/**
 * Peer-review verdict primitives — extracted from peer-review.ts to keep the
 * phase module under the 300-line budget.
 *
 * These are pure: seat selection and the checker's answer parser. Nothing here
 * touches the model or the engagement state, so they extract without changing
 * the phase's behaviour.
 */
import type { AgentRole } from "@secscan/redteam-llm-router";
import { type ActorRole, type PeerReviewStamp } from "../types.js";
import { extractJsonBlock } from "../util.js";

/** Checker preference: the Architect owns review; then the coordinator
 * (the sign-off seat), reporter, recon, exploiter. The producer is
 * removed from the list before picking — see selectChecker. */
export const CHECKER_PREFERENCE: readonly AgentRole[] = ["architect", "coordinator", "reporter", "recon", "exploiter"];

/**
 * The checker for a finding: the first preferred seat that is NOT the
 * producer. Pure and total — for every producer (including 'runner'
 * and an absent stamp) some other seat is returned, so the pass can
 * never seat a finding's producer as its own checker.
 */
export function selectChecker(producer: ActorRole | undefined): AgentRole {
  for (const seat of CHECKER_PREFERENCE) {
    if (seat !== producer) return seat;
  }
  // Unreachable: the preference list holds five distinct seats and a
  // producer can exclude at most one. Fail loud if that ever changes.
  throw new Error(`[peer-review] no checker seat available for producer ${String(producer)}`);
}

export const SEVERITY_LADDER = ["info", "low", "medium", "high", "critical"] as const;

export function coerceSeverity(s: string): (typeof SEVERITY_LADDER)[number] {
  const l = s.toLowerCase();
  return (SEVERITY_LADDER as readonly string[]).includes(l)
    ? (l as (typeof SEVERITY_LADDER)[number])
    : "low";
}

export function oneNotchDown(sev: string): string | null {
  const i = SEVERITY_LADDER.indexOf(coerceSeverity(sev));
  return i > 0 ? SEVERITY_LADDER[i - 1]! : null;
}

export type PeerVerdict = PeerReviewStamp["verdict"];

export interface ParsedPeerVerdict {
  verdict: PeerVerdict;
  /** Proposed lower severity, only meaningful for 'downgraded'. */
  severity?: string;
  rationale: string;
}

const VERDICTS: readonly PeerVerdict[] = ["upheld", "downgraded", "needs-evidence", "killed"];

/** Parse the checker's answer. Anything off-shape is null — the caller
 * records a failed challenge, never a guessed verdict. */
export function parsePeerVerdict(text: string): ParsedPeerVerdict | null {
  const parsed = extractJsonBlock(text) as { verdict?: unknown; severity?: unknown; rationale?: unknown } | null;
  if (!parsed || typeof parsed.verdict !== "string") return null;
  if (!(VERDICTS as readonly string[]).includes(parsed.verdict)) return null;
  return {
    verdict: parsed.verdict as PeerVerdict,
    severity: typeof parsed.severity === "string" ? parsed.severity : undefined,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 500) : "",
  };
}
