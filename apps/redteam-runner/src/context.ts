/**
 * Shared engagement context (v0.19.0 refactor — extracted from phases.ts).
 *
 * The Ctx object is the "Megazord": one context every agent reads and writes.
 * RunnerDeps carries the injectable seams (transports, model router) the
 * tests use. No runtime logic lives here — only the shapes everything else
 * agrees on.
 */
import { completeForRole as routerCompleteForRole } from '@secscan/redteam-llm-router'
import { EventLog } from './events.js'
import { McpClient } from './mcp.js'
import { ProberLike } from './prober.js'
import { HostExecutor } from './host-exec/index.js'
import { TargetAutoHalt, TargetRateLimiter, type CredentialAttemptGuard, type TestEnvironment } from './safety/index.js'
import { ApprovalLog, type TierState } from './accountability/index.js'
import { type RegistryEntry, type TargetFingerprint, type VulnerabilityRegistry } from './registry.js'
import { type EngagementInput, type OperationPlan, type ResolvedRunnerConfig } from './types.js'
import { type BatteryCategory } from './battery.js'
import { type TargetId } from './targets.js'
import { MsfExecutor } from './msf/index.js'
import { NucleiExecutor } from './nuclei/index.js'
import { NmapExecutor } from './nmap/index.js'
import { type ItemVerdict } from './coverage/items.js'
import { type MemoryEngagementState } from './memory/types.js'
import { type MemoryDeps } from './memory/lifecycle.js'
import { type PolicyRules } from './policy/rules.js'
import { type ScopeGuard } from './safety/scope-guard.js'
import { type HookRegistry } from './hooks/index.js'

export interface RunnerDeps {
  verify?: (domain: string, cfg: { endpoint: string; token: string }) => Promise<boolean>
  completeForRole?: typeof routerCompleteForRole
  /** Injectable for tests (defaults: real McpClient / WebProber). */
  mcp?: McpClient
  prober?: ProberLike
  /** Injectable for tests (default: real HostExecutor with real transports). */
  hostExecutor?: HostExecutor
  /** Injectable for tests (default: real MsfExecutor against the operator's msfrpcd). */
  msfExecutor?: MsfExecutor
  /** Injectable for tests (default: real NucleiExecutor against the operator's nuclei binary). */
  nucleiExecutor?: NucleiExecutor
  /** Injectable for tests (default: real NmapExecutor against the operator's nmap binary). */
  nmapExecutor?: NmapExecutor
  /** Injectable for tests (default: real memory store/pack/commit from memory/lifecycle.ts). */
  memory?: MemoryDeps
}

/** One entry in the shared target map (recon-written, whole-team-read). */
export interface TargetMapEntry {
  area: string
  method: string
  params?: string
  authState?: string
  attackId?: string
  notes?: string
}

/** A confirmed finding recorded live during exploitation (shared state). */
export interface LiveFinding {
  severity: string
  title: string
  vulnClass?: string
  attackId: string
  evidence: string
  payload?: string
  /**
   * Dual-exploiter cell outcome (spec §5), set only when the finding was
   * recorded with a proven claim and adjudicated by exploit-cell/live.ts:
   * 'proven' means both cell signatures plus a passing negative control;
   * anything else ends 'detected'. Absent = never adjudicated.
   */
  cellState?: 'proven' | 'detected'
  /**
   * The adjudicated claim's expected marker + target URL, retained by
   * exploit-cell/live.ts only when a claim was present at adjudication, so
   * the report layer can show what was proven. The claim's receipt is NOT
   * retained here — it lives in the audit trail.
   */
  provenClaim?: { expectedMarker: string; targetUrl: string }
  /** The adjudication outcome's one-line detail, retained with the claim. */
  cellDetail?: string
}

/** A killed hypothesis recorded live during exploitation (shared state). */
export interface KilledLive {
  hypothesis: string
  killingObservation: string
  vulnClass?: string
  attackId?: string
  payload?: string
}

export class HaltError extends Error {}

