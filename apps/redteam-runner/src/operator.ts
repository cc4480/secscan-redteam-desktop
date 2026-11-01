/**
 * Operator dispatch — the executor tools with NO live engagement (v0.31.0).
 *
 * Carlos's order (2026-11-01): the executor bridges (http_probe, msf_exec,
 * nmap_exec, nuclei_exec, ssh_exec, …) must not be gated on a running
 * engagement — "I don't want anything gated, especially those tools." The
 * gated design routed every MCP executor call through a live engagement's
 * context, so with nothing running the tools were dead. This module is the
 * other path: a call that names NO engagement executes directly, as the
 * operator's own call, against the target named in its arguments.
 *
 * The posture is deliberate and narrow:
 *
 *   - Dispatch goes through dispatchToolInner — the handler chain itself —
 *     NOT through dispatchTool's engagement safety wrapper. There is no
 *     tier refusal, no scope refusal, no auto-halt, no lockout interlock,
 *     no variant cap and no ESTOP check on this path, because there is no
 *     engagement for those mechanisms to belong to.
 *   - What the handlers themselves require is seated per call: the target
 *     host resolved from the call's arguments becomes the context's scope
 *     (hosts / verifiedScope / prober scope), so the per-handler target
 *     checks validate the operator's own named target and nothing else.
 *   - The context posture is Tier 2 with production confirmed: the operator
 *     placing the call IS the confirmation. Handler-level checks that read
 *     the tier (e.g. nmap profile minTier) see the operator's full tier.
 *   - Two things are kept, because they are not gates: the per-host rate
 *     limiter still paces calls (it delays; it never denies), and every
 *     call is written to the operator context's event log (audit) — a call
 *     that leaves no record did not happen.
 *
 * Calls are serialized through a single chain: the context is shared and
 * its scope is seated per call, so two operator calls never interleave
 * their seating. The operator is one person at one console; the queue is
 * the honest shape.
 *
 * A call that names an engagement id never reaches this module — the MCP
 * surface routes it to dispatchLiveTool, and a non-live id fails there
 * with an honest "not running" error rather than falling back to here.
 * Implicit retargeting is the one part of the old design that stays.
 */

import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import { type Ctx, type RunnerDeps } from "./context.js";
import { EventLog } from "./events.js";
import { McpClient } from "./mcp.js";
import { WebProber } from "./prober.js";
import { HostExecutor } from "./host-exec/index.js";
import { MsfExecutor } from "./msf/index.js";
import { NucleiExecutor } from "./nuclei/index.js";
import { NmapExecutor } from "./nmap/index.js";
import { CredentialAttemptGuard, TargetAutoHalt, TargetRateLimiter, resolveEffectiveRps } from "./safety/index.js";
import { ApprovalLog } from "./accountability/index.js";
import { loadRegistryFile, seedRegistry, type VulnerabilityRegistry } from "./registry.js";
import { resolveConfig } from "./phases/config.js";
import { resolveVariantCap } from "./variants/index.js";
import type { EngagementInput } from "./types.js";
import { dispatchToolInner } from "./dispatch/handlers.js";
import { toolTargetHost } from "./dispatch/target-host.js";
import type { DispatchResult } from "./dispatch/types.js";

/** The synthetic engagement id the operator context logs under. */
export const OPERATOR_ID = "operator";

export interface OperatorDispatcher {
  readonly ctx: Ctx;
  dispatch(name: string, args: Record<string, unknown>): Promise<DispatchResult>;
}

