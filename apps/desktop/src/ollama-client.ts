/**
 * Ollama daemon client.
 *
 * Three operations over the daemon's native HTTP API, all transport-injectable
 * so a test never reaches a socket: read what is installed (`/api/tags`, and
 * `/api/show` for one model's declared detail), pull a model with real byte
 * progress (`/api/pull`, streamed newline-delimited JSON), and delete one
 * (`/api/delete`). Plus a cheap `probeDaemon` that answers "is Ollama running
 * where we expect it" without throwing.
 *
 * Parity with the Hugging Face client (llama-hf.ts) is deliberate: the operator
 * types a model reference, gets live byte progress, can cancel, and can delete
 * what landed. The difference is who owns the bytes — Hugging Face streams a
 * file we write, Ollama streams a pull the daemon performs and we only observe.
 *
 * This module never logs. The optional bearer token is only ever written as an
 * `Authorization` header, and a failure message carries neither the token nor a
 * URL's query string.
 */

import type {
  OllamaConnection,
  OllamaModel,
  OllamaModelDetails,
  OllamaPullProgress,
} from './ollama-api.ts'
import { resolveModelLimits } from './model-limits.ts'

/** Environment variable overriding the daemon root. */
export const OLLAMA_BASE_URL_ENV = 'OLLAMA_BASE_URL'

/** Ollama's documented default listening address. */
export const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434'

/** Environment variable carrying an optional bearer token for a proxied daemon. */
export const OLLAMA_API_KEY_ENV = 'OLLAMA_API_KEY'

/** Minimum gap between progress callbacks, about four events per second. */
const PROGRESS_INTERVAL_MS = 250

/** A daemon probe must not hang the UI when nothing is listening. */
const PROBE_TIMEOUT_MS = 2_500

/**
 * A model reference Ollama accepts: an optional host and namespace, a name, and
 * an optional tag. Spaces, control characters and traversal segments are
 * refused rather than forwarded to the daemon.
 */
const MODEL_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._/-]*(?::[A-Za-z0-9._-]+)?$/u

/** Cancellation raised when the caller's `AbortSignal` stopped a pull. */
export class OllamaPullCancelledError extends Error {
  /** Builds the one cancellation error every aborted pull reports. */
  constructor() {
    super('the model pull was cancelled')
    this.name = 'OllamaPullCancelledError'
  }
}

/** Options shared by every call. */
export interface OllamaClientOptions {
  /** Daemon root; defaults to `OLLAMA_BASE_URL`, then the documented address. */
  readonly baseUrl?: string
  /** Optional bearer token, sent only as an `Authorization` header. */
  readonly token?: string
  /** Overrides the transport; a test supplies its own. */
  readonly fetch?: typeof fetch
}

/** Options for {@link pullModel}. */
export interface PullModelOptions extends OllamaClientOptions {
  /** Model reference to pull, e.g. `llama3.2:3b`. */
  readonly name: string
  /** Called with aggregated byte counts, throttled to about four events per second. */
  readonly onProgress?: (progress: OllamaPullProgress) => void
  /** Aborts the pull; the daemon stops fetching and keeps whatever already landed. */
  readonly signal?: AbortSignal
}

/** Options naming one installed model. */
export interface ModelNameOptions extends OllamaClientOptions {
  /** Model reference, as `ollama list` shows it. */
  readonly name: string
}

/**
 * Resolve the daemon root for a call.
 * @param options - caller options and the process environment.
 * @returns the base URL without a trailing slash.
 */
export function resolveOllamaBaseUrl(options: OllamaClientOptions = {}): string {
  const pinned = options.baseUrl?.trim()
  if (pinned !== undefined && pinned !== '') return pinned.replace(/\/+$/, '')
  const fromEnv = process.env[OLLAMA_BASE_URL_ENV]?.trim()
  return (fromEnv !== undefined && fromEnv !== '' ? fromEnv : OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, '')
}

