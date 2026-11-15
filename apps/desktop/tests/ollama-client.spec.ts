/**
 * Ollama client and service: daemon probe, installed listing, declared detail,
 * streamed pull progress, cancellation and delete — all against an injected
 * transport, so no socket is ever opened.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  OllamaPullCancelledError,
  deleteInstalled,
  listInstalled,
  probeDaemon,
  pullModel,
  resolveOllamaBaseUrl,
  showInstalled,
  validateModelName,
} from '../src/ollama-client.ts'
import { createOllamaService } from '../src/ollama-service.ts'
import type { OllamaPullProgress } from '../src/ollama-api.ts'

/** @returns a JSON reply as a Response. */
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** @returns a streamed reply whose body emits each chunk in order. */
function streamed(chunks: readonly string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status, headers: { 'Content-Type': 'application/x-ndjson' } })
}

describe('model reference validation', () => {
  it('accepts the forms Ollama documents', () => {
    expect(validateModelName('llama3.2:3b')).toBe('llama3.2:3b')
    expect(validateModelName('qwen2.5-coder')).toBe('qwen2.5-coder')
    expect(validateModelName('registry.example.com/ns/model:latest')).toBe('registry.example.com/ns/model:latest')
  })

  it('refuses blanks, spaces and traversal', () => {
    expect(() => validateModelName('')).toThrow()
    expect(() => validateModelName('has space')).toThrow()
    expect(() => validateModelName('../../etc/passwd')).toThrow()
  })
})

describe('base url resolution', () => {
  it('prefers an explicit value, then the environment, then the documented default', () => {
    expect(resolveOllamaBaseUrl({ baseUrl: 'http://10.0.0.5:11434/' })).toBe('http://10.0.0.5:11434')
    const previous = process.env['OLLAMA_BASE_URL']
    try {
      process.env['OLLAMA_BASE_URL'] = 'http://127.0.0.1:12345'
      expect(resolveOllamaBaseUrl()).toBe('http://127.0.0.1:12345')
      delete process.env['OLLAMA_BASE_URL']
      expect(resolveOllamaBaseUrl()).toBe('http://127.0.0.1:11434')
    } finally {
      if (previous === undefined) delete process.env['OLLAMA_BASE_URL']
      else process.env['OLLAMA_BASE_URL'] = previous
    }
  })
})

describe('probeDaemon', () => {
  it('reports a reachable daemon with its version', async () => {
    const fetchImpl = vi.fn(async () => json({ version: '0.5.1' })) as unknown as typeof fetch
    const connection = await probeDaemon({ baseUrl: 'http://127.0.0.1:11434', fetch: fetchImpl })
    expect(connection.reachable).toBe(true)
    expect(connection.version).toBe('0.5.1')
    expect(connection.baseUrl).toBe('http://127.0.0.1:11434')
  })

  it('answers rather than throwing when nothing is listening', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const connection = await probeDaemon({ fetch: fetchImpl })
    expect(connection.reachable).toBe(false)
    expect(connection.error).toContain('ollama serve')
  })
})

describe('listInstalled', () => {
  it('maps the daemon entries into the contract shape', async () => {
    const fetchImpl = vi.fn(async () => json({
      models: [
        {
          name: 'llama3.2:3b',
          model: 'llama3.2:3b',
          size: 2019393189,
          digest: 'sha256:abc',
          modified_at: '2026-11-01T10:00:00.000Z',
          details: { parameter_size: '3.2B', quantization_level: 'Q4_K_M', family: 'llama' },
        },
      ],
    })) as unknown as typeof fetch
    const models = await listInstalled({ fetch: fetchImpl })
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      name: 'llama3.2:3b',
      sizeBytes: 2019393189,
      parameterSize: '3.2B',
      quantization: 'Q4_K_M',
      family: 'llama',
    })
    expect(models[0]?.modifiedAt).toBe(Date.parse('2026-11-01T10:00:00.000Z'))
  })

  it('surfaces the daemon status on failure', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
    await expect(listInstalled({ fetch: fetchImpl })).rejects.toThrow(/HTTP 500/u)
  })
})

