/**
 * Wire shapes of the console's engagement-record routes, mirrored
 * field-for-field from the runner (`apps/redteam-runner/src/ui/routes`
 * over `src/types.ts` / `src/proof/bundle`). The console is the single
 * authority; nullable and optional fields stay nullable and optional
 * exactly where the runner leaves them absent.
 */

/** One confirmed finding from `GET /api/engagements/:id/findings` (state.findings + hasProof). */
export interface Finding {
  readonly id: string
  readonly severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  readonly title: string
  readonly attackIds: readonly string[]
  readonly evidence: string
  readonly fix: string
  readonly retest: string
  readonly status: 'confirmed' | 'killed' | 'deferred'
  /** The dual-exploiter cell verdict, runner-stamped; absent = never adjudicated. */
  readonly cellState?: 'proven' | 'detected'
  readonly provenClaim?: { readonly expectedMarker: string; readonly targetUrl: string }
  readonly cellDetail?: string
  readonly cvss?: number
  readonly cwe?: string
  /** The fleet seat that produced the finding; absent on older records. */
  readonly producer?: string
  /** Whether a PoC bundle exists for this finding. */
  readonly hasProof: boolean
}

/** One executed step inside a proof bundle. */
export interface PocStep {
  readonly seq: number
  readonly ts: string
  readonly tool: string
  readonly target?: string
  readonly attackId?: string
  readonly command: string
  readonly result: string
  readonly validation: unknown
  readonly marker?: string
  readonly cve?: string
  readonly replay: unknown
}

/** A proof bundle from `GET /api/engagements/:id/proof/:fid` (PocBundle v1). */
export interface ProofBundle {
  readonly version: 1
  readonly bundleId: string
  readonly engagementId: string
  readonly findingId: string
  readonly batteryItemId?: string
  readonly attackIds: readonly string[]
  readonly cve?: string
  readonly severity: string
  readonly title: string
  readonly target: string
  readonly operator: string
  readonly generatedAt: string
  readonly steps: readonly PocStep[]
  readonly markerSent?: string
  readonly markerObserved?: string
  readonly validationTier: string
  /** Exactly what the bundle proves. */
  readonly proves: string
  /** What it does NOT prove — no impact overclaim. */
  readonly doesNotProve: string
  readonly reverifyCommand: string
}

/** Battery coverage cells from the engagement state. */
export interface CoverageCells {
  readonly logic: number
  readonly functionality: number
  readonly validation: number
}

/** `GET /api/engagements/:id/coverage` — item-verdict rollup + battery cells. */
export interface Coverage {
  readonly cells: CoverageCells | null
  readonly total: number
  readonly byDisposition: Readonly<Record<string, number>>
  readonly pending: readonly string[]
  readonly pendingTotal: number
}

/** `GET /api/engagements/:id/compliance` — server-rendered HTML per document, null when unwritten. */
export interface Compliance {
  readonly packHtml: string | null
  readonly attestationHtml: string | null
  readonly safetyHtml: string | null
  readonly reportHtml: string | null
}

/** One step of a reverify plan (the server's trimmed replay view). */
export interface ReverifyPlanStep {
  readonly seq: number
  readonly tool: string
  readonly target?: string
  readonly command: string
  readonly validation: unknown
  readonly replayable: boolean
}

/** `POST /api/reverify` without execute: the plan (no traffic sent). */
export interface ReverifyPlan {
  readonly plan: true
  readonly bundleId: string
  readonly findingId: string
  readonly title: string
  readonly validationTier: string
  readonly proves: string
  readonly doesNotProve: string
  readonly steps: readonly ReverifyPlanStep[]
}

/** A background job record from `GET /api/jobs/:id` (UiJob). */
export interface JobRecord {
  readonly id: string
  readonly kind: 'reverify' | 'watch-trigger'
  readonly status: 'running' | 'done' | 'failed'
  readonly startedAt: string
  readonly finishedAt?: string
  /** For a finished reverify: { verdict, summary, tickets }. */
  readonly result?: unknown
  readonly error?: string
}

/** The reverify job's result payload, when the job is a finished reverify. */
export interface ReverifyJobResult {
  readonly verdict?: string
  readonly summary?: string
  readonly tickets?: unknown
}