/**
 * @param name - operator-supplied model reference.
 * @returns the reference when it is one the daemon can be asked for.
 * @throws Error naming the accepted shape; the rejected text is not echoed back.
 */
export function validateModelName(name: string): string {
  const trimmed = name.trim()
  if (!MODEL_REFERENCE.test(trimmed) || trimmed.includes('..')) {
    throw new Error('the Ollama model must look like `name`, `name:tag` or `host/namespace/name:tag`')
  }
  return trimmed
}

/**
 * @param options - caller options.
 * @returns request headers, carrying the token as a Bearer credential when one is set.
 */
function headersFor(options: OllamaClientOptions): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = options.token?.trim()
  if (token !== undefined && token !== '') headers['Authorization'] = `Bearer ${token}`
  return headers
}

/**
 * @param value - any decoded JSON value.
 * @returns whether the value is a plain JSON object.
 */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param value - any decoded JSON value.
 * @returns a non-negative safe integer, or undefined.
 */
function byteCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/**
 * @param value - any decoded JSON value.
 * @returns the value when it is a non-empty string.
 */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Probe the daemon.
 *
 * A stopped daemon is a normal answer, not an exception: this call resolves with
 * `reachable: false` and the operative reason, so the UI can offer guidance
 * instead of surfacing a transport stack.
 * @param options - caller options.
 * @returns the connection snapshot.
 */
