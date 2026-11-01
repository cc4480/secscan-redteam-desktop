/**
 * Operator actions (v0.22.0): reverify, watch triggers, tier escalation.
 *
 * POST /api/engagements/:id/escalate — v0.24.0 mid-run tier change. Same
 * rules as the CLI (`redteam-runner escalate`): raising the tier requires a
 * named operator + reason; lowering is logged freely; Tier 2 on production
 * needs explicit confirmation. The running dispatcher picks the new tier up
 * on its next tool call — no restart.
 * POST /api/reverify — plan or execute a PoC bundle replay (mirrors the
 * CLI's reverify command; execution runs as a background job).
 * GET/POST /api/watch — list watch profiles in a dir; trigger one cycle.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { engagementDir } from "../store.js";
import { createReplayer, reverifyBundle } from "../../proof/index.js";
import { loadTicketMapping, updateTicketsForReverify } from "../../integrations/index.js";
import { loadWatchProfile, runWatchCycle } from "../../continuous/index.js";
import { describeEscalation, escalateEngagement } from "../../accountability/index.js";
import { json, badRequest } from "./http.js";
/**
 * POST /api/engagements/:id/escalate { tier, operator, reason?, confirmTier2Production? }
 * v0.24.0: mid-run tier change with the CLI's exact rules. Raising the tier
 * requires a named operator + reason; lowering is logged freely; Tier 2 on
 * production needs explicit confirmation. The running dispatcher picks the
 * new tier up on its next tool call — no restart. Works for CLI-started
 * engagements too (the signal is tier.json on disk, not the UI's live map).
 */
export function handleEscalate(store, res, id, body) {
    const b = (body ?? {});
    try {
        const result = escalateEngagement({
            engagementsDir: store.engagementsDir,
            engagementId: id,
            toTier: typeof b.tier === "string" || typeof b.tier === "number" ? String(b.tier) : "",
            operator: typeof b.operator === "string" ? b.operator : undefined,
            reason: typeof b.reason === "string" ? b.reason : undefined,
            tier2ProdConfirmed: b.confirmTier2Production === true,
        });
        json(res, 200, {
            ok: true,
            engagementId: result.engagementId,
            fromTier: result.fromTier,
            toTier: result.toTier,
            operator: result.operator,
            engagementStatus: result.engagementStatus,
            approvalSeq: result.approvalSeq,
            message: describeEscalation(result),
        });
    }
    catch (err) {
        badRequest(res, err.message);
    }
}
/** POST /api/reverify — plan (sync) or execute (background job). */
export async function handleReverify(store, res, body) {
    const b = (body ?? {});
    // The bundle is resolved from the engagement's OWN poc/ directory, never from
    // a caller-supplied filesystem path. Accepting a raw bundlePath let a token
    // holder read and replay an arbitrary file on disk; the schema always said
    // { id, finding }, so this handler was lying about what it actually consumed.
    if (!b.id || typeof b.id !== "string") {
        badRequest(res, "id (engagement id) is required");
        return;
    }
    const dir = engagementDir(store.engagementsDir, b.id);
    if (!dir) {
        json(res, 404, { error: "unknown engagement" });
        return;
    }
    if (!b.finding || typeof b.finding !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(b.finding)) {
        badRequest(res, "finding (finding id) is required and must be a safe id");
        return;
    }
    const bundlePath = join(dir, "poc", `${b.finding}.json`);
    if (!existsSync(bundlePath)) {
        json(res, 404, { error: "no proof bundle for finding" });
        return;
    }
    let bundle;
    try {
        bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
    }
    catch (err) {
        badRequest(res, `bad bundle JSON: ${err.message}`);
        return;
    }
    if (bundle.version !== 1 || !Array.isArray(bundle.steps)) {
        badRequest(res, "not a v1 PoC bundle");
        return;
    }
    if (!b.execute) {
        // Plan only — no traffic, same as the CLI without --execute.
        json(res, 200, {
            plan: true,
            bundleId: bundle.bundleId,
            findingId: bundle.findingId,
            title: bundle.title,
            validationTier: bundle.validationTier,
            proves: bundle.proves,
            doesNotProve: bundle.doesNotProve,
            steps: bundle.steps.map((s) => ({
                seq: s.seq,
                tool: s.tool,
                target: s.target,
                command: s.command.slice(0, 200),
                validation: s.validation,
                replayable: !!s.replay,
            })),
        });
        return;
    }
    if (!Array.isArray(b.scope) || b.scope.length === 0) {
        badRequest(res, "execute requires scope: string[] (exact hosts, enforced mechanically)");
        return;
    }
    const job = store.createJob("reverify");
    json(res, 202, { jobId: job.id });
    // Background: replay with a fresh canary, then push the verdict to
    // linked tickets exactly like the CLI does.
    void (async () => {
        try {
            const report = await reverifyBundle(bundle, createReplayer({ scope: b.scope }));
            let tickets = null;
            try {
                const mapping = loadTicketMapping(dir);
                if (mapping) {
                    const { attempts } = await updateTicketsForReverify(mapping, bundle, report);
                    tickets = attempts;
                }
            }
            catch {
                // ticket updates never fail the reverify itself
            }
            store.finishJob(job.id, { verdict: report.verdict, summary: report.summary, tickets });
        }
        catch (err) {
            store.failJob(job.id, err);
        }
    })();
}
/** GET /api/jobs/:jobId — background job status. */
export function handleJob(store, res, jobId) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) {
        badRequest(res, "bad job id");
        return;
    }
    const job = store.getJob(jobId);
    if (!job) {
        json(res, 404, { error: "unknown job" });
        return;
    }
    json(res, 200, job);
}
/** The single directory watch profiles live in — never a caller-supplied path. */
function watchProfilesDir() {
    const d = process.env["REDTEAM_WATCH_DIR"]?.trim();
    return d ? d : join(process.cwd(), "watch");
}
/** GET /api/watch/profiles — list parseable watch profiles in the fixed dir. */
export function handleWatchProfiles(res, _query) {
    const dir = watchProfilesDir();
    let files = [];
    try {
        files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    }
    catch {
        json(res, 200, []);
        return;
    }
    const out = [];
    for (const f of files) {
        const p = join(dir, f);
        try {
            const profile = loadWatchProfile(p);
            out.push({ path: p, target: profile.engagement?.target, intervalHours: profile.cadence?.intervalHours });
        }
        catch {
            // not a watch profile — skip
        }
    }
    json(res, 200, out);
}
/** POST /api/watch/trigger { profile, trigger? } — one cycle, background job. */
export function handleWatchTrigger(store, res, body) {
    const b = (body ?? {});
    if (!b.profile || typeof b.profile !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(b.profile)) {
        badRequest(res, "profile (watch profile name) is required");
        return;
    }
    const dir = watchProfilesDir();
    const profilePath = join(dir, b.profile.endsWith(".json") ? b.profile : `${b.profile}.json`);
    // Confine to the watch directory: a profile name is not a path.
    if (!resolve(profilePath).startsWith(resolve(dir) + sep)) {
        badRequest(res, "profile name escapes the watch directory");
        return;
    }
    const job = store.createJob("watch-trigger");
    json(res, 202, { jobId: job.id });
    void (async () => {
        try {
            const result = await runWatchCycle({ profilePath, once: true, trigger: b.trigger });
            store.finishJob(job.id, {
                status: result.status,
                engagementId: result.engagementId,
                engagementStatus: result.engagementStatus,
                reason: result.reason,
            });
        }
        catch (err) {
            store.failJob(job.id, err);
        }
    })();
}
//# sourceMappingURL=actions.js.map