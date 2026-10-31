/**
 * Failure classification — by REASON, never by raw status alone.
 *
 * A priority-ordered pipeline maps any provider failure to a FailoverReason
 * plus recovery hints; the retry executor (executor.ts) and the credential
 * pool (pool.ts) consult the hints instead of re-matching strings or status
 * codes themselves. Ported from the Hermes failover design, reduced to the
 * reasons this router can act on:
 *
 *   - rate_limit vs upstream_rate_limit is the load-bearing distinction:
 *     a plain 429 throttles OUR key (bench it, rotate), while an upstream
 *     429 means the aggregator's model backend throttled — the key is
 *     healthy, only the model should change or wait.
 *   - billing / auth_dead are credential-terminal: rotate immediately; the
 *     pool marks the key DEAD so no later call re-tries it.
 *   - entitlement is model-scoped: this account cannot use that model.
 *     Another key may hold it; otherwise fall back to a different model.
 *   - context_overflow is NOT a failover: the recovery is compression,
 *     owned by the caller, so every failover hint stays false.
 *   - content_policy is deterministic for the unchanged request: never
 *     retry it on the same route; a different model/provider may serve it.
 *
 * Hermes' `overloaded` (503/529) folds into `server_error` here: the
 * recovery this router applies — back off, same key, never rotate — is
 * identical. Classification reads structured ProviderError fields first;
 * message patterns exist for the provider bodies that carry their meaning
 * in prose (and for legacy plain-Error throws from unconverted providers).
 */

import { ProviderError } from './errors.js'

export type FailoverReason =
  | 'rate_limit'
  | 'upstream_rate_limit'
  | 'billing'
  | 'entitlement'
  | 'auth_dead'
  | 'context_overflow'
  | 'content_policy'
  | 'server_error'
  | 'timeout'
  | 'unknown'

export interface RecoveryHints {
  /** Retry the step (after the decision layer applies rotation/fallback/delay). */
  retryable: boolean
  /** Abandon the failed credential for another pooled key. */
  rotateCredential: boolean
  /** Retry against a different model on the same provider. */
  fallbackModel: boolean
  /** Retry against a different provider. */
  fallbackProvider: boolean
  /** The recovery is context compression by the caller, not failover. */
  compress: boolean
}

export interface ClassifiedFailure {
  reason: FailoverReason
  hints: RecoveryHints
  /** HTTP status, when known. */
  status?: number
  /** Provider error code, when known. */
  code?: string
  /** Provider-published wait (Retry-After), in milliseconds. */
  retryAfterMs?: number
  /** Absolute epoch-ms reset the provider published, when known. */
  resetAtMs?: number
  /** Which rule produced the verdict — for logs and tests. */
  detail: string
}

const NO_HINTS: RecoveryHints = {
  retryable: false,
  rotateCredential: false,
  fallbackModel: false,
  fallbackProvider: false,
  compress: false,
}

function hints(partial: Partial<RecoveryHints>): RecoveryHints {
  return { ...NO_HINTS, ...partial }
}

const HINTS_BY_REASON: Record<FailoverReason, RecoveryHints> = {
  rate_limit: hints({ retryable: true, rotateCredential: true, fallbackProvider: true }),
  upstream_rate_limit: hints({ retryable: true, fallbackModel: true, fallbackProvider: true }),
  billing: hints({ rotateCredential: true, fallbackProvider: true }),
  entitlement: hints({ rotateCredential: true, fallbackModel: true, fallbackProvider: true }),
  auth_dead: hints({ rotateCredential: true, fallbackProvider: true }),
  context_overflow: hints({ compress: true }),
  content_policy: hints({ fallbackModel: true, fallbackProvider: true }),
  server_error: hints({ retryable: true, fallbackProvider: true }),
  timeout: hints({ retryable: true, fallbackProvider: true }),
  unknown: hints({ retryable: true }),
}

// Pattern tables: lowercased substrings matched against the provider error
// code + body message combined. Kept narrow — a pattern that also matches a
// healthy response's prose would misclassify real failures.

const BILLING_CODES = new Set([
  'insufficient_quota',
  'insufficient_credits',
  'billing_not_active',
  'payment_required',
  'balance_depleted',
  'credit_balance_exhausted',
  'terminal_quota_exhausted',
])

