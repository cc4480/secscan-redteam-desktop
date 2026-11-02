/**
 * CredentialPool — per-provider API keys that bench and rotate instead of
 * killing runs.
 *
 * Keys come from the environment: the provider's primary key env var plus
 * numbered siblings (`<PRIMARY>_2`, `<PRIMARY>_3`, ...). Selection is
 * fill-first (Hermes' default): the earliest healthy key serves until it is
 * benched or dead, then the next takes over.
 *
 * Failure bookkeeping is scoped the way the failures are:
 *   - rate_limit benches the (key, model) pair until the provider's
 *     published reset / Retry-After, or an exponential cooldown
 *     (60s → 2m → 4m → ... → 4h cap) when the provider publishes neither.
 *   - entitlement benches the (key, model) pair permanently — the account
 *     will not gain the model mid-run — while the key stays healthy for
 *     every other model.
 *   - billing and auth_dead mark the KEY dead: a terminal state, never
 *     re-acquired, so no later call burns an attempt rediscovering it.
 *   - upstream_rate_limit touches NO key (the key is healthy); the executor
 *     benches the model pool-wide via benchModel() instead.
 *   - server_error / timeout change nothing: transient faults are the
 *     executor's backoff problem, not the credential's.
 *
 * Raw keys live only in memory and in the AcquiredCredential handed to the
 * provider for one call. Snapshots expose a SHA-256 fingerprint prefix —
 * never the key — so state can be logged and tested safely.
 *
 * Persistence is optional and injected (PoolStateStore): with a store, the
 * failure bookkeeping — dead marks and benches, keyed by fingerprint —
 * survives process restarts in a versioned JSON document, so a key the
 * provider already pronounced dead is not retried cold on the next launch.
 * The document holds fingerprints and bench bookkeeping only, never key
 * material. A corrupt document never wedges startup: it is quarantined
 * when the store supports it, the pool reseeds empty, and a warning names
 * what happened. Without a store the pool is exactly the in-memory pool
 * it has always been.
 */

import { createHash } from 'node:crypto'
import type { ClassifiedFailure } from './classifier.js'

/** First cooldown after a rate-limit failure, in milliseconds. */
export const COOLDOWN_BASE_MS = 60_000
/** Cooldown ceiling: the exponential ladder caps at 4 hours. */
export const COOLDOWN_MAX_MS = 14_400_000

/**
 * Cooldown after the n-th consecutive rate-limit failure of one
 * (key, model) pair: 60s, 120s, 240s, ... capped at 4h.
 * @param consecutiveFailures - Failure count for the pair (1-based).
 * @returns The cooldown in milliseconds.
 */
export function cooldownMsForFailure(consecutiveFailures: number): number {
  const n = Math.max(1, Math.floor(consecutiveFailures))
  return Math.min(COOLDOWN_BASE_MS * 2 ** (n - 1), COOLDOWN_MAX_MS)
}

/**
 * Collect a provider's keys from an environment: the primary variable plus
 * numbered siblings `<PRIMARY>_2` .. `<PRIMARY>_<maxExtra + 1>`. Blank values
 * are skipped and duplicates collapse (the same key twice is one credential).
 * @param env - The environment to read.
 * @param primaryEnvName - The primary key variable, e.g. "DEEPSEEK_API_KEY".
 * @param maxExtra - How many numbered siblings to look for (default 8).
 * @returns The keys in fill-first order.
 */
export function collectCredentialEnv(
  env: NodeJS.ProcessEnv,
  primaryEnvName: string,
  maxExtra = 8,
): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  const push = (raw: string | undefined): void => {
    const value = raw?.trim()
    if (value !== undefined && value.length > 0 && !seen.has(value)) {
      seen.add(value)
      keys.push(value)
    }
  }
  push(env[primaryEnvName])
  for (let i = 2; i <= maxExtra + 1; i += 1) push(env[`${primaryEnvName}_${i}`])
  return keys
}

export interface AcquiredCredential {
  /** Pool-local id (the fill-first index). Safe to log. */
  keyId: number
  /** The raw key, for the provider's Authorization header only. */
  apiKey: string
}

