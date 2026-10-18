/** Local model store: directory resolution, ids, metadata, registry persistence and pruning. */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LOCAL_MODELS_DIR_ENV,
  MODEL_PARTIAL_SUFFIX,
  MODEL_REGISTRY_FILENAME,
  MODEL_REGISTRY_VERSION,
  deleteModel,
  deriveModelId,
  ensureModelsDirectory,
  listModels,
  parseModelMetadata,
  registerModel,
  resolveModelsDirectory,
  resolveRegistryPath,
  type LlamaModelMetadata,
} from '../src/llama-models.ts'
import type { LlamaModel } from '../src/llama-api.ts'

interface StoreFixture {
  readonly models: string
  readonly environment: NodeJS.ProcessEnv
}

const roots: string[] = []

/** A throwaway models directory that cleanup always removes. */
function store(): StoreFixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-llama-models-'))
  roots.push(root)
  const models = join(root, 'models')
  return { models, environment: { [LOCAL_MODELS_DIR_ENV]: models } }
}

/** Write one GGUF file into the fixture and build its registry entry. */
function prepared(fixture: StoreFixture, file: string, overrides: Partial<LlamaModel> = {}): LlamaModel {
  mkdirSync(fixture.models, { recursive: true })
  const path = join(fixture.models, file)
  writeFileSync(path, `gguf:${file}`)
  return {
    id: deriveModelId({ repo: 'owner/repo', file }),
    repo: 'owner/repo',
    file,
    path,
    sizeBytes: statSync(path).size,
    downloadedAt: 1_000,
    ...overrides,
  }
}

/** Read the raw registry document text, failing loudly when it is absent. */
function registryText(fixture: StoreFixture): string {
  return readFileSync(join(fixture.models, MODEL_REGISTRY_FILENAME), 'utf8')
}

/** Read the registered entries without the store's tolerance for corruption. */
function registryModels(fixture: StoreFixture): LlamaModel[] {
  const document = JSON.parse(registryText(fixture)) as { models: LlamaModel[] }
  return document.models
}