describe('showInstalled', () => {
  it('reads declared capabilities so tool support is answered by the daemon', async () => {
    const fetchImpl = vi.fn(async () => json({
      details: { parameter_size: '3.2B', quantization_level: 'Q4_K_M', family: 'llama' },
      capabilities: ['completion', 'tools'],
      model_info: { 'llama.context_length': 131072 },
    })) as unknown as typeof fetch
    const details = await showInstalled({ name: 'llama3.2:3b', fetch: fetchImpl })
    expect(details.supportsTools).toBe(true)
    expect(details.capabilities).toContain('tools')
    expect(details.contextLength).toBe(131072)
  })

  it('reports tool support as false when the daemon does not declare it', async () => {
    const fetchImpl = vi.fn(async () => json({
      details: { family: 'llama' },
      capabilities: ['completion'],
      model_info: {},
    })) as unknown as typeof fetch
    const details = await showInstalled({ name: 'llama3.2:3b', fetch: fetchImpl })
    expect(details.supportsTools).toBe(false)
  })

  it('derives the output budget from the declared context window', async () => {
    const fetchImpl = vi.fn(async () => json({
      details: { family: 'llama' },
      capabilities: ['completion', 'tools'],
      model_info: { 'llama.context_length': 32768 },
    })) as unknown as typeof fetch
    const details = await showInstalled({ name: 'llama3.2:3b', fetch: fetchImpl })
    expect(details.contextLength).toBe(32768)
    expect(details.contextSource).toBe('declared')
    expect(details.maxOutputTokens).toBe(8192)
    expect(details.maxOutputSource).toBe('derived')
  })

  it('uses a num_predict output cap the daemon reports as declared', async () => {
    const fetchImpl = vi.fn(async () => json({
      details: { family: 'llama' },
      capabilities: ['completion'],
      model_info: { 'llama.context_length': 32768 },
      parameters: 'num_ctx 8192\nnum_predict 1536\nstop "<|end|>"\n',
    })) as unknown as typeof fetch
    const details = await showInstalled({ name: 'llama3.2:3b', fetch: fetchImpl })
    expect(details.maxOutputTokens).toBe(1536)
    expect(details.maxOutputSource).toBe('declared')
  })

  it('labels both numbers derived when the daemon declares no window', async () => {
    const fetchImpl = vi.fn(async () => json({
      details: { family: 'llama' },
      capabilities: ['completion'],
      model_info: {},
    })) as unknown as typeof fetch
    const details = await showInstalled({ name: 'llama3.2:3b', fetch: fetchImpl })
    expect(details.contextSource).toBe('derived')
    expect(details.maxOutputSource).toBe('derived')
    expect(details.maxOutputTokens).toBeGreaterThan(0)
  })
})