export interface PoolEntrySnapshot {
  keyId: number
  /** First 8 hex chars of the key's SHA-256 — identifies a key without exposing it. */
  fingerprint: string
  dead: boolean
  deadReason?: string
  /** Epoch-ms when the killing failure was recorded (dead entries only). */
  deadAtMs?: number
  /** HTTP status of the killing response, when the provider sent one. */
  deadStatus?: number
  /** Provider error code of the killing response, when the provider sent one. */
  deadCode?: string
  benchedModels: Array<{ model: string; untilMs: number | null }>
}

/** One dead credential's recorded death: who died, why, and what the provider said. */
export interface DeadCredentialInfo {
  keyId: number
  /** First 8 hex chars of the key's SHA-256 — identifies a key without exposing it. */
  fingerprint: string
  deadReason?: string
  /** Epoch-ms when the killing failure was recorded. */
  deadAtMs?: number
  /** HTTP status of the killing response, when the provider sent one. */
  deadStatus?: number
  /** Provider error code of the killing response, when the provider sent one. */
  deadCode?: string
}

/**
 * Why the pool cannot serve a model right now — the structured form of an
 * acquire() refusal, so the resilience layer can name the terminal cause
 * honestly (a dead key is not a rate limit) instead of guessing.
 */
export interface PoolRefusalExplanation {
  kind: 'all-dead' | 'model-benched' | 'keys-benched'
  /** Every dead entry (kind 'all-dead': every entry in the pool). */
  dead: DeadCredentialInfo[]
  /** Epoch-ms when the earliest bench lifts, when a finite bench bounds the refusal. */
  benchUntilMs?: number
  /** At least one refusing bench is permanent (entitlement): it never lifts on its own. */
  permanentBench: boolean
}

/**
 * The persistence seam for pool state: a dumb text store for ONE versioned
 * JSON document shared by every provider's pool (sections keyed by
 * provider id). Implementations write atomically (see FilePoolStateStore).
 * The document contains fingerprints and bench bookkeeping only — an
 * implementation never receives key material.
 */
export interface PoolStateStore {
  /** Stored document text, or null when no state exists. I/O absence is null; a throw is a programmer error. */
  read(): string | null
  /**
   * Replace the stored document with this text.
   * @param text - The full serialized document.
   */
  write(text: string): void
  /** The stored document's location, for diagnostics only; warnings name it, never the contents. */
  path?: string
  /**
   * Optional: move the current stored document aside (corruption
   * quarantine) so the next write starts clean and the bad bytes survive
   * for an operator to inspect.
   * @returns The quarantine location, or null when nothing was moved.
   */
  quarantine?(): string | null
}

/** What a pool's constructor restore did, exposed for logs and tests. */
export interface PoolRestoreReport {
  /** Stored entries matched to a current key by fingerprint. */
  restoredEntries: number
  /** Benches (per-key and pool-wide) restored still in force. */
  restoredBenches: number
  /** Stored entries whose fingerprint matches no current key (dropped). */
  prunedEntries: number
  /** Benches already lapsed at restore time (dropped). */
  droppedLapsed: number
  /** The stored document was unusable and the pool reseeded empty. */
  quarantined: boolean
}

/** Options for CredentialPool construction. */
export interface CredentialPoolOptions {
  /** Clock override (tests use a fake clock). */
  now?: () => number
  /** Persistence store; absent means the in-memory behavior the pool has always had. */
  store?: PoolStateStore
}

interface ModelBench {
  /** Epoch-ms when the bench lifts; Infinity for permanent (entitlement). */
  untilMs: number
  failures: number
}

interface PoolEntry {
  keyId: number
  apiKey: string
  fingerprint: string
  dead: boolean
  deadReason?: string
  deadAtMs?: number
  deadStatus?: number
  deadCode?: string
  benches: Map<string, ModelBench>
}

function fingerprintOf(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex').slice(0, 8)
}

/** Version of the persisted pool-state document this build reads and writes. */
const POOL_STATE_VERSION = 1

/** One persisted bench: `untilMs: null` is a permanent (entitlement) bench. */
interface StoredBench {
  model: string
  untilMs: number | null
  failures: number
}

/** One persisted pool entry, keyed by the credential's fingerprint. */
interface StoredPoolEntry {
  fingerprint: string
  dead: boolean
  deadReason?: string
  /** Epoch-ms when the killing failure was recorded (dead entries only). */
  deadAtMs?: number
  /** HTTP status of the killing response, when the provider sent one. */
  deadStatus?: number
  /** Provider error code of the killing response, when the provider sent one. */
  deadCode?: string
  benches: StoredBench[]
}

