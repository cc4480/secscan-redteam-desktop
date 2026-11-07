/**
 * ResilientProvider — the router's one retry/fallback policy, in one place.
 *
 * Wraps a provider and runs every call through the step-boundary executor
 * (executor.ts): failures are classified by reason (classifier.ts), the
 * decision below applies the recovery the classification demands, and the
 * credential pool (pool.ts) benches/rotates keys instead of letting a 429
 * or a dead key kill the run.
 *
 * Decision table (per classified failure):
 *   rate_limit        stay-on-primary when the published reset is sooner
 *                     than the switching threshold; else rotate to the
 *                     next pooled key; else wait out the reset when it
 *                     fits maxDelayMs, or the pool bench when it fits
 *                     maxBenchWaitMs (never below the base bench — a
 *                     single 429 must not kill a run); else give up,
 *                     re-expressed with the bench and its expiry. A call
 *                     that STARTS during a finite bench within the same
 *                     ceiling waits it out before its first attempt.
 *   upstream_rate_limit
 *                     the key is healthy — bench the MODEL pool-wide, fall
 *                     back to the configured fallback model, or wait out
 *                     the model bench. Never rotate on the key's account.
 *   billing/auth_dead the key is marked DEAD by the pool; rotate if another
 *                     key exists, else give up — the router may cascade to
 *                     a fallback provider from the hints.
 *   entitlement       the (key, model) pair is benched permanently; rotate
 *                     (another account may hold the entitlement), else fall
 *                     back to a different model, else give up.
 *   server_error/timeout
 *                     retry the same key on the executor's backoff ladder.
 *   context_overflow  give up immediately: the hints carry compress=true
 *                     and the CALLER owns the recovery.
 *   content_policy    give up on this route: retrying the unchanged
 *                     request is deterministic; the router may cascade to
 *                     a fallback provider from the hints.
 *
 * Configuration is env-first (resilienceConfigFromEnv) with code overrides.
 * Classification + retry default ON. The pool only changes which credential
 * a call carries when more than one key is configured; with a single key
 * and no failure, a call is byte-identical to the unwrapped provider's.
 */

import { appendFileSync } from 'node:fs'
import type { ChatResult, CompleteOptions, LlmProvider } from './types.js'
import type { ClassifiedFailure, FailoverReason, RecoveryHints } from './classifier.js'
import { CredentialPool, COOLDOWN_BASE_MS, type PoolRefusalExplanation } from './pool.js'
import {
  abortableSleep,
  executeStep,
  ResilienceError,
  type AttemptContext,
  type RetryDecision,
  type RetryEvent,
  type RetryEventSink,
} from './executor.js'

export interface FallbackProviderTarget {
  provider: string
  /** Model to request on the fallback provider; defaults to the original. */
  model?: string
}

export interface ResilienceConfig {
  enabled: boolean
  /** Total attempts per call including the first. */
  maxAttempts: number
  /**
   * "Reset sooner than switching cost" threshold: when a rate limit
   * publishes a reset within this many ms, wait on the primary instead of
   * rotating or falling back (Hermes' opt-in rule). 0 disables it.
   */
  stayOnPrimaryResetMs: number
  /** Longest single wait the executor will sleep inside one call. */
  maxDelayMs: number
  /**
   * Longest bench (pool cooldown / provider-published bench) one call
   * will wait out instead of giving up: stay-on-primary extended to pool
   * benches. A benched-only refusal with a finite expiry at or below
   * this ceiling is waited out on the spot; a longer or permanent bench
   * gives up with the honest bench wording + expiry. Normalized to never
   * sit below the pool's base bench (COOLDOWN_BASE_MS) — see
   * normalizeResilienceConfig — so the historical collision (30s wait
   * ceiling vs 60s base bench: every first 429 a guaranteed give-up)
   * cannot recur by configuration.
   */
  maxBenchWaitMs: number
  /** provider id -> model -> fallback model (same provider). */
  fallbackModels: Record<string, Record<string, string>>
  /** provider id -> fallback provider target (applied by router.ts). */
  fallbackProviders: Record<string, FallbackProviderTarget>
  /** JSONL resilience-event path. Default: $REDTEAM_TRAJECTORY_LOG or
   *  ./trajectories.jsonl (the adapter's log). Null disables event logging. */
  logPath?: string | null
}