describe('pullModel', () => {
  it('streams layer progress and returns the installed model', async () => {
    const responses = [
      streamed([
        '{"status":"pulling manifest"}\n',
        '{"status":"pulling abc","digest":"sha256:abc","total":100,"completed":40}\n',
        '{"status":"pulling abc","digest":"sha256:abc","total":100,"completed":100}\n',
        '{"status":"verifying sha256 digest"}\n',
        '{"status":"success"}\n',
      ]),
      json({ models: [{ name: 'llama3.2:3b', model: 'llama3.2:3b', size: 42 }] }),
    ]
    const fetchImpl = vi.fn(async () => responses.shift() ?? json({})) as unknown as typeof fetch
    const events: OllamaPullProgress[] = []
    const model = await pullModel({
      name: 'llama3.2:3b',
      fetch: fetchImpl,
      onProgress: (progress) => { events.push(progress) },
    })
    expect(model.name).toBe('llama3.2:3b')
    expect(model.sizeBytes).toBe(42)
    // A status transition always reaches the caller, and the final state is done.
    expect(events.some(event => event.phase === 'verifying')).toBe(true)
    expect(events.at(-1)?.phase).toBe('done')
    const withBytes = events.filter(event => event.totalBytes !== undefined)
    expect(withBytes.at(-1)?.receivedBytes).toBe(100)
  })

  it('aggregates multiple layers into one honest total', async () => {
    const responses = [
      streamed([
        '{"status":"pulling a","digest":"sha256:a","total":100,"completed":100}\n',
        '{"status":"pulling b","digest":"sha256:b","total":50,"completed":50}\n',
        '{"status":"success"}\n',
      ]),
      json({ models: [{ name: 'm', model: 'm', size: 150 }] }),
    ]
    const fetchImpl = vi.fn(async () => responses.shift() ?? json({})) as unknown as typeof fetch
    const events: OllamaPullProgress[] = []
    await pullModel({ name: 'm', fetch: fetchImpl, onProgress: (progress) => { events.push(progress) } })
    const lastWithBytes = events.filter(event => event.totalBytes !== undefined).at(-1)
    expect(lastWithBytes?.totalBytes).toBe(150)
    expect(lastWithBytes?.receivedBytes).toBe(150)
  })

  it('throws the daemon error line instead of reporting success', async () => {
    const fetchImpl = vi.fn(async () => streamed([
      '{"status":"pulling manifest"}\n',
      '{"error":"model not found"}\n',
    ])) as unknown as typeof fetch
    await expect(pullModel({ name: 'nope:1b', fetch: fetchImpl })).rejects.toThrow(/model not found/u)
  })

  it('reports cancellation distinctly from failure', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(async () => {
      controller.abort()
      throw new Error('aborted')
    }) as unknown as typeof fetch
    await expect(pullModel({ name: 'm', fetch: fetchImpl, signal: controller.signal }))
      .rejects.toBeInstanceOf(OllamaPullCancelledError)
  })
})

describe('deleteInstalled', () => {
  it('treats an absent model as done', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch
    await expect(deleteInstalled({ name: 'gone:1b', fetch: fetchImpl })).resolves.toBeUndefined()
  })

  it('surfaces any other failure', async () => {
    const fetchImpl = vi.fn(async () => new Response('busy', { status: 500 })) as unknown as typeof fetch
    await expect(deleteInstalled({ name: 'm', fetch: fetchImpl })).rejects.toThrow(/HTTP 500/u)
  })
})

describe('createOllamaService', () => {
  /** @returns a service over recording fakes. */
  function service() {
    const pulled: string[] = []
    const client = {
      probeDaemon: vi.fn(async () => ({ reachable: true, baseUrl: 'http://x', checkedAt: 0 })),
      listInstalled: vi.fn(async () => []),
      showInstalled: vi.fn(async () => ({
        name: 'm',
        capabilities: ['completion', 'tools'],
        capabilitiesDeclared: true,
        supportsTools: true,
        contextLength: 4096,
        contextSource: 'derived' as const,
        maxOutputTokens: 1024,
        maxOutputSource: 'derived' as const,
      })),
      pullModel: vi.fn(async (options: { name: string; onProgress?: (p: OllamaPullProgress) => void }) => {
        pulled.push(options.name)
        options.onProgress?.({ name: options.name, phase: 'pulling', receivedBytes: 1, totalBytes: 2 })
        return { name: options.name, model: options.name, sizeBytes: 2 }
      }),
      deleteInstalled: vi.fn(async () => undefined),
    }
    return { client, pulled, service: createOllamaService({ client }) }
  }

  it('fans pull progress out to subscribers', async () => {
    const { service: subject } = service()
    const seen: OllamaPullProgress[] = []
    const detach = subject.onPullProgress((progress) => { seen.push(progress) })
    await subject.pullModel('m')
    detach()
    expect(seen).toHaveLength(1)
    expect(seen[0]?.totalBytes).toBe(2)
  })

  it('refuses a second concurrent pull of the same model', async () => {
    const { service: subject } = service()
    const first = subject.pullModel('m')
    await expect(subject.pullModel('m')).rejects.toThrow(/already in progress/u)
    await first
  })

  it('cancels only the named pull', async () => {
    const { client } = service()
    let seenSignal: AbortSignal | undefined
    const captured = createOllamaService({
      client: {
        ...client,
        pullModel: vi.fn(async (options: { name: string; signal?: AbortSignal }) => {
          seenSignal = options.signal
          await new Promise((resolve) => { setTimeout(resolve, 5) })
          return { name: options.name, model: options.name, sizeBytes: 0 }
        }),
      },
    })
    const running = captured.pullModel('a')
    await captured.cancelPull('a')
    expect(seenSignal?.aborted).toBe(true)
    await running
  })

  it('refuses blank model names at the boundary', async () => {
    const { service: subject } = service()
    await expect(subject.pullModel('  ')).rejects.toThrow(/non-empty/u)
    await expect(subject.deleteModel('  ')).rejects.toThrow(/non-empty/u)
  })
})

