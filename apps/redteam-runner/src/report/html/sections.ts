/**
 * Report sections (design study D5, in order): cover, posture banner,
 * coverage strip, complete fix prompt, tool activity, audit footer.
 * The executive-summary and findings sections are assembled by render.ts
 * (they own the prose renderer and the tier grouping respectively).
 */
import { type SecurityPosture, type PostureBanner } from "#seclayer/server/scoring.js";
import { type Finding } from "../../types.js";
import { type PocBundle } from "../../proof/index.js";
import { type ReportMeta } from "../html.js";
import { scoreGauge, severityBar } from "./gauge.js";
import { severityRank } from "./cards.js";
import { esc, type ReportTier, type SeverityName } from "./tokens.js";

export interface CoverInput {
  meta: ReportMeta;
  posture: SecurityPosture;
  tierCounts: Record<ReportTier, number>;
  haltedReason?: string;
  dryRun?: boolean;
}

/** Section 1 — the cover: SecScan's composition (target + summary meta on
 * the left, the score block on the right) in Seclayer's tokens. A halted
 * engagement renders the N/A gauge and states why it halted. */
export function coverSection(o: CoverInput): string {
  const m = o.meta;
  const halted = typeof o.haltedReason === "string" && o.haltedReason.length > 0;
  const gauge = halted
    ? scoreGauge({ score: null, grade: "N/A" })
    : scoreGauge({ score: o.posture.score, grade: o.posture.grade });
  const counts = halted
    ? `<div class="counts-line">engagement halted</div>`
    : `<div class="counts-line">${o.tierCounts.proven} proven · ${o.tierCounts.confirmed} confirmed · ${o.tierCounts.deferred} deferred</div>`;
  const statusPill =
    m.status === "complete" ? "ok" : m.status === "halted" || m.status === "blocked" ? "bad" : "";
  const rows: string[] = [
    `<div><dt>Engagement</dt><dd>${esc(m.engagementId)}</dd></div>`,
    `<div><dt>Status</dt><dd><span class="pill ${statusPill}">${esc(m.status)}</span></dd></div>`,
    `<div><dt>Mode</dt><dd>${esc(m.mode)} · tier ${m.tier} · ${esc(m.environment)}</dd></div>`,
    `<div><dt>Authorisation</dt><dd>${m.verified ? '<span class="pill ok">ownership verified</span>' : '<span class="pill bad">not verified</span>'}</dd></div>`,
  ];
  if (m.operator) rows.push(`<div><dt>Operator</dt><dd>${esc(m.operator)}</dd></div>`);
  if (m.client) rows.push(`<div><dt>Client</dt><dd>${esc(m.client)}</dd></div>`);
  rows.push(`<div><dt>Started</dt><dd>${esc(m.startedAt)}</dd></div>`);
  rows.push(`<div><dt>Generated</dt><dd>${esc(m.generatedAt)}</dd></div>`);
  const eyebrow =
    `SecScan RedTeam — Engagement Report` + (o.dryRun ? " · Dry Run" : "") + (m.client ? ` · ${esc(m.client)}` : "");
  return (
    `<section class="cover"><div class="eyebrow">${eyebrow}</div><div class="cover-grid">` +
    `<div class="cover-meta"><div class="target">${esc(m.target)}</div>` +
    (m.objective ? `<p class="objective">${esc(m.objective)}</p>` : "") +
    `<dl class="meta-grid">${rows.join("")}</dl></div>` +
    `<div class="score-block">${gauge}` +
    `<div class="posture-word">${halted ? "Incomplete" : esc(o.posture.postureRating)}</div>` +
    severityBar(o.posture.findingsBySeverity as Record<SeverityName, number>) +
    counts +
    `</div></div></section>`
  );
}

/** The halt banner: why the engagement stopped, in place of a grade. */
export function haltBanner(reason: string): string {
  return (
    `<div class="banner critical"><h3>Engagement Halted</h3>` +
    `<p>${esc(reason)} Findings, coverage, and proof below are the runner-computed record of work completed up to the halt.</p></div>`
  );
}

