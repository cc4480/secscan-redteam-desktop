/**
 * Campaign module barrel (Q-CAMPAIGN).
 *
 * A campaign sits above engagements (one wave = one engagement) and
 * persists plan, sequence, and operator intent. Knowledge storage is
 * Q-MEMTIER's; the throttle/lockout interlock payload is Q-LOCKOUT's —
 * this module owns the campaign record, its store, and the wave gate.
 *
 * Ownership within the module (pair build, 2026-10-31):
 *  - types.ts / schema.ts / store.ts / gate.ts — persistence + the
 *    recorded-decision gate (Agent B).
 *  - kinds.ts / planner.ts / brief.ts / executor.ts / lifecycle.ts /
 *    cli.ts — kind registry, wave planner, lifecycle, CLI (Agent A;
 *    append exports here as they land, do not rewrite this header).
 */
export { CAMPAIGN_STATUSES, CampaignSchemaError, OPERATOR_DECISION_KINDS, WAVE_SEVERITIES, WAVE_STATUSES, isForbiddenKind, isSafeCampaignId, validateCampaignRecord, } from './schema.js';
export { CAMPAIGN_FILE_NAME, CampaignStoreError, applyCampaignTransition, beginWave, campaignDir, campaignFile, computeRollup, createCampaign, listCampaignIds, loadCampaign, loadCampaignFile, recordTransition, recordWaveOutcome, resolveCampaignsDir, resumeCampaigns, saveCampaignFile, settleFailedWave, transactCampaign, } from './store.js';
export { CampaignGateError, assertLaunchAllowed, evaluateLaunch, nextWaveIndex, recordOperatorDecision, } from './gate.js';
// — Agent A: kind registry (kinds.ts)
export { CampaignKindError, WEB_HUNT_KIND, getCampaignKind, hasCampaignKind, listCampaignKinds, validateCampaignKind, } from './kinds.js';
// — Agent A: wave planner (planner.ts)
export { FALLBACK_FOCUS_COUNT, MAX_FOCUS_VECTORS, deterministicFallbackPlan, loadWavePlan, planNextWave, wavePlanPath, writeWavePlan, } from './planner.js';
// — Agent A: wave brief assembly (brief.ts)
export { buildWaveBrief, coverageGaps, waveHistory, } from './brief.js';
// — Agent A: lifecycle transitions + campaign rollup (lifecycle.ts)
export { CampaignLifecycleError, completeCampaign, computeCampaignRollup, getCampaign, pauseCampaign, planCampaignWave, resumeCampaign, stopCampaign, } from './lifecycle.js';
// — Agent A: wave executor (executor.ts)
export { CampaignExecutorError, launchCampaignWave, planNextCampaignWave, } from './executor.js';
// — Agent A: CLI surface (cli.ts)
export { CampaignCliError, runCampaignCli } from './cli.js';
//# sourceMappingURL=index.js.map