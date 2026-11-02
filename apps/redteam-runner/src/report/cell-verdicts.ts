/**
 * Q-PROVEN cell-verdict carry helpers for the report phase (extracted
 * from phase.ts to keep that file inside the 300-line budget).
 *
 * The dual-exploiter cell stamps LiveFinding.cellState at adjudication;
 * these helpers carry that verdict onto the report's Finding records —
 * mechanically, by the runner, never from model text.
 */
import { type Finding } from "../types.js";
import { type LiveFinding } from "../context.js";

/**
 * Halted path: a report Finding built mechanically from one live finding,
 * carrying its cell verdict (same F-${i+1} positional indexing as the
 * state sync in dispatch/verdicts.ts). No join is needed here — the
 * halted report is built from the same live array it reports on.
 */
export function haltedFindingFromLive(lf: LiveFinding, index: number): Finding {
  return {
    id: `F-${index + 1}`,
    severity: (["critical", "high", "medium", "low", "info"].includes(lf.severity)
      ? lf.severity
      : "info") as Finding["severity"],
    title: lf.title,
    attackIds: lf.attackId ? [lf.attackId] : [],
    evidence: lf.evidence,
    fix: "(engagement halted before remediation guidance was written)",
    retest: "(engagement halted before a retest plan was written)",
    status: "confirmed",
    cellState: lf.cellState,
    provenClaim: lf.provenClaim,
    cellDetail: lf.cellDetail,
  };
}

/**
 * Normal-path join: stamp each reporter-parsed finding with the cell
 * verdict of the live finding it came from. A match requires BOTH keys —
 * normalized title equality AND the live finding's attackId among the
 * parsed finding's attackIds (attackIds are shared ATT&CK ids and titles
 * are model prose; either key alone is not an identifier). Across
 * multiple live matches 'proven' wins; a live finding stamps only the
 * first parsed finding that matches it. A miss leaves the finding
 * completely unstamped — it renders on bundle/status alone, exactly as
 * before this build; a miss never fabricates a verdict.
 */
/**
 * Normal-path reconciliation: build the report's Finding set
 * MECHANICALLY from the live findings — the same base records the
 * halted path builds via {@link haltedFindingFromLive} — and join the
 * reporter's narrative prose (evidence / fix / retest) onto them. The
 * reporter is a narrator, not a source: a live finding it omits still
 * appears, with the runner-side evidence and an explicit note where
 * its remediation prose would have gone, and a reporter item that
 * matches no live finding is dropped — reported through `onDropped`,
 * never silently. A match is by positional id first (the reporter's
 * F-N numbering follows the live list it was shown), then by ATT&CK
 * id; each reporter item joins at most one live finding. Identity
 * fields (id, title, severity, status, attackIds, cell verdict) are
 * always the live record's — the reporter's restatement never moves
 * them.
 */
export function mergeReporterFindings(
  liveFindings: LiveFinding[],
  reporterFindings: Finding[] | null,
  onDropped?: (f: Finding) => void,
): Finding[] {
  // null = the reporter emitted nothing parseable: the prose joins
  // nothing and the live set still publishes whole.
  const reporter = reporterFindings ?? [];
  const consumed = new Set<number>();
  const byId = new Map<string, number>();
  reporter.forEach((f, i) => {
    if (typeof f?.id === "string" && !byId.has(f.id)) byId.set(f.id, i);
  });
  const matched = new Map<number, number>();
  liveFindings.forEach((_lf, i) => {
    const ri = byId.get(`F-${i + 1}`);
    if (ri !== undefined && !consumed.has(ri)) {
      matched.set(i, ri);
      consumed.add(ri);
    }
  });
  liveFindings.forEach((lf, i) => {
    if (matched.has(i) || !lf.attackId) return;
    const ri = reporter.findIndex(
      (f, j) =>
        !consumed.has(j) &&
        Array.isArray(f?.attackIds) &&
        f.attackIds.some((a) => typeof a === "string" && a.toUpperCase() === lf.attackId.toUpperCase()),
    );
    if (ri >= 0) {
      matched.set(i, ri);
      consumed.add(ri);
    }
  });
  const findings = liveFindings.map((lf, i) => {
    const base = haltedFindingFromLive(lf, i);
    const ri = matched.get(i);
    if (ri === undefined) {
      base.fix = "(reporter omitted this finding — no remediation guidance was written)";
      base.retest = "(reporter omitted this finding — no retest plan was written)";
      return base;
    }
    const prose = reporter[ri]!;
    if (typeof prose.evidence === "string" && prose.evidence.trim()) base.evidence = prose.evidence;
    base.fix =
      typeof prose.fix === "string" && prose.fix.trim()
        ? prose.fix
        : "(reporter wrote no remediation guidance for this finding)";
    base.retest =
      typeof prose.retest === "string" && prose.retest.trim()
        ? prose.retest
        : "(reporter wrote no retest plan for this finding)";
    return base;
  });
  reporter.forEach((f, j) => {
    if (!consumed.has(j)) onDropped?.(f);
  });
  return findings;
}

export function applyCellVerdicts(findings: Finding[], liveFindings: LiveFinding[]): void {
  const stampedLive = new Set<number>();
  for (const f of findings) {
    const title = f.title.trim().toLowerCase();
    let match: LiveFinding | undefined;
    liveFindings.forEach((lf, i) => {
      if (stampedLive.has(i)) return;
      if (lf.title.trim().toLowerCase() !== title) return;
      if (!f.attackIds.some((a) => a.toUpperCase() === lf.attackId.toUpperCase())) return;
      if (!match || (lf.cellState === "proven" && match.cellState !== "proven")) match = lf;
    });
    if (match) {
      f.cellState = match.cellState;
      f.provenClaim = match.provenClaim;
      f.cellDetail = match.cellDetail;
      stampedLive.add(liveFindings.indexOf(match));
    }
  }
}
