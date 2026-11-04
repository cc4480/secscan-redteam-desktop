/**
 * Engagement routes (v0.22.0): launch, list, detail.
 *
 * Launch calls runEngagement() directly — the same function the CLI calls —
 * with the run detached (no await) so the HTTP request returns immediately.
 * Validation mirrors cli/args.ts buildInput() so the UI can never launch
 * something the CLI would refuse.
 */
import { join } from "node:path";
import { runEngagement } from "../../phases.js";
import { ALL_TARGETS, isTargetId } from "../../targets.js";
import { parseTier } from "../../accountability/index.js";
import { readState } from "../../events.js";
import { engagementDir, generateEngagementId } from "../store.js";
import { json, badRequest } from "./http.js";
export function toEngagementInput(b) {
    if (!b.target || typeof b.target !== "string")
        throw new Error("target is required");
    if (b.mode !== "red" && b.mode !== "black")
        throw new Error("mode must be red|black");
    if (!b.objective || typeof b.objective !== "string")
        throw new Error("objective is required");
    if (!Array.isArray(b.scope) || b.scope.length === 0 || !b.scope.every((s) => typeof s === "string" && s.trim())) {
        throw new Error("scope is required (non-empty array of exact hosts)");
    }
    if (b.outOfScope !== undefined && (!Array.isArray(b.outOfScope) || !b.outOfScope.every((s) => typeof s === "string" && s.trim()))) {
        throw new Error("outOfScope must be an array of exact hosts");
    }
    let targets;
    if (b.targets && b.targets.length > 0) {
        const bad = b.targets.filter((t) => !isTargetId(t));
        if (bad.length > 0)
            throw new Error(`bad targets ${JSON.stringify(bad)}; want subset of ${ALL_TARGETS.join(",")}`);
        targets = b.targets;
    }
    let tier;
    if (b.tier !== undefined) {
        tier = parseTier(String(b.tier));
    }
    // S2-H2: the launching command's phase list rides into the input,
    // validated against the phase vocabulary — a malformed list refuses
    // the launch instead of being silently dropped (which is how the
    // sibling semantics were lost in the first place). The command name
    // itself is validated and dropped here: buildLaunchBody resolves it
    // against the registry before the body is built, so by this seam the
    // name is a record, not an instruction.
    let phases;
    if (b.phases !== undefined) {
        const PHASES = ["authorize", "plan", "recon", "exploit", "report", "done", "blocked", "halted"];
        if (!Array.isArray(b.phases) || b.phases.length === 0 || !b.phases.every((p) => typeof p === "string" && PHASES.includes(p))) {
            throw new Error(`bad phases ${JSON.stringify(b.phases)}; want a non-empty subset of ${PHASES.join(",")}`);
        }
        phases = b.phases;
    }
    let environment;
    if (b.environment !== undefined) {
        if (b.environment !== "staging" && b.environment !== "production")
            throw new Error("environment must be staging|production");
        environment = b.environment;
    }
    return {
        target: b.target,
        mode: b.mode,
        objective: b.objective,
        roe: {
            scope: b.scope,
            ...(b.outOfScope?.length ? { outOfScope: b.outOfScope } : {}),
            excludedTechniques: b.excludedTechniques?.length ? b.excludedTechniques : null,
            blackoutWindows: [],
            stopConditions: [],
        },
        client: b.client,
        operatorName: b.operatorName,
        fullBattery: b.fullBattery ?? true,
        ...(b.localHost ? { localHost: true } : {}),
        targets,
        ...(phases ? { phases } : {}),
        environment,
        confirmProduction: b.confirmProduction ?? false,
        tier,
        confirmTier2Production: b.confirmTier2Production ?? false,
    };
}
/** POST /api/engagements — launch. Returns 202 { id }. */
export async function handleLaunch(store, _req, res, body) {
    let input;
    try {
        input = toEngagementInput(body);
    }
    catch (err) {
        badRequest(res, err.message);
        return;
    }
    const launch = body;
    const dryRun = body.dryRun === true;
    const id = generateEngagementId();
    const dir = join(store.engagementsDir, id);
    store.register({ id, dir, status: "starting", startedAt: new Date().toISOString(), target: input.target, mode: input.mode });
    // Detached run — the request returns now; progress streams via SSE.
    try {
        const p = runEngagement(input, {
            engagementId: id,
            // The run must write where this server reads. Left to resolveConfig,
            // the writer falls back to REDTEAM_HOME or the process cwd — on the
            // desktop the console is spawned with cwd = the runner payload dir
            // while the store root is the --engagements-dir (userData), so state
            // landed in the payload tree and every store read (detail, findings,
            // scope, the console list's disk scan) found nothing. Pinning the
            // store's root here unifies writer and readers at the one root this
            // server was configured with, in source and packaged layouts alike.
            engagementsDir: store.engagementsDir,
            dryRunAgents: dryRun,
            // The action cap is a RunnerOption, not an EngagementInput field, so it
            // crosses over here rather than riding along in `input`. Passing it in
            // the input object typechecks nowhere - which is how this was caught -
            // but the same mistake with `any` would have accepted the value and
            // silently ignored it, leaving the operator to wonder why their cap had
            // no effect.
            ...(launch.maxActions === undefined ? {} : { maxActions: launch.maxActions }),
        });
        void p.then(() => store.complete(id), (err) => store.fail(id, err));
    }
    catch (err) {
        store.fail(id, err);
        badRequest(res, `launch failed: ${err.message}`);
        return;
    }
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id }));
}
/** GET /api/engagements — list all (live first, then history). */
export function handleList(store, res) {
    json(res, 200, store.list());
}
/** GET /api/engagements/:id — state snapshot + artifact availability. */
export function handleDetail(store, res, id) {
    const dir = engagementDir(store.engagementsDir, id);
    const state = dir ? readState(dir) : null;
    if (!state) {
        // No state.json. Either the run is still starting, or it died before it
        // wrote one — a missing SECSCAN_MCP_TOKEN, a refused scope, an expired
        // authorization. Report the in-memory record so the operator learns WHY,
        // instead of the bare "unknown engagement" this used to return.
        const rec = store.get(id);
        if (!rec) {
            json(res, 404, { error: "unknown engagement" });
            return;
        }
        json(res, 200, {
            state: null,
            pending: true,
            live: rec.running === true,
            status: rec.status,
            target: rec.target ?? null,
            mode: rec.mode ?? null,
            startedAt: rec.startedAt,
            error: rec.error ?? null,
            artifacts: {
                report: false,
                compliancePack: false,
                attestation: false,
                safetyManifest: false,
                itemVerdicts: false,
                proofBundles: 0,
            },
        });
        return;
    }
    const live = store.get(id);
    json(res, 200, {
        state,
        live: !!live?.running,
        artifacts: {
            report: store.readTextArtifact(id, "report.md") !== null,
            compliancePack: store.readTextArtifact(id, "compliance-pack.md") !== null,
            attestation: store.readTextArtifact(id, "attestation.md") !== null,
            safetyManifest: store.readTextArtifact(id, "safety-manifest.md") !== null,
            itemVerdicts: store.readJsonArtifact(id, "item-verdicts.json") !== null,
            proofBundles: store.listSubdir(id, "poc").length,
        },
    });
}
//# sourceMappingURL=engagements.js.map