/** One persisted pool-wide model bench. */
interface StoredModelBench {
  model: string
  untilMs: number
}

/** One provider's section of the pool-state document. */
interface StoredProviderPoolState {
  entries: StoredPoolEntry[]
  modelBenches: StoredModelBench[]
}

/** The persisted document: one section per provider id. */
interface PoolStateDocument {
  version: number
  updatedAt: string
  providers: Record<string, StoredProviderPoolState>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Short error class for warnings: an errno code when present, else the error name. Never the message (never contents). */
function errorClass(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code
    return typeof code === 'string' ? code : err.name
  }
  return 'unknown'
}

/**
 * Validate one stored bench; undefined when any field is wrong-typed.
 * Malformed pieces drop one by one (the storedDocument() convention from
 * mcp-credentials): a bad bench never condemns its siblings.
 */
function parseStoredBench(raw: unknown): StoredBench | undefined {
  if (!isRecord(raw)) return undefined
  const model = raw.model
  const untilMs = raw.untilMs
  const failures = raw.failures
  if (typeof model !== 'string') return undefined
  if (untilMs !== null && (typeof untilMs !== 'number' || !Number.isFinite(untilMs))) return undefined
  if (typeof failures !== 'number' || !Number.isFinite(failures) || failures < 0) return undefined
  return { model, untilMs, failures: Math.floor(failures) }
}

/** Validate one stored pool entry; undefined when its identity fields are wrong-typed. */
function parseStoredPoolEntry(raw: unknown): StoredPoolEntry | undefined {
  if (!isRecord(raw)) return undefined
  if (typeof raw.fingerprint !== 'string' || typeof raw.dead !== 'boolean') return undefined
  if (!Array.isArray(raw.benches)) return undefined
  const benches: StoredBench[] = []
  for (const item of raw.benches) {
    const bench = parseStoredBench(item)
    if (bench !== undefined) benches.push(bench)
  }
  const entry: StoredPoolEntry = { fingerprint: raw.fingerprint, dead: raw.dead, benches }
  if (typeof raw.deadReason === 'string') entry.deadReason = raw.deadReason
  if (typeof raw.deadAtMs === 'number' && Number.isFinite(raw.deadAtMs) && raw.deadAtMs >= 0) {
    entry.deadAtMs = raw.deadAtMs
  }
  if (typeof raw.deadStatus === 'number' && Number.isFinite(raw.deadStatus)) {
    entry.deadStatus = raw.deadStatus
  }
  if (typeof raw.deadCode === 'string') entry.deadCode = raw.deadCode
  return entry
}

/** Validate one provider section; undefined when its containers are malformed (entries inside still drop one by one). */
function parseProviderPoolState(raw: unknown): StoredProviderPoolState | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.entries) || !Array.isArray(raw.modelBenches)) return undefined
  const entries: StoredPoolEntry[] = []
  for (const item of raw.entries) {
    const entry = parseStoredPoolEntry(item)
    if (entry !== undefined) entries.push(entry)
  }
  const modelBenches: StoredModelBench[] = []
  for (const item of raw.modelBenches) {
    if (!isRecord(item)) continue
    const model = item.model
    const untilMs = item.untilMs
    if (typeof model === 'string' && typeof untilMs === 'number' && Number.isFinite(untilMs)) {
      modelBenches.push({ model, untilMs })
    }
  }
  return { entries, modelBenches }
}

/**
 * Parse a whole pool-state document leniently (used on the save path):
 * undefined when the envelope is unusable; sections that fail validation
 * drop, valid sibling sections survive.
 */
function parsePoolStateDocument(text: string): PoolStateDocument | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    // Not JSON at all: the envelope is unusable; the caller treats it as empty.
    return undefined
  }
  if (!isRecord(raw) || raw.version !== POOL_STATE_VERSION || !isRecord(raw.providers)) return undefined
  const providers: Record<string, StoredProviderPoolState> = {}
  for (const [id, section] of Object.entries(raw.providers)) {
    const parsed = parseProviderPoolState(section)
    if (parsed !== undefined) providers[id] = parsed
  }
  return {
    version: POOL_STATE_VERSION,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    providers,
  }
}

