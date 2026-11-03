/**
 * High-quality HTML rendering for engagement reports.
 *
 * The runner already writes report.md, compliance-pack.md, attestation.md and
 * safety-manifest.md. Those stay — they are the diffable, greppable record and
 * the input to other tooling. This renders the same content as a self-contained
 * HTML document meant to be read by a person, opened in a browser, and printed.
 *
 * Deliberate properties:
 *
 *   - Self-contained. No CDN, no web fonts, no external images. A pentest report
 *     is read on client networks, in air-gapped review, and years after the
 *     engagement; a stylesheet that 404s turns a deliverable into a wall of
 *     unstyled text. Everything is inlined.
 *   - Safe. Body markdown goes through the same renderer the UI uses, which
 *     escapes all raw HTML and restricts links to http(s). Finding text embeds
 *     target-derived strings, so this is not a nicety.
 *   - Dark/light aware via prefers-color-scheme, with print rules that force
 *     light and drop interactive chrome, so "print to PDF" produces something
 *     worth sending without editing.
 *   - Severity colour-coded at the source. A reader scanning for the critical
 *     item should not have to read every line to find it.
 */

import { renderMarkdown } from "../ui/markdown.js";
import { renderHtmlDocument } from "./html/shell.js";
import { type Ctx } from "../context.js";
import { type Finding } from "../types.js";
import { resolveOperatorName } from "../accountability/index.js";

export interface ReportMeta {
  engagementId: string;
  target: string;
  mode: string;
  environment: string;
  tier: number;
  operator?: string;
  client?: string;
  status: string;
  phase: string;
  verified: boolean;
  objective: string;
  startedAt: string;
  generatedAt: string;
  /** The recorded same-engine predecessor this report diffs against
   * (spec §1.2), when one exists. score/grade absent => the baseline
   * predates recorded scores and the diff renders counts-only. */
  baseline?: { engagementId: string; startedAt: string; score?: number; grade?: string };
  /** Counts shown in the summary strip. */
  findings?: { critical: number; high: number; medium: number; low: number; info: number };
  battery?: { total: number; confirmed: number; executedClean: number; killed: number; blocked: number; na: number; pending: number };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}


/**
 * Colour the severity tags the report already writes, without emitting markup in
 * a way that can land inside an attribute or a code block.
 *
 * The match runs on the MARKDOWN source, against the one unambiguous form the
 * report uses — a bracketed `[critical]`/`[high]`/`[medium]`/`[low]`/`[info]`
 * tag — and produces a NUL sentinel that survives the renderer's HTML escaping
 * untouched. The `<span>` is substituted only AFTER rendering, so it can never
 * appear inside an href or a `<code>` the renderer built. Colouring over
 * finished HTML (a regex over the whole document) is what corrupted links and
 * code by matching the word "high" inside `…/high-risk` URLs.
 */
function decorateSeverity(markdown: string): { body: string; tokens: string[] } {
  const tokens: string[] = [];
  const body = markdown.replace(/\[(critical|high|medium|low|info)\]/gi, (_m, word: string) => {
    tokens.push(word);
    return `\u0000SEV${tokens.length - 1}\u0000`;
  });
  return { body, tokens };
}

export interface RenderHtmlOptions {
  /** Document title, shown as the page title and the H1. */
  title: string;
  /** Short line under the title. */
  subtitle?: string;
  meta: ReportMeta;
  /** The report body, as markdown. */
  markdown: string;
  /** Show the finding/battery summary strip. Off for attestation and manifests. */
  showStrip?: boolean;
}

/**
 * Build the metadata block shared by every HTML artifact, from the engagement
 * context. Severity counts are derived from the findings; battery figures are
 * passed in when the caller has them (the report does, the manifest does not).
 *
 * `ctx.events.state` is private; the snapshot getter is the supported read path
 * and copies findings so nothing here can mutate the live state.
 */