/** Section 2 — the posture banner: severity-proportioned, worst finding
 * named (the grading seam's bannerForPosture output, verbatim). */
export function bannerSection(banner: PostureBanner): string {
  const cls = banner.level === "critical" ? "critical" : banner.level === "warning" ? "warning" : "notice";
  return `<div class="banner ${cls}"><h3>${esc(banner.title)}</h3><p>${esc(banner.message)}</p></div>`;
}

export type CoverageCellState = "done" | "blocked" | "missing";

export interface CoverageCell {
  target: string;
  category: string;
  state: CoverageCellState;
}

export interface CoverageInput {
  fullBattery: boolean;
  cells: CoverageCell[];
  totals: { total: number; confirmed: number; executedClean: number; killed: number; blocked: number; na: number; pending: number };
  probesUsed: number;
  /** Items that execute only when a prerequisite is supplied. */
  planOnly: string[];
  /** Human labels for cells/categories not covered. */
  notCovered: string[];
}

const CELL_WORD: Record<CoverageCellState, string> = { done: "Probed", blocked: "Blocked", missing: "Not covered" };

/** Section 4 — the coverage strip: what was actually checked, cell by
 * cell, with the honest limits named. This is what makes a zero-finding
 * report credible. */
export function coverageSection(c: CoverageInput): string {
  const cells = c.cells
    .map(
      (cell) =>
        `<div class="cell"><div class="ct">${esc(cell.target)}</div><div class="cn">${esc(cell.category)}</div>` +
        `<div class="cs ${cell.state}">${CELL_WORD[cell.state]}</div></div>`,
    )
    .join("");
  const t = c.totals;
  const totals =
    t.total > 0
      ? `<p class="totals">${t.total} battery items: ${t.confirmed} confirmed · ${t.executedClean} executed-clean · ${t.killed} killed · ${t.blocked} blocked · ${t.na} not-applicable · ${t.pending} pending${c.probesUsed > 0 ? ` · ${c.probesUsed} probes` : ""}</p>`
      : c.probesUsed > 0
        ? `<p class="totals">${c.probesUsed} probes used</p>`
        : "";
  const limits: string[] = [];
  for (const cell of c.cells) if (cell.state === "blocked") limits.push(`Blocked (prerequisite not met): ${cell.target}:${cell.category}`);
  for (const p of c.planOnly) limits.push(`Executes when its prerequisite is supplied: ${p}`);
  for (const n of c.notCovered) limits.push(`Not covered: ${n}`);
  const limitsHtml = limits.length
    ? `<h3>Honest limits</h3><ul class="limits">${limits.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`
    : "";
  return (
    `<h2 class="sec-title">Coverage</h2>` +
    `<p class="sec-sub">${c.fullBattery ? "Full battery" : "Scoped run"} — every cell states what actually ran; nothing below is inferred.</p>` +
    (cells ? `<div class="cells">${cells}</div>` : "") +
    totals +
    limitsHtml
  );
}

/** The consolidated fix prompt text (Seclayer's Complete Fix Prompt
 * pattern): role framing once, then every actionable finding as a compact
 * section. Composed mechanically from the finding records — never by an
 * agent — so the prompt and the report can never drift apart. */
export function buildFixPrompt(target: string, findings: Finding[], bundles: ReadonlyMap<string, PocBundle>): string {
  const actionable = findings
    .filter((f) => f.status === "confirmed" && f.severity !== "info")
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.id.localeCompare(b.id));
  if (actionable.length === 0) return "";
  const lines: string[] = [
    `You are fixing the security findings of an authorized penetration test against ${target}.`,
    `Work through the findings in order. For each one: apply the fix, then run the retest to confirm the issue no longer reproduces. Do not change behaviour beyond what each fix requires.`,
    ``,
  ];
  actionable.forEach((f, i) => {
    lines.push(`## ${i + 1}. [${f.severity.toUpperCase()}] ${f.title} (${f.id})`);
    if (f.attackIds.length) lines.push(`ATT&CK: ${f.attackIds.join(", ")}`);
    if (f.evidence) lines.push(`Evidence: ${f.evidence.slice(0, 400)}`);
    if (f.fix) lines.push(`Fix: ${f.fix}`);
    if (f.retest) lines.push(`Retest: ${f.retest}`);
    const b = bundles.get(f.id);
    if (b) lines.push(`Reverify: ${b.reverifyCommand}`);
    lines.push(``);
  });
  return lines.join("\n").trimEnd();
}

