/**
 * REAL-composition test (packages/AGENTS.md): the unit suites prove what
 * the adapter registers and returns, but not that the plugin composes.
 * This suite boots a test-only cordis.yml through the real Cordis Loader
 * with the real `LlmRuntime` and this plugin — resolved by name through
 * Node module resolution, exactly as the desktop bundle's row resolves
 * them — and asserts the model-visible output: the Host model catalog
 * built by `buildModelCatalog` (the `session/modelCatalog` RPC's own
 * builder) carries the Local group with the downloaded models while the
 * server is stopped. A second suite proves the registration disposes with
 * the plugin fiber and that the models-directory watcher emits
 * `llm/adapters-updated`.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { buildModelCatalog } from '@deepseek-ai/dsh-api-session-controller'
import * as llmLocal from '../src/index.js'
import {
  ACTIVE_MODEL_ID,
  createFixtureModelsDir,
  FIXTURE_BASE_URL,
  SECOND_MODEL_ID,
  writeServerState,
} from './fixtures.js'

describe('llm-local real Loader composition', () => {
  it('seats the Local group in the Host model catalog with the server stopped', async () => {
    const modelsDir = await createFixtureModelsDir()
    // No server-state.json exists: the server is stopped. The catalog
    // must still list the downloaded models (the reported bug's shape).
    const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
    const root = await mkdtemp(join(packageRoot, '.composition-'))
    const previousEnv = process.env['DSH_LOCAL_MODELS_DIR']
    process.env['DSH_LOCAL_MODELS_DIR'] = modelsDir
    const context = new Context()
    try {
      const configPath = join(root, 'cordis.yml')
      await writeFile(configPath, [
        "- name: '@deepseek-ai/dsh-llm'",
        "- name: '@secscan/redteam-llm-local'",
        '',
      ].join('\n'))

      context.baseUrl = pathToFileURL(root).href + '/'
      await context.plugin(Loader)
      context.loader.builtins.include = Include
      await context.loader.create({
        name: 'cordis:include',
        config: { path: pathToFileURL(configPath).href },
      })
      await context.loader.await()

      assert.ok(context.llm.listProviders().map(provider => provider.id).includes('local'))
      const catalog = await buildModelCatalog(context, { provider: 'local', model: ACTIVE_MODEL_ID })
      const localGroup = catalog.groups.find(group => group.id === 'local')
      assert.ok(localGroup !== undefined, `Local group missing from: ${catalog.groups.map(group => group.id).join(', ')}`)
      assert.equal(localGroup.name, 'Local')
      assert.deepEqual(localGroup.models.map(model => model.id), [ACTIVE_MODEL_ID, SECOND_MODEL_ID])
      assert.deepEqual(catalog.default, { provider: 'local', model: ACTIVE_MODEL_ID })
      assert.ok(catalog.routableProviders.includes('local'))
    } finally {
      if (previousEnv === undefined) delete process.env['DSH_LOCAL_MODELS_DIR']
      else process.env['DSH_LOCAL_MODELS_DIR'] = previousEnv
      await context.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('llm-local plugin lifecycle', () => {
  it('registers on apply, disposes with the fiber, and announces directory changes', async () => {
    const modelsDir = await createFixtureModelsDir()
    const context = new Context()
    try {
      await context.plugin(LlmRuntime)
      let announced = 0
      context.on('llm/adapters-updated', () => { announced += 1 })
      const fiber = await context.plugin(llmLocal, { modelsDir })
      assert.ok(context.llm.listProviders().map(provider => provider.id).includes('local'))
      const models = await context.llm.listModels('local')
      assert.deepEqual(models.map(model => model.id), [ACTIVE_MODEL_ID, SECOND_MODEL_ID])

      // Publishing a server state is a catalog-affecting change: the
      // watcher must announce it so open pickers refresh.
      await writeServerState(modelsDir, { status: 'running', baseUrl: FIXTURE_BASE_URL, modelId: ACTIVE_MODEL_ID })
      const deadline = Date.now() + 5000
      while (announced === 0 && Date.now() < deadline) {
        await new Promise(resolveWait => setTimeout(resolveWait, 25))
      }
      assert.ok(announced > 0, 'the watcher did not emit llm/adapters-updated after server-state changed')

      await fiber.dispose()
      assert.ok(!context.llm.listProviders().map(provider => provider.id).includes('local'))
    } finally {
      await context.fiber.dispose()
    }
  })
})
