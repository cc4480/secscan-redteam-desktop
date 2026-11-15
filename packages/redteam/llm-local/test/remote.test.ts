/**
 * Remote-seat test for the `localModels` namespace: B1's
 * `adapter.localModelsStatus()` read, called through the Typert Gateway
 * face (`ctx.typertGateway.invoke`) — never by calling the adapter or
 * the service directly — against compositions that boot the real plugin.
 *
 * The Ollama suites boot the plugin in Ollama serving mode against a
 * stub Ollama endpoint — one through a test-only cordis.yml over the
 * real Cordis Loader (the composition style of
 * `./composition.test.ts`) with the Typert registry and Gateway rows
 * beside the llm-local row, one through direct plugin mounts. The llama
 * suites mount the pieces directly so the plugin fiber's disposal can
 * be observed: the seat is provided by the plugin, so disposing the
 * fiber withdraws the Remote endpoint.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import * as llmLocal from '../src/index.js'
import type { LocalModelsStatus } from '../src/index.js'
import {
  ACTIVE_MODEL_FILE,
  ACTIVE_MODEL_ID,
  createFixtureModelsDir,
  FIXTURE_BASE_URL,
  SECOND_MODEL_FILE,
  SECOND_MODEL_ID,
  writeServerState,
} from './fixtures.js'

/** Stub model id the Ollama endpoint serves first and has loaded. */
const STUB_MODEL_ID = 'stub-model:9b'
/** Stub model id the Ollama endpoint serves second and has not loaded. */
const STUB_SECOND_MODEL_ID = 'stub-other:27b'

/**
 * Start a stub Ollama endpoint on an ephemeral loopback port: the model
 * list names both stub models, `/api/ps` names the first loaded with a
 * 4096 runtime allocation and 42 bytes of VRAM, and `/api/tags` names
 * much larger maxima for both.
 * @returns the running server.
 */
function startStubOllama(): Server {
  const server = createServer((request, response) => {
    const url = request.url ?? ''
    if (url.endsWith('/v1/models')) {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ object: 'list', data: [{ id: STUB_MODEL_ID }, { id: STUB_SECOND_MODEL_ID }] }))
      return
    }
    if (url.endsWith('/api/ps')) {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ models: [{ name: STUB_MODEL_ID, context_length: 4096, size_vram: 42 }] }))
      return
    }
    if (url.endsWith('/api/tags')) {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        models: [
          { name: STUB_MODEL_ID, details: { context_length: 131072 } },
          { name: STUB_SECOND_MODEL_ID, details: { context_length: 32768 } },
        ],
      }))
      return
    }
    response.statusCode = 404
    response.end('not found')
  })
  return server
}

/**
 * Call the panel status through the Gateway face, as the web transport does.
 * @param context - composition carrying the Gateway.
 * @returns the status payload the Remote method returned.
 */
async function invokeStatus(context: Context): Promise<LocalModelsStatus> {
  return await context.typertGateway.invoke({
    namespace: 'localModels',
    method: 'status',
    args: {},
  }) as LocalModelsStatus
}

describe('llm-local Remote seat (Ollama, direct composition)', () => {
  it('answers localModels/status through the Gateway with the adapter payload, unreshaped', async () => {
    const modelsDir = await createFixtureModelsDir()
    const server = startStubOllama()
    await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
    const port = (server.address() as AddressInfo).port
    const baseUrl = `http://127.0.0.1:${port}/v1`
    const context = new Context()
    try {
      await context.plugin(TypertRegistry)
      await context.plugin(TypertGatewayService)
      await context.plugin(LlmRuntime)
      await context.plugin(llmLocal, {
        modelsDir,
        serving: 'ollama',
        ollamaBaseUrl: baseUrl,
        ollamaProbeIntervalMs: 60000,
      })

      assert.ok(context.get('localModels') !== undefined, 'the plugin did not provide the localModels service')
      const status = await invokeStatus(context)
      assert.deepEqual(status, {
        serving: 'ollama',
        endpoint: { up: true, baseUrl },
        models: [
          { id: STUB_MODEL_ID, loaded: true, contextLength: 4096, maxContextLength: 131072, sizeVram: 42 },
          { id: STUB_SECOND_MODEL_ID, loaded: false, maxContextLength: 32768 },
        ],
        folderModels: [
          { id: ACTIVE_MODEL_ID, path: join(modelsDir, ACTIVE_MODEL_FILE) },
          { id: SECOND_MODEL_ID, path: join(modelsDir, SECOND_MODEL_FILE) },
        ],
      })
    } finally {
      await context.fiber.dispose()
      await new Promise<void>(resolveClose => server.close(() => resolveClose()))
    }
  })
})