export interface OperatorOptions {
  /** Injectable transports/executors (tests); defaults are the real ones. */
  deps?: RunnerDeps;
  /** Override for the resolved engagements root (tests). */
  engagementsDir?: string;
  /** Environment to resolve config from (tests). Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Build the operator context: a real Ctx, shaped like an engagement's but
 * belonging to no engagement. Constructed once per dispatcher and reused —
 * the rate limiter's pacing state and the event log are the point of the
 * reuse.
 */
export function buildOperatorCtx(opts: OperatorOptions = {}): Ctx {
  const env = opts.env ?? process.env;
  const deps = opts.deps ?? {};
  // dryRunAgents: operator calls run no agents, so the fleet's model key
  // is not a startup requirement for THIS context (resolveConfig would
  // otherwise refuse to build a config in a process that only serves
  // tools). Nothing about the call path changes.
  const config = resolveConfig(env, { dryRunAgents: true, engagementsDir: opts.engagementsDir });
  const environment = "production" as const;
  const { rps, productionCapApplied } = resolveEffectiveRps(environment, config.maxRpsPerHost);

  // The operator audit log lives BESIDE the engagements root, never inside
  // it: a directory under the live root would be enumerated as an
  // engagement by the console pages.
  const dir = join(dirname(config.engagementsDir), OPERATOR_ID);
  const events = new EventLog(dir, OPERATOR_ID, {
    target: OPERATOR_ID,
    mode: "red",
    objective: "Operator-invoked executor tool calls (no engagement)",
  });
  const approvals = new ApprovalLog(dir, OPERATOR_ID);
  approvals.append("tier-declared", "operator", "Autonomy Tier 2 (full tool access) declared for operator dispatch", undefined, 2);
  approvals.append("production-confirm", "operator", "Production posture confirmed by the operator placing each call");

  // The registry is read (query_registry, record paths) but never seeded
  // over: an existing-but-unloadable registry fails loud, exactly as at
  // engagement start.
  const loadedRegistry = loadRegistryFile(config.registryPath);
  if (loadedRegistry === null && existsSync(config.registryPath)) {
    throw new Error(
      `[runner] findings registry at ${config.registryPath} exists but could not be loaded (corrupt or wrong version) — operator dispatch refuses to run against a seeded-over registry`,
    );
  }
  const registry: VulnerabilityRegistry = loadedRegistry ?? seedRegistry();

  const input: EngagementInput = {
    target: OPERATOR_ID,
    mode: "red",
    objective: "Operator-invoked executor tool calls (no engagement)",
    roe: { scope: [], outOfScope: [] },
  };

  const ctx: Ctx = {
    input,
    config,
    deps,
    events,
    mcp: deps.mcp ?? new McpClient({ endpoint: config.mcpEndpoint, token: config.mcpToken }),
    prober:
      deps.prober ??
      new WebProber({ scopeHosts: [], minDelayMs: config.probeDelayMs, allowPrivateHosts: true }),
    hostExecutor: deps.hostExecutor ?? new HostExecutor({ testMode: config.testMode }),
    msfExecutor: deps.msfExecutor ?? new MsfExecutor({ testMode: config.testMode }),
    nucleiExecutor: deps.nucleiExecutor ?? new NucleiExecutor(),
    nmapExecutor: deps.nmapExecutor ?? new NmapExecutor(),
    nuclei: { templateExecutions: 0, templatesRun: 0, findings: 0 },
    hostKill: { aborted: false, controllers: new Set() },
    safety: {
      limiter: new TargetRateLimiter({ rpsPerHost: rps, disabled: config.testMode }),
      autoHalt: new TargetAutoHalt(),
      lockout: new CredentialAttemptGuard({
        lockoutThreshold: config.lockoutThreshold,
        totalFailureCeiling: config.lockoutTotalFailures,
        opaqueRunsPerHost: config.lockoutOpaqueRuns,
      }),
      environment,
      productionConfirmed: true,
      rpsPerHost: rps,
      productionCapApplied,
      killSwitchAborts: 0,
    },
    tier: { current: 2, declared: 2, chainSteps: new Map() },
    approvals,
    hosts: [],
    domain: "",
    excludedNote: "",
    startedAt: Date.now(),
    actions: 0,
    plan: null,
    opsecCooldown: new Set(),
    consecutive5xx: 0,
    coverage: new Set(),
    targetCoverage: new Map(),
    itemLedger: new Map(),
    probesUsed: 0,
    variantCap: resolveVariantCap(environment, config.maxVariantsPerItem),
    fingerprint: { host: "", stack: [], appType: "unknown" },
    registry,
    registryPath: config.registryPath,
    registryHits: [],
    targetMap: [],
    liveFindings: [],
    killedLive: [],
    peerKilledLive: [],
    peerDeferredLive: [],
    redirects: 0,
    deniedStreak: 0,
  };
  return ctx;
}

/**
 * Seat one call's target on the shared operator context. The host resolved
 * from the call's own arguments becomes the context's scope — hosts,
 * verifiedScope (the scope guard rebuilds itself from the new stamp),
 * domain, fingerprint, input target — and the default prober is re-seated
 * with that host as its scope, so a handler's target validation checks the
 * operator's named target and no other. An injected prober (tests) is left
 * untouched: its scope is the test's own business.
 */
function seatCallTarget(ctx: Ctx, seatProber: boolean, host: string | undefined, args: Record<string, unknown>): void {
  if (!host) return;
  ctx.hosts = [host];
  ctx.domain = host;
  ctx.fingerprint.host = host;
  ctx.verifiedScope = [host];
  ctx.input = {
    ...ctx.input,
    target: typeof args["url"] === "string" ? (args["url"] as string) : host,
    roe: { scope: [host], outOfScope: [] },
  };
  if (seatProber) {
    ctx.prober = new WebProber({
      scopeHosts: [host],
      minDelayMs: ctx.config.probeDelayMs,
      // The operator named this target in the call itself; loopback and
      // private lab hosts are legitimate operator targets. The prober's
      // own hard floor (cloud metadata addresses) still applies — it is
      // enforced inside validateProbeTarget in every mode.
      allowPrivateHosts: true,
    });
  }
}

/**
 * Create an operator dispatcher over a freshly built context. Operator
 * dispatches are serialized: the context is shared and its scope is seated
 * per call, so calls run one at a time, in arrival order.
 */
export function createOperatorDispatcher(opts: OperatorOptions = {}): OperatorDispatcher {
  const ctx = buildOperatorCtx(opts);
  const seatProber = !opts.deps?.prober;
  let chain: Promise<unknown> = Promise.resolve();

  async function dispatchOnce(name: string, args: Record<string, unknown>): Promise<DispatchResult> {
    const call: ToolCallRequest = {
      id: `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      arguments: args,
    };
    const host = toolTargetHost(call);
    seatCallTarget(ctx, seatProber, host, args);
    // Audit first: the call is on record before anything is sent, and the
    // result is appended when it lands. Both entries live in the operator
    // context's own event log, beside the engagements root.
    ctx.events.append({
      phase: "exploit",
      actor: "coordinator",
      action: "operator_tool_call",
      ...(host ? { target: host } : {}),
      result: `Operator dispatch (no engagement): ${name}${host ? ` against ${host}` : ""}.`,
    });
    // The one kept pacing mechanism: the per-host rate limiter delays,
    // never denies.
    if (host) await ctx.safety.limiter.acquire(host);
    const d = await dispatchToolInner(ctx, "coordinator", "exploit", call);
    ctx.events.append({
      phase: "exploit",
      actor: "runner",
      action: "operator_tool_result",
      ...(host ? { target: host } : {}),
      result: d.result.slice(0, 500),
    });
    return d;
  }

  return {
    ctx,
    dispatch(name: string, args: Record<string, unknown>): Promise<DispatchResult> {
      const run = chain.then(() => dispatchOnce(name, args));
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

let shared: OperatorDispatcher | undefined;

/**
 * Dispatch one executor tool call with no engagement, through the
 * process-wide operator dispatcher (built lazily on first use).
 */
export function dispatchOperatorTool(name: string, args: Record<string, unknown>): Promise<DispatchResult> {
  shared ??= createOperatorDispatcher();
  return shared.dispatch(name, args);
}

/**
 * Test seam: replace (or clear, with undefined) the process-wide operator
 * dispatcher so suites can run against fixture transports and a temp
 * engagements root instead of the real config.
 */
export function installOperatorDispatcher(dispatcher: OperatorDispatcher | undefined): void {
  shared = dispatcher;
}
