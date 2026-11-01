/**
 * Finding cards and proof blocks (design study D6/D7).
 *
 * Tier discipline is the honesty core of the design: the PROVEN badge is
 * keyed to a PoC bundle whose validationTier is "execution" (the runner's
 * replayable, marker-backed proof) or to the exploit-cell's adjudicated
 * verdict carried on the finding (Q-PROVEN) — never to a severity, a
 * confidence word, or the scoring seam. A confirmed finding with no bundle says so,
 * with the reason the runner computed. Nothing is derived or guessed:
 * reference chips render only from fields the record actually carries.
 */
import { type Finding } from "../../types.js";
import { type PocBundle, type NegativeProof } from "../../proof/index.js";
import { SEVERITY_ORDER, SEVERITY_TOKENS, TIER_LABEL, esc, type ReportTier, type SeverityName } from "./tokens.js";

/** Optional per-finding reference data, present only where a real record
 * carries it (battery item resolution in the report phase, or a bundle). */
export interface FindingMeta {
  category?: string;
  owasp?: string;
  cwe?: string;
  cvss?: number;
}

/** The truth tier a finding renders under. PROVEN requires a runner
 * stamp: an execution-tier bundle, or the cell's adjudicated verdict. */
export function tierOf(f: Finding, bundle?: PocBundle): ReportTier {
  if (bundle?.validationTier === "execution" || f.cellState === "proven") return "proven";
  if (f.status === "confirmed") return "confirmed";
  if (f.status === "deferred") return "deferred";
  return "ruled-out";
}

/** The severity chip, shared with the detail sections (area/pillar rows). */
export function severityChip(sev: string): string {
  const s = (SEVERITY_ORDER as readonly string[]).includes(sev) ? (sev as SeverityName) : "info";
  return `<span class="sevchip chip-${s}">${SEVERITY_TOKENS[s].label}</span>`;
}

function tierBadge(tier: ReportTier): string {
  const mark = tier === "proven" || tier === "confirmed" ? "✓ " : "";
  return `<span class="tier-badge ${tier}">${mark}${TIER_LABEL[tier].toUpperCase()}</span>`;
}

function refChip(text: string): string {
  return `<span class="refchip">${esc(text)}</span>`;
}

/** Wrap occurrences of the observed marker in <mark> — the analogue of
 * Seclayer's verbatim-quote highlight: the substring IS the proof. */
function highlightMarker(escapedText: string, marker?: string): string {
  if (!marker) return escapedText;
  const m = esc(marker);
  if (!m || !escapedText.includes(m)) return escapedText;
  return escapedText.split(m).join(`<mark>${m}</mark>`);
}

/** The evidence receipt (D7): heading by validation tier, what it proves,
 * the marker line, the ordered redacted steps, what it does NOT prove,
 * and the reverify command. Observation receipts are never badged proven. */