const BILLING_PATTERNS = [
  'insufficient balance',
  'insufficient credits',
  'insufficient_quota',
  'credit balance is too low',
  'credits exhausted',
  'payment required',
  'exceeded your current quota',
  'account is deactivated',
  'out of funds',
  'budget limit exceeded',
  'hard billing limit',
  'not available on the free tier',
]

/** Signals that a 429 came from the model backend, not from our key's quota. */
const UPSTREAM_PATTERNS = [
  'upstream',
  'model provider is temporarily unavailable',
  'model_provider_unavailable',
  // DashScope's model-scoped rate quota: the key is fine, the model is hot.
  'throttling.ratequota',
  'ratequota',
]

const RATE_LIMIT_CODES = new Set(['rate_limit_exceeded', 'resource_exhausted', 'throttled'])

const RATE_LIMIT_PATTERNS = [
  'rate limit',
  'rate_limit',
  'too many requests',
  'throttling',
  'throttled',
  'requests per minute',
  'tokens per minute',
  'resource exhausted',
  'try again in',
]

const ENTITLEMENT_PATTERNS = [
  'model_not_supported',
  'model not supported',
  'model not found',
  'model_not_found',
  'invalid model',
  'no such model',
  'unknown model',
  'unsupported model',
  'model does not exist',
  'not entitled',
  'does not have access',
  'no access to the model',
]

const CONTEXT_PATTERNS = [
  'context_length_exceeded',
  'context length',
  'maximum context',
  'context window',
  'too many tokens',
  'prompt is too long',
  'input is too long',
  'max_model_len',
  'maximum number of tokens',
  'maximum allowed input length',
]

const CONTENT_PATTERNS = [
  'content_filter',
  'content policy',
  'content_policy',
  'data_inspection_failed',
  'responsibleaipolicyviolation',
  'safety filter',
  'request was flagged',
  'violates our usage policies',
]

const AUTH_PATTERNS = [
  'invalid api key',
  'invalid_api_key',
  'incorrect api key',
  'invalid token',
  'token revoked',
  'token expired',
  'authentication failed',
  'unauthorized',
]

/** A 403 written by a WAF/CDN in front of the provider — the key is healthy. */
const UPSTREAM_BLOCKED_PATTERNS = [
  'your request was blocked',
  'request blocked',
  'attention required! | cloudflare',
  'cf-browser-verification',
  'enable javascript and cookies to continue',
]

const TIMEOUT_PATTERNS = ['timed out', 'timeout', 'deadline exceeded', 'etimedout', 'request timeout']

const TRANSPORT_PATTERNS = [
  'fetch failed',
  'request failed',
  'econnreset',
  'econnrefused',
  'econnaborted',
  'eai_again',
  'enotfound',
  'socket',
  'network',
  'connection reset',
  'connection refused',
]

interface RawFields {
  status?: number
  code?: string
  message: string
  name?: string
  retryAfterMs?: number
  resetAtMs?: number
}

function extractFields(err: unknown): RawFields {
  if (err instanceof ProviderError) {
    return {
      status: err.status,
      code: err.code,
      message: err.message,
      retryAfterMs: err.retryAfterMs,
      resetAtMs: err.resetAtMs,
    }
  }
  if (err instanceof Error) {
    // Legacy plain-Error throws (unconverted providers) embed the status in
    // the message: "[llm-router] DeepSeek HTTP 429: ...". Recover it so the
    // same pipeline classifies them.
    const statusMatch = /HTTP (\d{3})\b/.exec(err.message)
    return {
      status: statusMatch ? Number(statusMatch[1]) : undefined,
      message: err.message,
      name: err.name,
    }
  }
  return { message: String(err) }
}

function verdict(
  reason: FailoverReason,
  fields: RawFields,
  detail: string,
  hintOverrides?: Partial<RecoveryHints>,
): ClassifiedFailure {
  const out: ClassifiedFailure = {
    reason,
    hints: hintOverrides ? { ...HINTS_BY_REASON[reason], ...hintOverrides } : HINTS_BY_REASON[reason],
    detail,
  }
  if (fields.status !== undefined) out.status = fields.status
  if (fields.code !== undefined) out.code = fields.code
  if (fields.retryAfterMs !== undefined) out.retryAfterMs = fields.retryAfterMs
  if (fields.resetAtMs !== undefined) out.resetAtMs = fields.resetAtMs
  return out
}

