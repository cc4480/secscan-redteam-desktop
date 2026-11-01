/**
 * Campaign record validation (Q-CAMPAIGN, scoping N1).
 *
 * File-boundary validation per repo rule: a campaign record read from
 * disk is untrusted until it passes validateCampaignRecord. Fail loud
 * with path-specific messages — a corrupt or foreign record must surface
 * as an error, never be silently repaired into a different campaign.
 * (Restart repair of *stranded waves* is a different, explicit act —
 * see resumeCampaigns in store.ts — and is recorded in the record when
 * it happens.)
 */
export class CampaignSchemaError extends Error {
    constructor(message) {
        super(`[campaign] ${message}`);
        this.name = 'CampaignSchemaError';
    }
}
export const CAMPAIGN_STATUSES = [
    'draft',
    'armed',
    'wave-running',
    'awaiting-advance',
    'paused',
    'complete',
    'stopped',
];
export const WAVE_STATUSES = [
    'planned',
    'running',
    'complete',
    'halted',
    'interrupted',
    'failed',
];
export const OPERATOR_DECISION_KINDS = [
    'start',
    'advance',
    'enable-auto-advance',
    'disable-auto-advance',
    'pause',
    'resume',
    'stop',
    'complete',
];
export const WAVE_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
/** Campaign ids double as directory names — same safety shape as
 *  engagement ids (util.ts safeEngagementId): no separators, no dots
 *  beyond the slug body, bounded length. */
const CAMPAIGN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,120}$/;
export function isSafeCampaignId(id) {
    return typeof id === 'string' && CAMPAIGN_ID_RE.test(id);
}
/** The one kind name that must never exist in this product: the donor's
 *  /ad kind is forbidden by the canonical manifest, Part C. Enforced
 *  here at the file boundary and at creation, not just by convention. */