/** Run an action while this module's call-time platform check reports `platform`. */
function withPlatform<T>(platform: NodeJS.Platform, action: () => T): T {
  const saved = Object.getOwnPropertyDescriptor(process, 'platform')!
  try {
    Object.defineProperty(process, 'platform', { ...saved, value: platform })
    return action()
  } finally {
    Object.defineProperty(process, 'platform', saved)
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('resolveModelsDirectory', () => {
  it('honors the DSH_LOCAL_MODELS_DIR override for the directory and registry', () => {
    const fixture = store()
    const override = join(fixture.models, 'custom')
    const environment: NodeJS.ProcessEnv = { [LOCAL_MODELS_DIR_ENV]: override }
    expect(resolveModelsDirectory(environment)).toBe(override)
    expect(resolveRegistryPath(environment)).toBe(join(override, MODEL_REGISTRY_FILENAME))
  })

  it('resolves the product directory under LOCALAPPDATA on Windows', () => {
    const localAppData = 'C:\\Users\\operator\\AppData\\Local'
    withPlatform('win32', () => {
      expect(resolveModelsDirectory({ LOCALAPPDATA: localAppData })).toBe(join(localAppData, 'SecScan Red Team', 'models'))
    })
  })

  it('falls back to the home directory outside Windows', () => {
    withPlatform('linux', () => {
      expect(resolveModelsDirectory({})).toBe(join(homedir(), '.secscan-redteam', 'models'))
    })
  })

  it('falls back to the home directory on Windows without LOCALAPPDATA', () => {
    withPlatform('win32', () => {
      expect(resolveModelsDirectory({})).toBe(join(homedir(), '.secscan-redteam', 'models'))
    })
  })

  it('ignores a blank override', () => {
    withPlatform('linux', () => {
      const environment: NodeJS.ProcessEnv = { [LOCAL_MODELS_DIR_ENV]: '   ' }
      expect(resolveModelsDirectory(environment)).toBe(join(homedir(), '.secscan-redteam', 'models'))
    })
  })
})

describe('ensureModelsDirectory', () => {
  it('creates the models directory on demand and again idempotently', async () => {
    const fixture = store()
    expect(existsSync(fixture.models)).toBe(false)
    await expect(ensureModelsDirectory(fixture.environment)).resolves.toBe(fixture.models)
    expect(statSync(fixture.models).isDirectory()).toBe(true)
    await expect(ensureModelsDirectory(fixture.environment)).resolves.toBe(fixture.models)
  })

  it('is not called by listing, which leaves the directory absent', async () => {
    const fixture = store()
    expect(await listModels(fixture.environment)).toStrictEqual([])
    expect(existsSync(fixture.models)).toBe(false)
  })
})

describe('deriveModelId', () => {
  it('joins the owner, repository name and file stem', () => {
    expect(deriveModelId({
      repo: 'mradermacher/Huihui-Qwen3.8-27B-abliterated-GGUF',
      file: 'Huihui-Qwen3.8-27B-abliterated.Q4_K_M.gguf',
    })).toBe('mradermacher--huihui-qwen3-8-27b-abliterated-gguf--huihui-qwen3-8-27b-abliterated-q4-k-m')
  })

  it('lowercases and collapses punctuation in both repo and file', () => {
    expect(deriveModelId({ repo: 'Org/My..Repo', file: 'Model (v2) [Q8_0].gguf' }))
      .toBe('org--my-repo--model-v2-q8-0')
  })

  it('strips the extension from paths, not the directory', () => {
    expect(deriveModelId({ repo: 'owner/repo', file: 'nested/dir/Some Model.Q4_K_M.gguf' }))
      .toBe('owner--repo--some-model-q4-k-m')
  })

  it('keeps a two-part id for a repository without an owner', () => {
    expect(deriveModelId({ repo: 'gpt2', file: 'gpt2.Q4_0.gguf' })).toBe('gpt2--gpt2-q4-0')
  })

  it('normalizes only ASCII letters and digits, so accents become separators', () => {
    expect(deriveModelId({ repo: 'owner/r\u00e9po', file: 'M\u00f6del.gguf' })).toBe('owner--r-po--m-del')
  })

  it('derives the same id for names that normalize alike', () => {
    const dotted = deriveModelId({ repo: 'owner/repo', file: 'Model.Q4_K_M.gguf' })
    const hyphenated = deriveModelId({ repo: 'OWNER/Repo', file: 'model-q4-k-m.gguf' })
    expect(dotted).toBe('owner--repo--model-q4-k-m')
    expect(hyphenated).toBe(dotted)
  })

  it('refuses to derive an id from empty parts', () => {
    expect(() => deriveModelId({ repo: '  ', file: 'model.gguf' })).toThrow(/empty repository/)
    expect(() => deriveModelId({ repo: 'owner/repo', file: '  ' })).toThrow(/empty file name/)
  })
})

const metadataCases: Array<[string, LlamaModelMetadata]> = [
  ['Huihui-Qwen3.8-27B-abliterated.Q4_K_M.gguf', { quantization: 'Q4_K_M', parameterSize: '27B' }],
  ['DeepSeek-R1-Distill-Qwen-7B-IQ4_XS.gguf', { quantization: 'IQ4_XS', parameterSize: '7B' }],
  ['Llama-3.1-8B-Instruct-Q8_0.gguf', { quantization: 'Q8_0', parameterSize: '8B' }],
  ['gemma-2-2b-it-q4_0.gguf', { quantization: 'Q4_0', parameterSize: '2B' }],
  ['Phi-3-mini-1.5B-f16.gguf', { quantization: 'F16', parameterSize: '1.5B' }],
  ['Mistral-7B-v0.3-BF16.gguf', { quantization: 'BF16', parameterSize: '7B' }],
  ['TinyLlama-1.1B-Chat.Q5_K_S.gguf', { quantization: 'Q5_K_S', parameterSize: '1.1B' }],
  ['granite-3.0-8b-instruct.Q6_K.gguf', { quantization: 'Q6_K', parameterSize: '8B' }],
  ['some-model-350M.gguf', { parameterSize: '350M' }],
  ['Q4_K_M.gguf', { quantization: 'Q4_K_M' }],
  ['model.gguf', {}],
  ['README.md', {}],
]

describe('parseModelMetadata', () => {
  it.each(metadataCases)('parses metadata from %s', (file, expected) => {
    expect(parseModelMetadata(file)).toStrictEqual(expected)
  })

  it('reads the file name out of a full path', () => {
    expect(parseModelMetadata(join('models', 'Mistral-7B-v0.3-IQ4_XS.gguf')))
      .toStrictEqual({ quantization: 'IQ4_XS', parameterSize: '7B' })
  })

  it('takes the last quantization token when several appear', () => {
    expect(parseModelMetadata('model-IQ2_XXS-Q4_K_M.gguf')).toStrictEqual({ quantization: 'Q4_K_M' })
  })
})

describe('registry round-trip', () => {
  it('registers models and lists them newest first with on-disk sizes', async () => {
    const fixture = store()
    const older = prepared(fixture, 'older.Q4_K_M.gguf', { downloadedAt: 1_000 })
    const newer = prepared(fixture, 'newer.Q8_0.gguf', { downloadedAt: 2_000 })
    await registerModel(older, fixture.environment)
    await registerModel(newer, fixture.environment)
    const models = await listModels(fixture.environment)
    expect(models.map(model => model.id)).toStrictEqual([newer.id, older.id])
    expect(models[0]).toStrictEqual(newer)
    expect(models[0]!.sizeBytes).toBe(statSync(newer.path).size)
    expect(models[1]).toStrictEqual(older)
  })

  it('replaces an entry that derives the same id', async () => {
    const fixture = store()
    const first = prepared(fixture, 'First.Q4_K_M.gguf')
    const replacement = prepared(fixture, 'Second.Q8_0.gguf', { id: first.id, downloadedAt: 2_000 })
    await registerModel(first, fixture.environment)
    await registerModel(replacement, fixture.environment)
    expect(await listModels(fixture.environment)).toStrictEqual([replacement])
    expect(registryModels(fixture)).toStrictEqual([replacement])
  })

  it('serializes concurrent registrations without losing one', async () => {
    const fixture = store()
    const first = prepared(fixture, 'a.Q4_K_M.gguf')
    const second = prepared(fixture, 'b.Q8_0.gguf', { downloadedAt: 2_000 })
    await Promise.all([
      registerModel(first, fixture.environment),
      registerModel(second, fixture.environment),
    ])
    expect((await listModels(fixture.environment)).map(model => model.id).sort())
      .toStrictEqual([first.id, second.id].sort())
  })

  it('creates the models directory on the first registration', async () => {
    const fixture = store()
    expect(existsSync(fixture.models)).toBe(false)
    const ghost: LlamaModel = {
      id: 'owner--repo--ghost',
      repo: 'owner/repo',
      file: 'ghost.gguf',
      path: join(fixture.models, 'ghost.gguf'),
      sizeBytes: 0,
      downloadedAt: 5,
    }
    await registerModel(ghost, fixture.environment)
    expect(statSync(fixture.models).isDirectory()).toBe(true)
    expect(existsSync(join(fixture.models, MODEL_REGISTRY_FILENAME))).toBe(true)
    expect(await listModels(fixture.environment)).toStrictEqual([])
  })

  it('writes the documented registry schema with a trailing newline', async () => {
    const fixture = store()
    await registerModel(prepared(fixture, 'a.gguf'), fixture.environment)
    await registerModel(prepared(fixture, 'b.gguf', { downloadedAt: 2_000 }), fixture.environment)
    const raw = registryText(fixture)
    expect(raw.endsWith('\n')).toBe(true)
    const document = JSON.parse(raw) as { version: unknown; models: unknown[] }
    expect(document.version).toBe(MODEL_REGISTRY_VERSION)
    expect(document.models).toHaveLength(2)
  })
})

describe('tolerant registry reads', () => {
  it('lists nothing without a registry document', async () => {
    const fixture = store()
    expect(await listModels(fixture.environment)).toStrictEqual([])
  })

  it('lists nothing for corrupt, non-object and foreign-version documents', async () => {
    const documents = ['{ not json', 'null', '[]', '"models"', '42', 'true', '', '{"version":2,"models":[]}',
      '{"version":1,"models":{}}', '{"version":1}']
    for (const document of documents) {
      const fixture = store()
      mkdirSync(fixture.models, { recursive: true })
      writeFileSync(join(fixture.models, MODEL_REGISTRY_FILENAME), document)
      expect(await listModels(fixture.environment)).toStrictEqual([])
    }
  })

  it('drops invalid entries but keeps valid ones', async () => {
    const fixture = store()
    const valid = prepared(fixture, 'valid.Q4_K_M.gguf')
    const invalid = [
      null,
      42,
      'model',
      {},
      { id: 'owner--repo--missing', repo: 'owner/repo', file: 'missing.gguf' },
    ]
    writeFileSync(
      join(fixture.models, MODEL_REGISTRY_FILENAME),
      JSON.stringify({ version: MODEL_REGISTRY_VERSION, models: [valid, ...invalid] }),
    )
    expect(await listModels(fixture.environment)).toStrictEqual([valid])
  })

  it('prunes entries whose file is missing from the listing but not the document', async () => {
    const fixture = store()
    const kept = prepared(fixture, 'kept.gguf')
    const removed = prepared(fixture, 'removed.gguf', { downloadedAt: 2_000 })
    await registerModel(kept, fixture.environment)
    await registerModel(removed, fixture.environment)
    rmSync(removed.path)
    expect(await listModels(fixture.environment)).toStrictEqual([kept])
    expect(registryModels(fixture)).toHaveLength(2)
  })
})

describe('deleteModel', () => {
  it('removes the model file, its partial sidecar and the registry entry', async () => {
    const fixture = store()
    const doomed = prepared(fixture, 'doomed.Q4_K_M.gguf')
    const sidecar = `${doomed.path}${MODEL_PARTIAL_SUFFIX}`
    writeFileSync(sidecar, 'partial')
    await registerModel(doomed, fixture.environment)
    await deleteModel(doomed.id, fixture.environment)
    expect(existsSync(doomed.path)).toBe(false)
    expect(existsSync(sidecar)).toBe(false)
    expect(await listModels(fixture.environment)).toStrictEqual([])
    expect(registryModels(fixture)).toStrictEqual([])
  })

  it('ignores an unknown id and leaves the registry untouched', async () => {
    const fixture = store()
    const model = prepared(fixture, 'kept.Q8_0.gguf')
    await registerModel(model, fixture.environment)
    const before = registryText(fixture)
    await deleteModel('owner--repo--not-registered', fixture.environment)
    expect(registryText(fixture)).toBe(before)
    expect(await listModels(fixture.environment)).toStrictEqual([model])
  })

  it('tolerates an entry whose file is already gone', async () => {
    const fixture = store()
    const ghost: LlamaModel = {
      id: 'owner--repo--ghost',
      repo: 'owner/repo',
      file: 'ghost.gguf',
      path: join(fixture.models, 'ghost.gguf'),
      sizeBytes: 7,
      downloadedAt: 1,
    }
    await registerModel(ghost, fixture.environment)
    await deleteModel(ghost.id, fixture.environment)
    expect(registryModels(fixture)).toStrictEqual([])
  })
})

describe('atomic registry writes', () => {
  it('never leaves a temporary document behind', async () => {
    const fixture = store()
    const first = prepared(fixture, 'a.gguf')
    const second = prepared(fixture, 'b.gguf', { downloadedAt: 2_000 })
    await registerModel(first, fixture.environment)
    await registerModel(second, fixture.environment)
    await deleteModel(first.id, fixture.environment)
    expect(readdirSync(fixture.models).filter(name => name.includes('.tmp'))).toStrictEqual([])
    expect(JSON.parse(registryText(fixture))).toMatchObject({ version: MODEL_REGISTRY_VERSION, models: [{ id: second.id }] })
  })

  it('cleans its temporary file when the registry cannot be replaced', async () => {
    const fixture = store()
    mkdirSync(fixture.models, { recursive: true })
    mkdirSync(join(fixture.models, MODEL_REGISTRY_FILENAME))
    const model = prepared(fixture, 'model.gguf')
    await expect(registerModel(model, fixture.environment)).rejects.toThrow()
    expect(readdirSync(fixture.models).filter(name => name.includes('.tmp'))).toStrictEqual([])
  })
})