describe('selection', () => {
  /** @returns a service with recording selection collaborators. */
  function selectionService(declared: { capabilitiesDeclared: boolean; supportsTools: boolean }) {
    const written: unknown[] = []
    const published: Array<{ selection: unknown; limits: unknown }> = []
    const client = {
      probeDaemon: vi.fn(async () => ({ reachable: true, baseUrl: 'http://127.0.0.1:11434', checkedAt: 0 })),
      listInstalled: vi.fn(async () => []),
      showInstalled: vi.fn(async () => ({
        name: 'm',
        capabilities: declared.capabilitiesDeclared ? ['completion'] : [],
        capabilitiesDeclared: declared.capabilitiesDeclared,
        supportsTools: declared.supportsTools,
        contextLength: 32768,
        contextSource: 'declared' as const,
        maxOutputTokens: 8192,
        maxOutputSource: 'derived' as const,
      })),
      pullModel: vi.fn(async () => ({ name: 'm', model: 'm', sizeBytes: 0 })),
      deleteInstalled: vi.fn(async () => undefined),
    }
    const subject = createOllamaService({
      client,
      connection: { baseUrl: 'http://127.0.0.1:11434' },
      selection: {
        read: () => ({ activeModel: null, baseUrl: 'http://127.0.0.1:11434' }),
        write: (selection) => { written.push(selection) },
        publish: (choice, limits) => { published.push({ selection: choice, limits }) },
      },
    })
    return { subject, written, published }
  }

  it('publishes the detected limits with the chosen model', async () => {
    const { subject, published } = selectionService({ capabilitiesDeclared: true, supportsTools: true })
    const selection = await subject.selectModel('llama3.2:3b')
    expect(selection.activeModel).toBe('llama3.2:3b')
    // The context the daemon declares must travel with the choice, or dispatch runs small.
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({
      selection: { activeModel: 'llama3.2:3b' },
      limits: { contextLength: 32768, maxOutputTokens: 8192 },
    })
  })

  it('refuses a model that declares no tool capability', async () => {
    const { subject, published } = selectionService({ capabilitiesDeclared: true, supportsTools: false })
    await expect(subject.selectModel('chat-only:1b')).rejects.toThrow(/tool support/u)
    expect(published).toHaveLength(0)
  })

  it('allows a model whose daemon declares no capability list', async () => {
    // "unknown" is not "no": an older daemon must not block every model.
    const { subject, published } = selectionService({ capabilitiesDeclared: false, supportsTools: false })
    await expect(subject.selectModel('legacy:1b')).resolves.toMatchObject({ activeModel: 'legacy:1b' })
    expect(published).toHaveLength(1)
  })

  it('stands the fleet down without touching the chosen model first', async () => {
    const { subject, published } = selectionService({ capabilitiesDeclared: true, supportsTools: true })
    const cleared = await subject.selectModel(null)
    expect(cleared.activeModel).toBeNull()
    expect(published[0]?.selection).toBeNull()
  })
})
