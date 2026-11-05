import { HostExecutor } from '../host-exec/index.js';
import { McpClient } from '../mcp.js';
import { MsfExecutor } from '../msf/index.js';
import { NucleiExecutor } from '../nuclei/index.js';
import { NmapExecutor } from '../nmap/index.js';
import { CredentialAttemptGuard, TargetRateLimiter, attestedHostAllowed } from '../safety/index.js';
import { WebProber, allHostsPrivateOrLoopback } from '../prober.js';
import { activeTargets } from '../targets.js';
import { buildItemLedger } from '../coverage/items.js';
import { resolveVariantCap } from '../variants/index.js';
export function buildEngagementContext(opts) {
    const { input, config, deps, events, hosts, environment, prodConfirmed, rps, productionCapApplied, tier, approvals, registry, registryPath, } = opts;
    const ctx = {
        input,
        config,
        deps,
        events,
        mcp: deps.mcp ?? new McpClient({ endpoint: config.mcpEndpoint, token: config.mcpToken }),
        prober: deps.prober ?? new WebProber({ scopeHosts: hosts, minDelayMs: config.probeDelayMs, allowPrivateHosts: (config.localSandbox && allHostsPrivateOrLoopback(hosts)) || config.testMode, attestedHost: host => attestedHostAllowed(ctx, host) }),
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
        excludedNote: '',
        startedAt: Date.now(),
        actions: 0,
        plan: null,
        opsecCooldown: new Set(),
        consecutive5xx: 0,
        llmDown: false,
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
        fingerprint: { host: hosts[0], stack: [], appType: 'unknown' },
        registry,
        registryPath,
        registryHits: [],
        targetMap: [],
        liveFindings: [],
        killedLive: [],
        peerKilledLive: [],
        peerDeferredLive: [],
        redirects: { "plan→recon": 0, "recon→exploit": 0, "exploit→report": 0 },
        wallRedirects: 0,
        deniedStreak: 0,
    };
    return ctx;
}
//# sourceMappingURL=run-context.js.map