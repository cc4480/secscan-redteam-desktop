/**
 * The unified engagement report renderer — the design study's Part D
 * template, assembled deterministically from structured records.
 *
 * Inputs are the report phase's own objects (posture, findings, PoC
 * bundles, coverage, activity) — never agent-authored HTML and never a
 * markdown string whose prose structure the renderer must guess at. The
 * one prose input is the reporter narrative, rendered through the same
 * escaping markdown renderer the UI uses, into the executive-summary slot.
 *
 * Output: one self-contained HTML file — inline CSS, inline SVG, no
 * external requests, readable with scripts off (the single script is a
 * copy-button enhancement).
 */
import { type SecurityPosture, type PostureBanner } from "#seclayer/server/scoring.js";
import { type Finding } from "../../types.js";
import { type PocBundle, type NegativeProof } from "../../proof/index.js";
import { renderMarkdown } from "../../ui/markdown.js";
import { type ReportMeta } from "../html.js";
import { REPORT_CSS } from "./style.js";
import { severityChips } from "./gauge.js";
import { findingCard, negativeProofCard, severityRank, tierOf, type FindingMeta } from "./cards.js";
import {
  activitySection,
  allClearSection,
  bannerSection,
  coverSection,
  coverageSection,
  fixPromptSection,
  footerSection,
  haltBanner,
  type ActivityInput,
  type CoverageInput,
} from "./sections.js";
import { TIER_DEFINITION, TIER_LABEL, TIER_ORDER, esc, type ReportTier, type SeverityName } from "./tokens.js";
import type { ReportDetail } from "../detail.js";
import type { HostInventoryArtifact } from "../host-inventory.js";
import {
  breakdownSection, impactSection, pillarSection, prioritySection,
  riskAreasSection, surfaceSection, whatChangedSection,
} from "./detail-sections.js";
import { inventorySection } from "./inventory-sections.js";

export type { ActivityInput, CoverageInput } from "./sections.js";
export type { FindingMeta } from "./cards.js";

export interface EngagementReportInput {
  meta: ReportMeta;
  title: string;
  /** Reporter narrative markdown (the executive-summary prose slot). */
  narrativeMd: string;
  /** The anchored grade over the confirmed findings (grading seam). */
  posture: SecurityPosture;
  banner: PostureBanner | null;
  findings: Finding[];
  bundles: ReadonlyMap<string, PocBundle>;
  /** Runner-computed reason each confirmed finding has no bundle. */
  noBundleReasons: ReadonlyMap<string, string>;
  negativeProof: NegativeProof[];
  findingMeta: ReadonlyMap<string, FindingMeta>;
  /** The Q-REPORT-DETAIL derivations (report/detail.ts), when the
   * phase assembled them. Absent => the pre-detail anatomy renders. */
  detail?: ReportDetail;
  /** The Q-RP-11 host inventory (report/host-inventory.ts), when the
   * engagement dir carries the artifact. Absent => no inventory
   * sections render (web/remote engagements are unchanged). */
  inventory?: HostInventoryArtifact;
  coverage: CoverageInput;
  activity: ActivityInput;
  haltedReason?: string;
  dryRun?: boolean;
}

interface TierGroup {
  tier: ReportTier;
  cards: string[];
}

const norm = (s: string): string => s.trim().toLowerCase();

/** Group findings under the truth tiers (PROVEN → CONFIRMED → DEFERRED →
 * RULED OUT), severity-ordered within a tier. Ruled-out negative proofs
 * join the group unless a killed finding already states the same
 * hypothesis (exact normalized match — deterministic, not fuzzy). */