export async function probeDaemon(options: OllamaClientOptions = {}): Promise<OllamaConnection> {
  const baseUrl = resolveOllamaBaseUrl(options)
  const fetchImpl = options.fetch ?? globalThis.fetch
  const checkedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, PROBE_TIMEOUT_MS)
  try {
    const response = await fetchImpl(`${baseUrl}/api/version`, {
      headers: headersFor(options),
      signal: controller.signal,
    })
    if (!response.ok) {
      return {
        reachable: false,
        baseUrl,
        checkedAt,
        error: `the Ollama daemon answered HTTP ${String(response.status)}`,
      }
    }
    const parsed: unknown = await response.json().catch(() => undefined)
    const version = record(parsed) ? nonEmptyString(parsed['version']) : undefined
    return { reachable: true, baseUrl, checkedAt, ...version === undefined ? {} : { version } }
  } catch {
    return {
      reachable: false,
      baseUrl,
      checkedAt,
      error: 'the Ollama daemon is not answering — start it with `ollama serve`, or set '
        + `${OLLAMA_BASE_URL_ENV} if it listens elsewhere`,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param options - caller options.
 * @returns the HTTP origin and headers for a daemon call.
 */
function endpoint(options: OllamaClientOptions): { baseUrl: string; headers: Record<string, string> } {
  return { baseUrl: resolveOllamaBaseUrl(options), headers: headersFor(options) }
}

/**
 * Read one JSON reply, mapping the daemon's failure into an operator-facing message.
 * @param response - the daemon's reply.
 * @param action - what was attempted, for the failure message.
 * @returns the decoded JSON value.
 * @throws Error for a non-OK status or an unreadable body.
 */
async function replyJson(response: Response, action: string): Promise<unknown> {
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    // The daemon's own message is the useful part ("model not found"); it carries
    // no credential, so a trimmed fragment of it is safe to surface.
    const suffix = detail.trim() === '' ? '' : `: ${detail.trim().slice(0, 200)}`
    throw new Error(`Ollama could not ${action} (HTTP ${String(response.status)})${suffix}`)
  }
  try {
    return await response.json()
  } catch {
    throw new Error(`Ollama returned an unreadable reply when asked to ${action}`)
  }
}

/**
 * Map one `/api/tags` entry into the contract's model shape.
 * @param entry - one entry from the daemon's reply.
 * @returns the model, or undefined when the entry carries no usable name.
 */
function tagModel(entry: unknown): OllamaModel | undefined {
  if (!record(entry)) return undefined
  const name = nonEmptyString(entry['name']) ?? nonEmptyString(entry['model'])
  if (name === undefined) return undefined
  const details = record(entry['details']) ? entry['details'] : {}
  const modified = nonEmptyString(entry['modified_at'])
  const modifiedAt = modified === undefined ? undefined : Date.parse(modified)
  const digest = nonEmptyString(entry['digest'])
  const parameterSize = nonEmptyString(details['parameter_size'])
  const quantization = nonEmptyString(details['quantization_level'])
  const family = nonEmptyString(details['family'])
  return {
    name,
    model: nonEmptyString(entry['model']) ?? name,
    sizeBytes: byteCount(entry['size']) ?? 0,
    ...digest === undefined ? {} : { digest },
    ...modifiedAt === undefined || Number.isNaN(modifiedAt) ? {} : { modifiedAt },
    ...parameterSize === undefined ? {} : { parameterSize },
    ...quantization === undefined ? {} : { quantization },
    ...family === undefined ? {} : { family },
  }
}

/**
 * List the models the daemon has installed.
 * @param options - caller options.
 * @returns every installed model, as the daemon orders them.
 * @throws Error when the daemon is unreachable or answers unusably.
 */
export async function listInstalled(options: OllamaClientOptions = {}): Promise<OllamaModel[]> {
  const { baseUrl, headers } = endpoint(options)
  const fetchImpl = options.fetch ?? globalThis.fetch
  let response: Response
  try {
    response = await fetchImpl(`${baseUrl}/api/tags`, { headers })
  } catch {
    throw new Error(`the Ollama daemon at ${baseUrl} is not answering — start it with \`ollama serve\``)
  }
  const parsed = await replyJson(response, 'list installed models')
  if (!record(parsed) || !Array.isArray(parsed['models'])) {
    throw new Error('Ollama returned an unexpected model list')
  }
  const models: OllamaModel[] = []
  for (const entry of parsed['models']) {
    const model = tagModel(entry)
    if (model !== undefined) models.push(model)
  }
  return models
}

/**
 * Read one installed model's declared detail, including whether it is tool-capable.
 * @param options - caller options plus the model name.
 * @returns the detail the daemon reports.
 * @throws Error when the daemon is unreachable, the model is absent, or the reply is unusable.
 */
export async function showInstalled(options: ModelNameOptions): Promise<OllamaModelDetails> {
  const name = validateModelName(options.name)
  const { baseUrl, headers } = endpoint(options)
  const fetchImpl = options.fetch ?? globalThis.fetch
  let response: Response
  try {
    response = await fetchImpl(`${baseUrl}/api/show`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: name }),
    })
  } catch {
    throw new Error(`the Ollama daemon at ${baseUrl} is not answering — start it with \`ollama serve\``)
  }
  const parsed = await replyJson(response, `describe ${name}`)
  if (!record(parsed)) throw new Error('Ollama returned an unexpected model description')
  const details = record(parsed['details']) ? parsed['details'] : {}
  const modelInfo = record(parsed['model_info']) ? parsed['model_info'] : {}
  const declared = Array.isArray(parsed['capabilities'])
    ? parsed['capabilities'].filter((entry): entry is string => typeof entry === 'string')
    : []
  const parameterSize = nonEmptyString(details['parameter_size'])
  const quantization = nonEmptyString(details['quantization_level'])
  const family = nonEmptyString(details['family'])
  // The context window rides model_info under an architecture-prefixed key
  // (`llama.context_length`, `qwen2.context_length`, ...), so it is matched by suffix.
  let contextLength: number | undefined
  for (const [key, value] of Object.entries(modelInfo)) {
    if (!key.endsWith('.context_length')) continue
    const parsedLength = byteCount(value)
    if (parsedLength !== undefined && parsedLength > 0) contextLength = parsedLength
  }
  const sizeBytes = byteCount(parsed['size'])
  // Ollama reports runtime parameters as a flat "key value" text block. A
  // `num_predict` line is the model's own output cap when the operator baked one
  // in; without it the budget is derived, and the result says which.
  const parametersText = nonEmptyString(parsed['parameters']) ?? ''
  let declaredMaxOutputTokens: number | undefined
  for (const line of parametersText.split(/\r?\n/u)) {
    const match = /^\s*num_predict\s+(\d+)\s*$/u.exec(line)
    if (match === null) continue
    const parsedCap = Number(match[1])
    if (Number.isSafeInteger(parsedCap) && parsedCap > 0) declaredMaxOutputTokens = parsedCap
  }
  const limits = resolveModelLimits({
    ...contextLength === undefined ? {} : { contextLength },
    ...declaredMaxOutputTokens === undefined ? {} : { declaredMaxOutputTokens },
  })
  return {
    name,
    capabilities: declared,
    capabilitiesDeclared: declared.length > 0,
    // Ollama declares capabilities; absent list means the daemon is older and the
    // answer is unknown, so the conservative reading is "not declared".
    supportsTools: declared.includes('tools'),
    contextLength: limits.contextLength,
    contextSource: limits.contextSource,
    maxOutputTokens: limits.maxOutputTokens,
    maxOutputSource: limits.maxOutputSource,
    ...parameterSize === undefined ? {} : { parameterSize },
    ...quantization === undefined ? {} : { quantization },
    ...family === undefined ? {} : { family },
    ...sizeBytes === undefined ? {} : { sizeBytes },
  }
}

