/**
 * Engagement distress circuit breaker (fleet charter, spec §6) — the
 * layer above the per-target auto-halt (autohalt.ts).
 *
 * The auto-halt stops traffic to a distressed target and dispatch
 * refuses it for the rest of the engagement. What the charter adds,
 * and this module owns:
 *
 *  - ESCALATION IS A RECORD, not just an event line. Every target halt
 *    is registered here with its reason, forming the engagement's
 *    distress record the Coordinator (or the human operator) decides
 *    from — preserved state, not a scrolled-past log entry.
 *  - RESUME IS A DECISION, never a default. A halted target stays
 *    halted until a resume decision is recorded naming WHO decided
 *    (coordinator or human) and the rationale. There is no timer, no
 *    retry counter, and no code path that clears a halt on its own:
 *    `resumeTarget` refuses without a recorded decision, and the only
 *    way to record one is this module's explicit call.
 *  - ENGAGEMENT-WIDE VIEW. When halts accumulate (default: 3 distinct
 *    targets), the breaker reports the engagement itself as distressed
 *    — the signal for the Coordinator to halt the engagement's attack
 *    work entirely rather than pivot forever across a buckling estate.
 *
 * The registry is keyed by engagement id and lives for the process;
 * the runner is one engagement per process in practice.
 */

export interface DistressHaltRecord {
  host: string;
  reason: string;
  /** 1-based order of this halt within the engagement. */
  seq: number;
}

export interface ResumeDecision {
  by: "coordinator" | "human";
  rationale: string;
}

interface EngagementDistress {
  halts: DistressHaltRecord[];
  resumeDecisions: Map<string, ResumeDecision>;
}

const engagements = new Map<string, EngagementDistress>();

/** Distinct halted targets at which an engagement counts as distressed overall. */
export const ENGAGEMENT_DISTRESS_TARGET_THRESHOLD = 3;

function stateFor(engagementId: string): EngagementDistress {
  let s = engagements.get(engagementId);
  if (!s) {
    s = { halts: [], resumeDecisions: new Map() };
    engagements.set(engagementId, s);
  }
  return s;
}

/**
 * Register one target halt (called by dispatch when the auto-halt
 * fires). Idempotent per host: a host already on record keeps its
 * first halt record.
 */
export function registerDistressHalt(engagementId: string, host: string, reason: string): DistressHaltRecord {
  const s = stateFor(engagementId);
  const existing = s.halts.find((h) => h.host === host);
  if (existing) return existing;
  const record: DistressHaltRecord = { host, reason, seq: s.halts.length + 1 };
  s.halts.push(record);
  return record;
}

/** The engagement's distress record, in halt order. */
export function distressHalts(engagementId: string): DistressHaltRecord[] {
  return [...(engagements.get(engagementId)?.halts ?? [])];
}

/** True when the engagement's halts meet the engagement-wide distress threshold. */
export function engagementDistressed(
  engagementId: string,
  threshold: number = ENGAGEMENT_DISTRESS_TARGET_THRESHOLD,
): boolean {
  return (engagements.get(engagementId)?.halts.length ?? 0) >= threshold;
}

/**
 * Record the resume decision for one halted target. This is the ONLY
 * input that can clear a halt, and it must name its decider and its
 * rationale — an empty rationale is not a decision.
 */
export function recordResumeDecision(engagementId: string, host: string, decision: ResumeDecision): void {
  if (decision.rationale.trim().length === 0) {
    throw new Error(`resume decision for ${host} has no rationale — a resume without a stated reason is not a decision`);
  }
  stateFor(engagementId).resumeDecisions.set(host, decision);
}

/** The recorded resume decision for a target, if one exists. */
export function resumeDecisionFor(engagementId: string, host: string): ResumeDecision | undefined {
  return engagements.get(engagementId)?.resumeDecisions.get(host);
}

/**
 * Resume one halted target: refuses unless a resume decision is on
 * record for it. On success the auto-halt tracker is reset for the host
 * and the decision is consumed (a second halt needs a second decision).
 */
export function resumeTarget(
  engagementId: string,
  host: string,
  autoHalt: { reset: (host: string) => void },
): ResumeDecision {
  const s = stateFor(engagementId);
  const decision = s.resumeDecisions.get(host);
  if (!decision) {
    throw new Error(
      `refusing to resume ${host}: no resume decision on record — resume requires a recorded coordinator/human decision (spec §6), never an automatic one`,
    );
  }
  autoHalt.reset(host);
  s.resumeDecisions.delete(host);
  s.halts = s.halts.filter((h) => h.host !== host);
  return decision;
}

/**
 * Register a halt and render its escalation text (dispatch calls this
 * when the auto-halt fires): the halt's place in the record, the
 * resume terms, and the engagement-wide warning when the threshold
 * is met.
 */
export function distressEscalationResult(engagementId: string, host: string, reason: string): string {
  const record = registerDistressHalt(engagementId, host, reason);
  const wide = engagementDistressed(engagementId)
    ? ` Engagement-wide distress threshold reached (${record.seq} targets halted): the estate, not one host, is buckling.`
    : "";
  return (
    `DISTRESS ESCALATION #${record.seq}: ${host} halted (${reason}). Escalated to the Coordinator. ` +
    `Resume requires a recorded coordinator/human resume decision — no automatic resume.${wide}`
  );
}

/** Test/maintenance helper: forget one engagement's distress record. */
export function clearDistressRecord(engagementId: string): void {
  engagements.delete(engagementId);
}
