/**
 * Core types for the live engagement runner.
 *
 * An engagement is a scoped, authorized red-team or black-team operation
 * against web targets. Red = overt, aggressive, full breadth. Black = the
 * covert-ops tier: black-box (zero prior knowledge), stealth-prioritized,
 * OPSEC-strict, undeclared to the target's blue team. BOTH modes require
 * server-authoritative domain-ownership proof before any active testing —
 * covert means covert vs the blue team, NEVER vs the authorization gate.
 */

/** Red = overt/aggressive. Black = covert-ops tier (stealth-prioritized). */
export type EngagementMode = 'red' | 'black'

import type { TargetId } from './targets/types.js'
import type { AutonomyTier } from './accountability/tiers.js'
import type { MemoryEngagementReceipt } from './memory/types.js'

export type EngagementPhase =
  | 'authorize'
  | 'plan'
  | 'recon'
  | 'exploit'
  | 'report'
  | 'done'
  | 'blocked'
  | 'halted'

export type EngagementStatus =
  | 'queued'
  | 'authorizing'
  | 'running'
  | 'complete'
  | 'blocked'
  | 'halted'

export type ActorRole = 'coordinator' | 'recon' | 'exploiter' | 'reporter' | 'architect' | 'runner'

/** Daily blackout window, 24h "HH:MM" strings. May cross midnight. */
export interface BlackoutWindow {
  start: string // "02:00"
  end: string // "04:30"
  /** IANA timezone, e.g. "America/Chicago". Defaults to the runner's local tz. */
  tz?: string
}

/**
 * Rules of Engagement — the contract that bounds every action the runner takes.
 * Mirrors engagements/engagement-template.md §1–§3.
 */
export interface RulesOfEngagement {
  /**
   * In-scope hosts, URLs, IPs or CIDRs. Nothing else is ever touched.
   * Membership is decided by the scope guard (safety/scope-guard.ts):
   * exact host, subdomain of a listed domain, listed IP, or CIDR member.
   */
  scope: string[]
  /**
   * Out-of-scope hosts/IPs/CIDRs that must never be touched, even when
   * they fall inside `scope` (e.g. a third-party subdomain of an in-scope
   * domain). Enforced by the scope guard at dispatch; deny beats allow.
   */
  outOfScope?: string[]
  /** ATT&CK technique IDs the engagement must not use, e.g. ["T1110"]. null/omitted = none beyond the mode defaults. */
  excludedTechniques?: string[] | null
  /** Daily windows during which the runner pauses (no traffic). */
  blackoutWindows?: BlackoutWindow[]
  /** Stop conditions, e.g. ["production outage", "WAF hard-block", "scope crossing"]. */
  stopConditions?: string[]
  /** Who to contact on the client side if something goes wrong. */
  deconflictionContact?: string
  /** ISO timestamps bounding the test. The runner refuses to run outside it. */
  testWindow?: { start: string; end: string }
  /** Free-text notes (provided creds reference, out-of-scope remarks…). Never paste secrets. */
  notes?: string
}

