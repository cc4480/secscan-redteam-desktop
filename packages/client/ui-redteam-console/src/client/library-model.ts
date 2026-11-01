/**
 * Wire types for the Phase 3 surfaces — Foundry, Arsenal, Reports, and
 * Scope & Safety — read from the runner console's own route and tool
 * sources (`apps/redteam-runner/src/ui/routes/foundry.ts`,
 * `routes/console-scope.ts`, `src/arsenal/tools.ts`,
 * `src/foundry/locate.ts`). The client renders these payloads; it never
 * invents fields the console did not send.
 */

/* ------------------------------------------------------------------ */
/* Foundry (GET /api/foundry, POST /api/foundry/{verify,run-gold,loop}) */
/* ------------------------------------------------------------------ */

/** One snapshot manifest bundle, projected for display by the console. */
export interface FoundryBundleRow {
  readonly slug: string
  readonly family: string
  readonly loopTier: string
  readonly vulnClass: string
  readonly cwe: string
  readonly tier: number | null
  readonly status: string
  readonly fitness: number | null
  readonly panelPassRate: number | null
}

/** The located Foundry snapshot, projected for display. */
export interface FoundrySnapshot {
  readonly name: string | null
  readonly generatedAt: string | null
  readonly declaredCounts: {
    readonly datasets: number | null
    readonly gold: number | null
    readonly silver: number | null
    readonly liveCases: number | null
  }
  readonly bundles: readonly FoundryBundleRow[]
  readonly counts: { readonly total: number; readonly gold: number; readonly silver: number; readonly other: number }
}

/** One scan-created case in the Foundry store. */
export interface FoundryCase {
  readonly id: string
  readonly family: string
  readonly tier: string
  readonly origin: string
  readonly vulnClass: string
  readonly cwe: string
  readonly severity: string
  readonly payloadClass: string
  readonly proofType: string
  readonly endpointShape: string
  readonly sourceEngagementId: string | null
  readonly createdAt: string
  readonly lineage: unknown
}

/** One registered bundle entry in the Foundry store. */
export interface FoundryStoreBundle {
  readonly id: string
  readonly family: string
  readonly tier: string
  readonly origin: string
  readonly sourceEngagementId: string | null
  readonly lineage: unknown
  readonly createdAt: string
}

/** One case's fitness record from the Gold Loop state. */
export interface FoundryFitness {
  readonly caseId: string
  readonly fitness: number
  readonly components: unknown
  readonly at: string
}

/** The full Foundry state answer. */
export interface FoundryState {
  readonly available: boolean
  readonly reason: string | null
  readonly snapshotDir: string | null
  readonly snapshotVia: string | null
  readonly searched: readonly string[]
  readonly snapshot: FoundrySnapshot | null
  readonly gate: {
    readonly available: boolean
    readonly cliPath: string | null
    readonly packageRoots: readonly string[]
  }
  readonly store: {
    readonly dir: string
    readonly available: boolean
    readonly cases: readonly FoundryCase[]
    readonly bundles: readonly FoundryStoreBundle[]
    readonly counts: {
      readonly total: number
      readonly byTier: Readonly<Record<string, number>>
      readonly byFamily: Readonly<Record<string, number>>
    }
    readonly sanitizerNotes: readonly string[]
  }
  readonly loop: {
    readonly cyclesRun: number
    readonly lastCycle: unknown
    readonly fitness: readonly FoundryFitness[]
  }
}

/** One per-family rollup row in a gate action's answer. */
export interface FoundryFamilyRow {
  readonly family: string
  readonly total: number
  readonly ok: number
  readonly failed: number
  readonly failedSlugs: readonly string[]
}

/** The verify action's answer. */
export interface FoundryVerifyResult {
  readonly ok: boolean
  readonly error?: string
  readonly exitCode?: number | null
  readonly timedOut?: boolean
  readonly totals?: { readonly ok: number; readonly total: number }
  readonly perFamily?: readonly FoundryFamilyRow[]
}

/** One GOLD bundle row in the run-gold answer. */
export interface FoundryGoldBundle {
  readonly slug: string
  readonly passRate: number | null
  readonly observedTier: number | null
  readonly assignedTier: number | null
  readonly fitness: number | null
  readonly gatePass: boolean | null
  readonly error: string | null
}

/** The run-gold action's answer. */
export interface FoundryRunGoldResult {
  readonly ok: boolean
  readonly error?: string
  readonly exitCode?: number | null
  readonly timedOut?: boolean
  readonly perFamily?: readonly FoundryFamilyRow[]
  readonly bundles?: readonly FoundryGoldBundle[]
}

