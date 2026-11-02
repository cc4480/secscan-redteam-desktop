/**
 * /api/models route — the chat view's engine banner data.
 * Proves the seat policy the banner renders: with REDTEAM_LLM_PROVIDER=meta
 * every role seats on Meta Muse Spark and the meta provider reports itself.
 * Also proves the local entry: the desktop's active model appears exactly
 * while its published server state says running AND the endpoint probe
 * confirms the server serves that model — never from the documents alone.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerResponse } from 'node:http'
import { handleModels } from '../src/ui/routes/models.js'
import type { LocalModelEntry } from '../src/ui/local-model.js'

interface Captured {
  status: number
  body: string
}

function fakeRes(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: 0, body: '' }
  const res = {
    writeHead(status: number) {
      captured.status = status
      return res
    },
    end(chunk?: string) {
      captured.body = chunk ?? ''
      return res
    },
  }
  return { res: res as unknown as ServerResponse, captured }
}

describe('GET /api/models', () => {
  it('reports the meta seats when REDTEAM_LLM_PROVIDER=meta', async () => {
    const prevProvider = process.env.REDTEAM_LLM_PROVIDER
    const prevKey = process.env.MODEL_API_KEY
    process.env.REDTEAM_LLM_PROVIDER = 'meta'
    process.env.MODEL_API_KEY = 'test-key-not-real'
    try {
      const { res, captured } = fakeRes()
      await handleModels(res)
      assert.equal(captured.status, 200)
      const data = JSON.parse(captured.body) as {
        activeProvider: string
        providers: Array<{ id: string; configured: boolean }>
        seats: Array<{ role: string; provider: string; model: string }>
      }
      assert.equal(data.activeProvider, 'meta')
      const meta = data.providers.find(p => p.id === 'meta')
      assert.ok(meta, 'meta provider is registered')
      assert.equal(meta.configured, true)
      assert.equal(data.seats.length, 5)
      assert.ok(
        data.seats.some(s => s.role === 'architect'),
        'the architect seat is reported',
      )
      for (const seat of data.seats) {
        assert.equal(seat.provider, 'meta')
        assert.equal(seat.model, 'muse-spark-1.3')
      }
    } finally {
      if (prevProvider === undefined) delete process.env.REDTEAM_LLM_PROVIDER
      else process.env.REDTEAM_LLM_PROVIDER = prevProvider
      if (prevKey === undefined) delete process.env.MODEL_API_KEY
      else process.env.MODEL_API_KEY = prevKey
    }
  })
})

const LOCAL_MODEL_ID = 'acme--qwen-fixture--qwen3-6-35b-a3b-fixture'
const LOCAL_MODEL_FILE = 'Qwen3.6-35B-A3B-Fixture.gguf'
const LOCAL_BASE_URL = 'http://127.0.0.1:19876/v1'

interface LocalFixture {
  env: NodeJS.ProcessEnv
  dir: string
}

/** Seed a desktop models directory: one registered, active model on disk. */
function seedLocalModels(state: Record<string, unknown> | null): LocalFixture {
  const dir = mkdtempSync(join(tmpdir(), 'ui-models-local-'))
  const modelPath = join(dir, 'model.gguf')
  writeFileSync(modelPath, 'GGUF fixture bytes')
  writeFileSync(join(dir, 'registry.json'), JSON.stringify({
    version: 1,
    models: [{
      id: LOCAL_MODEL_ID,
      repo: 'acme/Qwen-Fixture-GGUF',
      file: LOCAL_MODEL_FILE,
      path: modelPath,
      sizeBytes: 18,
      downloadedAt: 1,
    }],
  }))
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({
    activeModelId: LOCAL_MODEL_ID,
    contextLength: 32768,
    threads: 4,
    startOnLaunch: false,
  }))
  if (state !== null) writeFileSync(join(dir, 'server-state.json'), JSON.stringify(state))
  return {
    dir,
    env: {
      DSH_LOCAL_MODELS_DIR: dir,
      REDTEAM_LLM_PROVIDER: 'meta',
      MODEL_API_KEY: 'test-key-not-real',
    },
  }
}

async function localModelOf(
  fixture: LocalFixture,
  probe: (baseUrl: string) => Promise<readonly string[] | null>,
): Promise<LocalModelEntry | null> {
  const { res, captured } = fakeRes()
  await handleModels(res, { env: fixture.env, probe })
  assert.equal(captured.status, 200)
  const data = JSON.parse(captured.body) as { localModel: LocalModelEntry | null }
  return data.localModel
}

describe('GET /api/models — local model entry', () => {
  const runningState = {
    version: 1,
    status: 'running',
    baseUrl: LOCAL_BASE_URL,
    modelId: LOCAL_MODEL_ID,
    updatedAt: 1,
  }

  it('lists the active local model while its server provably serves it', async () => {
    const fixture = seedLocalModels(runningState)
    const probed: string[] = []
    const entry = await localModelOf(fixture, async (baseUrl) => {
      probed.push(baseUrl)
      return [LOCAL_MODEL_ID]
    })
    assert.deepEqual(probed, [LOCAL_BASE_URL])
    assert.deepEqual(entry, {
      provider: 'local',
      model: LOCAL_MODEL_ID,
      label: 'Qwen3.6-35B-A3B-Fixture · Local',
      baseUrl: LOCAL_BASE_URL,
    })
  })

  it('omits the entry when the published state says the server is stopped', async () => {
    const fixture = seedLocalModels({ version: 1, status: 'stopped', updatedAt: 1 })
    let probed = false
    const entry = await localModelOf(fixture, async () => {
      probed = true
      return [LOCAL_MODEL_ID]
    })
    assert.equal(entry, null)
    assert.equal(probed, false)
  })

  it('omits the entry when the endpoint does not answer (stale running state)', async () => {
    const fixture = seedLocalModels(runningState)
    const entry = await localModelOf(fixture, async () => null)
    assert.equal(entry, null)
  })

  it('omits the entry when the endpoint serves a different model', async () => {
    const fixture = seedLocalModels(runningState)
    const entry = await localModelOf(fixture, async () => ['someone-elses-model'])
    assert.equal(entry, null)
  })

  it('omits the entry when the state names a model other than the active one', async () => {
    const fixture = seedLocalModels({ ...runningState, modelId: 'a--different--model' })
    const entry = await localModelOf(fixture, async () => [LOCAL_MODEL_ID])
    assert.equal(entry, null)
  })

  it('omits the entry when no server state was ever published', async () => {
    const fixture = seedLocalModels(null)
    const entry = await localModelOf(fixture, async () => [LOCAL_MODEL_ID])
    assert.equal(entry, null)
  })
})
