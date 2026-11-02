/**
 * runEngagement entry point + RunOptions (v0.19.0 refactor — extracted from phases.ts).
 */
import { ApprovalLog, TIER_ENV, defaultTier, describeTier, parseTier, requireNamedOperator, requireTier2ProductionApproval, resolveOperatorName, tier2ProductionConfirmed, writeTierFile } from "../accountability/index.js";
import { HaltError } from "../context.js";
import { EventLog } from "../events.js";
import { HostExecutor } from "../host-exec/index.js";
import { McpClient } from "../mcp.js";
import { MsfExecutor } from "../msf/index.js";
import { NucleiExecutor } from "../nuclei/index.js";
import { NmapExecutor } from "../nmap/index.js";
import { CredentialAttemptGuard, TargetRateLimiter, describeEnvironment, parseEnvironment, productionConfirmed, requireGraduation, resolveEffectiveRps, resolveLogRotationConfig, assertDistFresh } from "../safety/index.js";
import { loadRegistryFile, saveRegistryFile, seedRegistry } from "../registry.js";
import { WebProber, allHostsPrivateOrLoopback } from "../prober.js";
import { activeTargets } from "../targets.js";
import { buildItemLedger } from "../coverage/items.js";
import { fireSlack, reportPhase, scribeGate } from "../report.js";
import { finalizeDeliverables } from "../report/deliverables.js";
import { inTestWindow, scopeHosts } from "../gate.js";
import { safeEngagementId } from "../util.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { verifiedRecordFor } from "../prompts/fleet-assembly.js";
import { authorizePhase } from "./authorize.js";
import { deadCredentialHaltReason } from "./dead-credential.js";
import { planPhase } from "./plan.js";
import { reconPhase } from "./recon.js";
import { exploitPhase } from "./exploit.js";
import { registerLive, unregisterLive } from "../live.js";
import { resolveConfig } from "./config.js";
import { coordinatorSignOff } from "./signoff.js";
import { peerReviewPhase } from "./peer-review.js";
import { resolveVariantCap } from "../variants/index.js";
import { captureEngagementTrajectory } from "../harness2/trajectory.js";
import { poolSnapshots, roleModelPolicy } from "@secscan/redteam-llm-router";
import { MemoryError, commitMemoryForRun, deriveEngagementScope, injectExploitMemory, injectStartMemory, openEngagementMemory, } from "../memory/index.js";
export async function runEngagement(input, opts = {}) {
    // Stale compiled dist/ is a silent-safety bug (an old model policy running after a src-only change). Fail fast — before any target touch.
    assertDistFresh();
    const config = resolveConfig(process.env, opts);
    const deps = opts.deps ?? {};
    if (!input.target)
        throw new Error("[runner] target is required");
    if (!["red", "black"].includes(input.mode))
        throw new Error(`[runner] mode must be red|black, got ${input.mode}`);
    if (!input.roe?.scope?.length)
        throw new Error("[runner] ROE scope is required (exact hosts).");
    if (!config.testMode && !inTestWindow(new Date(), input.roe)) {
        throw new Error("[runner] current time is outside the ROE test window — refusing to run.");
    }
    // v0.13.0 safety case: staging→production graduation is MECHANICAL.
    // Production without explicit operator confirmation refuses to start —
    // fail fast, before the engagement directory is even created.
    const environment = input.environment ?? parseEnvironment(process.env["REDTEAM_ENV"]);
    const prodConfirmed = input.confirmProduction ?? productionConfirmed(process.env);
    if (!config.testMode)
        requireGraduation(environment, prodConfirmed);
    const { rps, productionCapApplied } = resolveEffectiveRps(environment, config.maxRpsPerHost);
    // v0.17.0 accountability: autonomy tiers + named human operator.
    // Tier resolves: explicit input → REDTEAM_TIER → environment default
    // (staging: Tier 2 chain, production: Tier 1 validate). Tier 2 on
    // production needs its own explicit operator approval. Production always
    // needs a NAMED human operator — someone must own the findings.
    // All fail fast, before the engagement directory is even created.
    const tier = input.tier ?? parseTier(process.env[TIER_ENV]) ?? defaultTier(environment);
    const tier2ProdConfirmed = input.confirmTier2Production ?? tier2ProductionConfirmed(process.env);
    if (!config.testMode)
        requireTier2ProductionApproval(tier, environment, tier2ProdConfirmed);
    const operator = resolveOperatorName(input.operatorName, process.env);
    if (!config.testMode)
        requireNamedOperator(environment, operator);
    const hosts = scopeHosts(input.roe);
    if (hosts.length === 0)
        throw new Error("[runner] ROE scope produced no parseable hosts — refusing to run.");
    const engagementId = safeEngagementId(opts.engagementId);
    const dir = join(config.engagementsDir, engagementId);
    // v0.26.0: log rotation — CLI/env overrides, then env defaults. events.jsonl
    // and engagement.md rotate together when the cap is hit (see EventLog).
    const rotation = resolveLogRotationConfig(process.env, {
        maxLogBytes: opts.maxLogBytes,
        maxLogArchives: opts.maxLogArchives,
    });
    const events = new EventLog(dir, engagementId, { target: input.target, mode: input.mode, objective: input.objective }, rotation);
    // v0.17.0 accountability: the append-only approval log. Tier declared and
    // production confirmation are recorded here FIRST — before any agent acts.
    const approvals = new ApprovalLog(dir, engagementId);
    const operatorLabel = operator ?? "(operator name not supplied — set REDTEAM_OPERATOR)";
    approvals.append("tier-declared", operatorLabel, `Autonomy ${describeTier(tier)} declared for ${environment} engagement`, undefined, tier);
    if (environment === "production") {
        approvals.append("production-confirm", operatorLabel, "Production engagement explicitly confirmed by operator");
        if (tier === 2) {
            approvals.append("tier-escalation", operatorLabel, "Tier 2 (chain) on production explicitly approved by operator", 1, 2);
        }
    }
    // v0.24.0: tier.json — the mid-run tier signal. The dispatcher re-reads it
    // before every tier check; `redteam-runner escalate` and the UI rewrite it
    // (atomically) when the operator changes the tier. No new network surface.
    writeTierFile(dir, { tier, declared: tier, environment, updatedAt: new Date().toISOString() });
    // The registry: load, or seed with the v0.3.x secscan.us engagement data on first run.
    const registryPath = config.registryPath;
    const loadedRegistry = loadRegistryFile(registryPath);
    // Q-MEMTIER §8 row 1: a registry file that EXISTS but does not load is
    // corrupt or wrong-version — fail loud naming the path, before seeding
    // can overwrite the only copy. (Absent file → seed, unchanged.)
    if (loadedRegistry === null && existsSync(registryPath)) {
        throw new MemoryError("REGISTRY_UNREADABLE", `findings registry at ${registryPath} exists but could not be loaded (corrupt or wrong version) — refusing to seed over it`);
    }
    const registry = loadedRegistry ?? seedRegistry();
    saveRegistryFile(registryPath, registry);
    const ctx = {
        input,
        config,
        deps,
        events,
        mcp: deps.mcp ?? new McpClient({ endpoint: config.mcpEndpoint, token: config.mcpToken }),
        prober: deps.prober ?? new WebProber({ scopeHosts: hosts, minDelayMs: config.probeDelayMs, allowPrivateHosts: (config.localSandbox && allHostsPrivateOrLoopback(hosts)) || config.testMode }),
        hostExecutor: deps.hostExecutor ?? new HostExecutor({ testMode: config.testMode }),
        msfExecutor: deps.msfExecutor ?? new MsfExecutor({ testMode: config.testMode }),
        nucleiExecutor: deps.nucleiExecutor ?? new NucleiExecutor(),
        nmapExecutor: deps.nmapExecutor ?? new NmapExecutor(),
        nuclei: { templateExecutions: 0, templatesRun: 0, findings: 0 },
        // v0.13.0 safety case: mechanical protections, armed from engagement start.
        safety: {
            limiter: new TargetRateLimiter({ rpsPerHost: rps, disabled: config.testMode }),
            // Q-LOCKOUT: the credential-attempt interlock, armed from engagement
            // start with the operator-declared lockout policy (defaults: threshold
            // 5, campaign ceiling 25, opaque runs 1/host — see phases/config.ts).
            lockout: new CredentialAttemptGuard({
                lockoutThreshold: config.lockoutThreshold,
                totalFailureCeiling: config.lockoutTotalFailures,
                opaqueRunsPerHost: config.lockoutOpaqueRuns,
            }),
            environment,
            productionConfirmed: prodConfirmed,
            rpsPerHost: rps,
            productionCapApplied,
        },
        // v0.17.0 accountability: graduated autonomy, mechanically enforced.
        tier: { current: tier, declared: tier, chainSteps: new Map() },
        approvals,
        hosts,
        domain: hosts[0],
        excludedNote: "",
        startedAt: Date.now(),
        actions: 0,
        plan: null,
        opsecCooldown: new Set(),
        consecutive5xx: 0,
        coverage: new Set(),
        targetCoverage: new Map(),
        // v0.18.0 per-item verdicts: every selected battery item opens pending
        // (or blocked when its prerequisite is unmet); the report gate refuses
        // "complete" while any item is still pending.
        itemLedger: input.fullBattery ? buildItemLedger(activeTargets(input)) : new Map(),
        probesUsed: 0,
        // v0.20.0 payload-variant expansion: per-item cap resolved mechanically
        // (env default 25 staging / 10 production; --max-variants / REDTEAM_MAX_VARIANTS).
        variantCap: resolveVariantCap(environment, config.maxVariantsPerItem),
        fingerprint: { host: hosts[0], stack: [], appType: "unknown" },
        registry,
        registryPath,
        registryHits: [],
        targetMap: [],
        liveFindings: [],
        killedLive: [],
        peerKilledLive: [],
        peerDeferredLive: [],
        redirects: 0,
        deniedStreak: 0,
    };
    // Q-MEMTIER moment 1 (§7.1): open the engagement memory store right
    // after the registry load, before any agent acts — a corrupt store
    // stops the run at the same fail-fast altitude as the checks above.
    // No scope exists yet, so nothing is recalled here.
    ctx.memory = openEngagementMemory(ctx, { root: config.memoryRoot, engagementDir: dir, deps: deps.memory });
    // v0.30.0: publish this context so the console and the MCP bridge can invoke
    // the executor tools (nuclei_exec, msf_exec, http_probe, …) on demand while
    // the engagement runs. Registered here — before any agent acts — so the tools
    // are reachable for the whole live window, and withdrawn in the finally below
    // so a finished engagement reports "not running" rather than serving a stale
    // context whose executors no longer belong to anything.
    registerLive(engagementId, ctx);
    events.append({ phase: "authorize", actor: "runner", action: "engagement_start", target: input.target, result: `Mode=${input.mode.toUpperCase()} env=${describeEnvironment(environment, prodConfirmed)} tier=${describeTier(tier)} rate_limit=${rps}rps/host objective="${input.objective}" scope=[${hosts.join(", ")}] registry=${registry.confirmed.length} confirmed / ${registry.killed.length} killed entries loaded` });
    // v0.15.0: Slack lifecycle — engagement started (best-effort, never blocking).
    void fireSlack(ctx, { kind: "started" });
    // Hoisted so the halt path (catch) can still assemble the report/safety
    // artifacts from whatever work completed before the halt.
    let brief = "";
    let summary = "";
    // Hoisted (Q-MEMTIER §2.3): the finally block attaches the memory
    // commit receipt (result.memory) before the return completes.
    let result;
    try {
        const verdict = await authorizePhase(ctx);
        if (!verdict.allowed) {
            // Q-DELIVERABLES-AUTOFIRE (P3): a blocked end still closes with the
            // deliverable set — mechanically (no reporter LLM), the block as the
            // headline and grade N/A — so a refused scan never vanishes silently.
            // Defensive like the halt path: a failure here never masks the block.
            events.updateState({ status: "blocked", phase: "report", blockedReason: verdict.reason });
            let blockedFindings = [];
            try {
                blockedFindings = await reportPhase(ctx, brief, summary, { blockedReason: verdict.reason });
            }
            catch (reportErr) {
                events.append({ phase: "report", actor: "runner", action: "blocked_report_failed", result: `Could not write blocked-end artifacts: ${reportErr.message}` });
            }
            const delivered = finalizeDeliverables(ctx);
            result = { engagementId, status: "blocked", blockedReason: verdict.reason, reportPath: join(dir, "report.md"), findings: blockedFindings, deliverables: delivered.paths, ...(delivered.ok ? {} : { deliverableFailed: true }) };
            return result;
        }
        // Q-MEMTIER moment 2 (§7.1): derive the verified scope and assemble
        // the start pack — after authorization, before planning. Throws
        // MEMORY_SCOPE_UNVERIFIED when the record carries no proof.
        deriveEngagementScope(ctx);
        // Phase 2 W3: the production fail-loud gate for fleet prompt
        // assembly. Authorize succeeded, so its stamped verification record
        // MUST exist; verifiedRecordFor throws when it does not, and no
        // fleet prompt is ever assembled from an unattested record. (The
        // record itself is rebuilt per prompt by agents.ts promptCtx.)
        verifiedRecordFor(ctx);
        injectStartMemory(ctx);
        // FIX-DEADKEY fail-fast: a fleet credential the provider already
        // pronounced dead (recorded in the router's pool) halts the
        // engagement here — before the plan phase — with the honest terminal
        // cause and the remedy, instead of dying mid-plan behind a generic
        // give-up. Living credentials (or no pool) pass through untouched.
        const deadReason = deadCredentialHaltReason(poolSnapshots(), roleModelPolicy().coordinator.provider);
        if (deadReason !== undefined)
            throw new HaltError(deadReason);
        await planPhase(ctx);
        await coordinatorSignOff(ctx, "plan→recon", `Operation plan:\n${JSON.stringify(ctx.plan, null, 1)}`);
        void fireSlack(ctx, { kind: "phase", phase: "recon" });
        brief = await reconPhase(ctx);
        // Q-MEMTIER moment 3 (§7.1): the refresh pack — after recon, with
        // the fingerprint set, before the recon→exploit sign-off.
        const refreshPack = injectExploitMemory(ctx);
        await coordinatorSignOff(ctx, "recon→exploit", `Recon brief:\n${brief.slice(0, 3000)}\n\nShared target map (${ctx.targetMap.length} entries):\n${ctx.targetMap.map((t) => `- ${t.method} ${t.area}${t.authState ? ` [${t.authState}]` : ""}${t.attackId ? ` ${t.attackId}` : ""}`).join("\n") || "(empty)"}\nRegistry hits consulted: ${ctx.registryHits.length}. Fingerprint: ${JSON.stringify(ctx.fingerprint)}\nMemory refresh: ${refreshPack.survivors.length} units surfaced (${[...new Set(refreshPack.survivors.map((s) => s.tier))].join(", ") || "none"}), receipt ${refreshPack.receiptId}`);
        summary = await exploitPhase(ctx, brief);
        // Q-FLEET-XCHECK: the reviewer pass — every finding is challenged
        // by a different seat than its producer before the report, and
        // before this sign-off, so the verdict counts below are the
        // post-challenge counts.
        await peerReviewPhase(ctx);
        void fireSlack(ctx, { kind: "phase", phase: "exploit" });
        await coordinatorSignOff(ctx, "exploit→report", `Exploitation summary:\n${summary.slice(0, 3000)}\n\nVerdicts — confirmed: ${ctx.liveFindings.length}, killed: ${ctx.killedLive.length}.\nBattery: ${["logic", "functionality", "validation"].map((c) => `${c}:${ctx.coverage.has(c) ? "yes" : "no"}`).join(", ")}.`);
        const findings = await reportPhase(ctx, brief, summary);
        void fireSlack(ctx, { kind: "phase", phase: "report" });
        // SCRIBE GATE, then Q-DELIVERABLES-AUTOFIRE: the publisher seat signs
        // the closing set (or leaves it UNSIGNED — report/scribe.ts); the set
        // is then verified on disk before the completion is recorded.
        events.updateState({ status: "complete", phase: "done" });
        const scribeOutcome = await scribeGate(ctx);
        events.append({
            phase: "report",
            actor: "runner",
            action: "scribe_gate_outcome",
            result: scribeOutcome.signed
                ? `Scribe gate outcome: signed after ${scribeOutcome.cycles} review cycle(s).`
                : `Scribe gate outcome: shipped unsigned (${scribeOutcome.reason ?? "unspecified"}) after ${scribeOutcome.cycles} review cycle(s).`,
        });
        const delivered = finalizeDeliverables(ctx);
        if (delivered.ok) {
            events.append({ phase: "done", actor: "runner", action: "engagement_complete", result: `Complete. ${findings.length} findings.` });
        }
        result = { engagementId, status: "complete", reportPath: join(dir, "report.md"), findings, deliverables: delivered.paths, ...(delivered.ok ? {} : { deliverableFailed: true }) };
        return result;
    }
    catch (err) {
        const reason = err instanceof HaltError ? err.message : `unexpected error: ${err.message}`;
        events.updateState({ status: "halted", phase: "halted", blockedReason: reason });
        events.append({ phase: "halted", actor: "runner", action: "engagement_halted", result: reason });
        void fireSlack(ctx, { kind: "halted", reason });
        // A halt is exactly when the zero-disruption record matters most (5xx
        // aborted sign-off). Still emit the mechanical
        // accountability artifacts — safety manifest, item verdicts, proof
        // bundles, partial report — WITHOUT re-running the reporter LLM (it could
        // re-hit the same cap). Defensive: a failure here must never mask the halt.
        let findings = events.snapshot.findings;
        let reportPath;
        try {
            findings = await reportPhase(ctx, brief, summary, { haltedReason: reason });
            reportPath = join(dir, "report.md");
        }
        catch (reportErr) {
            events.append({ phase: "halted", actor: "runner", action: "halt_report_failed", result: `Could not write halt artifacts: ${reportErr.message}` });
        }
        // Q-DELIVERABLES-AUTOFIRE (G5): the halt close also verifies the set —
        // including when reportPhase itself threw — so the record always
        // names what was delivered and flags any gap.
        const delivered = finalizeDeliverables(ctx);
        result = { engagementId, status: "halted", blockedReason: reason, reportPath, findings, deliverables: delivered.paths, ...(delivered.ok ? {} : { deliverableFailed: true }) };
        return result;
    }
    finally {
        unregisterLive(engagementId);
        // H2-P1a: additive trajectory/metrics capture for every outcome; guarded so it never throws into the run (tokens: see TOKEN_CAPTURE_STATUS).
        captureEngagementTrajectory({ engagementDir: dir, engagementId, target: input.target, targetIds: input.targets, ctx, events });
        // Q-MEMTIER §7.2: the two-phase memory commit runs AFTER trajectory
        // capture (the archive copies the trajectory/metrics/run files). A
        // Phase-1 archive failure (MemoryArchiveError) replaces the return
        // by design; Phase-2 failures land on the receipt, never throw.
        const memoryReceipt = commitMemoryForRun(ctx, {
            status: result?.status ?? "halted",
            ...(result?.blockedReason ? { haltReason: result.blockedReason } : {}),
        });
        if (memoryReceipt && result)
            result.memory = memoryReceipt;
        // v0.23.0: no blind save here. Every verdict persists atomically via transactRegistryFile at write time; a whole-file save of this engagement's in-memory copy would clobber verdicts transacted by a concurrent engagement.
    }
}
//# sourceMappingURL=run.js.map