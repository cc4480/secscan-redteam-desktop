/**
 * Q-FLEET-XCHECK peer-verdict carry for the report phase — the join
 * twin of cell-verdicts.ts, in its own module so the reviewer pass owns
 * its seam (report rendering consumes the stamped Finding fields only).
 *
 * The reviewer pass (phases/peer-review.ts) stamps every live finding
 * with its challenge outcome and moves killed/deferred findings out of
 * the confirmed flow; this join carries the outcome onto the report's
 * Finding records — mechanically, by the runner, never from model
 * text. Matching follows applyCellVerdicts' discipline: normalized
 * title equality AND the live finding's attackId among the parsed
 * finding's attackIds (either key alone is not an identifier), and a
 * source finding stamps only the first parsed finding that matches it.
 * Precedence across the three source lists is killed → deferred →
 * live: what the checker stamped OUT is never re-admitted by a
 * live-list match on a colliding title. Effects per source:
 *  - live: producer + peerReview carried; a downgraded disposition
 *    forces the finding's severity to the stamped rung (the runner's
 *    stamp wins over the reporter's restatement).
 *  - deferred: status forced to 'deferred', producer + stamp carried.
 *  - killed: status forced to 'killed', producer + stamp carried.
 * A miss leaves the finding completely unstamped — it renders on its
 * own content alone, exactly as before this build; a miss never
 * fabricates a challenge.
 */
import { type Finding } from "../types.js";
import { type Ctx, type LiveFinding } from "../context.js";
export interface PeerVerdictSources {
    live: LiveFinding[];
    killed: LiveFinding[];
    deferred: LiveFinding[];
}
export declare function applyPeerVerdicts(findings: Finding[], sources: PeerVerdictSources): void;
/** The report-phase call site for the peer join, with the sources read
 * from the engagement context (extracted from report/phase.ts so the
 * orchestrator stays inside the file budget; arguments unchanged). */
export declare function stampPeerVerdicts(findings: Finding[], ctx: Ctx): void;
/** The per-finding peer fragment of the reporter prompt's shared-verdicts
 * list: the checker's verdict and seat, or nothing when unchallenged. */
export declare function peerVerdictSuffix(f: LiveFinding): string;
/** The reporter prompt's peer-deferred section: findings a different
 * seat challenged and sent back for more evidence, listed so the
 * reporter marks any write-up deferred. Ends with a newline. */
export declare function peerDeferredPromptSection(deferred: readonly LiveFinding[] | undefined): string;