describe('llm-local Remote seat (Ollama, real Loader composition)', () => {
  it('answers localModels/status through the Gateway with the adapter payload, unreshaped', async () => {
    const modelsDir = await createFixtureModelsDir()
    const server = startStubOllama()
    await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
    const port = (server.address() as AddressInfo).port
    const baseUrl = `http://127.0.0.1:${port}/v1`
    const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
    const root = await mkdtemp(join(packageRoot, '.composition-'))
    const context = new Context()
    try {
      const configPath = join(root, 'cordis.yml')
      await writeFile(configPath, [
        "- name: '@deepseek-ai/dsh-llm'",
        "- name: '@deepseek-ai/dsh-typert-registry'",
        "- name: '@deepseek-ai/dsh-api-gateway'",
        "- name: '@secscan/redteam-llm-local'",
        '  config:',
        '    serving: ollama',
        `    ollamaBaseUrl: ${baseUrl}`,
        `    modelsDir: ${modelsDir}`,
        '    ollamaProbeIntervalMs: 60000',
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

      assert.ok(context.get('localModels') !== undefined, 'the plugin did not provide the localModels service')
      const status = await invokeStatus(context)
      assert.deepEqual(status, {
        serving: 'ollama',
        endpoint: { up: true, baseUrl },
        models: [
          { id: STUB_MODEL_ID, loaded: true, contextLength: 4096, maxContextLength: 131072, sizeVram: 42 },
          { id: STUB_SECOND_MODEL_ID, loaded: false, maxContextLength: 32768 },
        ],
        folderModels: [
          { id: ACTIVE_MODEL_ID, path: join(modelsDir, ACTIVE_MODEL_FILE) },
          { id: SECOND_MODEL_ID, path: join(modelsDir, SECOND_MODEL_FILE) },
        ],
      })
    } finally {
      await context.fiber.dispose()
      await rm(root, { recursive: true, force: true })
      await new Promise<void>(resolveClose => server.close(() => resolveClose()))
    }
  })
})

/**
 * Start a stub llama-server endpoint on an ephemeral loopback port: its
 * `/v1/models` answers with the fixture's active model, the way a real
 * llama-server publishes its `--alias`. Status probe-verifies the
 * endpoint, so a llama status test needs a live endpoint, not just a
 * published state document.
 * @returns the running server.
 */
function startStubLlama(): Server {
  const server = createServer((request, response) => {
    if ((request.url ?? '').endsWith('/v1/models')) {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ object: 'list', data: [{ id: ACTIVE_MODEL_ID }] }))
      return
    }
    response.statusCode = 404
    response.end('not found')
  })
  return server
}

describe('llm-local Remote seat (llama mode)', () => {
  it('reports the probe-verified llama-server state through the Gateway', async () => {
    const modelsDir = await createFixtureModelsDir()
    const llama = startStubLlama()
    await new Promise<void>(resolveListen => llama.listen(0, '127.0.0.1', resolveListen))
    const port = (llama.address() as AddressInfo).port
    const baseUrl = `http://127.0.0.1:${port}/v1`
    await writeServerState(modelsDir, { status: 'running', baseUrl, modelId: ACTIVE_MODEL_ID })
    const context = new Context()
    try {
      await context.plugin(TypertRegistry)
      await context.plugin(TypertGatewayService)
      await context.plugin(LlmRuntime)
      await context.plugin(llmLocal, { modelsDir })

      const status = await invokeStatus(context)
      assert.deepEqual(status, {
        serving: 'llama',
        endpoint: { up: true, baseUrl },
        models: [
          { id: ACTIVE_MODEL_ID, loaded: true, contextLength: 32768 },
          { id: SECOND_MODEL_ID, loaded: false, contextLength: 32768 },
        ],
        folderModels: [
          { id: ACTIVE_MODEL_ID, path: join(modelsDir, ACTIVE_MODEL_FILE) },
          { id: SECOND_MODEL_ID, path: join(modelsDir, SECOND_MODEL_FILE) },
        ],
      })
    } finally {
      await context.fiber.dispose()
      await new Promise<void>(resolveClose => llama.close(() => resolveClose()))
    }
  })

  it('reports a stale running document as down when the endpoint does not answer', async () => {
    const modelsDir = await createFixtureModelsDir()
    // The published document claims a running server at the fixture base
    // URL, but nothing listens there: the document alone is not proof.
    await writeServerState(modelsDir, { status: 'running', baseUrl: FIXTURE_BASE_URL, modelId: ACTIVE_MODEL_ID })
    const context = new Context()
    try {
      await context.plugin(TypertRegistry)
      await context.plugin(TypertGatewayService)
      await context.plugin(LlmRuntime)
      await context.plugin(llmLocal, { modelsDir })

      const status = await invokeStatus(context)
      assert.deepEqual(status.endpoint, { up: false, baseUrl: FIXTURE_BASE_URL })
      assert.deepEqual(status.models.map(model => model.loaded), [false, false])
      assert.deepEqual(status.folderModels.map(model => model.id), [ACTIVE_MODEL_ID, SECOND_MODEL_ID])
    } finally {
      await context.fiber.dispose()
    }
  })

  it('reports a stopped server honestly, and the endpoint withdraws with the plugin fiber', async () => {
    const modelsDir = await createFixtureModelsDir()
    // No server-state.json: the llama server is stopped.
    const context = new Context()
    try {
      await context.plugin(TypertRegistry)
      await context.plugin(TypertGatewayService)
      await context.plugin(LlmRuntime)
      const fiber = await context.plugin(llmLocal, { modelsDir })

      const status = await invokeStatus(context)
      assert.deepEqual(status.endpoint, { up: false, baseUrl: '' })
      assert.deepEqual(status.models.map(model => model.loaded), [false, false])
      assert.deepEqual(status.folderModels.map(model => model.id), [ACTIVE_MODEL_ID, SECOND_MODEL_ID])

      await fiber.dispose()
      assert.equal(context.get('localModels'), undefined)
      await assert.rejects(
        invokeStatus(context),
        (error: unknown) => remoteErrorOf(error)?.code === 'gateway/invocation-unavailable',
      )
    } finally {
      await context.fiber.dispose()
    }
  })
})