/** Stores whose save failure was already warned about (the router shares one store per process). */
const saveWarnedStores = new WeakSet<object>()

export class CredentialPool {
  readonly providerId: string
  private readonly entries: PoolEntry[] = []
  /** Provider-wide model benches (upstream rate limits): model -> until epoch-ms. */
  private readonly modelBenches = new Map<string, number>()
  private readonly now: () => number
  private readonly store?: PoolStateStore
  /** Outcome of the constructor's restore; null when this pool has no store. */
  readonly restoreReport: PoolRestoreReport | null

  constructor(providerId: string, keys: string[], opts: CredentialPoolOptions = {}) {
    this.providerId = providerId
    this.now = opts.now ?? Date.now
    keys.forEach((apiKey, keyId) => {
      this.entries.push({
        keyId,
        apiKey,
        fingerprint: fingerprintOf(apiKey),
        dead: false,
        benches: new Map(),
      })
    })
    this.store = opts.store
    this.restoreReport = this.store !== undefined ? this.restore(this.store) : null
  }

  /**
   * Build a pool from an environment's primary key variable + numbered siblings.
   * @param providerId - Router provider id, e.g. "deepseek".
   * @param primaryEnvName - The primary key variable, e.g. "DEEPSEEK_API_KEY".
   * @param env - Environment to read (defaults to `process.env`).
   * @param opts - Clock override and persistence store.
   * @returns The pool (possibly empty when no key variable is set).
   */
  static fromEnv(
    providerId: string,
    primaryEnvName: string,
    env: NodeJS.ProcessEnv = process.env,
    opts: CredentialPoolOptions = {},
  ): CredentialPool {
    return new CredentialPool(providerId, collectCredentialEnv(env, primaryEnvName), opts)
  }