export interface EngagementInput {
  /** Target domain or URL, e.g. "secscan.us" or "https://secscan.us". */
  target: string
  mode: EngagementMode
  /** What the client wants proven, e.g. "assess external attack surface". */
  objective: string
  roe: RulesOfEngagement
  client?: string
  /** Named human operator accountable for the engagement (attestation + evidence pack). */
  operatorName?: string
  /**
   * Full-battery unified engagement (target-specific batteries as ONE
   * operation). The coordinator prompt carries the selected target batteries
   * as the plan skeleton; coverage requires all 3 categories × every
   * selected target (or the cell honestly BLOCKED).
   * Set via --full-battery or --target secscan+seclayer.
   */
  fullBattery?: boolean
  /**
   * Local-host engagement (Q-RP-11): the target is the machine the app
   * itself runs on (target = os.hostname(), scope = [hostname]). The
   * collector runs ON-HOST during recon — no network services, no test
   * credentials — and writes host-inventory.json into the engagement
   * dir for the report's inventory sections. Set by /pcscan and by the
   * chat surface's engagement_launch_local; never for a remote target.
   */
  localHost?: boolean
  /**
   * Subset of full-battery targets, set via --targets (comma-separated).
   * Defaults to all four (secscan, seclayer, windows, linux).
   */
  targets?: TargetId[]
  /**
   * Test environment for staging→production graduation (v0.13.0 safety case).
   * "staging" (default): full battery, configured rate limits. "production":
   * requires explicit operator confirmation (confirmProduction or
   * REDTEAM_PROD_CONFIRM=1) and caps the per-host rate limit mechanically.
   * Set via --env staging|production.
   */
  environment?: 'staging' | 'production'
  /**
   * Explicit operator confirmation for a production run. The runner refuses
   * to start a production engagement without it — fail fast, before any
   * packet. Set via --confirm-production.
   */
  confirmProduction?: boolean
  /**
   * Autonomy tier (v0.17.0 accountability): 0 = observe (read-only recon),
   * 1 = validate (single-step validated exploitation, one step per target),
   * 2 = chain (multi-step attack chains, still non-destructive, no-DoS).
   * Enforced mechanically in the tool dispatcher — not by prompt.
   * Unset → environment default (staging: 2, production: 1).
   * Set via --tier 0|1|2 (or REDTEAM_TIER).
   */
  tier?: AutonomyTier
  /**
   * Explicit operator approval for Tier 2 on production. The runner refuses
   * to start a Tier 2 production engagement without it — fail fast, before
   * any packet. Set via --confirm-tier2-production (or
   * REDTEAM_TIER2_PROD_CONFIRM=1).
   */
  confirmTier2Production?: boolean
}

/** One streamed event. Written to events.jsonl as it happens. */
export interface EngagementEvent {
  ts: string // ISO
  seq: number
  engagementId: string
  phase: EngagementPhase
  actor: ActorRole
  /** Short machine-readable action, e.g. "secscan_exec", "http_probe", "plan_step". */
  action: string
  /** MITRE ATT&CK technique ID when the action maps to one. */
  attackId?: string
  target?: string
  /** Human-readable outcome. */
  result: string
  /** Black-mode OPSEC notes (detection signals, backoff decisions…). */
  opsec?: string
  /** seq of the event this one was caused by, when one action is a consequence of another (causality). */
  causedBy?: number
}

export interface PlanStep {
  phase: EngagementPhase
  attackId?: string
  description: string
  stealthNote?: string
  /** ISO 8601 time this step's task should be settled by. Carried onto
   * the work-graph task verbatim; reporting/ready-order only. */
  deadline?: string
  /** Estimated cost in dispatched-action units (GraphSubtask.actions unit). */
  cost?: number
}

export interface OperationPlan {
  mode: EngagementMode
  objective: string
  adversaryProfile: string
  steps: PlanStep[]
}

/**
 * Q-FLEET-XCHECK peer-review stamp: before the report, a DIFFERENT fleet
 * seat than the producer challenged this finding (spec:
 * fleet-peer-cross-check-2026-10-31.md). `verdict` is what the checker
 * seat answered; `disposition` is what the RUNNER mechanically did with
 * it. The two differ only when a stronger mechanical verdict already
 * stands: a PROVEN cell verdict outranks a peer kill (proven wins), and
 * a downgrade proposed at the severity floor cannot move the severity.
 * Stamped by the runner only, from the parsed verdict — never model-set.
 */
export interface PeerReviewStamp {
  checker: ActorRole
  verdict: 'upheld' | 'downgraded' | 'needs-evidence' | 'killed'
  rationale: string
  disposition: 'flows' | 'downgraded' | 'deferred' | 'killed'
  /** Severity ladder move, present when disposition is 'downgraded'. */
  fromSeverity?: string
  toSeverity?: string
}

