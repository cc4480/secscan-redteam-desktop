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

export * from './types-engagement.js'
import { type ActorRole, type EngagementMode, type EngagementPhase, type EngagementStatus } from './types-engagement.js'
import type { MemoryEngagementReceipt } from './memory/types.js'
/** Red = overt/aggressive. Black = covert-ops tier (stealth-prioritized). */
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
  /**
   * Q-DELIVERABLES-AUTOFIRE: the closing deliverable set, by file name —
   * the absolute path of every deliverable verified on disk at close
   * (report.html/.md/.json/.txt, findings.csv, report.docx,
   * report-package.zip). Attached by finalizeDeliverables on every
   * recorded end (complete, halted, blocked).
   */
  deliverables?: Record<string, string>
  /** True when the deliverable set was incomplete at close: the
   * engagement must not be read as cleanly complete. */
  deliverableFailed?: boolean
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
   * recorded in the engagement event log. The out-of-scope deny list
   * is NOT bypassed. Default
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