/**
 * Classify any provider failure into a FailoverReason + recovery hints.
 * @param err - The error a provider threw (ProviderError or legacy Error).
 * @returns The classification; never throws.
 */
export function classifyError(err: unknown): ClassifiedFailure {
  const fields = extractFields(err)
  const code = (fields.code ?? '').toLowerCase()
  const text = `${code} ${fields.message}`.toLowerCase()
  const status = fields.status
  const has = (patterns: string[]): boolean => patterns.some(p => text.includes(p))

  // A caller-side abort is not a provider failure; the executor checks the
  // signal before classifying, but a bare AbortError still lands as timeout
  // rather than unknown so a stray one never reads as a provider fault.
  if (fields.name === 'AbortError') return verdict('timeout', fields, 'abort-error')

  // Deterministic request-content verdicts first: a content-filter rejection
  // can arrive wearing billing-adjacent prose, and an overflow must never be
  // mistaken for a credential problem.
  if (has(CONTENT_PATTERNS) || code === 'content_filter') {
    return verdict('content_policy', fields, 'content-pattern')
  }
  if (has(CONTEXT_PATTERNS) || code === 'context_length_exceeded') {
    return verdict('context_overflow', fields, 'context-pattern')
  }

  // Billing: terminal for this credential (402 by definition, or a
  // structured billing code / explicit exhaustion prose on any status).
  if (status === 402 || BILLING_CODES.has(code) || has(BILLING_PATTERNS)) {
    return verdict('billing', fields, status === 402 ? 'status-402' : 'billing-pattern')
  }

  // Rate limiting — upstream first: if the model backend throttled, the key
  // is healthy and must not be benched or rotated.
  if (status === 429 || RATE_LIMIT_CODES.has(code) || has(RATE_LIMIT_PATTERNS)) {
    if (has(UPSTREAM_PATTERNS)) return verdict('upstream_rate_limit', fields, 'upstream-429')
    return verdict('rate_limit', fields, 'rate-limit')
  }

  // Entitlement: the account cannot use this model (includes model-not-found
  // 404s — a retired slug and an unentitled one are indistinguishable here,
  // and the recovery is the same). "The model `x` does not exist" carries the
  // slug between "model" and "does not exist", so 404s match that tail too;
  // the tail alone is not a pattern, or a 400 "parameter does not exist"
  // would misread as a model problem.
  if (has(ENTITLEMENT_PATTERNS) || (status === 404 && text.includes('does not exist'))) {
    return verdict('entitlement', fields, 'entitlement-pattern')
  }

  // Auth: 401 is a dead/rejected credential. A bare 403 defaults to the
  // credential too — unless a WAF/CDN wrote it, in which case the key is
  // healthy and the route is the problem.
  if (status === 401) return verdict('auth_dead', fields, 'status-401')
  if (status === 403) {
    if (has(UPSTREAM_BLOCKED_PATTERNS)) {
      return verdict('server_error', fields, 'upstream-blocked-403', { rotateCredential: false })
    }
    return verdict('auth_dead', fields, has(AUTH_PATTERNS) ? 'auth-pattern-403' : 'status-403')
  }
  if (has(AUTH_PATTERNS) && (status === undefined || status < 500)) {
    return verdict('auth_dead', fields, 'auth-pattern')
  }

  if (status !== undefined && status >= 500 && status <= 599) {
    return verdict('server_error', fields, 'status-5xx')
  }

  if (code === 'timeout' || fields.name === 'TimeoutError' || has(TIMEOUT_PATTERNS)) {
    return verdict('timeout', fields, 'timeout')
  }
  if (code === 'network_error' || has(TRANSPORT_PATTERNS)) {
    return verdict('timeout', fields, 'transport')
  }

  // A generic 400 is a deterministic request problem: retrying the identical
  // step cannot help, so the unknown verdict is non-retryable here.
  if (status === 400) return verdict('unknown', fields, 'request-validation', { retryable: false })
  return verdict('unknown', fields, 'unclassified')
}
