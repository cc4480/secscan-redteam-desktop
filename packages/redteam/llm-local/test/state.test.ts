import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  localModelLabel,
  readLocalModelsDirectory,
  readLocalServerState,
  resolveLocalDispatch,
  resolveLocalModelsDirectory,
  watchLocalModelsDirectory,
} from '../src/index.js'
import {
  ACTIVE_MODEL_ID,
  createFixtureModelsDir,
  FIXTURE_BASE_URL,
  SECOND_MODEL_ID,
  writeServerState,
} from './fixtures.js'

describe('local models directory state', () => {
  it('reads the registry, settings, and absence of server state', async () => {
    const directory = await createFixtureModelsDir()
    const state = readLocalModelsDirectory(directory)
    assert.equal(state.models.length, 3)
    assert.equal(state.models[0]?.id, ACTIVE_MODEL_ID)
    assert.equal(state.settings.activeModelId, ACTIVE_MODEL_ID)
    assert.equal(state.settings.contextLength, 32768)
    assert.equal(state.server, undefined)
  })

  it('tolerates a directory with no documents at all', async () => {
    const directory = await createFixtureModelsDir()
    const empty = join(directory, 'does-not-exist')
    const state = readLocalModelsDirectory(empty)
    assert.deepEqual(state.models, [])
    assert.equal(state.settings.activeModelId, undefined)
    assert.equal(state.server, undefined)
  })

  it('drops registry entries with unusable fields instead of failing', async () => {
    const directory = await createFixtureModelsDir()
    await writeFile(join(directory, 'registry.json'), JSON.stringify({
      models: [{ id: ACTIVE_MODEL_ID }, 'junk', { id: 'ok', file: 'ok.gguf', path: '/tmp/ok.gguf' }],
    }))
    const state = readLocalModelsDirectory(directory)
    assert.deepEqual(state.models.map(model => model.id), ['ok'])
  })

  it('validates the server-state document the way the desktop reader does', async () => {
    const directory = await createFixtureModelsDir()
    await writeServerState(directory, { status: 'running', baseUrl: FIXTURE_BASE_URL, modelId: ACTIVE_MODEL_ID })
    assert.deepEqual(readLocalServerState(directory), {
      status: 'running',
      baseUrl: FIXTURE_BASE_URL,
      modelId: ACTIVE_MODEL_ID,
    })

    // Wrong schema version: not a state this reader may act on.
    await writeFile(join(directory, 'server-state.json'), JSON.stringify({ version: 2, status: 'running', updatedAt: 1 }))
    assert.equal(readLocalServerState(directory), undefined)

    // Unknown status: not a state this reader may act on.
    await writeServerState(directory, { status: 'sideways' })
    assert.equal(readLocalServerState(directory), undefined)
  })

  it('labels a model by its GGUF file stem plus the local marker', () => {
    assert.equal(
      localModelLabel({ id: ACTIVE_MODEL_ID, file: 'Qwen3.6-35B-A3B.gguf', path: '/x/Qwen3.6-35B-A3B.gguf' }),
      'Qwen3.6-35B-A3B · Local',
    )
  })

  it('resolves the models directory from override, then env, then platform default', () => {
    assert.equal(resolveLocalModelsDirectory({ DSH_LOCAL_MODELS_DIR: '/env/dir' }, '/cfg/dir'), '/cfg/dir')
    assert.equal(resolveLocalModelsDirectory({ DSH_LOCAL_MODELS_DIR: '/env/dir' }), '/env/dir')
    assert.equal(
      resolveLocalModelsDirectory({ LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' }),
      process.platform === 'win32'
        ? 'C:\\Users\\Test\\AppData\\Local\\SecScan Red Team\\models'
        : join(process.env['HOME'] ?? '', '.secscan-redteam', 'models'),
    )
  })
})

describe('local dispatch gate', () => {
  it('refuses every non-serving state with its own decision kind', () => {
    assert.deepEqual(resolveLocalDispatch(undefined, ACTIVE_MODEL_ID), { kind: 'stopped' })
    assert.deepEqual(resolveLocalDispatch({ status: 'stopped' }, ACTIVE_MODEL_ID), { kind: 'stopped' })
    assert.deepEqual(resolveLocalDispatch({ status: 'starting' }, ACTIVE_MODEL_ID), { kind: 'starting' })
    assert.deepEqual(resolveLocalDispatch({ status: 'error' }, ACTIVE_MODEL_ID), { kind: 'error' })
    // Running without a published endpoint is an error state, not a route.
    assert.deepEqual(resolveLocalDispatch({ status: 'running', modelId: ACTIVE_MODEL_ID }, ACTIVE_MODEL_ID), { kind: 'error' })
  })

  it('dispatches only to the model the server is actually serving', () => {
    assert.deepEqual(
      resolveLocalDispatch({ status: 'running', baseUrl: FIXTURE_BASE_URL, modelId: ACTIVE_MODEL_ID }, ACTIVE_MODEL_ID),
      { kind: 'ready', baseUrl: FIXTURE_BASE_URL },
    )
    assert.deepEqual(
      resolveLocalDispatch({ status: 'running', baseUrl: FIXTURE_BASE_URL, modelId: SECOND_MODEL_ID }, ACTIVE_MODEL_ID),
      { kind: 'serving-other', servingModelId: SECOND_MODEL_ID },
    )
    // A running state silent about its model still routes: the endpoint
    // itself is the authority for the one model it loaded.
    assert.deepEqual(
      resolveLocalDispatch({ status: 'running', baseUrl: FIXTURE_BASE_URL }, ACTIVE_MODEL_ID),
      { kind: 'ready', baseUrl: FIXTURE_BASE_URL },
    )
  })

  it('notifies after a state document changes', async () => {
    const directory = await createFixtureModelsDir()
    let notifications = 0
    const dispose = watchLocalModelsDirectory(directory, () => { notifications += 1 }, { debounceMs: 25 })
    try {
      await writeServerState(directory, { status: 'running', baseUrl: FIXTURE_BASE_URL, modelId: ACTIVE_MODEL_ID })
      const deadline = Date.now() + 5000
      while (notifications === 0 && Date.now() < deadline) {
        await new Promise(resolveWait => setTimeout(resolveWait, 25))
      }
      assert.equal(notifications, 1)
    } finally {
      dispose()
    }
  })
})
