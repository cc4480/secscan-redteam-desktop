/**
 * Step-boundary retry executor — durable before wait.
 *
 * Ported from the DeepSeek Harness llm-retry discipline: a failed step is
 * retried INSIDE the same open turn, and every retry is recorded before any
 * waiting happens. The event order is the contract:
 *
 *   attempt-failed -> retry-scheduled -> (sleep) -> retry-started -> attempt
 *
 * so a crash or cancellation during backoff never leaves an invisible
 * pending retry: the log already says what was scheduled and why.
 *
 * Streamed responses are SINGLE-ATTEMPT by design: once response chunks have
 * been emitted to a consumer they cannot be durably separated from a retry's
 * chunks, so replaying the step would interleave two partial answers. A
 * streamed step that fails is recorded and thrown, never re-run. (The
 * current providers are non-streaming; the flag exists so a future
 * streaming provider inherits the rule instead of rediscovering it.)
 *
 * The executor owns the loop, classification, recording, and sleeping. The
 * recovery DECISION — rotate a credential, switch model, wait out a bench,
 * or give up — belongs to the caller (resilience.ts) via `decide`, because
 * only the caller owns the pool and the fallback configuration.
 */

import { classifyError, type ClassifiedFailure, type FailoverReason } from './classifier.js'
import { describeErrorCause } from './errors.js'

export interface AttemptContext {
  /** 1-based attempt number. */
  attempt: number
  providerId: string
  model: string
  /** Pool id of the credential serving this attempt (safe to log). */
  keyId?: number
  /** Raw credential for this attempt. NEVER emitted in events or logs. */
  apiKey?: string
}

export type RetryEventKind = 'attempt-failed' | 'retry-scheduled' | 'retry-started'

export interface RetryEvent {
  kind: RetryEventKind
  attempt: number
  providerId: string
  model: string
  keyId?: number
  reason?: FailoverReason
  /** Scheduled wait before the next attempt (retry-scheduled only). */
  delayMs?: number
  detail?: string
  /** HTTP status of the failed attempt (attempt-failed only, when known). */
  status?: number
  /** Provider error code of the failed attempt (attempt-failed only, when known). */
  code?: string
  /** Provider-cause excerpt for the failed attempt (attempt-failed only). */
  causeExcerpt?: string
  /** ISO timestamp of the event. */
  ts: string
}

export type RetryEventSink = (event: RetryEvent) => void

export interface RetryDecision {
  retry: boolean
  /** Wait before the next attempt; defaults to defaultBackoffMs(attempt). */
  delayMs?: number
  /** Field overrides for the next attempt (rotation / model fallback). */
  next?: Partial<Omit<AttemptContext, 'attempt'>>
}

export interface ExecuteStepOptions<T> {
  run: (ctx: AttemptContext) => Promise<T>
  initial: Omit<AttemptContext, 'attempt'>
  /** Streamed steps are single-attempt (see the module header). */
  streamed?: boolean
  signal?: AbortSignal
  /** Total attempts including the first (default 3). */
  maxAttempts?: number
  classify?: (err: unknown) => ClassifiedFailure
  /**
   * Recovery decision for each failure. Returning null defers to the
   * classification's `retryable` hint. The decision is consulted only when
   * attempts remain and the step is not streamed.
   */
  decide?: (failure: ClassifiedFailure, ctx: AttemptContext) => RetryDecision | null
  onEvent?: RetryEventSink
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
}

/** Thrown when the executor gives up: carries the classification so the
 *  router can cascade to a fallback provider without re-classifying. */
export class ResilienceError extends Error {
  readonly classified: ClassifiedFailure
  readonly attempts: number

  constructor(classified: ClassifiedFailure, attempts: number, cause: unknown) {
    super(
      `[llm-router] giving up after ${attempts} attempt(s): ${classified.reason}` +
        (classified.status !== undefined ? ` (HTTP ${classified.status})` : '') +
        ` — ${classified.detail}`,
      { cause },
    )
    this.name = 'ResilienceError'
    this.classified = classified
    this.attempts = attempts
  }
}

/**
 * Default wait between attempts when neither the provider nor the decision
 * layer names one: 500ms, 1s, 2s, ... capped at 10s (the dsh normal-mode
 * ladder).
 * @param attempt - The attempt that just failed (1-based).
 * @returns The backoff in milliseconds.
 */
export function defaultBackoffMs(attempt: number): number {
  return Math.min(500 * 2 ** Math.max(0, attempt - 1), 10_000)
}

function abortError(): Error {
  const err = new Error('The operation was aborted')
  err.name = 'AbortError'
  return err
}

/** Default sleep: a timer that rejects promptly when the signal aborts. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Run one step with classification-driven retries at the step boundary.
 * @param opts - The step, its initial context, and the recovery policy hooks.
 * @returns The step's result from whichever attempt succeeds.
 * @throws The original error when the caller's signal aborts; otherwise a
 *   ResilienceError carrying the final classification when attempts run out,
 *   the decision layer declines, or the step is streamed.
 */
export async function executeStep<T>(opts: ExecuteStepOptions<T>): Promise<T> {
  const classify = opts.classify ?? classifyError
  const sleep = opts.sleep ?? abortableSleep
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3)
  const now = opts.now ?? Date.now
  const emit = (event: Omit<RetryEvent, 'ts'>): void => {
    opts.onEvent?.({ ...event, ts: new Date(now()).toISOString() })
  }

  let ctx: AttemptContext = { ...opts.initial, attempt: 1 }
  for (;;) {
    try {
      return await opts.run(ctx)
    } catch (err) {
      // A caller abort is not a provider failure: never classify, never
      // retry, never wrap — the original error propagates untouched.
      if (opts.signal?.aborted) throw err
      const failure = classify(err)
      emit({
        kind: 'attempt-failed',
        attempt: ctx.attempt,
        providerId: ctx.providerId,
        model: ctx.model,
        keyId: ctx.keyId,
        reason: failure.reason,
        detail: failure.detail,
        status: failure.status,
        code: failure.code,
        causeExcerpt: describeErrorCause(err),
      })
      if (opts.streamed) {
        // Emitted chunks cannot be durably separated from a retry's; the
        // failure is recorded above and the step is NOT re-run.
        throw new ResilienceError(failure, ctx.attempt, err)
      }
      if (ctx.attempt >= maxAttempts) throw new ResilienceError(failure, ctx.attempt, err)
      const decision = opts.decide ? opts.decide(failure, ctx) : null
      const retry = decision ? decision.retry : failure.hints.retryable
      if (!retry) throw new ResilienceError(failure, ctx.attempt, err)
      const delayMs = Math.max(0, decision?.delayMs ?? defaultBackoffMs(ctx.attempt))
      // Durable before wait: the scheduled retry is recorded BEFORE the
      // sleep, so the pending retry survives a crash during backoff.
      emit({
        kind: 'retry-scheduled',
        attempt: ctx.attempt + 1,
        providerId: ctx.providerId,
        model: ctx.model,
        keyId: ctx.keyId,
        reason: failure.reason,
        delayMs,
        detail: failure.detail,
      })
      await sleep(delayMs, opts.signal)
      const next: AttemptContext = {
        ...ctx,
        ...(decision?.next ?? {}),
        attempt: ctx.attempt + 1,
      }
      emit({
        kind: 'retry-started',
        attempt: next.attempt,
        providerId: next.providerId,
        model: next.model,
        keyId: next.keyId,
        reason: failure.reason,
        detail: failure.detail,
      })
      ctx = next
    }
  }
}