export const RESILIENCE_ENV = {
  enabled: 'REDTEAM_LLM_RESILIENCE',
  maxAttempts: 'REDTEAM_LLM_MAX_ATTEMPTS',
  stayOnPrimaryResetMs: 'REDTEAM_LLM_STAY_ON_PRIMARY_MS',
  maxDelayMs: 'REDTEAM_LLM_MAX_DELAY_MS',
  maxBenchWaitMs: 'REDTEAM_LLM_MAX_BENCH_WAIT_MS',
  fallbackModels: 'REDTEAM_LLM_FALLBACK_MODELS',
  fallbackProviders: 'REDTEAM_LLM_FALLBACK_PROVIDERS',
} as const

/**
 * Default bench-wait ceiling: 240s — the third rung of the pool's
 * cooldown ladder (60s → 120s → 240s). Benches a provider publishes or
 * the ladder assigns for the first three consecutive rate-limit failures
 * are waited out inside the call; a longer bench (fourth failure and
 * beyond, or a provider-published reset past the ceiling) gives up
 * honestly with its expiry rather than hanging the engagement. Total
 * in-call waiting stays bounded by (maxAttempts − 1) × this ceiling.
 */
export const DEFAULT_MAX_BENCH_WAIT_MS = 240_000

/**
 * Enforce the bench-wait invariant on any config, however it was built:
 * the bench-wait ceiling never sits below the pool's base bench
 * (COOLDOWN_BASE_MS). A smaller configured value is raised to the base
 * bench, never honored — the 30s-vs-60s collision this guards against
 * made a single 429 a guaranteed give-up.
 * @param config - The configuration to normalize.
 * @returns The configuration with the invariant enforced.
 */
export function normalizeResilienceConfig(config: ResilienceConfig): ResilienceConfig {
  const maxBenchWaitMs = Math.max(COOLDOWN_BASE_MS, config.maxBenchWaitMs ?? DEFAULT_MAX_BENCH_WAIT_MS)
  return maxBenchWaitMs === config.maxBenchWaitMs ? config : { ...config, maxBenchWaitMs }
}

function parseNonNegativeInt(envName: string, raw: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`[llm-router] ${envName} must be a non-negative integer, got ${JSON.stringify(raw)}`)
  }
  return value
}

function parseFallbackModels(raw: string | undefined): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  if (raw === undefined || raw.trim().length === 0) return out
  for (const entry of raw.split(',')) {
    const match = /^([^:>]+):([^>]+)>(.+)$/.exec(entry.trim())
    if (!match) {
      throw new Error(
        `[llm-router] ${RESILIENCE_ENV.fallbackModels} entries must look like ` +
          '"provider:model>fallback-model", got ' + JSON.stringify(entry),
      )
    }
    const [, provider, model, fallback] = match as unknown as [string, string, string, string]
    ;(out[provider] ??= {})[model] = fallback
  }
  return out
}

function parseFallbackProviders(raw: string | undefined): Record<string, FallbackProviderTarget> {
  const out: Record<string, FallbackProviderTarget> = {}
  if (raw === undefined || raw.trim().length === 0) return out
  for (const entry of raw.split(',')) {
    const match = /^([^>]+)>([^:>]+)(?::(.+))?$/.exec(entry.trim())
    if (!match) {
      throw new Error(
        `[llm-router] ${RESILIENCE_ENV.fallbackProviders} entries must look like ` +
          '"provider>fallback-provider[:model]", got ' + JSON.stringify(entry),
      )
    }
    const [, provider, target, model] = match as unknown as [string, string, string, string | undefined]
    const parsed: FallbackProviderTarget = { provider: target }
    if (model !== undefined) parsed.model = model
    out[provider] = parsed
  }
  return out
}

/**
 * Resolve the resilience configuration from the environment.
 * @param env - Environment to read (defaults to `process.env`).
 * @param overrides - Code-level overrides, applied last.
 * @returns The effective configuration.
 * @throws When a set variable is malformed (misconfiguration fails loud).
 */
