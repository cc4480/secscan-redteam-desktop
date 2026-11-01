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
import { type LiveFinding } from "../context.js";

export interface PeerVerdictSources {
  live: LiveFinding[];
  killed: LiveFinding[];
  deferred: LiveFinding[];
}

function matches(f: Finding, lf: LiveFinding): boolean {
  if (lf.title.trim().toLowerCase() !== f.title.trim().toLowerCase()) return false;
  return f.attackIds.some((a) => a.toUpperCase() === lf.attackId.toUpperCase());
}

function stampFrom(f: Finding, lf: LiveFinding): void {
  f.producer = lf.producer;
  f.peerReview = lf.peerReview;
}

export function applyPeerVerdicts(findings: Finding[], sources: PeerVerdictSources): void {
  const used: Record<keyof PeerVerdictSources, Set<number>> = {
    live: new Set(),
    killed: new Set(),
    deferred: new Set(),
  };
  for (const f of findings) {
    let hit = false;
    for (const key of ["killed", "deferred"] as const) {
      const list = sources[key];
      const i = list.findIndex((lf, idx) => !used[key].has(idx) && matches(f, lf));
      if (i >= 0) {
        stampFrom(f, list[i]!);
        f.status = key === "killed" ? "killed" : "deferred";
        used[key].add(i);
        hit = true;
        break;
      }
    }
    if (hit) continue;
    const i = sources.live.findIndex((lf, idx) => !used.live.has(idx) && matches(f, lf));
    if (i < 0) continue;
    const lf = sources.live[i]!;
    stampFrom(f, lf);
    if (lf.peerReview?.disposition === "downgraded" && lf.peerReview.toSeverity) {
      f.severity = lf.peerReview.toSeverity as Finding["severity"];
    }
    used.live.add(i);
  }
}
