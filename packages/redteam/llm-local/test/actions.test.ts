/**
 * Lifecycle-action tests for the Ollama serving mode: start (load),
 * stop (unload), delete, and pull against a stub Ollama transport that
 * records every request. Actions must hit the native endpoints with
 * the right payloads, verify their outcome against the endpoint's own
 * reads, and surface failures as failures — never as silent success.
 * Llama-mode actions live in ./llama-restore.test.ts; one honest-failure
 * edge of theirs is pinned at the bottom of this file.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { LocalLlamaAdapter } from '../src/index.js'
import type { LocalModelPullStatus } from '../src/index.js'
import { ACTIVE_MODEL_ID, createFixtureModelsDir } from './fixtures.js'

/** OpenAI-compatible base URL the stub Ollama endpoint answers on. */
const OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1'
/** Native API root the action endpoints live on. */
const NATIVE_BASE_URL = 'http://127.0.0.1:11434'
/** Stub model id the library holds and can load. */
const MODEL_A = 'alpha-model:9b'
/** Stub model id the library holds, never loaded. */
const MODEL_B = 'beta-model:27b'

/** Mutable state of one stub Ollama endpoint. */
interface StubActionState {
  /** Whether every request fails as a refused connection. */
  down: boolean
  /** Model ids the library holds (what `/v1/models` and `/api/tags` report). */
  library: Set<string>
  /** Model ids currently loaded (what `/api/ps` reports). */
  loaded: Set<string>
  /** Whether the generate call actually loads/unloads (false simulates an endpoint that accepts but does not act). */
  generateActs: boolean
  /** HTTP status the generate endpoint answers with, when not 200. */
  generateStatus?: number
  /** Pull responder override; defaults to an immediate one-line success stream. */
  pullResponder?: () => Response
}

/**
 * Build a fetch seam that answers the native action endpoints like
 * Ollama: generate loads/unloads per `keep_alive`, delete removes from
 * the library (404 when absent), and the catalog reads report the
 * stub state. Requests are recorded with their parsed JSON bodies.
 * @returns the fetch seam, its request log, and its mutable state.
 */