export function resilienceConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<ResilienceConfig> = {},
): ResilienceConfig {
  const enabledRaw = env[RESILIENCE_ENV.enabled]?.trim().toLowerCase()
  const config: ResilienceConfig = {
    enabled: enabledRaw !== 'off' && enabledRaw !== '0' && enabledRaw !== 'false',
    maxAttempts: 4,
    stayOnPrimaryResetMs: 0,
    maxDelayMs: 30_000,
    maxBenchWaitMs: DEFAULT_MAX_BENCH_WAIT_MS,
    fallbackModels: parseFallbackModels(env[RESILIENCE_ENV.fallbackModels]),
    fallbackProviders: parseFallbackProviders(env[RESILIENCE_ENV.fallbackProviders]),
  }
  const maxAttemptsRaw = env[RESILIENCE_ENV.maxAttempts]
  if (maxAttemptsRaw !== undefined && maxAttemptsRaw.trim().length > 0) {
    config.maxAttempts = Math.max(1, parseNonNegativeInt(RESILIENCE_ENV.maxAttempts, maxAttemptsRaw.trim()))
  }
  const stayRaw = env[RESILIENCE_ENV.stayOnPrimaryResetMs]
  if (stayRaw !== undefined && stayRaw.trim().length > 0) {
    config.stayOnPrimaryResetMs = parseNonNegativeInt(RESILIENCE_ENV.stayOnPrimaryResetMs, stayRaw.trim())
  }
  const maxDelayRaw = env[RESILIENCE_ENV.maxDelayMs]
  if (maxDelayRaw !== undefined && maxDelayRaw.trim().length > 0) {
    config.maxDelayMs = parseNonNegativeInt(RESILIENCE_ENV.maxDelayMs, maxDelayRaw.trim())
  }
  const maxBenchWaitRaw = env[RESILIENCE_ENV.maxBenchWaitMs]
  if (maxBenchWaitRaw !== undefined && maxBenchWaitRaw.trim().length > 0) {
    config.maxBenchWaitMs = parseNonNegativeInt(RESILIENCE_ENV.maxBenchWaitMs, maxBenchWaitRaw.trim())
  }
  return normalizeResilienceConfig({ ...config, ...overrides })
}

const NO_ROTATE_HINTS: RecoveryHints = {
  retryable: false,
  rotateCredential: true,
  fallbackModel: false,
  fallbackProvider: true,
  compress: false,
}

/**
 * Build the give-up classification + cause for a pool refusal (acquire()
 * returned null before any attempt). The terminal cause is stated as the
 * pool recorded it: a DEAD credential is named as dead — provider,
 * deadReason, the killing response's status/code, and when the death was
 * recorded — and is never dressed up as a rate limit; a genuine bench is
 * named as a bench with its expiry.
 * @param providerId - The refusing provider's router id.
 * @param model - The model the refused call would request.
 * @param refusal - The pool's explanation, or undefined when it offered none.
 * @returns The classification and the cause message for the ResilienceError.
 */
export function poolRefusalFailure(
  providerId: string,
  model: string,
  refusal: PoolRefusalExplanation | undefined,
): { failure: ClassifiedFailure; causeMessage: string } {
  if (refusal?.kind === 'all-dead') {
    const first = refusal.dead[0]
    const reason: FailoverReason =
      first?.deadReason === 'billing' ? 'billing' : 'auth_dead'
    const segments = refusal.dead.map((d) => {
      const said: string[] = []
      if (d.deadStatus !== undefined) said.push(`HTTP ${d.deadStatus}`)
      if (d.deadCode !== undefined) said.push(d.deadCode)
      return (
        `key …${d.fingerprint} marked ${d.deadReason ?? 'dead'}` +
        (d.deadAtMs !== undefined ? ` at ${new Date(d.deadAtMs).toISOString()}` : '') +
        (said.length > 0 ? ` (${said.join(' ')})` : '')
      )
    })
    const failure: ClassifiedFailure = {
      reason,
      hints: { ...NO_ROTATE_HINTS },
      detail: 'all-credentials-dead',
    }
    if (first?.deadStatus !== undefined) failure.status = first.deadStatus
    if (first?.deadCode !== undefined) failure.code = first.deadCode
    // Kept short on purpose: ResilienceError embeds the cause excerpt
    // truncated at 300 chars, and the remedy must survive that truncation
    // into the halt text an operator reads.
    return {
      failure,
      causeMessage:
        `[llm-router] provider '${providerId}' cannot serve '${model}': ` +
        `every pooled credential is DEAD — ${segments.join('; ')}. ` +
        'Re-seat a valid key in Settings → Models: the provider rejected the key itself — ' +
        'not a rate limit, no bench lifts it. A re-seated key takes effect on the next call; no restart is needed.',
    }
  }
  if (refusal?.kind === 'model-benched' && refusal.benchUntilMs !== undefined) {
    return {
      failure: { reason: 'rate_limit', hints: { ...NO_ROTATE_HINTS }, detail: 'model-benched' },
      causeMessage:
        `[llm-router] model '${model}' is benched pool-wide for provider '${providerId}' ` +
        `until ${new Date(refusal.benchUntilMs).toISOString()} (upstream rate limit); ` +
        'no credential can serve it before then.',
    }
  }
  const benchTail =
    refusal?.kind === 'keys-benched'
      ? refusal.benchUntilMs !== undefined
        ? ` until ${new Date(refusal.benchUntilMs).toISOString()}`
        : refusal.permanentBench
          ? ' — at least one bench is permanent (entitlement) and never lifts on its own'
          : ''
      : ''
  return {
    failure: { reason: 'rate_limit', hints: { ...NO_ROTATE_HINTS }, detail: 'all-credentials-benched' },
    causeMessage: `[llm-router] every pooled credential is benched or dead for this model${benchTail}`,
  }
}

