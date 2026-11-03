/**
 * Campaign store (Q-CAMPAIGN, scoping N2).
 *
 * Directory-per-campaign (scoping D-2): `<campaignsDir>/<id>/campaign.json`
 * holds the one versioned record; wave plan artifacts may live alongside
 * it in `wave-<n>/` subdirectories (the planner's territory). The record
 * is the single source of truth for campaign state.
 *
 * Discipline, following the registry store's precedent:
 *  - Synchronous transact: load → mutate → validate → atomic save, so
 *    within one process two writers can never silently lose each other.
 *  - Atomic file replacement (tmp + rename): a crash mid-save leaves the
 *    prior record byte-identical, never a torn half-record.
 *  - No delete, no silent overwrite: creating over an existing campaign
 *    is an error, and a corrupt record fails loud at load (schema.ts).
 *  - Every status change is written through a transition entry — the
 *    record's audit spine cannot be skipped by a caller.
 *
 * Restart honesty (resumeCampaigns): a wave still marked "running" when
 * a new process loads the store was stranded by the old process's death.
 * It is marked "interrupted" — with when and why — and the campaign
 * returns to "awaiting-advance" for an operator decision. An interrupted
 * wave is NEVER silently counted complete, and its engagementId (what
 * was actually launched) stays on the record.
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, } from 'node:fs';
import { dirname, join } from 'node:path';
import { CampaignSchemaError, isForbiddenKind, isSafeCampaignId, validateCampaignRecord, WAVE_SEVERITIES, } from './schema.js';
export class CampaignStoreError extends Error {
    constructor(message) {
        super(`[campaign] ${message}`);
        this.name = 'CampaignStoreError';
    }
}
export const CAMPAIGN_FILE_NAME = 'campaign.json';
/** Mirror of config.ts resolution: opts → REDTEAM_CAMPAIGNS_DIR →
 *  REDTEAM_HOME/engagements/campaigns → cwd/engagements/campaigns.
 *  Campaigns sit beside the registry under the engagements home (D-6). */
export function resolveCampaignsDir(opts = {}) {
    const env = opts.env ?? process.env;
    if (opts.campaignsDir)
        return opts.campaignsDir;
    if (env['REDTEAM_CAMPAIGNS_DIR'])
        return env['REDTEAM_CAMPAIGNS_DIR'];
    const home = env['REDTEAM_HOME'];
    const base = home ? join(home, 'engagements') : join(opts.cwd ?? process.cwd(), 'engagements');
    return join(base, 'campaigns');
}
export function campaignDir(campaignsDir, campaignId) {
    return join(campaignsDir, campaignId);
}
export function campaignFile(campaignsDir, campaignId) {
    return join(campaignDir(campaignsDir, campaignId), CAMPAIGN_FILE_NAME);
}
function iso(now) {
    return now.toISOString();
}
/** Atomic replace: write a sibling tmp file, then rename over the
 *  target. A crash between the two leaves the old record intact. */
function atomicWriteFileSync(path, content) {
    const tmp = `${path}.tmp-${process.pid}`;
    try {
        writeFileSync(tmp, content);
        renameSync(tmp, path);
    }
    catch (err) {
        try {
            rmSync(tmp, { force: true });
        }
        catch {
            /* tmp already gone — the original error is the one that matters */
        }
        throw err;
    }
}
/** Validate then persist a record (normalized form is what lands). */
export function saveCampaignFile(path, rec) {
    const normalized = validateCampaignRecord(rec);
    mkdirSync(dirname(path), { recursive: true });
    atomicWriteFileSync(path, JSON.stringify(normalized, null, 2));
}
/** Load + validate one campaign record file. Throws CampaignSchemaError
 *  on a missing, unparsable, or invalid record — fail loud, never a
 *  quietly-invented empty campaign. */