export function isForbiddenKind(kind) {
    return typeof kind === 'string' && kind.trim().toLowerCase() === 'ad';
}
function fail(path, problem) {
    throw new CampaignSchemaError(`campaign record invalid at ${path}: ${problem}`);
}
function isObj(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function reqString(v, path) {
    if (typeof v !== 'string' || v.trim() === '')
        fail(path, 'must be a non-empty string');
    return v;
}
function optString(v, path) {
    if (v === undefined)
        return undefined;
    if (typeof v !== 'string')
        fail(path, 'must be a string when present');
    return v;
}
function reqIntAtLeast(v, path, min) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min) {
        fail(path, `must be an integer >= ${min}`);
    }
    return v;
}
function optIntAtLeast(v, path, min) {
    if (v === undefined)
        return undefined;
    return reqIntAtLeast(v, path, min);
}
function reqNumber(v, path) {
    if (typeof v !== 'number' || !Number.isFinite(v))
        fail(path, 'must be a finite number');
    return v;
}
function validateAutoAdvance(v, path) {
    if (!isObj(v))
        fail(path, 'must be an object');
    const o = v;
    if (typeof o.enabled !== 'boolean')
        fail(`${path}.enabled`, 'must be a boolean');
    const out = { enabled: o.enabled };
    const maxWave = optIntAtLeast(o.maxWave, `${path}.maxWave`, 1);
    if (maxWave !== undefined)
        out.maxWave = maxWave;
    const enabledBy = optString(o.enabledBy, `${path}.enabledBy`);
    if (enabledBy !== undefined)
        out.enabledBy = enabledBy;
    const enabledAt = optString(o.enabledAt, `${path}.enabledAt`);
    if (enabledAt !== undefined)
        out.enabledAt = enabledAt;
    const decisionSeq = optIntAtLeast(o.decisionSeq, `${path}.decisionSeq`, 0);
    if (decisionSeq !== undefined)
        out.decisionSeq = decisionSeq;
    // Shape invariant: an enabled state must carry its authorization
    // coordinates. Whether decisionSeq *resolves* to an enable decision is
    // the gate's check (gate.ts), not the schema's.
    if (out.enabled && (out.maxWave === undefined || !out.enabledBy || !out.enabledAt || out.decisionSeq === undefined)) {
        fail(path, 'enabled auto-advance must record maxWave, enabledBy, enabledAt and decisionSeq');
    }
    return out;
}
function validateWave(v, path) {
    if (!isObj(v))
        fail(path, 'must be an object');
    const o = v;
    const index = reqIntAtLeast(o.index, `${path}.index`, 1);
    if (!WAVE_STATUSES.includes(o.status)) {
        fail(`${path}.status`, `must be one of ${WAVE_STATUSES.join('|')}`);
    }
    const wave = { index, status: o.status };
    const aim = optString(o.aim, `${path}.aim`);
    if (aim !== undefined)
        wave.aim = aim;
    const planRef = optString(o.planRef, `${path}.planRef`);
    if (planRef !== undefined)
        wave.planRef = planRef;
    const engagementId = optString(o.engagementId, `${path}.engagementId`);
    if (engagementId !== undefined)
        wave.engagementId = engagementId;
    const launchedAt = optString(o.launchedAt, `${path}.launchedAt`);
    if (launchedAt !== undefined)
        wave.launchedAt = launchedAt;
    const finishedAt = optString(o.finishedAt, `${path}.finishedAt`);
    if (finishedAt !== undefined)
        wave.finishedAt = finishedAt;
    if (o.outcome !== undefined) {
        if (!isObj(o.outcome))
            fail(`${path}.outcome`, 'must be an object');
        const oc = o.outcome;
        const engagementStatus = reqString(oc.engagementStatus, `${path}.outcome.engagementStatus`);
        if (!isObj(oc.rollup))
            fail(`${path}.outcome.rollup`, 'must be an object');
        const r = oc.rollup;
        const bySeverityRaw = isObj(r.bySeverity) ? r.bySeverity : undefined;
        if (!bySeverityRaw)
            fail(`${path}.outcome.rollup.bySeverity`, 'must be an object');
        const bySeverity = {};
        for (const sev of WAVE_SEVERITIES) {
            bySeverity[sev] = reqNumber(bySeverityRaw[sev], `${path}.outcome.rollup.bySeverity.${sev}`);
        }
        wave.outcome = {
            engagementStatus,
            ...(optString(oc.blockedReason, `${path}.outcome.blockedReason`) !== undefined
                ? { blockedReason: oc.blockedReason }
                : {}),
            ...(optString(oc.reportPath, `${path}.outcome.reportPath`) !== undefined
                ? { reportPath: oc.reportPath }
                : {}),
            rollup: {
                totalFindings: reqNumber(r.totalFindings, `${path}.outcome.rollup.totalFindings`),
                confirmed: reqNumber(r.confirmed, `${path}.outcome.rollup.confirmed`),
                killed: reqNumber(r.killed, `${path}.outcome.rollup.killed`),
                deferred: reqNumber(r.deferred, `${path}.outcome.rollup.deferred`),
                bySeverity,
            },
        };
    }
    const interruptedAt = optString(o.interruptedAt, `${path}.interruptedAt`);
    if (interruptedAt !== undefined)
        wave.interruptedAt = interruptedAt;
    const interruptReason = optString(o.interruptReason, `${path}.interruptReason`);
    if (interruptReason !== undefined)
        wave.interruptReason = interruptReason;
    return wave;
}
function validateDecision(v, path) {
    if (!isObj(v))
        fail(path, 'must be an object');
    const o = v;
    if (!OPERATOR_DECISION_KINDS.includes(o.kind)) {
        fail(`${path}.kind`, `must be one of ${OPERATOR_DECISION_KINDS.join('|')}`);
    }
    const d = {
        seq: reqIntAtLeast(o.seq, `${path}.seq`, 0),
        ts: reqString(o.ts, `${path}.ts`),
        operator: reqString(o.operator, `${path}.operator`),
        kind: o.kind,
    };
    const waveIndex = optIntAtLeast(o.waveIndex, `${path}.waveIndex`, 1);
    if (waveIndex !== undefined)
        d.waveIndex = waveIndex;
    const maxWave = optIntAtLeast(o.maxWave, `${path}.maxWave`, 1);
    if (maxWave !== undefined)
        d.maxWave = maxWave;
    const note = optString(o.note, `${path}.note`);
    if (note !== undefined)
        d.note = note;
    return d;
}
function validateTransition(v, path) {
    if (!isObj(v))
        fail(path, 'must be an object');
    const o = v;
    if (o.from !== null && !CAMPAIGN_STATUSES.includes(o.from)) {
        fail(`${path}.from`, `must be null or one of ${CAMPAIGN_STATUSES.join('|')}`);
    }
    if (!CAMPAIGN_STATUSES.includes(o.to)) {
        fail(`${path}.to`, `must be one of ${CAMPAIGN_STATUSES.join('|')}`);
    }
    const t = {
        seq: reqIntAtLeast(o.seq, `${path}.seq`, 0),
        ts: reqString(o.ts, `${path}.ts`),
        from: o.from,
        to: o.to,
        reason: reqString(o.reason, `${path}.reason`),
    };
    const waveIndex = optIntAtLeast(o.waveIndex, `${path}.waveIndex`, 1);
    if (waveIndex !== undefined)
        t.waveIndex = waveIndex;
    return t;
}
/**
 * Validate an untrusted value as a CampaignRecord. Returns a normalized
 * record (only known fields survive). Throws CampaignSchemaError on any
 * violation — including an unknown version: a record written by newer
 * code fails loud here instead of silently downgrading.
 */
