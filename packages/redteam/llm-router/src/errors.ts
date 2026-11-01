/**
 * ProviderError — the router's one failure type.
 *
 * Every provider in this package raises failures as ProviderError (the
 * ZimZilla discipline: foreign wire errors are translated into the primary
 * protocol's exception type at the boundary, so ONE policy — classifier.ts —
 * governs every provider instead of each caller re-matching private message
 * formats). The classifier consumes the structured fields (status, provider
 * error code, Retry-After / reset hints); the message keeps the historical
 * `[llm-router] <Label> HTTP <status>: <body>` shape so existing logs and
 * message-based tooling keep reading the same text.
 *
 * The API key never appears in a ProviderError: providers build these from
 * the response status/body/headers only, and request bodies never carry the
 * key (it travels in the Authorization header).
 */

export interface ProviderErrorInit {
  /** Router provider id, e.g. "deepseek". */
  provider: string
  /** Full message, in the historical `[llm-router] ...` shape. */
  message: string
  /** HTTP status, when the failure was an HTTP response. */
  status?: number
  /**
   * Provider error code from the response body (`error.code`, falling back
   * to `error.type`), e.g. "insufficient_quota", "Throttling.RateQuota".
   */
  code?: string
  /** Provider-published wait before retrying (Retry-After), in milliseconds. */
  retryAfterMs?: number
  /** Absolute epoch-ms at which the provider says the limit resets, when published. */
  resetAtMs?: number
  /** Underlying error for transport failures (never carries the key). */
  cause?: unknown
}

export class ProviderError extends Error {
  readonly provider: string
  readonly status?: number
  readonly code?: string
  readonly retryAfterMs?: number
  readonly resetAtMs?: number

  constructor(init: ProviderErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined)
    this.name = 'ProviderError'
    this.provider = init.provider
    if (init.status !== undefined) this.status = init.status
    if (init.code !== undefined) this.code = init.code
    if (init.retryAfterMs !== undefined) this.retryAfterMs = init.retryAfterMs
    if (init.resetAtMs !== undefined) this.resetAtMs = init.resetAtMs
  }
}

/**
 * Parse a `Retry-After` header value into a millisecond delay.
 * @param value - The raw header value: delta-seconds or an HTTP-date.
 * @param nowMs - Current time in epoch milliseconds (the base for HTTP-dates).
 * @returns The delay in milliseconds (never negative), or undefined when the
 *   value is missing or unparseable.
 */
export function parseRetryAfterHeader(value: string | null | undefined, nowMs: number): number | undefined {
  if (value === null || value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const dateMs = Date.parse(trimmed)
  if (Number.isNaN(dateMs)) return undefined
  return Math.max(0, dateMs - nowMs)
}

/**
 * Parse an `x-ratelimit-reset*` header (epoch seconds) into epoch milliseconds.
 * @param value - The raw header value.
 * @returns Epoch milliseconds, or undefined when missing or unparseable.
 */
export function parseRateLimitResetHeader(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined
  const seconds = Number(value.trim())
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  return seconds * 1000
}

/** The slice of the fetch Response the error builder needs (fakeable in tests). */
export interface FailedResponse {
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}

/**
 * Build a ProviderError from a failed HTTP response, consuming the body once.
 * @param provider - Router provider id, e.g. "deepseek".
 * @param label - Human label for the message, e.g. "DeepSeek".
 * @param res - The failed response (status, headers, body).
 * @param nowMs - Current time in epoch milliseconds (Retry-After base).
 * @returns The ProviderError to throw.
 */
export async function providerErrorFromResponse(
  provider: string,
  label: string,
  res: FailedResponse,
  nowMs: number = Date.now(),
): Promise<ProviderError> {
  const text = await res.text().catch(() => '')
  let code: string | undefined
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown; type?: unknown } }
    const raw = parsed?.error?.code ?? parsed?.error?.type
    if (typeof raw === 'string' && raw.length > 0) code = raw
    else if (typeof raw === 'number') code = String(raw)
  } catch {
    code = undefined // Non-JSON body: the status + message still classify.
  }
  return new ProviderError({
    provider,
    message: `[llm-router] ${label} HTTP ${res.status}: ${text.slice(0, 500)}`,
    status: res.status,
    code,
    retryAfterMs: parseRetryAfterHeader(res.headers.get('retry-after'), nowMs),
    resetAtMs:
      parseRateLimitResetHeader(res.headers.get('x-ratelimit-reset')) ??
      parseRateLimitResetHeader(res.headers.get('x-ratelimit-reset-requests')),
  })
}

/**
 * Build a ProviderError for a transport failure (the fetch itself threw:
 * DNS, connection reset, timeout). The code distinguishes a timeout from a
 * generic network failure; the classifier maps both to a retryable reason.
 * @param provider - Router provider id, e.g. "deepseek".
 * @param messagePrefix - Message start, e.g. "[llm-router] DeepSeek request failed".
 * @param err - The error fetch threw.
 * @returns The ProviderError to throw.
 */
/**
 * Describe the provider failure at the root of an error chain, for logs and
 * event records. The provider's actual words (status, code, body excerpt)
 * live on the ProviderError a ResilienceError wraps as `cause`;
 * ResilienceError's message embeds this excerpt (see executor.ts), and this
 * helper remains the structured unwrap for event records and callers that
 * need the cause on its own. This walks the chain (depth ≤ 3,
 * starting from `err` itself) and formats the first ProviderError found; with
 * no ProviderError in the chain it falls back to the deepest Error's message.
 * Built from the ProviderError only — request data is never formatted, so no
 * credential can appear (see the module header guarantee).
 * @param err - The thrown error (typically a ResilienceError or ProviderError).
 * @param maxChars - Hard cap on the returned text (default 300); a truncated
 *   result ends with `…`.
 * @returns The formatted cause, or undefined when nothing describable exists.
 */
export function describeErrorCause(err: unknown, maxChars = 300): string | undefined {
  let deepest: Error | undefined
  let current: unknown = err
  for (let depth = 0; depth <= 3 && current !== undefined && current !== null; depth++) {
    if (current instanceof ProviderError) {
      const body = current.message.replace(/^\[llm-router\] [^[]*? HTTP \d{3}: /, '')
      const head =
        `provider=${current.provider}` +
        (current.status !== undefined ? ` HTTP ${current.status}` : '') +
        (current.code !== undefined ? ` code=${current.code}` : '')
      const text = body.length > 0 ? `${head}: ${body}` : head
      return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 1))}…` : text
    }
    if (current instanceof Error) {
      deepest = current
      current = current.cause
      continue
    }
    break
  }
  if (deepest === undefined || deepest.message.length === 0) return undefined
  return deepest.message.length > maxChars
    ? `${deepest.message.slice(0, Math.max(0, maxChars - 1))}…`
    : deepest.message
}

export function providerTransportError(provider: string, messagePrefix: string, err: unknown): ProviderError {
  const inner = err instanceof Error ? err : new Error(String(err))
  const isTimeout =
    inner.name === 'TimeoutError' || /timed out|timeout|etimedout/i.test(inner.message)
  return new ProviderError({
    provider,
    message: `${messagePrefix}: ${inner.message}`,
    code: isTimeout ? 'timeout' : 'network_error',
    cause: err,
  })
}