export function loadCampaignFile(path) {
    let rawText;
    try {
        rawText = readFileSync(path, 'utf8');
    }
    catch (err) {
        throw new CampaignSchemaError(`campaign record unreadable at ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(rawText);
    }
    catch (err) {
        throw new CampaignSchemaError(`campaign record is not valid JSON at ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return validateCampaignRecord(parsed);
}
export function loadCampaign(campaignsDir, campaignId) {
    if (!isSafeCampaignId(campaignId)) {
        throw new CampaignStoreError(`unsafe campaign id: ${JSON.stringify(campaignId)}`);
    }
    return loadCampaignFile(campaignFile(campaignsDir, campaignId));
}
/** Ids of all campaigns with a record file under campaignsDir, sorted.
 *  A missing campaigns directory is an empty store, not an error. */
export function listCampaignIds(campaignsDir) {
    if (!existsSync(campaignsDir))
        return [];
    return readdirSync(campaignsDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && existsSync(join(campaignsDir, e.name, CAMPAIGN_FILE_NAME)))
        .map(e => e.name)
        .sort();
}
/**
 * Create a new campaign in "draft" with auto-advance OFF (C-1 default)
 * and the creation transition recorded. Throws if a campaign with this
 * id already exists — creation never overwrites an existing record.
 */
export function createCampaign(campaignsDir, input, now = new Date()) {
    if (!isSafeCampaignId(input.id)) {
        throw new CampaignStoreError(`unsafe campaign id: ${JSON.stringify(input.id)}`);
    }
    if (typeof input.kind !== 'string' || input.kind.trim() === '') {
        throw new CampaignStoreError('campaign kind must be a non-empty string');
    }
    if (isForbiddenKind(input.kind)) {
        throw new CampaignStoreError('the "ad" kind is forbidden in this product (manifest Part C)');
    }
    if (!input.scope || !Array.isArray(input.scope.hosts) || input.scope.hosts.length === 0) {
        throw new CampaignStoreError('campaign scope.hosts must be a non-empty array — a campaign binds one verified scope');
    }
    if (typeof input.scope.verificationRef !== 'string' || input.scope.verificationRef.trim() === '') {
        throw new CampaignStoreError('campaign scope.verificationRef is required — waves inherit verified scope, they do not re-derive it');
    }
    if (typeof input.createdBy !== 'string' || input.createdBy.trim() === '') {
        throw new CampaignStoreError('campaign createdBy must name the operator creating it');
    }
    if (!Number.isInteger(input.caps?.maxWaves) || input.caps.maxWaves < 1) {
        throw new CampaignStoreError('campaign caps.maxWaves must be an integer >= 1');
    }
    const file = campaignFile(campaignsDir, input.id);
    // The store is directory-per-campaign, so a fresh campaignsDir has no
    // `<id>/` yet and the exclusive create below would fail with ENOENT instead
    // of creating the campaign. Creating the parent is not an overwrite: the
    // `wx` open still guarantees an existing record is never replaced.
    mkdirSync(dirname(file), { recursive: true });
    try {
        const fd = openSync(file, 'wx');
        closeSync(fd);
    }
    catch (err) {
        if (err.code === 'EEXIST') {
            throw new CampaignStoreError(`campaign already exists: ${input.id} (creation never overwrites a record)`);
        }
        throw err;
    }
    const ts = iso(now);
    const rec = {
        version: 1,
        id: input.id,
        name: input.name,
        kind: input.kind,
        status: 'draft',
        scope: {
            hosts: [...input.scope.hosts],
            verificationRef: input.scope.verificationRef,
            ...(input.scope.roeRef !== undefined ? { roeRef: input.scope.roeRef } : {}),
        },
        objective: input.objective,
        caps: {
            maxWaves: input.caps.maxWaves,
            ...(input.caps.maxBudget !== undefined ? { maxBudget: input.caps.maxBudget } : {}),
        },
        autoAdvance: { enabled: false },
        waves: [],
        decisions: [],
        transitions: [
            { seq: 0, ts, from: null, to: 'draft', reason: `campaign created by ${input.createdBy}` },
        ],
        createdAt: ts,
        createdBy: input.createdBy,
        updatedAt: ts,
    };
    rmSync(file, { force: true });
    saveCampaignFile(file, rec);
    return loadCampaignFile(file);
}
/**
 * Atomic read-modify-write transaction on one campaign record
 * (registry transact precedent). The mutator runs against the freshly
 * loaded record; the result is validated and saved atomically, with
 * updatedAt refreshed. If the mutator throws, nothing is written.
 */
export function transactCampaign(campaignsDir, campaignId, fn, now = new Date()) {
    const file = campaignFile(campaignsDir, campaignId);
    const rec = loadCampaignFile(file);
    const out = fn(rec);
    rec.updatedAt = iso(now);
    saveCampaignFile(file, rec);
    return out;
}
/** Append a transition entry and move the status. This is the SINGLE
 *  transition writer for campaign records: seq always equals the
 *  entry's index in transitions[] (creation is seq 0), so the audit
 *  spine stays gapless and duplicate-free no matter which module
 *  records the move. Callers outside the store (lifecycle, executor)
 *  must use this — never push transition entries by hand. */
export function applyCampaignTransition(rec, to, reason, opts = {}) {
    rec.transitions.push({
        seq: rec.transitions.length,
        ts: iso(opts.now ?? new Date()),
        from: rec.status,
        to,
        reason,
        ...(opts.waveIndex !== undefined ? { waveIndex: opts.waveIndex } : {}),
    });
    rec.status = to;
}
/** Record a lifecycle status change (the executor/lifecycle's path for
 *  transitions not owned by beginWave/recordWaveOutcome — arm, pause,
 *  resume, stop, complete). */
export function recordTransition(campaignsDir, campaignId, to, reason, opts = {}) {
    const now = opts.now ?? new Date();
    return transactCampaign(campaignsDir, campaignId, (rec) => {
        applyCampaignTransition(rec, to, reason, { waveIndex: opts.waveIndex, now });
        return rec;
    }, now);
}
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
/**
 * Restart repair across the whole store. Any wave still "running" when
 * this runs was stranded by a previous process's death: it is marked
 * "interrupted" (interruptedAt + reason "process-restart") and the
 * campaign returns to "awaiting-advance" so an operator decides what
 * happens next. Idempotent — a second run over a repaired store changes
 * nothing. Repairs are persisted with transition entries (reason
 * "resume-repair: ..."), so the record itself shows what happened.
 */
export function resumeCampaigns(campaignsDir, now = new Date()) {
    const report = { scanned: 0, repaired: [], errors: [] };
    for (const id of listCampaignIds(campaignsDir)) {
        report.scanned += 1;
        let rec;
        try {
            rec = loadCampaign(campaignsDir, id);
        }
        catch (err) {
            report.errors.push({ id, error: err instanceof Error ? err.message : String(err) });
            continue;
        }
        const stranded = rec.waves.filter(w => w.status === 'running');
        const statusStranded = rec.status === 'wave-running' && stranded.length === 0;
        if (stranded.length === 0 && !statusStranded)
            continue;
        const fromStatus = rec.status;
        for (const wave of stranded) {
            wave.status = 'interrupted';
            wave.interruptedAt = iso(now);
            wave.interruptReason = 'process-restart';
        }
        // A terminal campaign with a stranded wave is contradictory; the
        // wave repair still lands, but the campaign status is left as the
        // operator left it and the transition records the inconsistency.
        const terminal = rec.status === 'complete' || rec.status === 'stopped';
        const toStatus = terminal ? rec.status : 'awaiting-advance';
        const detail = stranded.length
            ? `wave(s) ${stranded.map(w => w.index).join(', ')} marked interrupted, never counted complete`
            : 'campaign was wave-running with no running wave';
        applyCampaignTransition(rec, toStatus, `resume-repair: process restart — ${detail}`, { now });
        rec.updatedAt = iso(now);
        saveCampaignFile(campaignFile(campaignsDir, id), rec);
        report.repaired.push({
            id,
            interruptedWaves: stranded.map(w => w.index),
            fromStatus,
            toStatus,
        });
    }
    return report;
}
//# sourceMappingURL=store.js.map