export function validateCampaignRecord(raw) {
    if (!isObj(raw))
        fail('$', 'must be an object');
    const o = raw;
    if (o.version !== 1)
        fail('$.version', `must be 1, got ${JSON.stringify(o.version)}`);
    if (!isSafeCampaignId(o.id))
        fail('$.id', 'must be a safe campaign id (slug, <= 121 chars)');
    const kind = reqString(o.kind, '$.kind');
    if (isForbiddenKind(kind))
        fail('$.kind', 'the "ad" kind is forbidden in this product (manifest Part C)');
    if (!CAMPAIGN_STATUSES.includes(o.status)) {
        fail('$.status', `must be one of ${CAMPAIGN_STATUSES.join('|')}`);
    }
    if (!isObj(o.scope))
        fail('$.scope', 'must be an object');
    const scopeRaw = o.scope;
    if (!Array.isArray(scopeRaw.hosts) || scopeRaw.hosts.length === 0) {
        fail('$.scope.hosts', 'must be a non-empty array of hosts');
    }
    const hosts = scopeRaw.hosts.map((h, i) => reqString(h, `$.scope.hosts[${i}]`));
    if (!isObj(o.caps))
        fail('$.caps', 'must be an object');
    const capsRaw = o.caps;
    if (!Array.isArray(o.waves))
        fail('$.waves', 'must be an array');
    if (!Array.isArray(o.decisions))
        fail('$.decisions', 'must be an array');
    if (!Array.isArray(o.transitions))
        fail('$.transitions', 'must be an array');
    const rec = {
        version: 1,
        id: o.id,
        name: reqString(o.name, '$.name'),
        kind,
        status: o.status,
        scope: {
            hosts,
            verificationRef: reqString(scopeRaw.verificationRef, '$.scope.verificationRef'),
            ...(optString(scopeRaw.roeRef, '$.scope.roeRef') !== undefined
                ? { roeRef: scopeRaw.roeRef }
                : {}),
        },
        objective: reqString(o.objective, '$.objective'),
        caps: {
            maxWaves: reqIntAtLeast(capsRaw.maxWaves, '$.caps.maxWaves', 1),
            ...(capsRaw.maxBudget !== undefined
                ? { maxBudget: reqNumber(capsRaw.maxBudget, '$.caps.maxBudget') }
                : {}),
        },
        autoAdvance: validateAutoAdvance(o.autoAdvance, '$.autoAdvance'),
        waves: o.waves.map((w, i) => validateWave(w, `$.waves[${i}]`)),
        decisions: o.decisions.map((d, i) => validateDecision(d, `$.decisions[${i}]`)),
        transitions: o.transitions.map((t, i) => validateTransition(t, `$.transitions[${i}]`)),
        createdAt: reqString(o.createdAt, '$.createdAt'),
        createdBy: reqString(o.createdBy, '$.createdBy'),
        updatedAt: reqString(o.updatedAt, '$.updatedAt'),
    };
    return rec;
}
//# sourceMappingURL=schema.js.map