export function proofBlock(bundle: PocBundle): string {
  const execTier = bundle.validationTier === "execution";
  const head = execTier ? "Exploit Receipt — Proven Live" : "Observation Receipt — Captured Steps";
  const stepsText = bundle.steps
    .map((s) => `#${s.seq} ${s.tool}${s.attackId ? ` (${s.attackId})` : ""}\n$ ${s.command}\n${s.result}`)
    .join("\n\n");
  const steps = highlightMarker(esc(stepsText), bundle.markerObserved);
  const marker = bundle.markerSent
    ? `<p class="marker-line">Marker sent: ${esc(bundle.markerSent)}` +
      (bundle.markerObserved ? ` → observed: <mark>${esc(bundle.markerObserved)}</mark>` : " → not observed") +
      `</p>`
    : "";
  const rid = `reverify-${bundle.findingId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  return (
    `<div class="proof ${execTier ? "exec" : "obs"}">` +
    `<div class="proof-head">${head}</div><div class="proof-body">` +
    `<p>${esc(bundle.proves)}</p>` +
    marker +
    (steps ? `<div class="steps">${steps}</div>` : "") +
    `<p class="doesnot">Does not prove: ${esc(bundle.doesNotProve)}</p>` +
    `<div class="reverify" id="${rid}">Reverify: ${esc(bundle.reverifyCommand)}</div>` +
    `<button class="copybtn" data-copy="${rid}" type="button">Copy reverify command</button>` +
    `</div></div>`
  );
}

/** The Cell Receipt (Q-PROVEN): the proof block for a cell-proven finding
 * with no execution bundle to show. The verdict is the runner's cell stamp
 * (challenger critique + verification signatures + a passing negative
 * control); the block shows the record the adjudication retained — the
 * expected marker, the target it was observed at, and the adjudication
 * detail line. Every interpolated value passes through esc(): the marker
 * is agent-chosen free text, never injected raw. */
export function cellReceiptBlock(f: Finding): string {
  if (!f.provenClaim) return "";
  const detail = f.cellDetail ?? "Challenger critique + verification signed, negative control passed.";
  return (
    `<div class="proof exec">` +
    `<div class="proof-head">Cell Receipt — Proven Live</div><div class="proof-body">` +
    `<p>Exploit-cell adjudication: expected marker <mark>${esc(f.provenClaim.expectedMarker)}</mark> observed at ${esc(f.provenClaim.targetUrl)}.</p>` +
    `<p>${esc(detail)}</p>` +
    `</div></div>`
  );
}

export interface CardInput {
  finding: Finding;
  bundle?: PocBundle;
  /** Runner-computed reason a confirmed finding has no bundle. */
  noBundleReason?: string;
  meta?: FindingMeta;
  /** Q-RP-4 — the mechanically derived per-finding Impact statement
   * (report/detail-impact.ts), present only for findings of record. */
  impact?: string;
}

/** One finding card (D6): chip row, evidence body, proof block or the
 * honest no-bundle line, remediation fix + retest, accountability footer. */
export function findingCard(o: CardInput): string {
  const f = o.finding;
  const tier = tierOf(f, o.bundle);
  const chips: string[] = [severityChip(f.severity), tierBadge(tier)];
  for (const a of f.attackIds) chips.push(refChip(a));
  if (o.meta?.category) chips.push(refChip(o.meta.category));
  if (o.meta?.owasp) chips.push(refChip(o.meta.owasp));
  if (o.bundle?.cve) chips.push(refChip(o.bundle.cve));
  if (o.meta?.cwe) chips.push(refChip(o.meta.cwe));
  if (typeof o.meta?.cvss === "number") chips.push(refChip(`CVSS ${o.meta.cvss.toFixed(1)}`));

  let body = "";
  if (o.bundle) {
    body += proofBlock(o.bundle);
    // Q-PROVEN refinement: an observation-tier bundle under a cell-PROVEN
    // stamp would pair the PROVEN badge with a receipt head that says it
    // is never badged proven — append the Cell Receipt after the bundle
    // block. An execution bundle already proves the finding; it stands
    // alone, unchanged.
    if (o.bundle.validationTier !== "execution" && f.cellState === "proven" && f.provenClaim)
      body += cellReceiptBlock(f);
  } else if (f.cellState === "proven" && f.provenClaim) body += cellReceiptBlock(f);
  else if (f.status === "confirmed" && o.noBundleReason)
    body += `<p class="no-bundle">No replayable bundle — ${esc(o.noBundleReason)}</p>`;
  if (f.fix) {
    body +=
      `<div class="fixblock"><div class="fb-head">Remediation Fix</div>` +
      `<div class="fb-body">${esc(f.fix)}</div>` +
      (f.retest ? `<p class="retest"><strong>Retest:</strong> ${esc(f.retest)}</p>` : "") +
      `</div>`;
  }
  const foot: string[] = [];
  if (f.accountableOperator) foot.push(`Accountable: ${esc(f.accountableOperator)}`);
  if (o.bundle?.batteryItemId) foot.push(`Battery item: ${esc(o.bundle.batteryItemId)}`);

  return (
    `<article class="card ${tier}" id="finding-${esc(f.id)}">` +
    `<div class="card-top">${chips.join("")}` +
    `<span class="card-title">${esc(f.title)}</span>` +
    `<span class="card-id">${esc(f.id)}</span></div>` +
    (f.evidence ? `<div class="ev-body">${esc(f.evidence)}</div>` : "") +
    (o.impact
      ? `<div class="fixblock impactblock"><div class="fb-head">Impact</div><div class="fb-body">${esc(o.impact)}</div></div>`
      : "") +
    body +
    (foot.length ? `<div class="card-foot">${foot.join(" · ")}</div>` : "") +
    `</article>`
  );
}

/** A ruled-out hypothesis rendered from its negative proof: the decisive
 * observation is the content — negative proof is presented, never deleted. */
export function negativeProofCard(n: NegativeProof): string {
  const chips: string[] = [tierBadge("ruled-out")];
  if (n.attackId) chips.push(refChip(n.attackId));
  if (n.vulnClass) chips.push(refChip(n.vulnClass));
  const events = n.decisiveEvents.length
    ? `<div class="steps">${esc(
        n.decisiveEvents.map((e) => `seq ${e.seq} ${e.tool}: ${e.result}`).join("\n"),
      )}</div>`
    : "";
  return (
    `<article class="card ruled-out">` +
    `<div class="card-top">${chips.join("")}` +
    `<span class="card-title">${esc(n.hypothesis)}</span></div>` +
    `<div class="ev-body">Decisive observation: ${esc(n.killingObservation)}</div>` +
    events +
    `</article>`
  );
}

/** Severity rank for in-tier sorting (critical first); unknown → last. */
export function severityRank(sev: string): number {
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(sev);
  return i === -1 ? SEVERITY_ORDER.length : i;
}
