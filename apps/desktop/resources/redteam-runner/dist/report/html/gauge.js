/**
 * Score + severity visuals: the 270° gauge (Seclayer's ScoreGauge, at
 * SecScan's cover scale), the stacked SeverityBar, and the severity count
 * chips. All colours read the token table (tokens.ts) — the bar, the chips,
 * and the cards can never disagree about what a severity looks like.
 *
 * Gauge semantics are POSTURE (higher is better, the embedded engine's
 * math) — never SecScan's inverted risk label.
 */
import { SEVERITY_ORDER, SEVERITY_TOKENS, SECURE_HEX, gradeToken, esc } from "./tokens.js";
const CX = 88;
const CY = 88;
const R = 70;
function polar(angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: CX + R * Math.cos(rad), y: CY + R * Math.sin(rad) };
}
/** SVG arc path for a sweep starting at 135° (bottom-left), clockwise. */
function arcPath(sweepDeg) {
    if (sweepDeg <= 0)
        return "";
    const start = polar(135);
    const end = polar(135 + Math.min(sweepDeg, 269.9));
    const large = sweepDeg > 180 ? 1 : 0;
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}
/**
 * The cover gauge: recessive track, grade-coloured arc, hero score with
 * /100, caption "Grade {letter} — {word}". N/A renders "— / Incomplete" on
 * a near-empty neutral gauge: a scan that could not be graded never shows
 * a passing number.
 */
export function scoreGauge(o) {
    const tok = gradeToken(o.grade);
    const na = o.score === null;
    const sweep = na ? 8 : (Math.max(0, Math.min(100, o.score ?? 0)) / 100) * 270;
    const hero = na ? "—" : String(Math.round(o.score ?? 0));
    return (`<div class="gauge" style="--grade:${tok.hex};--grade-print:${tok.printHex}">` +
        `<svg width="176" height="176" viewBox="0 0 176 176" role="img" aria-label="Security score ${na ? "not available" : `${hero} of 100`}, grade ${esc(o.grade)}">` +
        `<path d="${arcPath(270)}" fill="none" stroke="#27272a" stroke-width="11" stroke-linecap="round"/>` +
        (sweep > 0 ? `<path class="gauge-arc" d="${arcPath(sweep)}" fill="none" stroke-width="11" stroke-linecap="round"/>` : "") +
        `</svg>` +
        `<div class="gauge-num"><div class="gauge-score">${hero}<small>/100</small></div>` +
        `<div class="gauge-grade">Grade ${esc(o.grade)} — ${esc(tok.word)}</div></div></div>`);
}
/** Stacked proportional severity bar, worst-first; an all-clear state
 * renders a green-tinted recessive track so the baseline stays consistent. */
export function severityBar(counts) {
    const total = SEVERITY_ORDER.reduce((n, s) => n + (counts[s] ?? 0), 0);
    if (total === 0)
        return `<div class="sevbar empty" role="img" aria-label="No findings"></div>`;
    const segs = SEVERITY_ORDER.filter((s) => (counts[s] ?? 0) > 0)
        .map((s) => {
        const pct = ((counts[s] ?? 0) / total) * 100;
        return `<div style="width:${pct.toFixed(2)}%;background:${SEVERITY_TOKENS[s].hex}" title="${counts[s]} ${SEVERITY_TOKENS[s].label}"></div>`;
    })
        .join("");
    return `<div class="sevbar" role="img" aria-label="Severity distribution">${segs}</div>`;
}
/** The at-a-glance count row: one chip per severity, count in a dark inset
 * box (SecScan's badge row, Seclayer's tokens). */
export function severityChips(counts) {
    const chips = SEVERITY_ORDER.map((s) => `<span class="sevchip chip-${s}">${SEVERITY_TOKENS[s].label}<span class="n">${counts[s] ?? 0}</span></span>`).join("");
    return `<div class="sevrow">${chips}</div>`;
}
/** Green used by non-token call sites (all-clear, proven accents). */
export const SECURE = SECURE_HEX;
//# sourceMappingURL=gauge.js.map