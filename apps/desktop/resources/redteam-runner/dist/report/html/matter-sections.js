import { TIER_DEFINITION, TIER_LABEL, TIER_ORDER, esc } from "./tokens.js";
function rowGrid(rows) {
    return (`<dl class="meta-grid">` +
        rows.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`).join("") +
        `</dl>`);
}
function lineBlock(lines) {
    return `<div class="breakdown">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>`;
}
/** Front matter 1 — scope & authorisation: the engagement's recorded
 * frame (ROE lists, the ownership-verification record, the operator of
 * record, the timestamps), stated once, before the narrative. */
export function scopeSection(m) {
    return (`<h2 class="sec-title">Scope &amp; Authorisation</h2>` +
        `<p class="sec-sub">The rules of engagement and the authorisation record, exactly as recorded — nothing here is inferred.</p>` +
        rowGrid([...m.scopeRows, ...m.authorisationRows]));
}
/** Front matter 2 — method & tooling: mode/tier, battery composition,
 * the plan's phases, and the recorded activity volume. */
export function methodSection(m) {
    return `<h2 class="sec-title">Method &amp; Tooling</h2>` + lineBlock(m.methodLines);
}
/** Front matter 3 — risk rating method: how the anchored grade on the
 * cover is produced, with the truth-tier definitions the findings
 * below are grouped by. */
export function riskMethodSection(m) {
    const tiers = TIER_ORDER.map((t) => `<li><strong>${esc(TIER_LABEL[t])}:</strong> ${esc(TIER_DEFINITION[t])}</li>`).join("");
    return (`<h2 class="sec-title">Risk Rating Method</h2>` +
        lineBlock(m.riskMethodLines) +
        `<ul class="limits">${tiers}</ul>`);
}
/** Q-RP-8 — what is working well: executed-clean checks by area and the
 * ruled-out count, from the coverage/proof record. Renders nothing
 * when the derivation found no strength evidence. */
export function strengthsSection(m) {
    if (!m.strengths)
        return "";
    const areas = m.strengths.areaLines.length
        ? `<ul class="limits">${m.strengths.areaLines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`
        : "";
    return (`<h2 class="sec-title">What Is Working Well</h2>` +
        `<p class="sec-sub">${esc(m.strengths.summary)}</p>` +
        areas);
}
/** Back matter — limitations & residual unknowns: what was blocked,
 * left uncovered, or left pending, restated at the close from the same
 * coverage record the Coverage section renders. */
export function limitationsSection(m) {
    return (`<h2 class="sec-title">Limitations &amp; Residual Unknowns</h2>` +
        `<ul class="limits">${m.limitationLines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`);
}
//# sourceMappingURL=matter-sections.js.map