export interface ResilientProviderOptions {
  pool?: CredentialPool
  config?: ResilienceConfig
  /** Event sink; defaults to the JSONL trajectory log (config.logPath). */
  onEvent?: RetryEventSink
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
  /**
   * Reconcile the pool with the credentials the resolver currently
   * answers (router wiring; see CredentialPool.refreshKeys). Invoked
   * before the pool is consulted on each call, so a key seated or
   * rotated in the app reaches this provider without a restart.
   */
  refreshPool?: () => void
}

export class ResilientProvider implements LlmProvider {
  readonly id: string
  readonly label: string
  private readonly inner: LlmProvider
  private readonly pool?: CredentialPool
  private readonly config: ResilienceConfig
  private readonly onEvent?: RetryEventSink
  private readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  private readonly now: () => number
  private readonly refreshPool?: () => void

  constructor(inner: LlmProvider, opts: ResilientProviderOptions = {}) {
    this.inner = inner
    this.id = inner.id
    this.label = inner.label
    this.pool = opts.pool
    this.refreshPool = opts.refreshPool
    // Normalized however the config arrived (env resolver or a literal):
    // the bench-wait invariant holds by construction, not by convention.
    this.config = normalizeResilienceConfig(opts.config ?? resilienceConfigFromEnv())
    this.onEvent = opts.onEvent
    this.sleep = opts.sleep
    this.now = opts.now ?? Date.now
  }

  isConfigured(): boolean {
    try {
      if (this.inner.isConfigured()) return true
    } catch {
      // A throwing isConfigured() reads as unconfigured, as in router.ts.
    }
    // Numbered sibling keys (DEEPSEEK_API_KEY_2, ...) configure the provider
    // through the pool even when the primary variable is unset.
    return (this.pool?.size ?? 0) > 0
  }

  /** Milliseconds until the provider-published reset, when the failure carries one. */
  private resetDelayMs(failure: ClassifiedFailure): number | undefined {
    if (failure.retryAfterMs !== undefined) return failure.retryAfterMs
    if (failure.resetAtMs !== undefined) return Math.max(0, failure.resetAtMs - this.now())
    return undefined
  }

  /** Rotate decision: the next usable pooled key, when it differs from the serving one. */
  private rotate(ctx: AttemptContext): RetryDecision | null {
    if (!this.pool || !this.pool.isActive()) return null
    const next = this.pool.acquire(ctx.model)
    if (!next || next.keyId === ctx.keyId) return null
    return { retry: true, delayMs: 0, next: { keyId: next.keyId, apiKey: next.apiKey } }
  }

  /** Model-fallback decision from the configuration, when one is named. */
  private fallbackModel(ctx: AttemptContext): RetryDecision | null {
    const fallback = this.config.fallbackModels[this.inner.id]?.[ctx.model]
    if (fallback === undefined || fallback === ctx.model) return null
    return { retry: true, delayMs: 0, next: { model: fallback } }
  }