/**
 * Parse one streamed `/api/pull` line.
 * @param line - a newline-delimited JSON line.
 * @returns the decoded object, or undefined for a blank or unparseable line.
 */
function progressLine(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim()
  if (trimmed === '') return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return record(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Pull a model, reporting aggregated byte progress.
 *
 * Ollama streams newline-delimited JSON per layer, so progress is the sum of
 * each layer's `completed` over the sum of its `total`, keyed by digest. That
 * gives one honest bar for a multi-layer pull instead of a set of unrelated
 * ones. The daemon performs the transfer and owns the files; an abort stops the
 * pull and leaves whatever already landed installed-and-partial on its side.
 *
 * Progress fires at most about four times per second, plus once per status
 * transition (a `verifying` or `success` line always reaches the caller).
 * @param options - model name, optional progress listener, signal and transport.
 * @returns the installed model, re-read from the daemon after a successful pull.
 * @throws OllamaPullCancelledError when the caller aborted, Error for any other failure.
 */
export async function pullModel(options: PullModelOptions): Promise<OllamaModel> {
  const name = validateModelName(options.name)
  const { baseUrl, headers } = endpoint(options)
  const fetchImpl = options.fetch ?? globalThis.fetch

  let response: Response
  try {
    response = await fetchImpl(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: name, stream: true }),
      ...options.signal === undefined ? {} : { signal: options.signal },
    })
  } catch {
    if (options.signal?.aborted === true) throw new OllamaPullCancelledError()
    throw new Error(`the Ollama daemon at ${baseUrl} is not answering — start it with \`ollama serve\``)
  }

  if (!response.ok) {
    if (options.signal?.aborted === true) throw new OllamaPullCancelledError()
    const detail = await response.text().catch(() => '')
    const suffix = detail.trim() === '' ? '' : `: ${detail.trim().slice(0, 200)}`
    throw new Error(`Ollama could not pull ${name} (HTTP ${String(response.status)})${suffix}`)
  }

  const body = response.body
  if (body === null) {
    // A daemon that answers without a stream still performed the pull in older
    // versions (stream:false behaviour); fall through to reading the result back.
    return readPulled(name, options)
  }

  /** Per-layer byte counts, keyed by the daemon's digest. */
  const layers = new Map<string, { completed: number; total: number }>()
  let emittedAt = 0
  let phase: OllamaPullProgress['phase'] = 'pulling'
  let lastStatus: string | undefined

  const emit = (): void => {
    emittedAt = Date.now()
    let received = 0
    let total = 0
    for (const layer of layers.values()) {
      received += layer.completed
      total += layer.total
    }
    if (lastStatus === undefined && received === 0) return
    options.onProgress?.({
      name,
      phase,
      receivedBytes: received,
      ...total > 0 ? { totalBytes: total } : {},
      ...lastStatus === undefined ? {} : { status: lastStatus },
    })
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      if (options.signal?.aborted === true) throw new OllamaPullCancelledError()
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        const entry = progressLine(line)
        if (entry === undefined) continue
        const error = nonEmptyString(entry['error'])
        if (error !== undefined) {
          phase = 'error'
          lastStatus = error
          emit()
          throw new Error(`Ollama could not pull ${name}: ${error}`)
        }
        const status = nonEmptyString(entry['status'])
        if (status !== undefined) lastStatus = status
        const digest = nonEmptyString(entry['digest'])
        const completed = byteCount(entry['completed'])
        const total = byteCount(entry['total'])
        if (digest !== undefined && completed !== undefined && total !== undefined) {
          layers.set(digest, { completed, total })
        }
        if (status !== undefined && /verifying|writing manifest|success/iu.test(status)) {
          // A status transition is always worth an event, even inside the throttle
          // window: it is the moment the operator sees the phase change.
          phase = /success/iu.test(status) ? 'done' : 'verifying'
          emit()
          continue
        }
        if (Date.now() - emittedAt >= PROGRESS_INTERVAL_MS) emit()
      }
    }
    // A trailing line without a final newline still counts.
    const entry = progressLine(buffer)
    if (entry !== undefined && nonEmptyString(entry['error']) !== undefined) {
      throw new Error(`Ollama could not pull ${name}: ${String(entry['error'])}`)
    }
    phase = 'done'
    emit()
    return await readPulled(name, options)
  } catch (error: unknown) {
    await reader.cancel().catch(() => {
      // The stream is already drained, cancelled or aborted; cleanup is best effort.
    })
    if (error instanceof OllamaPullCancelledError || options.signal?.aborted === true) {
      options.onProgress?.({
        name,
        phase: 'cancelled',
        receivedBytes: 0,
      })
      throw new OllamaPullCancelledError()
    }
    throw error instanceof Error ? error : new Error('the Ollama pull failed')
  }
}

