/**
 * Negative proof (killed hypotheses with decisive audit evidence) and the
 * one-line bundle summary for the report.
 */
import { redactSecrets } from '../../host-exec/common.js';
import { PROOF_TOOL_ACTIONS } from './steps.js';
import { bundleFileName } from './bundle.js';
/**
 * Negative proof: for each killed hypothesis, attach the decisive audit
 * events. Buyers value knowing what was tried and ruled out — and the
 * registry already records the killing observation; this grounds it in
 * the actual probe sequence.
 */
export function buildNegativeProof(killed, events, secrets) {
    const redact = (s) => redactSecrets(s, secrets);
    return killed.map((k) => {
        const attack = (k.attackId ?? '').toUpperCase();
        const decisiveEvents = events
            .filter((ev) => {
            if (ev.phase !== 'exploit' && ev.phase !== 'recon')
                return false;
            if (!PROOF_TOOL_ACTIONS.has(ev.action))
                return false;
            if (attack && (ev.attackId ?? '').toUpperCase() !== attack)
                return false;
            return true;
        })
            .slice(-5)
            .map(ev => ({ seq: ev.seq, ts: ev.ts, tool: ev.action, result: redact(ev.result.slice(0, 300)) }));
        return {
            hypothesis: redact(k.hypothesis),
            killingObservation: redact(k.killingObservation),
            attackId: k.attackId,
            vulnClass: k.vulnClass,
            decisiveEvents,
        };
    });
}
/** One-line bundle summary for the report's Proof of exploitation section. */
export function bundleSummary(b) {
    const steps = b.steps.map(s => `seq ${s.seq} ${s.tool}${s.marker ? ` (marker ${s.marker})` : ''}`).join('; ');
    return (`**${b.findingId}** — ${b.title} [${b.severity}] (${b.validationTier} proof). ` +
        `${b.proves} Steps (${b.steps.length}): ${steps}. ` +
        `Bundle: poc/${bundleFileName(b.findingId)}. Re-verify: \`${b.reverifyCommand}\``);
}
//# sourceMappingURL=negative.js.map