  private decide(failure: ClassifiedFailure, ctx: AttemptContext): RetryDecision {
    // Bookkeeping first: the pool state must reflect this failure before
    // any decision (or any scheduled retry) reads it.
    if (this.pool && ctx.keyId !== undefined) {
      this.pool.reportFailure(ctx.keyId, ctx.model, failure)
    }
    if (this.pool && failure.reason === 'upstream_rate_limit') {
      this.pool.benchModel(ctx.model, this.resetDelayMs(failure) ?? COOLDOWN_BASE_MS)
    }

    switch (failure.reason) {
      case 'context_overflow':
      case 'content_policy':
        // Not recoverable on this route; the hints on the thrown
        // ResilienceError tell the caller/router what to do instead.
        return { retry: false }
      case 'billing':
      case 'auth_dead':
        // The serving key is DEAD (pool bookkeeping above); another key is
        // the only credential-level recovery.
        return this.rotate(ctx) ?? { retry: false }
      case 'entitlement':
        return this.rotate(ctx) ?? this.fallbackModel(ctx) ?? { retry: false }
      case 'upstream_rate_limit': {
        const modelFallback = this.fallbackModel(ctx)
        if (modelFallback) return modelFallback
        const wait =
          this.pool?.modelBenchedForMs(ctx.model) ?? this.resetDelayMs(failure)
        if (wait !== undefined && wait > 0 && wait <= this.config.maxDelayMs) {
          return { retry: true, delayMs: wait }
        }
        return { retry: true } // No published wait: executor backoff.
      }
      case 'rate_limit': {
        const reset = this.resetDelayMs(failure)
        if (
          this.config.stayOnPrimaryResetMs > 0 &&
          reset !== undefined &&
          reset <= this.config.stayOnPrimaryResetMs
        ) {
          // The reset lands sooner than switching costs: stay on the
          // primary key and wait it out (Hermes' opt-in rule).
          return { retry: true, delayMs: reset }
        }
        const rotated = this.rotate(ctx)
        if (rotated) return rotated
        if (reset !== undefined && reset <= this.config.maxDelayMs) {
          return { retry: true, delayMs: reset }
        }
        // Stay-on-primary extended to pool benches: when the only serving
        // credential is benched with a finite expiry within the bench-wait
        // ceiling, wait the bench out on this same call instead of giving
        // up. The ceiling (maxBenchWaitMs, normalized to >= the base
        // bench) is what keeps a single 429 from killing the run while
        // still bounding the wait; a longer or permanent bench falls
        // through to the give-up, which complete() re-expresses with the
        // honest bench wording + expiry.
        const benchWait = this.pool?.nextAvailableInMs(ctx.model)
        if (benchWait !== undefined && benchWait > 0 && benchWait <= this.config.maxBenchWaitMs) {
          return { retry: true, delayMs: benchWait }
        }
        if (reset !== undefined || benchWait !== undefined) return { retry: false }
        return { retry: true } // No pool, no published reset: executor backoff.
      }
      case 'server_error':
      case 'timeout':
        return { retry: true }
      case 'unknown':
        return { retry: failure.hints.retryable }
      default:
        return { retry: false }
    }
  }

  /** Default event sink: one JSONL record per event on the trajectory log. */
  private logEvent(event: RetryEvent, options: CompleteOptions): void {
    const logPath =
      this.config.logPath !== undefined
        ? this.config.logPath
        : (process.env['REDTEAM_TRAJECTORY_LOG'] ?? './trajectories.jsonl')
    if (logPath === null) return
    try {
      appendFileSync(
        logPath,
        `${JSON.stringify({
          v: 2,
          kind: `llm/${event.kind}`,
          ts: event.ts,
          run_id: options.runId ?? null,
          role: options.role ?? null,
          provider: event.providerId,
          model: event.model,
          key_id: event.keyId ?? null,
          attempt: event.attempt,
          reason: event.reason ?? null,
          delay_ms: event.delayMs ?? null,
          detail: event.detail ?? null,
          http_status: event.status ?? null,
          error_code: event.code ?? null,
          cause_excerpt: event.causeExcerpt ?? null,
        })}\n`,
        'utf8',
      )
    } catch {
      // Event logging must never take down an engagement (adapter's rule).
    }
  }