function stubOllamaActions(): {
  fetchImpl: typeof fetch
  requests: { url: string; method: string; body: Record<string, unknown> | undefined }[]
  state: StubActionState
} {
  const requests: { url: string; method: string; body: Record<string, unknown> | undefined }[] = []
  const state: StubActionState = {
    down: false,
    library: new Set([MODEL_A, MODEL_B]),
    loaded: new Set(),
    generateActs: true,
  }
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined
    requests.push({ url: String(url), method, body })
    if (state.down) throw new Error('connect ECONNREFUSED 127.0.0.1:11434')
    const path = String(url)
    if (path.endsWith('/v1/models')) {
      return Response.json({ object: 'list', data: [...state.library].map(id => ({ id })) })
    }
    if (path.endsWith('/api/ps')) {
      return Response.json({ models: [...state.loaded].map(name => ({ name })) })
    }
    if (path.endsWith('/api/tags')) {
      return Response.json({ models: [...state.library].map(name => ({ name })) })
    }
    if (path.endsWith('/api/generate')) {
      if (state.generateStatus !== undefined) {
        return new Response('generate refused', { status: state.generateStatus })
      }
      const model = body?.['model']
      if (typeof model === 'string' && state.generateActs) {
        if (body?.['keep_alive'] === 0) state.loaded.delete(model)
        else state.loaded.add(model)
      }
      return Response.json({ model, done: true, done_reason: 'unload' })
    }
    if (path.endsWith('/api/delete')) {
      const model = body?.['model']
      if (typeof model !== 'string' || !state.library.has(model)) {
        return new Response('model not found', { status: 404 })
      }
      state.library.delete(model)
      state.loaded.delete(model)
      return new Response(null, { status: 200 })
    }
    if (path.endsWith('/api/pull')) {
      if (state.pullResponder !== undefined) return state.pullResponder()
      return ndjson(['{"status":"pulling manifest"}', '{"status":"success"}'])
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  return { fetchImpl, requests, state }
}

/**
 * Build one NDJSON streaming response from raw lines.
 * @param lines - the JSON lines, without trailing newlines.
 * @returns the streaming response.
 */
function ndjson(lines: readonly string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
}

/**
 * @param directory - fixture models directory.
 * @param fetchImpl - the stub fetch seam.
 * @returns an adapter in Ollama mode against the stub endpoint.
 */
function ollamaAdapter(directory: string, fetchImpl: typeof fetch): LocalLlamaAdapter {
  return new LocalLlamaAdapter({
    modelsDir: directory,
    fetchImpl,
    serving: 'ollama',
    ollamaBaseUrl: OLLAMA_BASE_URL,
  })
}

/**
 * Await a rejection and return its reason.
 * @param promise - the promise expected to reject.
 * @returns the rejection reason.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the promise to reject, but it resolved')
}

/**
 * Poll one pull job until it settles or the deadline passes.
 * @param adapter - the adapter holding the job.
 * @param jobId - the job handle.
 * @returns the settled status.
 */
async function settledPull(adapter: LocalLlamaAdapter, jobId: string): Promise<LocalModelPullStatus> {
  const deadline = Date.now() + 5000
  for (;;) {
    const status = adapter.localModelPullStatus(jobId)
    if (status.state !== 'running') return status
    if (Date.now() > deadline) throw new Error(`pull job ${jobId} never settled`)
    await new Promise(resolveWait => setTimeout(resolveWait, 5))
  }
}

describe('ollama start/stop actions', () => {
  it('loads with a promptless keep-forever generate on the native API and verifies against /api/ps', async () => {
    const directory = await createFixtureModelsDir()
    const { fetchImpl, requests } = stubOllamaActions()
    const adapter = ollamaAdapter(directory, fetchImpl)

    const result = await adapter.startLocalModel(MODEL_A)
    assert.deepEqual(result, { modelId: MODEL_A, loaded: true })

    const generate = requests.filter(request => request.url.endsWith('/api/generate'))
    assert.equal(generate.length, 1)
    assert.equal(generate[0]?.url, `${NATIVE_BASE_URL}/api/generate`)
    assert.equal(generate[0]?.method, 'POST')
    assert.deepEqual(generate[0]?.body, { model: MODEL_A, prompt: '', stream: false, keep_alive: -1 })
    assert.ok(requests.some(request => request.url === `${NATIVE_BASE_URL}/api/ps`))
  })

  it('fails when the endpoint accepts the load but does not report the model loaded', async () => {
    const directory = await createFixtureModelsDir()
    const { fetchImpl, state } = stubOllamaActions()
    state.generateActs = false
    const adapter = ollamaAdapter(directory, fetchImpl)

    const error = await rejectionOf(adapter.startLocalModel(MODEL_A))
    assert.ok(error instanceof LlmError)
    assert.equal(error.failure.code, 'LOCAL_MODEL_LOAD_FAILED')
    assert.match(error.failure.message, /does not report it loaded/)
  })

  it('surfaces an HTTP refusal from the generate endpoint with its status', async () => {
    const directory = await createFixtureModelsDir()
    const { fetchImpl, state } = stubOllamaActions()
    state.generateStatus = 500
    const adapter = ollamaAdapter(directory, fetchImpl)

    const error = await rejectionOf(adapter.startLocalModel(MODEL_A))
    assert.ok(error instanceof LlmError)
    assert.equal(error.failure.code, 'LOCAL_OLLAMA_REQUEST_FAILED')
    assert.match(error.failure.message, /HTTP 500/)
  })

  it('fails a down endpoint as unreachable, naming Ollama', async () => {
    const directory = await createFixtureModelsDir()
    const { fetchImpl, state } = stubOllamaActions()
    state.down = true
    const adapter = ollamaAdapter(directory, fetchImpl)

    const error = await rejectionOf(adapter.startLocalModel(MODEL_A))
    assert.ok(error instanceof LlmError)
    assert.equal(error.failure.code, 'LOCAL_OLLAMA_UNREACHABLE')
    assert.match(error.failure.message, /Is Ollama running on the host\?/)
  })

  it('unloads with keep_alive 0 and verifies the model is gone from /api/ps', async () => {
    const directory = await createFixtureModelsDir()
    const { fetchImpl, requests, state } = stubOllamaActions()
    state.loaded.add(MODEL_A)
    const adapter = ollamaAdapter(directory, fetchImpl)

    const result = await adapter.stopLocalModel(MODEL_A)
    assert.deepEqual(result, { modelId: MODEL_A, loaded: false })

    const generate = requests.filter(request => request.url.endsWith('/api/generate'))
    assert.equal(generate.length, 1)
    assert.deepEqual(generate[0]?.body, { model: MODEL_A, keep_alive: 0 })
  })

  it('fails when the model is still loaded after the unload request', async () => {
    const directory = await createFixtureModelsDir()
    const { fetchImpl, state } = stubOllamaActions()
    state.loaded.add(MODEL_A)
    state.generateActs = false
    const adapter = ollamaAdapter(directory, fetchImpl)

    const error = await rejectionOf(adapter.stopLocalModel(MODEL_A))
    assert.ok(error instanceof LlmError)
    assert.equal(error.failure.code, 'LOCAL_MODEL_UNLOAD_FAILED')
  })
})

describe('ollama delete action', () => {
  it('deletes through the native DELETE endpoint and verifies the library no longer lists the model', async () => {
    const directory = await createFixtureModelsDir()
    const { fetchImpl, requests } = stubOllamaActions()
    const adapter = ollamaAdapter(directory, fetchImpl)

    const result = await adapter.deleteLocalModel(MODEL_B)
    assert.deepEqual(result, { modelId: MODEL_B, deleted: true })

    const deletion = requests.filter(request => request.url.endsWith('/api/delete'))
    assert.equal(deletion.length, 1)
    assert.equal(deletion[0]?.url, `${NATIVE_BASE_URL}/api/delete`)
    assert.equal(deletion[0]?.method, 'DELETE')
    assert.deepEqual(deletion[0]?.body, { model: MODEL_B })
  })

  it('surfaces the 404 for a model the library does not hold', async () => {
    const directory = await createFixtureModelsDir()
    const { fetchImpl } = stubOllamaActions()
    const adapter = ollamaAdapter(directory, fetchImpl)

    const error = await rejectionOf(adapter.deleteLocalModel('not-held:1b'))
    assert.ok(error instanceof LlmError)
    assert.equal(error.failure.code, 'LOCAL_OLLAMA_REQUEST_FAILED')
    assert.match(error.failure.message, /HTTP 404/)
  })
})

describe('ollama pull jobs', () => {
  it('streams progress into the job record and settles done on the success line', async () => {
    const directory = await createFixtureModelsDir()
    const { fetchImpl, requests, state } = stubOllamaActions()
    state.pullResponder = () => ndjson([
      '{"status":"pulling manifest"}',
      '{"status":"downloading","digest":"sha256:abc","total":1000,"completed":250}',
      '{"status":"downloading","digest":"sha256:abc","total":1000,"completed":1000}',
      '{"status":"verifying sha256 digest"}',
      '{"status":"success"}',
    ])
    const adapter = ollamaAdapter(directory, fetchImpl)

    const { jobId } = await adapter.startLocalModelPull(MODEL_B)
    const settled = await settledPull(adapter, jobId)
    assert.equal(settled.state, 'done')
    assert.equal(settled.modelId, MODEL_B)
    assert.equal(settled.status, 'success')
    assert.equal(settled.totalBytes, 1000)
    assert.equal(settled.completedBytes, 1000)
    assert.equal(settled.error, undefined)

    const pull = requests.filter(request => request.url.endsWith('/api/pull'))
    assert.equal(pull.length, 1)
    assert.equal(pull[0]?.url, `${NATIVE_BASE_URL}/api/pull`)
    assert.deepEqual(pull[0]?.body, { model: MODEL_B, stream: true })
  })

  it('returns the running job handle when the same model is pulled twice', async () => {
    const directory = await createFixtureModelsDir()
    const { fetchImpl, state } = stubOllamaActions()
    const encoder = new TextEncoder()
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    state.pullResponder = () => new Response(new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController
        streamController.enqueue(encoder.encode('{"status":"downloading","total":10,"completed":5}\n'))
      },
    }), { status: 200 })
    const adapter = ollamaAdapter(directory, fetchImpl)

    const first = await adapter.startLocalModelPull(MODEL_A)
    const second = await adapter.startLocalModelPull(MODEL_A)
    assert.equal(second.jobId, first.jobId)

    const running = adapter.localModelPullStatus(first.jobId)
    assert.equal(running.state, 'running')
    assert.equal(running.status, 'downloading')
    assert.equal(running.completedBytes, 5)
    assert.equal(running.totalBytes, 10)

    controller?.enqueue(encoder.encode('{"status":"success"}\n'))
    controller?.close()
    const settled = await settledPull(adapter, first.jobId)
    assert.equal(settled.state, 'done')
  })

  it('settles failed on an error line in the pull stream', async () => {
    const directory = await createFixtureModelsDir()
    const { fetchImpl, state } = stubOllamaActions()
    state.pullResponder = () => ndjson([
      '{"status":"pulling manifest"}',
      '{"error":"repository not found"}',
    ])
    const adapter = ollamaAdapter(directory, fetchImpl)

    const { jobId } = await adapter.startLocalModelPull('ghost:1b')
    const settled = await settledPull(adapter, jobId)
    assert.equal(settled.state, 'failed')
    assert.match(settled.error ?? '', /repository not found/)
  })

  it('settles failed on an HTTP refusal before the stream starts', async () => {
    const directory = await createFixtureModelsDir()
    const { fetchImpl, state } = stubOllamaActions()
    state.pullResponder = () => new Response('pull refused', { status: 500 })
    const adapter = ollamaAdapter(directory, fetchImpl)

    const { jobId } = await adapter.startLocalModelPull(MODEL_A)
    const settled = await settledPull(adapter, jobId)
    assert.equal(settled.state, 'failed')
    assert.match(settled.error ?? '', /HTTP 500/)
  })

  it('settles failed when the stream ends without reporting success', async () => {
    const directory = await createFixtureModelsDir()
    const { fetchImpl, state } = stubOllamaActions()
    state.pullResponder = () => ndjson(['{"status":"pulling manifest"}'])
    const adapter = ollamaAdapter(directory, fetchImpl)

    const { jobId } = await adapter.startLocalModelPull(MODEL_A)
    const settled = await settledPull(adapter, jobId)
    assert.equal(settled.state, 'failed')
    assert.match(settled.error ?? '', /without reporting success/)
  })

  it('fails loud for an unknown pull job id', async () => {
    const directory = await createFixtureModelsDir()
    const { fetchImpl } = stubOllamaActions()
    const adapter = ollamaAdapter(directory, fetchImpl)

    assert.throws(
      () => adapter.localModelPullStatus('no-such-job'),
      (error: unknown) => error instanceof LlmError && error.failure.code === 'LOCAL_PULL_NOT_FOUND',
    )
  })
})

describe('llama mode lifecycle actions', () => {
  // The restore replaced the wave-2 refusal (`LOCAL_ACTIONS_REQUIRE_OLLAMA`)
  // with real llama-mode actions; their behavior is covered end to end in
  // ./llama-restore.test.ts. What remains here is the honest-failure edge
  // this fixture can settle: with no llama-server binary anywhere the
  // adapter can resolve, a start names that failure in its own typed code
  // instead of refusing by mode or pretending success.
  it('fails a start with a typed start failure when no llama-server binary resolves', async () => {
    const directory = await createFixtureModelsDir()
    const { fetchImpl } = stubOllamaActions()
    const adapter = new LocalLlamaAdapter({
      modelsDir: directory,
      fetchImpl,
      llamaServerBin: join(directory, 'no-such-llama-server'),
    })

    const error = await rejectionOf(adapter.startLocalModel(ACTIVE_MODEL_ID))
    assert.ok(error instanceof LlmError)
    assert.equal(error.failure.code, 'LOCAL_SERVER_START_FAILED')
    assert.match(error.failure.message, /llama-server binary not found/)
  })
})
