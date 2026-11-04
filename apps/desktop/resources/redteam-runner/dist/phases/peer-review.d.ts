import { type Ctx } from '../context.js';
export { CHECKER_PREFERENCE, SEVERITY_LADDER, selectChecker, parsePeerVerdict } from './peer-verdict.js';
export type { ParsedPeerVerdict, PeerVerdict } from './peer-verdict.js';
/**
 * The reviewer pass: challenge every live finding with a different
 * seat and apply the outcomes. Runs after exploitation, before the
 * report (wired in phases/run.ts ahead of the exploit→report
 * sign-off, so sign-off counts are post-challenge). No-ops on dry
 * runs — there are no agent findings to challenge.
 */
export declare function peerReviewPhase(ctx: Ctx): Promise<void>;