export function buildEngagementMeta(
  ctx: Ctx,
  findings: Finding[],
  battery?: ReportMeta["battery"],
): ReportMeta {
  const snap = ctx.events.snapshot;
  const counts: NonNullable<ReportMeta["findings"]> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    // Coerce and guard against prototype keys: a finding with severity "High"
    // must still count, and `"constructor" in counts` must not read a prototype.
    const sev = String(f.severity ?? "").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(counts, sev)) counts[sev as keyof typeof counts]++;
  }
  return {
    engagementId: ctx.events.engagementId,
    target: ctx.input.target,
    mode: ctx.input.mode,
    environment: ctx.input.environment ?? "staging",
    tier: ctx.tier.current,
    operator: resolveOperatorName(ctx.input.operatorName),
    client: ctx.input.client,
    status: snap.status,
    phase: snap.phase,
    verified: snap.verified,
    objective: ctx.input.objective,
    startedAt: snap.startedAt,
    generatedAt: new Date().toISOString(),
    findings: counts,
    battery,
  };
}

export function renderReportHtml(o: RenderHtmlOptions): string {
  const m = o.meta;
  const decorated = decorateSeverity(o.markdown);
  const body = renderMarkdown(decorated.body).replace(/\u0000SEV(\d+)\u0000/g, (_m, i: string) => {
    const word = decorated.tokens[Number(i)];
    return word ? `<span class="sev sev-${word.toLowerCase()}">${word}</span>` : "";
  });

  const cells: string[] = [];
  if (o.showStrip !== false) {
    const f = m.findings;
    if (f) {
      for (const [k, label, cls] of [
        ["critical", "Critical", "crit"], ["high", "High", "high"],
        ["medium", "Medium", "med"], ["low", "Low", "low"], ["info", "Info", "info"],
      ] as const) {
        cells.push(`<div class="cell ${cls}"><div class="n">${f[k]}</div><div class="k">${label}</div></div>`);
      }
    }
    const b = m.battery;
    if (b) {
      cells.push(`<div class="cell ok"><div class="n">${b.confirmed}</div><div class="k">Confirmed</div></div>`);
      cells.push(`<div class="cell"><div class="n">${b.executedClean}</div><div class="k">Clean</div></div>`);
      cells.push(`<div class="cell"><div class="n">${b.killed}</div><div class="k">Ruled out</div></div>`);
      cells.push(`<div class="cell warn"><div class="n">${b.pending}</div><div class="k">Pending</div></div>`);
    }
  }

  const statusPill =
    m.status === "complete" ? "ok" : m.status === "halted" || m.status === "blocked" ? "bad" : "warn";

  return renderHtmlDocument({
    title: `${o.title} — ${m.target}`,
    body: `
<header class="doc">
  <div class="eyebrow">SecScan RedTeam${m.client ? ` &middot; ${esc(m.client)}` : ""}</div>
  <h1>${esc(o.title)}</h1>
  ${o.subtitle ? `<p class="sub">${esc(o.subtitle)}</p>` : ""}
  <div class="meta">
    <div><dt>Target</dt><dd>${esc(m.target)}</dd></div>
    <div><dt>Engagement</dt><dd>${esc(m.engagementId)}</dd></div>
    <div><dt>Status</dt><dd><span class="pill ${statusPill}">${esc(m.status)}</span></dd></div>
    <div><dt>Mode</dt><dd>${esc(m.mode)} &middot; tier ${m.tier} &middot; ${esc(m.environment)}</dd></div>
    <div><dt>Authorisation</dt><dd>${m.verified ? '<span class="pill ok">ownership verified</span>' : '<span class="pill bad">not verified</span>'}</dd></div>
    ${m.operator ? `<div><dt>Operator</dt><dd>${esc(m.operator)}</dd></div>` : ""}
    <div><dt>Started</dt><dd>${esc(m.startedAt)}</dd></div>
    <div><dt>Generated</dt><dd>${esc(m.generatedAt)}</dd></div>
  </div>
  ${cells.length ? `<div class="strip">${cells.join("")}</div>` : ""}
</header>
<main>
<p><strong>Objective.</strong> ${esc(m.objective)}</p>
${body}
</main>
<footer class="doc">
  Generated by SecScan RedTeam from the engagement audit log. Machine-readable
  records — <code>state.json</code>, <code>item-verdicts.json</code>,
  <code>events.jsonl</code> — sit alongside this file and are the authoritative
  source for every figure above. Verify findings against them before acting.
</footer>
`,
  });
}
