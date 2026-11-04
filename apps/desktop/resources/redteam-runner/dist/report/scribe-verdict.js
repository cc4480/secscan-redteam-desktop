/**
 * Scribe verdict primitives — extracted from scribe.ts to keep the gate module
 * under the 300-line budget. Pure: the verdict shape, the cycle knob, and the
 * answer parser. Nothing here touches the model or the engagement state.
 */
import { resolveKnobs } from '@secscan/redteam-fleet-skills';
import { extractJsonBlock } from '../util.js';
const DEFECT_CLASSES = ['accuracy', 'completeness', 'craft'];
/**
 * The Scribe's reject/rewrite budget: the SCRIBE_MAX_CYCLES fleet knob
 * (default 2). The runner carries no charter/engagement knob files, so
 * the package defaults govern — the same sources the prompt assembly
 * resolves.
 *
 * @returns the maximum review cycles per completed close, at least 1
 */
export function scribeMaxCycles() {
    const raw = Number.parseInt(resolveKnobs().values['SCRIBE_MAX_CYCLES'] ?? '2', 10);
    return Number.isFinite(raw) && raw >= 1 ? raw : 2;
}
/**
 * Parse the seat's verdict answer. Anything off-shape is null — the
 * caller records an unavailable seat, never a guessed verdict. A sign
 * carries no defects (a signed set with open defects is a contradiction);
 * a reject must name at least one well-formed defect to be actionable.
 *
 * @param text - the completion text
 * @returns the parsed verdict, or null when off-shape
 */
export function parseScribeVerdict(text) {
    const parsed = extractJsonBlock(text);
    if (!parsed || (parsed.verdict !== 'sign' && parsed.verdict !== 'reject'))
        return null;
    if (parsed.verdict === 'sign')
        return { verdict: 'sign', defects: [] };
    const defects = [];
    for (const raw of Array.isArray(parsed.defects) ? parsed.defects : []) {
        const d = raw;
        if (!d || typeof d.file !== 'string' || typeof d.detail !== 'string' || typeof d.fix !== 'string')
            continue;
        defects.push({
            file: d.file.slice(0, 100),
            class: DEFECT_CLASSES.includes(d.class ?? '') ? d.class : 'accuracy',
            detail: d.detail.slice(0, 500),
            fix: d.fix.slice(0, 500),
        });
    }
    return defects.length > 0 ? { verdict: 'reject', defects } : null;
}
//# sourceMappingURL=scribe-verdict.js.map