/** One Gold Loop cycle summary (the loop action's `summary`). */
export interface FoundryLoopSummary {
  readonly cycle: number
  readonly at: string
  readonly casesScored: number
  readonly mutantsGenerated: number
  readonly survivorsRegistered: number
  readonly notes: readonly string[]
  readonly error: string | null
}

/** The loop action's answer. */
export interface FoundryLoopResult {
  readonly ok: boolean
  readonly summary: FoundryLoopSummary
}

/** The three Foundry actions. */
export type FoundryActionKind = 'verify' | 'run-gold' | 'loop'

/** Any Foundry action's answer, by kind. */
export type FoundryActionResult = FoundryVerifyResult | FoundryRunGoldResult | FoundryLoopResult

/* ------------------------------------------------------------------ */
/* Arsenal (the Phase 0 bridge: POST redteam-console/arsenal)          */
/* ------------------------------------------------------------------ */

/** The allowlisted Arsenal tools the bridge forwards. */
export type ArsenalToolName = 'arsenal_search' | 'arsenal_browse' | 'arsenal_recommend'

/** One Arsenal index entry, as the tools project it. */
export interface ArsenalItem {
  readonly name: string
  readonly url: string
  readonly description: string
  readonly description_truncated: boolean
  readonly collection: string
  readonly tags: readonly string[]
  readonly targets: readonly string[]
  readonly battery: readonly string[]
  /** Recommend only: the facets that matched, when the tool sent them. */
  readonly why?: readonly string[]
}

/** The search/recommend answer. */
export interface ArsenalResults {
  readonly results: readonly ArsenalItem[]
  readonly total: number
  readonly index: unknown
  /** The tools' typed failure envelope (e.g. ARSENAL_INDEX_EMPTY), when the call answered one instead of results. */
  readonly error?: ArsenalToolError
}

/** A typed Arsenal tool failure, carried in the tool's own JSON answer. */
export interface ArsenalToolError {
  readonly code: string
  readonly fix?: string
}

/** One browse topic row (the census form). */
export interface ArsenalTopic {
  readonly topic: string
  readonly collections: number
  readonly entries: number
}

/** One browse collection row (the category form). */
export interface ArsenalCollection {
  readonly slug: string
  readonly name: string
  readonly url: string
  readonly description: string
  readonly entry_count: number
  readonly level2: boolean
}

/** The browse answer: census or one category's collections. */
export interface ArsenalBrowse {
  readonly topics?: readonly ArsenalTopic[]
  readonly collections?: readonly ArsenalCollection[]
  readonly index: unknown
  /** The tools' typed failure envelope (e.g. ARSENAL_INDEX_EMPTY), when the call answered one instead of a census. */
  readonly error?: ArsenalToolError
}

/* ------------------------------------------------------------------ */
/* Scope & Safety (GET /api/console/scope)                             */
/* ------------------------------------------------------------------ */

/** The cross-engagement scope & safety aggregate. */
export interface ScopeAggregate {
  readonly available: boolean
  readonly reason?: string
  readonly generatedAt?: string
  readonly window?: { readonly engagementsScanned: number }
  readonly totals?: {
    readonly denials: number
    readonly scopeViolations: number
    readonly policyDenials: number
    readonly hookDenials: number
    readonly authorizationDenied: number
    readonly targetAutoHalts: number
    readonly engagementHalts: number
    readonly aborts: number
    readonly halts: number
  }
  readonly haltReasons?: readonly { readonly reason: string; readonly count: number }[]
  readonly perEngagement?: readonly {
    readonly id: string
    readonly target: string | null
    readonly startedAt: string | null
    readonly denials: number
    readonly halts: number
    readonly total: number
  }[]
  readonly latest?: readonly {
    readonly ts: string
    readonly engagementId: string
    readonly kind: string
    readonly target: string | null
    readonly reason: string | null
  }[]
  readonly notes?: readonly string[]
}

/* ------------------------------------------------------------------ */
/* Reports (GET /api/engagements/:id — the completion record)          */
/* ------------------------------------------------------------------ */

/** The engagement detail answer's subset the Reports library reads. */
export interface EngagementDetail {
  readonly state: {
    readonly status?: string
    readonly target?: string
    /** filename → path, written by the autofire at engagement close. */
    readonly deliverables?: Readonly<Record<string, string>>
    /** True when at least one deliverable failed to generate. */
    readonly deliverableFailed?: boolean
  } | null
  readonly live: boolean
  readonly pending?: boolean
}
