import { probeSqlInjection } from "./redTeam/sqlInjection.js";
import { probeReflectedXss } from "./redTeam/reflectedXss.js";
import { probeCommandInjection } from "./redTeam/commandInjection.js";
import { probeSsrf } from "./redTeam/ssrf.js";
import { probeBlindSsrf } from "./redTeam/blindSsrf.js";
import { PROBE_DESCRIPTORS, emitProbeFiring, emitProbeResult } from "./probeDescriptors.js";
// Ordered exactly as before: SQLi → XSS → cmd injection → reflected SSRF → blind
// OOB SSRF. probeBlindSsrf no-ops on its own when no collaborator is configured.
export const PROBES = [
    probeSqlInjection,
    probeReflectedXss,
    probeCommandInjection,
    probeSsrf,
    probeBlindSsrf,
];
// Number of distinct root-URL red-team probe types (for scan-coverage reporting).
export const RED_TEAM_PROBE_COUNT = PROBES.length;
export async function runRedTeamProbes(url, headers, opts = {}) {
    const ctx = {
        url,
        fuzzHeaders: { ...headers, "Cache-Control": "no-cache" },
        oob: opts.oob,
        scanId: opts.scanId,
    };
    const findings = [];
    for (const probe of PROBES) {
        const desc = PROBE_DESCRIPTORS[probe.name];
        try {
            emitProbeFiring(opts.emit, desc);
            const finding = await probe(ctx);
            emitProbeResult(opts.emit, desc, finding);
            if (finding)
                findings.push(finding);
        }
        catch (err) {
            // One probe's failure (fetch error, malformed response) must never stop
            // the rest. The original inline version swallowed each probe's errors the
            // same way; the log line preserves that visibility.
            console.warn(`[redteam] probe ${probe.name} failed:`, err);
        }
    }
    return findings;
}