/**
 * Re-read one model after a pull, so the returned entry carries the daemon's own sizes.
 * @param name - the model that was pulled.
 * @param options - caller options.
 * @returns the installed model, or a minimal entry when the list no longer carries it.
 */
async function readPulled(name: string, options: OllamaClientOptions): Promise<OllamaModel> {
  const installed = await listInstalled(options)
  const found = installed.find(entry => entry.name === name || entry.model === name)
  if (found !== undefined) return found
  return { name, model: name, sizeBytes: 0 }
}

/**
 * Delete an installed model.
 *
 * An already-absent model is not an error: the daemon answers 404 and the caller's
 * intent — "this model should not be here" — is already satisfied, so the delete
 * is reported as done. Every other status is surfaced.
 * @param options - caller options plus the model name.
 */
export async function deleteInstalled(options: ModelNameOptions): Promise<void> {
  const name = validateModelName(options.name)
  const { baseUrl, headers } = endpoint(options)
  const fetchImpl = options.fetch ?? globalThis.fetch
  let response: Response
  try {
    response = await fetchImpl(`${baseUrl}/api/delete`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ model: name }),
    })
  } catch {
    throw new Error(`the Ollama daemon at ${baseUrl} is not answering — start it with \`ollama serve\``)
  }
  if (response.status === 404) return
  await replyJson(response, `delete ${name}`)
}