  /**
   * Restore persisted bookkeeping onto the freshly built entries, matched
   * by fingerprint (a replaced or reordered key is never punished for its
   * predecessor; unmatched stored entries prune). Restore NEVER throws:
   * pool state is advisory bookkeeping the system re-derives by observing
   * providers, so a corrupt, truncated, or wrong-version document is
   * quarantined when the store supports it and the pool reseeds empty —
   * the alternative would let a damaged cache file take down every LLM
   * call in the app. Benches already lapsed at restore drop; permanent
   * benches and failure counts survive with their benches.
   * @param store - The store the constructor was given.
   * @returns The restore report (also exposed as `restoreReport`).
   */
  private restore(store: PoolStateStore): PoolRestoreReport {
    const report: PoolRestoreReport = {
      restoredEntries: 0,
      restoredBenches: 0,
      prunedEntries: 0,
      droppedLapsed: 0,
      quarantined: false,
    }
    let text: string | null = null
    try {
      text = store.read()
    } catch (err) {
      // The seam reserves throws for programmer error; restore still must
      // not take the pool down, so a throwing read is warned and treated
      // as "no state".
      console.warn(
        `[llm-router] credential pool state read failed for '${this.providerId}' (${errorClass(err)}); starting fresh`,
      )
    }
    if (text === null) return report
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      // Unparseable bytes: the document is unusable; the quarantine path below handles it.
      raw = undefined
    }
    const sectionRaw = isRecord(raw) && isRecord(raw.providers) ? raw.providers[this.providerId] : undefined
    const section = sectionRaw !== undefined ? parseProviderPoolState(sectionRaw) : undefined
    const envelopeBad =
      !isRecord(raw) || raw.version !== POOL_STATE_VERSION || !isRecord(raw.providers)
    if (envelopeBad || (sectionRaw !== undefined && section === undefined)) {
      report.quarantined = true
      let quarantinedTo: string | null = null
      try {
        quarantinedTo = store.quarantine?.() ?? null
      } catch {
        // Quarantine is best-effort evidence preservation; a store that
        // cannot move the file aside must not block the reseed.
        quarantinedTo = null
      }
      console.warn(
        `[llm-router] credential pool state for '${this.providerId}' is corrupt or an unsupported version; reseeded empty` +
          (store.path !== undefined ? ` (file: ${store.path})` : '') +
          (quarantinedTo !== null ? `; quarantined to ${quarantinedTo}` : ''),
      )
      return report
    }
    if (section === undefined) return report
    const nowMs = this.now()
    const byFingerprint = new Map(this.entries.map(entry => [entry.fingerprint, entry]))
    for (const stored of section.entries) {
      const entry = byFingerprint.get(stored.fingerprint)
      if (entry === undefined) {
        report.prunedEntries += 1
        continue
      }
      if (stored.dead) {
        entry.dead = true
        if (stored.deadReason !== undefined) entry.deadReason = stored.deadReason
        if (stored.deadAtMs !== undefined) entry.deadAtMs = stored.deadAtMs
        if (stored.deadStatus !== undefined) entry.deadStatus = stored.deadStatus
        if (stored.deadCode !== undefined) entry.deadCode = stored.deadCode
      }
      for (const bench of stored.benches) {
        if (bench.untilMs !== null && bench.untilMs <= nowMs) {
          report.droppedLapsed += 1
          continue
        }
        entry.benches.set(bench.model, {
          untilMs: bench.untilMs === null ? Infinity : bench.untilMs,
          failures: bench.failures,
        })
        report.restoredBenches += 1
      }
      report.restoredEntries += 1
    }
    for (const stored of section.modelBenches) {
      if (stored.untilMs <= nowMs) {
        report.droppedLapsed += 1
        continue
      }
      const existing = this.modelBenches.get(stored.model)
      if (existing === undefined || stored.untilMs > existing) {
        this.modelBenches.set(stored.model, stored.untilMs)
      }
      report.restoredBenches += 1
    }
    // Converge the file: what restore dropped (pruned fingerprints, lapsed
    // benches) should not be re-read on every launch.
    if (report.prunedEntries > 0 || report.droppedLapsed > 0) this.save()
    return report
  }

  /**
   * This provider's section of the state document, derived from live
   * internal state: failure counts are kept (unlike snapshot(), which is
   * a display projection) and benches are written verbatim, with Infinity
   * mapped to null. Entries carrying no state are omitted.
   * @returns The serializable section.
   */
  private serializeSection(): StoredProviderPoolState {
    const nowMs = this.now()
    const entries: StoredPoolEntry[] = []
    for (const entry of this.entries) {
      const benches: StoredBench[] = []
      for (const [model, bench] of entry.benches) {
        if (bench.untilMs !== Infinity && bench.untilMs <= nowMs) continue
        benches.push({
          model,
          untilMs: bench.untilMs === Infinity ? null : bench.untilMs,
          failures: bench.failures,
        })
      }
      if (!entry.dead && benches.length === 0) continue
      const stored: StoredPoolEntry = { fingerprint: entry.fingerprint, dead: entry.dead, benches }
      if (entry.deadReason !== undefined) stored.deadReason = entry.deadReason
      if (entry.dead) {
        if (entry.deadAtMs !== undefined) stored.deadAtMs = entry.deadAtMs
        if (entry.deadStatus !== undefined) stored.deadStatus = entry.deadStatus
        if (entry.deadCode !== undefined) stored.deadCode = entry.deadCode
      }
      entries.push(stored)
    }
    const modelBenches: StoredModelBench[] = []
    for (const [model, untilMs] of this.modelBenches) {
      if (untilMs <= nowMs) continue
      modelBenches.push({ model, untilMs })
    }
    return { entries, modelBenches }
  }

  /**
   * Write-through save: re-read the shared document, replace only this
   * provider's section, write the whole document back. A failed save
   * never breaks a call — it warns once per store and the pool continues
   * in memory (durability is best-effort; the engagement outranks the
   * cache). No store, no-op.
   */
  private save(): void {
    const store = this.store
    if (store === undefined) return
    try {
      let doc: PoolStateDocument = { version: POOL_STATE_VERSION, updatedAt: '', providers: {} }
      const text = store.read()
      if (text !== null) {
        const parsed = parsePoolStateDocument(text)
        if (parsed !== undefined) doc = parsed
      }
      doc.providers[this.providerId] = this.serializeSection()
      doc.updatedAt = new Date(this.now()).toISOString()
      store.write(`${JSON.stringify(doc, null, 2)}\n`)
    } catch (err) {
      if (!saveWarnedStores.has(store)) {
        saveWarnedStores.add(store)
        console.warn(
          '[llm-router] could not persist credential pool state' +
            (store.path !== undefined ? ` to ${store.path}` : '') +
            ` (${errorClass(err)}); continuing in memory`,
        )
      }
    }
  }

  /** Number of distinct keys in the pool. */
  get size(): number {
    return this.entries.length
  }

  /** Rotation only exists with more than one key; a single key is used as-is. */
  isActive(): boolean {
    return this.entries.length > 1
  }

  private entry(keyId: number): PoolEntry | undefined {
    return this.entries[keyId]
  }

  private modelBenchRemainingMs(model: string): number {
    const until = this.modelBenches.get(model)
    if (until === undefined) return 0
    const remaining = until - this.now()
    if (remaining <= 0) {
      this.modelBenches.delete(model)
      return 0
    }
    return remaining
  }

  /** True when the entry may serve `model` right now (not dead, not benched for it). */
  private usable(entry: PoolEntry, model: string): boolean {
    if (entry.dead) return false
    const bench = entry.benches.get(model)
    if (bench === undefined) return true
    if (bench.untilMs !== Infinity && bench.untilMs <= this.now()) {
      // Bench lapsed: the pair may serve again, but its failure count is
      // kept — the next failure benches it longer. Success clears it.
      entry.benches.delete(model)
      return true
    }
    return false
  }

  /**
   * Acquire the first usable credential for a model (fill-first).
   * @param model - The model the call will request.
   * @returns The credential, or null when every key is dead or benched for
   *   this model (or the model is benched pool-wide).
   */
  acquire(model: string): AcquiredCredential | null {
    if (this.modelBenchRemainingMs(model) > 0) return null
    for (const entry of this.entries) {
      if (this.usable(entry, model)) return { keyId: entry.keyId, apiKey: entry.apiKey }
    }
    return null
  }

  /**
   * Milliseconds until some key can serve `model` again.
   * @param model - The model the call would request.
   * @returns 0 when a key is usable now; the shortest bench otherwise;
   *   Infinity when no key can ever serve this model (all dead, or all
   *   permanently benched for it).
   */
  nextAvailableInMs(model: string): number {
    const modelBench = this.modelBenchRemainingMs(model)
    if (modelBench > 0) return modelBench
    let best = Infinity
    for (const entry of this.entries) {
      if (entry.dead) continue
      const bench = entry.benches.get(model)
      if (bench === undefined) return 0
      if (bench.untilMs === Infinity) continue
      const remaining = bench.untilMs - this.now()
      if (remaining <= 0) return 0
      if (remaining < best) best = remaining
    }
    return best
  }

  /**
   * Record a successful call: clears the (key, model) failure count/bench.
   * @param keyId - The serving key's pool id.
   * @param model - The model that was served.
   */
  reportSuccess(keyId: number, model: string): void {
    const entry = this.entry(keyId)
    if (entry && entry.benches.delete(model)) this.save()
  }

  /**
   * Record a failed call against the serving key, applying the scoping the
   * classification demands (see the module header).
   * @param keyId - The serving key's pool id.
   * @param model - The model that was requested.
   * @param failure - The classified failure.
   */
  reportFailure(keyId: number, model: string, failure: ClassifiedFailure): void {
    const entry = this.entry(keyId)
    if (!entry || entry.dead) return
    switch (failure.reason) {
      case 'auth_dead':
      case 'billing':
        entry.dead = true
        entry.deadReason = failure.reason
        // The death record carries the killing response's evidence — when
        // it happened, and what the provider answered — so a later refusal
        // can name the cause instead of a generic terminal label.
        entry.deadAtMs = this.now()
        if (failure.status !== undefined) entry.deadStatus = failure.status
        if (failure.code !== undefined) entry.deadCode = failure.code
        this.save()
        return
      case 'entitlement': {
        const prev = entry.benches.get(model)
        entry.benches.set(model, { untilMs: Infinity, failures: (prev?.failures ?? 0) + 1 })
        this.save()
        return
      }
      case 'rate_limit': {
        const prev = entry.benches.get(model)
        const failures = (prev?.failures ?? 0) + 1
        const nowMs = this.now()
        const providerDelay =
          failure.retryAfterMs ??
          (failure.resetAtMs !== undefined ? Math.max(0, failure.resetAtMs - nowMs) : undefined)
        const cooldown = providerDelay ?? cooldownMsForFailure(failures)
        entry.benches.set(model, { untilMs: nowMs + cooldown, failures })
        this.save()
        return
      }
      default:
        // upstream_rate_limit (key healthy), server_error, timeout,
        // context_overflow, content_policy, unknown: no credential state.
        return
    }
  }

  /**
   * Bench a model pool-wide: an upstream rate limit throttles the model
   * backend itself, so every key would hit the same wall.
   * @param model - The throttled model.
   * @param durationMs - Bench length in milliseconds.
   */
  benchModel(model: string, durationMs: number): void {
    const until = this.now() + Math.max(0, durationMs)
    const existing = this.modelBenches.get(model)
    if (existing === undefined || until > existing) {
      this.modelBenches.set(model, until)
      this.save()
    }
  }

  /** Milliseconds remaining on a pool-wide model bench (0 when none). */
  modelBenchedForMs(model: string): number {
    return this.modelBenchRemainingMs(model)
  }

  /**
   * Redacted pool state for logs and tests — fingerprints only, never keys.
   * @returns One snapshot per key, in fill-first order.
   */
  snapshot(): PoolEntrySnapshot[] {
    const nowMs = this.now()
    return this.entries.map((entry) => {
      const snap: PoolEntrySnapshot = {
        keyId: entry.keyId,
        fingerprint: entry.fingerprint,
        dead: entry.dead,
        benchedModels: [...entry.benches.entries()]
          .filter(([, bench]) => bench.untilMs === Infinity || bench.untilMs > nowMs)
          .map(([model, bench]) => ({
            model,
            untilMs: bench.untilMs === Infinity ? null : bench.untilMs,
          })),
      }
      if (entry.deadReason !== undefined) snap.deadReason = entry.deadReason
      if (entry.dead) {
        if (entry.deadAtMs !== undefined) snap.deadAtMs = entry.deadAtMs
        if (entry.deadStatus !== undefined) snap.deadStatus = entry.deadStatus
        if (entry.deadCode !== undefined) snap.deadCode = entry.deadCode
      }
      return snap
    })
  }

  /**
   * Explain why acquire() cannot serve `model`, in terminal-cause terms.
   * Dead credentials outrank benches: when every key is dead the refusal
   * is a death, not a throttle, and the explanation says which keys died,
   * why, and what the provider answered. A pool-wide model bench outranks
   * per-key benches (it refuses even a healthy key).
   * @param model - The model the refused call would request.
   * @returns The explanation, or undefined when a credential can serve now.
   */
  refusalExplanation(model: string): PoolRefusalExplanation | undefined {
    const nowMs = this.now()
    const dead: DeadCredentialInfo[] = []
    for (const entry of this.entries) {
      if (!entry.dead) continue
      const info: DeadCredentialInfo = { keyId: entry.keyId, fingerprint: entry.fingerprint }
      if (entry.deadReason !== undefined) info.deadReason = entry.deadReason
      if (entry.deadAtMs !== undefined) info.deadAtMs = entry.deadAtMs
      if (entry.deadStatus !== undefined) info.deadStatus = entry.deadStatus
      if (entry.deadCode !== undefined) info.deadCode = entry.deadCode
      dead.push(info)
    }
    if (this.entries.length > 0 && dead.length === this.entries.length) {
      return { kind: 'all-dead', dead, permanentBench: false }
    }
    const modelBenchUntil = this.modelBenches.get(model)
    if (modelBenchUntil !== undefined && modelBenchUntil > nowMs) {
      return { kind: 'model-benched', dead, benchUntilMs: modelBenchUntil, permanentBench: false }
    }
    let benchUntilMs: number | undefined
    let permanentBench = false
    let benched = false
    for (const entry of this.entries) {
      if (entry.dead) continue
      const bench = entry.benches.get(model)
      if (bench === undefined) return undefined // A living, unbenched key serves.
      if (bench.untilMs === Infinity) {
        permanentBench = true
        benched = true
        continue
      }
      if (bench.untilMs <= nowMs) return undefined // Bench lapsed: the key serves.
      benched = true
      if (benchUntilMs === undefined || bench.untilMs < benchUntilMs) benchUntilMs = bench.untilMs
    }
    if (!benched) return undefined
    const out: PoolRefusalExplanation = { kind: 'keys-benched', dead, permanentBench }
    if (benchUntilMs !== undefined) out.benchUntilMs = benchUntilMs
    return out
  }
}