  async complete(options: CompleteOptions): Promise<ChatResult> {
    if (!this.config.enabled) return this.inner.complete(options)
    // A key seated or rotated since the last call enters the pool here,
    // before acquire reads it — revival without a restart.
    if (this.pool) this.refreshPool?.()
    const pool = this.pool
    const initial: Omit<AttemptContext, 'attempt'> = { providerId: this.inner.id, model: options.model }
    if (pool && pool.size > 0) {
      // Through the same sink as attempt events: with no custom sink
      // configured (the router's construction), the default trajectory
      // log must still record refusals and bench waits — emitting only
      // via an optional custom sink dropped these records entirely.
      const refusalSink: RetryEventSink = this.onEvent ?? (event => this.logEvent(event, options))
      let acquired = pool.acquire(options.model)
      if (!acquired) {
        // A bench recorded by an earlier (or parallel) call refuses this
        // call before any attempt: when the refusal is a FINITE bench
        // within the bench-wait ceiling, wait it out and re-acquire once
        // instead of dying at attempt 0. Dead and permanent refusals
        // never wait — they give up honestly below.
        const startRefusal = pool.refusalExplanation(options.model)
        const startWaitMs =
          startRefusal !== undefined &&
          startRefusal.kind !== 'all-dead' &&
          startRefusal.benchUntilMs !== undefined
            ? startRefusal.benchUntilMs - this.now()
            : 0
        if (startWaitMs > 0 && startWaitMs <= this.config.maxBenchWaitMs) {
          refusalSink({
            kind: 'retry-scheduled',
            attempt: 0,
            providerId: this.inner.id,
            model: options.model,
            reason: 'rate_limit',
            delayMs: startWaitMs,
            detail: startRefusal?.kind === 'model-benched' ? 'model-benched' : 'all-credentials-benched',
            ts: new Date(this.now()).toISOString(),
          })
          await (this.sleep ?? abortableSleep)(startWaitMs, options.signal)
          acquired = pool.acquire(options.model)
        }
      }
      if (!acquired) {
        // The pool refused before any attempt: the give-up names the
        // terminal cause the pool recorded (dead key vs bench — see
        // poolRefusalFailure), never a blanket rate-limit label.
        const { failure, causeMessage } = poolRefusalFailure(
          this.inner.id,
          options.model,
          pool.refusalExplanation(options.model),
        )
        refusalSink({
          kind: 'attempt-failed',
          attempt: 0,
          providerId: this.inner.id,
          model: options.model,
          reason: failure.reason,
          detail: failure.detail,
          status: failure.status,
          code: failure.code,
          ts: new Date(this.now()).toISOString(),
        })
        throw new ResilienceError(failure, 0, new Error(causeMessage))
      }
      initial.keyId = acquired.keyId
      initial.apiKey = acquired.apiKey
    }

    const sink: RetryEventSink = this.onEvent ?? (event => this.logEvent(event, options))
    try {
      return await executeStep<ChatResult>({
        initial,
        signal: options.signal,
        maxAttempts: this.config.maxAttempts,
        onEvent: sink,
        sleep: this.sleep,
        now: this.now,
        decide: (failure, ctx) => this.decide(failure, ctx),
        run: async (ctx) => {
          const attemptOptions: CompleteOptions = { ...options, model: ctx.model }
          if (ctx.apiKey !== undefined) attemptOptions.apiKey = ctx.apiKey
          const result = await this.inner.complete(attemptOptions)
          if (pool && ctx.keyId !== undefined) pool.reportSuccess(ctx.keyId, ctx.model)
          return result
        },
      })
    } catch (err) {
      // A rate-limit give-up that leaves the pool benched-out (a bench
      // past the wait ceiling, or a permanent one) is re-expressed with
      // the pool's honest bench wording + expiry instead of the
      // classifier's bare rule name — the same text an attempt-0 refusal
      // produces. The attempt count is preserved; every other error
      // propagates untouched.
      if (pool && err instanceof ResilienceError && err.classified.reason === 'rate_limit') {
        const refusal = pool.refusalExplanation(options.model)
        if (refusal !== undefined && refusal.kind !== 'all-dead') {
          const { failure, causeMessage } = poolRefusalFailure(this.inner.id, options.model, refusal)
          throw new ResilienceError(failure, err.attempts, new Error(causeMessage))
        }
      }
      throw err
    }
  }
}