export interface Finding {
  id: string // F-1, F-2…
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  title: string
  attackIds: string[]
  evidence: string
  fix: string
  retest: string
  status: 'confirmed' | 'killed' | 'deferred'
  /**
   * Dual-exploiter cell verdict carried from the live finding at report
   * time (Q-PROVEN): 'proven' means the cell adjudicated a recorded claim
   * with both signatures plus a passing negative control. Stamped by the
   * RUNNER only (report-phase join / halted-path map) — never model-set.
   * Absent = never adjudicated.
   */
  cellState?: 'proven' | 'detected'
  /** The adjudicated claim's expected marker + target URL, carried with cellState so the report can render the Cell Receipt. The claim's receipt is NOT carried — it lives in the audit trail. */
  provenClaim?: { expectedMarker: string; targetUrl: string }
  /** The cell adjudication's one-line detail, carried with the claim. */
  cellDetail?: string
  /**
   * Engine-recorded CVSS base score + CWE id (Q-RP-3), stamped by the
   * RUNNER at report time from the source live finding (applyFindingRefs)
   * — never model-set: a value the reporter JSON carries is overwritten
   * by the stamp or removed. Absent when the engine recorded none.
   */
  cvss?: number
  cwe?: string
  /**
   * Q-FLEET-XCHECK: the fleet seat that produced this finding, stamped
   * by the RUNNER at record time and carried by the report join — the
   * producer claim the checker stamp sits beside. Absent when the live
   * finding carried none (recorded before producer stamps existed).
   */
  producer?: ActorRole
  /** Q-FLEET-XCHECK peer-review stamp (PeerReviewStamp). Absent = never challenged (e.g. the run halted before the reviewer pass). */
  peerReview?: PeerReviewStamp
  /** Named human operator accountable for this finding (v0.17.0). Stamped by the runner at report time. */
  accountableOperator?: string
}

export interface EngagementResult {
  engagementId: string
  status: EngagementStatus
  /** Present when the run was blocked/halted before completion. */
  blockedReason?: string
  reportPath?: string
  findings: Finding[]
  /**
   * Q-MEMTIER two-phase commit receipt (brief §7.2): archive + diff
   * outcome for this engagement's memory commit. Attached by the run
   * wiring in the finally block; absent when memory never opened.
   */
  memory?: MemoryEngagementReceipt
}

/** Knobs for the runner. All have safe defaults. */
export interface RunnerOptions {
  /** Max LLM turns per phase. Default 10 (recon), 14 (exploit) — see constants. */
  maxReconTurns?: number
  maxExploitProbes?: number
  /** Global caps. Defaults: 100 actions, 45 minutes. */
  maxActions?: number
  maxDurationMs?: number
  /** Reflection cap override (see ResolvedRunnerConfig). Env REDTEAM_REFLECTOR_CAP. */
  reflectorCap?: number
  /** Base delay between web probes; black mode adds jitter on top. Default 800ms. */
  probeDelayMs?: number
  /** Where engagement dirs live. Default: <repo>/engagements/live. */
  engagementsDir?: string
  /** Skip the LLM entirely (plan/recon/exploit/report become no-ops) — for gate tests. */
  dryRunAgents?: boolean
}