function groupFindings(o: EngagementReportInput): { groups: TierGroup[]; counts: Record<ReportTier, number> } {
  const byTier = new Map<ReportTier, Finding[]>();
  for (const f of o.findings) {
    const tier = tierOf(f, o.bundles.get(f.id));
    const list = byTier.get(tier) ?? [];
    list.push(f);
    byTier.set(tier, list);
  }
  const killedTitles = new Set(
    (byTier.get("ruled-out") ?? []).map((f) => norm(f.title)),
  );
  const extraNegatives = o.negativeProof.filter((n) => !killedTitles.has(norm(n.hypothesis)));

  const groups: TierGroup[] = [];
  const counts: Record<ReportTier, number> = { proven: 0, confirmed: 0, deferred: 0, "ruled-out": 0 };
  for (const tier of TIER_ORDER) {
    const list = (byTier.get(tier) ?? [])
      .slice()
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.id.localeCompare(b.id));
    const cards = list.map((f) =>
      findingCard({
        finding: f,
        bundle: o.bundles.get(f.id),
        noBundleReason: o.noBundleReasons.get(f.id),
        meta: o.findingMeta.get(f.id),
      }),
    );
    if (tier === "ruled-out") {
      for (const n of extraNegatives) cards.push(negativeProofCard(n));
    }
    counts[tier] = cards.length;
    if (cards.length > 0) groups.push({ tier, cards });
  }
  return { groups, counts };
}

const COPY_SCRIPT = `<script>
document.querySelectorAll("[data-copy]").forEach(function (b) {
  b.addEventListener("click", function () {
    var el = document.getElementById(b.getAttribute("data-copy"));
    if (el && navigator.clipboard) { navigator.clipboard.writeText(el.innerText); b.textContent = "Copied"; }
  });
});
</script>`;

export function renderEngagementReportHtml(o: EngagementReportInput): string {
  const { groups, counts } = groupFindings(o);
  const halted = typeof o.haltedReason === "string" && o.haltedReason.length > 0;
  const activeCount = counts.proven + counts.confirmed + counts.deferred;

  const parts: string[] = [];
  const d = o.detail;
  // The cover carries live deltas only when the baseline diff carries a
  // numeric score delta (a counts-only baseline renders none anywhere).
  const coverDelta = d && d.diff && d.diff.scoreDelta !== undefined && o.meta.baseline
    ? {
        scoreDelta: d.diff.scoreDelta,
        findingsDelta: d.diff.findingsDelta,
        baselineLabel: o.meta.baseline.startedAt.slice(0, 10),
      }
    : undefined;
  parts.push(
    coverSection({ meta: o.meta, posture: o.posture, tierCounts: counts, haltedReason: o.haltedReason, dryRun: o.dryRun, delta: coverDelta }),
  );
  if (halted) parts.push(haltBanner(o.haltedReason as string));
  else if (o.banner) parts.push(bannerSection(o.banner));

  const narrative = o.narrativeMd.trim();
  if (narrative) {
    parts.push(
      `<h2 class="sec-title">Executive Summary</h2><div class="prose">${renderMarkdown(narrative)}</div>`,
    );
  }

  if (d) {
    parts.push(breakdownSection(d));
    parts.push(whatChangedSection(d, o.meta.target));
    if (d.riskAreas.length > 0) parts.push(riskAreasSection(d));
    parts.push(impactSection(d));
  } else {
    parts.push(coverageSection(o.coverage));
  }

  parts.push(
    severityChips(o.posture.findingsBySeverity as Record<SeverityName, number>) +
      `<p class="accuracy">${counts.proven} proven · ${counts.confirmed} confirmed · ${counts.deferred} deferred · ${counts["ruled-out"]} ruled out</p>`,
  );

  parts.push(`<h2 class="sec-title">Findings</h2>`);
  if (activeCount === 0 && !halted) parts.push(allClearSection());
  for (const g of groups) {
    parts.push(
      `<h3 class="tier-head">${TIER_LABEL[g.tier]} — ${g.cards.length}</h3>` +
        `<p class="tier-def">${TIER_DEFINITION[g.tier]}</p>` +
        g.cards.join(""),
    );
  }

  parts.push(fixPromptSection(o.meta.target, o.findings, o.bundles));
  if (d) {
    parts.push(prioritySection(d));
    parts.push(pillarSection(d));
    parts.push(coverageSection(o.coverage));
    parts.push(surfaceSection(d));
  }
  const inventoryHtml = inventorySection(o.inventory);
  if (inventoryHtml) parts.push(inventoryHtml);
  parts.push(activitySection(o.activity));
  parts.push(footerSection(o.meta));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="SecScan RedTeam">
<meta name="robots" content="noindex,nofollow">
<title>${esc(o.title)} — ${esc(o.meta.target)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
${parts.join("\n")}
</div>
${COPY_SCRIPT}
</body>
</html>`;
}