/** Section 7 — the fix prompt panel: scrollable on screen, full in print. */
export function fixPromptSection(target: string, findings: Finding[], bundles: ReadonlyMap<string, PocBundle>): string {
  const text = buildFixPrompt(target, findings, bundles);
  if (!text) return "";
  return (
    `<h2 class="sec-title">Complete Fix Prompt</h2>` +
    `<p class="sec-sub">One consolidated, paste-ready prompt covering every actionable finding, composed from the records above.</p>` +
    `<button class="copybtn" data-copy="fixprompt" type="button">Copy fix prompt</button>` +
    `<pre class="fixprompt" id="fixprompt">${esc(text)}</pre>`
  );
}

export interface ActivityRow {
  action: string;
  count: number;
  attackIds: string[];
  firstSeq: number;
  lastSeq: number;
}

export interface ActivityInput {
  eventCount: number;
  rows: ActivityRow[];
  totalActions: number;
  decisions: { action: string; seq: number }[];
  danglingCauses: number[];
}

/** Section 8 — tool activity + operator decisions + causality integrity,
 * projected from the audit log; the record, not a narrative about it. */
export function activitySection(a: ActivityInput): string {
  if (a.eventCount === 0) return "";
  const rows = a.rows
    .map(
      (r) =>
        `<tr><td>${esc(r.action)}</td><td>${r.count}</td><td>${esc(r.attackIds.join(", ") || "—")}</td><td>${r.firstSeq}</td><td>${r.lastSeq}</td></tr>`,
    )
    .join("");
  const more =
    a.totalActions > a.rows.length
      ? `<tr><td colspan="5">… ${a.totalActions - a.rows.length} more actions (see events.jsonl)</td></tr>`
      : "";
  const decisions =
    `Operator decisions recorded: ${a.decisions.length}` +
    (a.decisions.length ? ` — ${a.decisions.map((d) => `${esc(d.action)} (seq ${d.seq})`).join(", ")}` : "");
  const causality =
    a.danglingCauses.length === 0
      ? "Causality integrity: every causedBy link resolves."
      : `Causality integrity: ${a.danglingCauses.length} dangling cause reference(s): seq ${a.danglingCauses.join(", ")}.`;
  return (
    `<h2 class="sec-title">Tool Activity</h2>` +
    `<p class="sec-sub">${a.eventCount} events across ${a.totalActions} distinct actions. ${decisions}. ${causality}</p>` +
    `<div class="tblwrap"><table class="act"><thead><tr><th>Action</th><th>Count</th><th>ATT&CK</th><th>First seq</th><th>Last seq</th></tr></thead>` +
    `<tbody>${rows}${more}</tbody></table></div>`
  );
}

/** The all-clear panel (Seclayer's pattern): a clean result is stated as
 * a result, with the coverage section above as its evidence. */
export function allClearSection(): string {
  return (
    `<div class="allclear"><h3>Zero Vulnerabilities Outstanding</h3>` +
    `<p>No confirmed findings this engagement. The coverage record above states what was actually checked.</p></div>`
  );
}

/** Section 9 — artifacts & audit footer: the machine-readable records
 * alongside this file are authoritative for every figure shown. */
export function footerSection(meta: ReportMeta): string {
  return (
    `<footer class="doc">Artifacts: <code>report.md</code> · <code>item-verdicts.json</code> · ` +
    `<code>poc/*.json</code> · <code>compliance-pack.html</code> · <code>attestation.html</code> · ` +
    `<code>safety-manifest.html</code> · <code>state.json</code> · <code>events.jsonl</code>.<br>` +
    `Generated ${esc(meta.generatedAt)} by SecScan RedTeam from the engagement audit log. ` +
    `The machine-readable records are the authoritative source for every figure above — verify findings against them before acting.</footer>`
  );
}