export interface Ctx {
  input: EngagementInput
  config: ResolvedRunnerConfig
  deps: RunnerDeps
  events: EventLog
  /**
   * Q-MEMTIER engagement memory state, opened by the run wiring
   * (memory/lifecycle.ts openEngagementMemory) after the registry
   * loads. Absent when memory never opened (blocked runs, tests,
   * partial contexts); lifecycle reads it through its session map.
   */
  memory?: MemoryEngagementState
  /** Optional operator policy (allow/deny rules), enforced before every dispatch. */
  policy?: PolicyRules
  /**
   * Scope guard (ROE allow set + out-of-scope deny set), enforced at
   * dispatch before any handler runs. Built from the ROE at engagement
   * start; the dispatch scope gate builds and caches it lazily when a
   * context was assembled without one (tests, partial contexts).
   */
  scopeGuard?: ScopeGuard
  /** Optional tool lifecycle hooks (pre/post), evaluated around every dispatch. */
  hooks?: HookRegistry
  mcp: McpClient
  prober: ProberLike
  /** Host execution (ssh/smb/winrm) — every call flows through the safety core. */
  hostExecutor: HostExecutor
  /** Metasploit bridge — every call flows through the msf safety policy. */
  msfExecutor: MsfExecutor
  /** Nuclei bridge — every call flows through the nuclei safety policy. */
  nucleiExecutor: NucleiExecutor
  /** Nmap bridge — every call flows through the nmap safety policy. */
  nmapExecutor: NmapExecutor
  /**
   * v0.21.0 honest counting: nuclei template executions are variant-level
   * checks, tracked separately from the 418 intents (never merged).
   */
  nuclei: { templateExecutions: number; templatesRun: number; findings: number }
  /**
   * Kill switch: coordinator abort sets `aborted` and aborts every registered
   * controller, terminating in-flight host executions across all parallel
   * tasks (they share this ctx). New host work is refused once aborted.
   */
  hostKill: { aborted: boolean; controllers: Set<AbortController> }
  /**
   * v0.13.0 production safety case — mechanical, runner-enforced.
   * The rate limiter gates every probe/exec tool per target host; the
   * auto-halt tracker refuses targets showing distress; environment drives
   * staging→production graduation.
   */
  safety: {
    limiter: TargetRateLimiter
    autoHalt: TargetAutoHalt
    /**
     * Q-LOCKOUT credential-attempt interlock: per-(host, protocol-class)
     * failed-validation budget of lockoutThreshold − 1, enforced in
     * dispatch between the duplicate guard and the rate limiter, with a
     * campaign ceiling and lockout-signal host trips. Resume only via a
     * recorded operator decision (guard.reset). Constructed from the
     * resolved config in phases/run.ts; optional here because dispatch
     * lazily builds one for contexts assembled without it (tests, partial
     * contexts — the scopeGuard precedent, see lockoutGuardFor).
     */
    lockout?: CredentialAttemptGuard
    environment: TestEnvironment
    productionConfirmed: boolean
    rpsPerHost: number
    productionCapApplied: boolean
    /** Kill-switch aborts this engagement (operator/coordinator override count). */
    killSwitchAborts: number
  }
  /**
   * v0.17.0 accountability — graduated autonomy, mechanically enforced.
   * The dispatcher refuses tools above the current tier and enforces the
   * Tier 1 single-step chain budget per target. Escalation happens only
   * through escalateTier() with a recorded operator approval — there is no
   * agent tool that raises the tier.
   */
  tier: TierState
  /** Append-only approval log (tier declared/escalated, production confirmed…). */
  approvals: ApprovalLog
  hosts: string[]
  domain: string
  excludedNote: string
  startedAt: number
  actions: number
  verifiedAt?: string
  verificationProof?: string
  plan: OperationPlan | null
  opsecCooldown: Set<string> // method+path keys abandoned after a detection signal
  consecutive5xx: number
  /** Battery categories probed so far this engagement. */
  coverage: Set<BatteryCategory>
  /**
   * Per-target battery coverage for full-battery engagements: target id →
   * categories probed on that target. Empty when fullBattery is off.
   */
  targetCoverage: Map<TargetId, Set<BatteryCategory>>
  /**
   * Per-item verdict ledger (v0.18.0): every selected battery item → one
   * disposition (pending/confirmed/executed-clean/killed/blocked/na).
   * The battery may not report complete while any item is pending.
   * Empty when fullBattery is off.
   */
  itemLedger: Map<string, ItemVerdict>
  probesUsed: number
  /**
   * v0.20.0 payload-variant expansion: max variant executions per battery
   * item this engagement (default 25 staging / 10 production; operator
   * override via --max-variants / REDTEAM_MAX_VARIANTS). Enforced
   * mechanically in dispatch — one item can't spray.
   */
  variantCap: number
  // -- Shared operation state (the Megazord): one context every agent reads and
  // -- writes. No agent works from a stale or private picture.
  /** Target fingerprint (stack guesses, app type) — parsed from the recon brief. */
  fingerprint: TargetFingerprint
  /** The persistent vulnerability registry (loaded at start; verdicts transact atomically as they land — v0.23.0). */
  registry: VulnerabilityRegistry
  registryPath: string
  /** Registry entries surfaced to this engagement (deduped). */
  registryHits: RegistryEntry[]
  /** Shared target map — recon writes it, the whole team reads it. */
  targetMap: TargetMapEntry[]
  /** Verdicts as they land — exploiter writes, reporter + registry consume. */
  liveFindings: LiveFinding[]
  killedLive: KilledLive[]
  /** Coordinator re-recon redirections used this engagement (max 2). */
  redirects: number
  /** Consecutive denied/cooled-down/OPSEC-signaled probes — wall detection. */
  deniedStreak: number
  /** The reporter's 2–3 sentence unified operation narrative (console header). */
  operationNarrative?: string
}
