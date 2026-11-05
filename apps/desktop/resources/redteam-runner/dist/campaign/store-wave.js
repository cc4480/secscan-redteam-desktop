/**
 * Campaign store — the wave lifecycle.
 *
 * Extracted verbatim from store.ts in a structural split (no file under
 * src/ may exceed 300 lines): launch bookkeeping (beginWave), the
 * mechanical rollup, outcome harvest (recordWaveOutcome) and the
 * executor's failure settlement (settleFailedWave). Every function keeps
 * its original body, ordering and status mapping; the record spine and
 * I/O it runs on lives in store-io.ts. No logic changed in the move.
 */
import { CampaignStoreError, applyCampaignTransition, iso, loadCampaign, transactCampaign } from './store-io.js';
import { WAVE_SEVERITIES } from './schema.js';
/**
 * Mark a wave launched: the wave becomes "running" with its engagement
 * id and launch time; the campaign moves to "wave-running". The gate
 * (gate.ts assertLaunchAllowed) is consulted by the caller BEFORE this —
 * beginWave enforces launch bookkeeping, not authorization. Throws if
 * the wave was already launched (any non-"planned" state).
 */
export function beginWave(campaignsDir, campaignId, waveIndex, input, now = new Date()) {
    return transactCampaign(campaignsDir, campaignId, (rec) => {
        let wave = rec.waves.find(w => w.index === waveIndex);
        if (wave && wave.status !== 'planned') {
            throw new CampaignStoreError(`wave ${waveIndex} of campaign ${campaignId} was already launched (status ${wave.status})`);
        }
        if (!wave) {
            wave = { index: waveIndex, status: 'planned' };
            rec.waves.push(wave);
            rec.waves.sort((a, b) => a.index - b.index);
        }
        wave.status = 'running';
        wave.engagementId = input.engagementId;
        wave.launchedAt = iso(now);
        if (input.aim !== undefined)
            wave.aim = input.aim;
        if (input.planRef !== undefined)
            wave.planRef = input.planRef;
        applyCampaignTransition(rec, 'wave-running', `wave ${waveIndex} launched (engagement ${input.engagementId})`, { waveIndex, now });
        return wave;
    }, now);
}
/** Mechanical rollup over a finished engagement's findings. */
export function computeRollup(findings) {
    const bySeverity = {};
    for (const sev of WAVE_SEVERITIES)
        bySeverity[sev] = 0;
    const rollup = {
        totalFindings: 0,
        confirmed: 0,
        killed: 0,
        deferred: 0,
        bySeverity,
    };
    for (const f of findings) {
        rollup.totalFindings += 1;
        if (f.status === 'confirmed')
            rollup.confirmed += 1;
        else if (f.status === 'killed')
            rollup.killed += 1;
        else if (f.status === 'deferred')
            rollup.deferred += 1;
        if (f.severity in bySeverity)
            bySeverity[f.severity] += 1;
    }
    return rollup;
}
const TERMINAL_WAVE_STATUS = {
    complete: 'complete',
    halted: 'halted',
    blocked: 'halted',
};
/**
 * Harvest a finished engagement into its wave record: outcome + rollup
 * land, the wave takes the mapped terminal status, and the campaign
 * moves to "complete" when the wave cap is reached, else
 * "awaiting-advance". Throws on a non-terminal engagement status — an
 * outcome is only ever recorded for a finished run.
 */
export function recordWaveOutcome(campaignsDir, campaignId, waveIndex, result, now = new Date()) {
    const waveStatus = TERMINAL_WAVE_STATUS[result.status];
    if (!waveStatus) {
        throw new CampaignStoreError(`engagement status ${JSON.stringify(result.status)} is not terminal — a wave outcome is recorded only for a finished engagement`);
    }
    return transactCampaign(campaignsDir, campaignId, (rec) => {
        const wave = rec.waves.find(w => w.index === waveIndex);
        if (!wave) {
            throw new CampaignStoreError(`wave ${waveIndex} of campaign ${campaignId} does not exist`);
        }
        if (wave.status !== 'running') {
            throw new CampaignStoreError(`wave ${waveIndex} of campaign ${campaignId} is ${wave.status}, not running — no outcome can be harvested`);
        }
        const outcome = {
            engagementStatus: result.status,
            ...(result.blockedReason !== undefined ? { blockedReason: result.blockedReason } : {}),
            ...(result.reportPath !== undefined ? { reportPath: result.reportPath } : {}),
            rollup: computeRollup(result.findings),
        };
        wave.outcome = outcome;
        wave.status = waveStatus;
        wave.finishedAt = iso(now);
        const capped = waveIndex >= rec.caps.maxWaves;
        applyCampaignTransition(rec, capped ? 'complete' : 'awaiting-advance', capped
            ? `wave ${waveIndex} finished (${result.status}); campaign wave cap ${rec.caps.maxWaves} reached`
            : `wave ${waveIndex} finished (${result.status})`, { waveIndex, now });
        return wave;
    }, now);
}
/**
 * Settle a wave whose engagement call THREW before producing an
 * EngagementResult (the executor's failure path): the wave becomes
 * "failed" with an outcome whose engagementStatus is "error" and whose
 * blockedReason carries the thrown message — the record shows the
 * launch happened and how it died, and the wave never sits "running"
 * forever. The campaign moves on exactly as for a harvested outcome
 * (cap → "complete", else "awaiting-advance"). Returns the settled
 * wave, or null when the wave was not running (already settled).
 */
export function settleFailedWave(campaignsDir, campaignId, waveIndex, message, now = new Date()) {
    const existing = loadCampaign(campaignsDir, campaignId);
    const existingWave = existing.waves.find(w => w.index === waveIndex);
    if (!existingWave || existingWave.status !== 'running')
        return null;
    return transactCampaign(campaignsDir, campaignId, (rec) => {
        const wave = rec.waves.find(w => w.index === waveIndex);
        if (!wave || wave.status !== 'running')
            return null;
        wave.status = 'failed';
        wave.finishedAt = iso(now);
        wave.outcome = {
            engagementStatus: 'error',
            blockedReason: message,
            rollup: computeRollup([]),
        };
        applyCampaignTransition(rec, waveIndex >= rec.caps.maxWaves ? 'complete' : 'awaiting-advance', `wave ${waveIndex} failed: ${message}`, { waveIndex, now });
        return wave;
    }, now);
}
//# sourceMappingURL=store-wave.js.map