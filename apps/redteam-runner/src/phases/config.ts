/**
 * Runner config resolution (v0.19.0 refactor — extracted from phases.ts).
 */
import { type ResolvedRunnerConfig } from "../types.js";
import { join } from "node:path";

/**
 * Parse an env-provided positive number at config-parse time (v0.28.0).
 * Mirrors the rotation config precedent: fail fast with a message naming
 * the exact variable instead of dying later on NaN deep inside a
 * constructor or limiter.
 */
function parseEnvPositiveNumber(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`[runner] bad ${name}=${JSON.stringify(raw)}; want a positive number`);
  }
  return n;
}

export function resolveConfig(env: NodeJS.ProcessEnv, opts: {
  mcpToken?: string;
  deepseekApiKey?: string;
  /** Meta Model API key. Env MODEL_API_KEY (META_API_KEY fallback). The fleet's provider key. */
  modelApiKey?: string;
  /** Opt-in service verification (env REDTEAM_VERIFY_VIA_SERVICE=1). Default: verification from the engagement record. */
  verifyViaService?: boolean;
  qwenApiKey?: string;
  mcpEndpoint?: string;
  maxReconTurns?: number;
  maxExploitProbes?: number;
  /** Progress-aware round caps (see ResolvedRunnerConfig). Env REDTEAM_SOFT_ROUND_CAP / REDTEAM_HARD_ROUND_CAP. */
  softRoundCap?: number;
  hardRoundCap?: number;
  maxActions?: number;
  maxDurationMs?: number;
  probeDelayMs?: number;
  engagementsDir?: string;
  registryPath?: string;
  dryRunAgents?: boolean;
  localSandbox?: boolean;
  /** Per-host rate limit override (requests/sec). Env REDTEAM_MAX_RPS. Production caps at 2 mechanically. */
  maxRpsPerHost?: number;
  /** v0.20.0: per-item variant cap override. Env REDTEAM_MAX_VARIANTS. Undefined = env default (25 staging, 10 production). */
  maxVariantsPerItem?: number;
} = {}): ResolvedRunnerConfig {
  // The SecScan MCP token is NOT a startup requirement: it is only read
  // when the operator opts into service verification
  // (REDTEAM_VERIFY_VIA_SERVICE=1). The default authorize path verifies
  // from the engagement record and never touches the service.
  const mcpToken = opts.mcpToken ?? env["SECSCAN_MCP_TOKEN"] ?? "";
  const verifyViaService = opts.verifyViaService ?? env["REDTEAM_VERIFY_VIA_SERVICE"] === "1";
  if (verifyViaService && !mcpToken) {
    throw new Error(
      "[runner] REDTEAM_VERIFY_VIA_SERVICE=1 asks the SecScan service to verify domains, but SECSCAN_MCP_TOKEN is not set. Enter the SecScan MCP token via the Secure Vault, or unset REDTEAM_VERIFY_VIA_SERVICE to verify from the engagement record.",
    );
  }
  const deepseekApiKey = opts.deepseekApiKey ?? env["DEEPSEEK_API_KEY"];
  const modelApiKey = opts.modelApiKey ?? env["MODEL_API_KEY"] ?? env["META_API_KEY"];
  // A live engagement needs ONE configured model provider: the fleet's
  // Meta key, a DeepSeek key, or the offline local provider
  // (REDTEAM_LLM_PROVIDER=local, keyless by design). Nothing else — in
  // particular not the SecScan service — gates the start.
  const localProvider = env["REDTEAM_LLM_PROVIDER"]?.trim().toLowerCase() === "local";
  if (!modelApiKey && !deepseekApiKey && !localProvider && !opts.dryRunAgents) {
    throw new Error(
      "[runner] No model provider key is configured. Set MODEL_API_KEY (Meta Model API — the fleet's provider) via the Secure Vault (it lands in the environment).",
    );
  }
  // v0.6: no role currently routes to Qwen (see llm-router/src/policy.ts),
  // so its key is optional here. It's still read/threaded through so
  // flipping policy.ts back to Qwen for the exploiter needs no
  // config-layer change.
  const qwenApiKey = opts.qwenApiKey ?? env["QWEN_API_KEY"] ?? env["DASHSCOPE_API_KEY"];
  if (opts.qwenApiKey && !env["QWEN_API_KEY"] && !env["DASHSCOPE_API_KEY"]) {
    // Key passed programmatically: make it visible to the provider, which
    // reads env only. Never logged, never persisted.
    env["QWEN_API_KEY"] = opts.qwenApiKey;
  }
  return {
    // Blank-but-present SECSCAN_MCP_URL (the .env.example convention for
    // "unset, use the default") must fall through too — "" ?? x is "",
    // not x, so a stray fetch("") blew up here before the .trim()/|| guard.
    mcpEndpoint: opts.mcpEndpoint || env["SECSCAN_MCP_URL"]?.trim() || "https://secscan.us/api/mcp",
    mcpToken,
    deepseekApiKey: deepseekApiKey ?? "",
    modelApiKey: modelApiKey ?? "",
    verifyViaService,
    qwenApiKey: qwenApiKey ?? "",
    maxReconTurns: opts.maxReconTurns ?? 10,
    maxExploitProbes: opts.maxExploitProbes ?? 12,
    softRoundCap: opts.softRoundCap ?? parseEnvPositiveNumber(env["REDTEAM_SOFT_ROUND_CAP"], "REDTEAM_SOFT_ROUND_CAP"),
    hardRoundCap: opts.hardRoundCap ?? parseEnvPositiveNumber(env["REDTEAM_HARD_ROUND_CAP"], "REDTEAM_HARD_ROUND_CAP"),
    maxActions: opts.maxActions ?? 60,
    maxDurationMs: opts.maxDurationMs ?? 45 * 60_000,
    probeDelayMs: opts.probeDelayMs ?? 800,
    engagementsDir:
      opts.engagementsDir ??
      (env["REDTEAM_HOME"] ? join(env["REDTEAM_HOME"], "engagements", "live") : join(process.cwd(), "engagements", "live")),
    registryPath:
      opts.registryPath ??
      (env["REDTEAM_HOME"] ? join(env["REDTEAM_HOME"], "engagements", "registry.json") : join(process.cwd(), "engagements", "registry.json")),
    dryRunAgents: opts.dryRunAgents ?? false,
    localSandbox: opts.localSandbox ?? env["REDTEAM_LOCAL_SANDBOX"] === "1",
    maxRpsPerHost: opts.maxRpsPerHost ?? parseEnvPositiveNumber(env["REDTEAM_MAX_RPS"], "REDTEAM_MAX_RPS"),
    maxVariantsPerItem: opts.maxVariantsPerItem ?? parseEnvPositiveNumber(env["REDTEAM_MAX_VARIANTS"], "REDTEAM_MAX_VARIANTS"),
  };
}

