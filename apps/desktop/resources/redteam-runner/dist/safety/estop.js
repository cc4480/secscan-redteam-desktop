/**
 * ESTOP — the fleet pause sentinel.
 *
 * One file pauses ALL automation: while the sentinel is present, no new
 * engagement launches. Every launch caller (CLI, the UI server / MCP
 * engagement_launch path, the harness2 probe CLI, continuous watch cycles)
 * funnels through runEngagement, whose launch gate is the single check.
 * In-flight engagements are NEVER touched: the check runs at launch only —
 * never per dispatch, never per phase. Resume is a deliberate operator
 * act: delete the file. There is no in-app override and no env bypass,
 * deliberately — the control's value is that anything with filesystem
 * access can engage it and only removing it lifts it.
 *
 * Ported semantics (adoption register §13b.6, from NousResearch
 * hermes-agent's estop.py, itself ported from gastown's estop.go; the
 * AlterEgo bridge leg implements the same contract beside its job
 * journal):
 *  - presence alone engages — empty, corrupt, or non-JSON content still
 *    engages (fail-safe: pause is the safe direction);
 *  - an optional JSON body {"reason", "engaged_at"} is surfaced verbatim
 *    when it parses;
 *  - checks are uncached stats at launch time — a file dropped a second
 *    before launch is seen.
 *
 * Deliberate divergences from abort.json (safety/abortfile.ts), the
 * runner's other file signal — pinned here so nobody "harmonizes" them:
 *  - scope: ESTOP is store/fleet-wide; abort.json is one engagement.
 *  - checked: ESTOP at launch only; abort.json every dispatch cycle.
 *  - effect: ESTOP never kills in-flight work; abort.json halts it.
 *  - corrupt file: ESTOP means ENGAGED; abort.json means "no signal".
 *  - consumption: ESTOP persists until the operator deletes it;
 *    abort.json is consumed (deleted) by the dispatcher after acting.
 */
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
export const ESTOP_FILE_NAME = 'ESTOP';
/** Env var naming one explicit sentinel file (tests, unusual installs). */
export const ESTOP_PATH_ENV = 'REDTEAM_ESTOP_PATH';
const REDTEAM_HOME_ENV = 'REDTEAM_HOME';
/**
 * Resolve the sentinel paths, in check order. One resolution, shared by
 * the launch gate (via ResolvedRunnerConfig.estopPaths) and the readiness
 * probe, so the two can never drift:
 *  1. REDTEAM_ESTOP_PATH, when set, names the ONLY path.
 *  2. Primary: beside registry.json.
 *  3. Secondary (Hermes's two-path rule): <REDTEAM_HOME>/ESTOP, when
 *     REDTEAM_HOME is set and it differs from the primary — an operator
 *     who drops the file in the obvious top-level place is honored.
 */
export function resolveEstopPaths(env, opts = {}) {
    const override = env[ESTOP_PATH_ENV]?.trim();
    if (override)
        return [override];
    const paths = [];
    if (opts.registryPath)
        paths.push(join(dirname(opts.registryPath), ESTOP_FILE_NAME));
    const home = env[REDTEAM_HOME_ENV]?.trim();
    if (home) {
        const fleetRoot = join(home, ESTOP_FILE_NAME);
        if (!paths.includes(fleetRoot))
            paths.push(fleetRoot);
    }
    return paths;
}
/**
 * Presence-based read of the first engaging path. ENOENT is the only
 * "absent" outcome: any other stat error means the sentinel state is
 * indeterminate, and indeterminate pauses the fleet (the Hermes rule —
 * is_engaged() returns true on stat errors). The body is best-effort:
 * empty or non-JSON content still engages, it just surfaces no reason.
 */
export function readEstopState(paths) {
    for (const path of paths) {
        try {
            statSync(path);
        }
        catch (err) {
            if (err.code === 'ENOENT')
                continue;
            return { engaged: true, path };
        }
        const state = { engaged: true, path };
        try {
            const raw = JSON.parse(readFileSync(path, 'utf8'));
            if (typeof raw.reason === 'string' && raw.reason.trim())
                state.reason = raw.reason.slice(0, 500);
            const at = typeof raw.engaged_at === 'string' ? raw.engaged_at : raw.engagedAt;
            if (typeof at === 'string' && at.trim())
                state.engagedAt = at;
        }
        catch {
            /* empty or non-JSON body — still engaged, nothing to surface */
        }
        return state;
    }
    return { engaged: false };
}
/**
 * The typed launch refusal. `code` is the mechanical key callers route
 * on; the message follows Hermes's paused_reply(): what is paused, that
 * in-flight work is unaffected, and the one act that resumes.
 */
export class EstopEngagedError extends Error {
    code = 'ESTOP_ENGAGED';
    path;
    reason;
    engagedAt;
    constructor(state) {
        const reasonClause = state.reason ? ` (reason: ${state.reason})` : '';
        super(`[runner] ESTOP engaged — new engagements are paused${reasonClause}. ` +
            `In-flight engagements are unaffected. Delete ${state.path} to resume.`);
        this.name = 'EstopEngagedError';
        this.path = state.path ?? '';
        if (state.reason)
            this.reason = state.reason;
        if (state.engagedAt)
            this.engagedAt = state.engagedAt;
    }
}
/**
 * The launch gate: throw EstopEngagedError when the sentinel is engaged,
 * return silently when clear. Called exactly once per launch, inside
 * runEngagement, before any engagement state exists.
 */
export function requireEstopClear(paths) {
    const state = readEstopState(paths);
    if (state.engaged)
        throw new EstopEngagedError(state);
}
/**
 * Engage the sentinel at an explicit path (atomic tmp + rename, the
 * writeAbortFile pattern, so a launch-time stat never observes a partial
 * write). The parent directory must already exist. v1 ships no in-app
 * engage verb — the operator engages by creating the file; this helper
 * serves tests and any future verb, writing the Hermes body format.
 */
export function engageEstop(path, body = {}) {
    const payload = {};
    if (body.reason)
        payload['reason'] = body.reason.slice(0, 500);
    payload['engaged_at'] = body.engagedAt ?? new Date().toISOString();
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n');
    renameSync(tmp, path);
}
/** Disengage: remove the sentinel. Best-effort — an absent file is the goal state. */
export function disengageEstop(path) {
    try {
        unlinkSync(path);
    }
    catch {
        /* already gone or unwritable — the operator's delete is the record */
    }
}
//# sourceMappingURL=estop.js.map