export interface ResolvedRunnerConfig {
  mcpEndpoint: string
  /** SecScan MCP token. Optional: read only by the opt-in service-verification path (verifyViaService). */
  mcpToken: string
  deepseekApiKey: string
  /** Meta Model API key (MODEL_API_KEY / META_API_KEY). The fleet's provider key; the router
   * provider reads it from env at call time — this field records that config resolved it. */
  modelApiKey: string
  /**
   * Ownership-verification basis. Default false: the authorize phase takes
   * verification from the engagement record (operator attestation) and never
   * calls the SecScan service. True (env REDTEAM_VERIFY_VIA_SERVICE=1) opts
   * back into the server-authoritative check, which then requires mcpToken.
   */
  verifyViaService: boolean
  /** Alibaba Model Studio key — optional since v0.6 (DeepSeek-only policy); the provider still reads it from env when configured. */
  qwenApiKey: string
  maxReconTurns: number
  maxExploitProbes: number
  /**
   * Progress-aware round caps for agentLoop (ported from ZimZilla's agent
   * loop, 2026-10-23). softRoundCap = rounds between soft-cap checkpoints:
   * at a checkpoint the turn CONTINUES when the previous round produced a
   * successful tool result and stops only when every tool in it failed.
   * hardRoundCap = the absolute round backstop. Both are announced in the
   * event stream (`continuing` / `iteration_cap`) — a capped turn is never
   * indistinguishable from a completed one. Undefined = agentLoop defaults
   * (soft 8, hard = the caller's maxTurns). Env REDTEAM_SOFT_ROUND_CAP /
   * REDTEAM_HARD_ROUND_CAP.
   */
  softRoundCap?: number
  hardRoundCap?: number
  /**
   * Bounded-reflection cap for agentLoop (reflector.ts, RC Item 7): the
   * max reflections one loop invocation may spend on stuck batches.
   * 0 disables reflection. Env REDTEAM_REFLECTOR_CAP.
   */
  reflectorCap: number
  /**
   * Q-ESTOP-APP: candidate paths for the ESTOP fleet pause sentinel
   * (safety/estop.ts), in priority order — the REDTEAM_ESTOP_PATH override
   * when set, else the sentinel beside registryPath, plus the REDTEAM_HOME
   * location when it differs. Resolved once here; the launch gate in
   * phases/run.ts checks them via requireEstopClear before any state.
   */
  estopPaths: string[]
  maxActions: number
  maxDurationMs: number
  probeDelayMs: number
  engagementsDir: string
  /** Persistent vulnerability registry path. Seeded on first run. */
  registryPath: string
  /** Q-MEMTIER memory root. Resolved in phases/config.ts: RunOptions.memoryRoot → REDTEAM_MEMORY_ROOT → <registry dir>/memory. */
  memoryRoot: string
  dryRunAgents: boolean
  /**
   * LOCAL SANDBOX MODE ONLY — explicit opt-in (CLI --local-sandbox or
   * REDTEAM_LOCAL_SANDBOX=1). Skips ownership verification and the
   * prober's private-host rejection, but ONLY for targets that already
   * resolve to a private/loopback address. Has no effect on a real
   * domain. Default false. See gate.ts / prober.ts for the invariant.
   */
  localSandbox: boolean
  /**
   * TEST MODE — explicit operator opt-in (REDTEAM_TEST_MODE=1). While
   * testing, the mechanical restraints are bypassed: ownership/scope
   * authorization (the record carries an honest operator self-attestation,
   * never a fabricated proof), tier enforcement, the credential lockout
   * interlock, rate limiting, the variant cap, always/mode technique
   * exclusions, and the destructive/DoS denylists. Every bypass is
   * recorded in the engagement event log. The kill switch, ESTOP,
   * auto-halt and the out-of-scope deny list are NOT bypassed. Default
   * false; off means every gate behaves exactly as before.
   */
  testMode: boolean
  /**
   * Operator-configured per-host rate limit (requests/sec) for the v0.13.0
   * safety rate limiter. Env REDTEAM_MAX_RPS. Production caps it at 2
   * mechanically regardless. Undefined = environment default (5 staging,
   * 2 production).
   */
  maxRpsPerHost?: number
  /**
   * v0.20.0 payload-variant expansion: max variant executions per battery
   * item. Env REDTEAM_MAX_VARIANTS. Undefined = environment default
   * (25 staging, 10 production). Enforced mechanically in dispatch.
   */
  maxVariantsPerItem?: number
  /**
   * Q-LOCKOUT: operator-declared expected account-lockout threshold of the
   * target environment. Env REDTEAM_LOCKOUT_THRESHOLD. Undefined = the
   * interlock default (5). The credential-attempt guard budgets
   * lockoutThreshold − 1 FAILED validations per (host, protocol class).
   */
  lockoutThreshold?: number
  /**
   * Q-LOCKOUT: campaign ceiling — total failed validations across all
   * keys that trips credential testing engagement-wide. Env
   * REDTEAM_LOCKOUT_TOTAL. Undefined = the interlock default (25).
   */
  lockoutTotalFailures?: number
  /**
   * Q-LOCKOUT: per-host call budget for opaque multi-attempt runs (msf
   * login scanners, nmap auth/brute scripts) whose internal attempts the
   * runner cannot count. Env REDTEAM_LOCKOUT_OPAQUE_RUNS. Undefined = the
   * interlock default (1).
   */
  lockoutOpaqueRuns?: number
}
