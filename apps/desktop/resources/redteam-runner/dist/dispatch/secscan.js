/**
 * Native SecScan engine tool handler: secscan_exec.
 *
 * The seam between the fleet and the vendored SecScan engine
 * (src/secscan/, byte-frozen). Everything the engine needs from the
 * runner is decided here and nowhere else:
 *
 *  - The tool's `depth` argument maps to the engine's own tier strings:
 *    passive → "basic", deep → "deep". The engine's tier is scan DEPTH,
 *    not the runner's autonomy tier — dispatch enforces autonomy tiers
 *    mechanically (tiers.ts classifies secscan_exec argument-sensitively,
 *    on the ladder the retired scan_url wrapper used: passive Tier 0,
 *    deep Tier 1).
 *  - depth=deep is VERIFICATION-GATED. The deep tier's active web app
 *    tests (path traversal, JS secret scanning, deep crawl) fire only
 *    when owner verification is on the engagement record
 *    (ctx.verificationProof, written by the authorize phase). Without
 *    it the handler refuses with an agent-readable reason — the fleet
 *    knows it must get verification from the owner before proceeding.
 *    No service-side verification machinery is ported; the engagement
 *    record is the source of truth. Passive runs on scope alone.
 *  - Findings are mapped into the runner's LiveFinding record shape and
 *    recorded through the same path record_finding uses (shared state +
 *    registry, with the platform's PII redaction and length caps).
 */
import { BATTERY_CATEGORIES } from '../battery.js';
import { isTargetId } from '../targets.js';
import { techniqueAllowed } from '../gate.js';
import { redactPii } from '../safety/index.js';
import { noteCategoryCoverage } from './prelude.js';
import { syncLiveFindingsToState, writeFindingToRegistry } from './verdicts.js';
import { runScan } from '#secscan/scanner.js';
function strArg(args, key) {
    const v = args[key];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
/**
 * ScanVulnerability → LiveFinding, verbatim: severity and title carry
 * over unchanged, the scanner's category becomes the finding's vuln
 * class, and the evidence is the scanner's own evidence text (falling
 * back to its description when the check recorded no separate evidence
 * blob). No rewording, no re-grading — the engine's FP/FN tuning lives
 * in exactly these strings.
 */
export function scanVulnerabilityToFinding(v, attackId) {
    return {
        severity: v.severity,
        title: v.name,
        vulnClass: v.category,
        attackId,
        evidence: v.evidence ?? v.description,
        // Q-RP-3: the scanner's recorded reference data rides along verbatim.
        // Null/absent stays absent — no score is derived or estimated here.
        ...(typeof v.cvssScore === "number" && Number.isFinite(v.cvssScore) ? { cvss: v.cvssScore } : {}),
        ...(typeof v.cweId === "string" && v.cweId.trim() ? { cwe: v.cweId.trim() } : {}),
    };
}
export async function handleSecscanTools(ctx, _role, _phase, call, args) {
    if (call.name !== 'secscan_exec')
        return null;
    const attackId = strArg(args, 'attackId')?.toUpperCase();
    const rawCat = (strArg(args, 'category') ?? '').toLowerCase();
    const category = BATTERY_CATEGORIES.includes(rawCat) ? rawCat : undefined;
    const url = strArg(args, 'url') ?? '';
    if (!techniqueAllowed(attackId, ctx.input.mode, ctx.input.roe, { testMode: ctx.config?.testMode === true })) {
        return { result: `DENIED by ROE: technique ${attackId} is excluded for this engagement.`, attackId, target: url };
    }
    if (!url) {
        return { result: 'DENIED: secscan_exec requires a url (the in-scope target to scan).', attackId, target: url, repairable: "secscan_exec requires a 'url' argument" };
    }
    const depth = args['depth'] === 'deep' ? 'deep' : 'passive';
    if (depth === 'deep' && !ctx.verificationProof) {
        return {
            result: 'DENIED: secscan_exec depth=deep runs verification-gated web app tests (active path traversal, JavaScript secret scanning, deep crawl) that require owner verification on the engagement record. ' +
                'No verification is on record for this engagement. Get verification from the owner that the target is theirs — the authorize phase records it — then run depth=deep again. ' +
                'depth=passive runs on engagement scope alone and needs no verification.',
            attackId,
            target: url,
        };
    }
    const rawTp = (strArg(args, 'targetProfile') ?? '').toLowerCase();
    const targetProfile = isTargetId(rawTp) ? rawTp : 'secscan';
    ctx.probesUsed++;
    noteCategoryCoverage(ctx, category, targetProfile);
    let scan;
    try {
        scan = await runScan(url, depth === 'deep' ? 'deep' : 'basic');
    }
    catch (err) {
        return { result: `secscan_exec failed: ${err.message}`, attackId, target: url, ok: false };
    }
    const findingAttackId = attackId ?? 'T1190';
    for (const v of scan.vulnerabilities) {
        const mapped = scanVulnerabilityToFinding(v, findingAttackId);
        // Same evidence hygiene as record_finding (v0.13.0): PII is redacted
        // and the shared-state length caps apply before anything is recorded.
        const lf = {
            ...mapped,
            title: redactPii(mapped.title.slice(0, 200)),
            evidence: redactPii(mapped.evidence.slice(0, 800)),
            // Q-FLEET-XCHECK: producer = the seat that ran the scan tool.
            producer: _role,
        };
        ctx.liveFindings.push(lf);
        writeFindingToRegistry(ctx, lf);
    }
    if (scan.vulnerabilities.length > 0)
        syncLiveFindingsToState(ctx);
    const counts = new Map();
    for (const v of scan.vulnerabilities)
        counts.set(v.severity, (counts.get(v.severity) ?? 0) + 1);
    const countText = ['critical', 'high', 'medium', 'low', 'info']
        .filter(s => counts.has(s))
        .map(s => `${counts.get(s)} ${s}`)
        .join(', ');
    const lines = scan.vulnerabilities.slice(0, 30).map(v => `- [${v.severity}] ${v.name} (${v.category})`);
    const more = scan.vulnerabilities.length > lines.length ? `\n- …and ${scan.vulnerabilities.length - lines.length} more (all recorded to shared state)` : '';
    const result = `SecScan native scan complete: ${url} → ${scan.finalUrl} (HTTP ${scan.statusCode}, depth=${depth}, ${scan.requestDurationMs}ms). ` +
        `${scan.vulnerabilities.length} findings recorded to shared state + registry${countText ? ` — ${countText}` : ''}. ` +
        `Technologies: ${scan.technologies.join(', ') || '(none fingerprinted)'}. TLS (own probe): ${scan.tlsGrade ?? 'n/a'}.` +
        (lines.length ? `\n${lines.join('\n')}${more}` : '\nNo findings — the passive suite came back clean for this target.');
    return { result, attackId, target: url, ok: true };
}
//# sourceMappingURL=secscan.js.map