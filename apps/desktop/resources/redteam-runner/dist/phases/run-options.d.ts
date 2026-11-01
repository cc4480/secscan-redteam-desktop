/**
 * RunOptions (extracted from run.ts, which sat at the 300-line file
 * budget: the in-house start options — modelApiKey, verifyViaService —
 * are what pushed it over).
 */
import { type RunnerDeps } from "../context.js";
export interface RunOptions {
    mcpToken?: string;
    deepseekApiKey?: string;
    /** Meta Model API key (env MODEL_API_KEY preferred). The fleet's provider key. */
    modelApiKey?: string;
    /** Opt-in service verification (env REDTEAM_VERIFY_VIA_SERVICE=1). Default: verification from the engagement record. */
    verifyViaService?: boolean;
    /** Alibaba Model Studio key. Optional since v0.6 (DeepSeek-only policy — no role routes to Qwen); threaded through so reinstating Qwen needs no config change. Env QWEN_API_KEY preferred. */
    qwenApiKey?: string;
    mcpEndpoint?: string;
    /** Override the generated engagement ID (the console passes its request ID for correlation). */
    engagementId?: string;
    maxReconTurns?: number;
    maxExploitProbes?: number;
    maxActions?: number;
    maxDurationMs?: number;
    probeDelayMs?: number;
    engagementsDir?: string;
    /** Registry path override (tests). Defaults to <REDTEAM_HOME>/engagements/registry.json. */
    registryPath?: string;
    /** Memory root override (tests + CLI). Defaults to REDTEAM_MEMORY_ROOT, then <registry dir>/memory. */
    memoryRoot?: string;
    /** Per-host rate limit override (requests/sec). Env REDTEAM_MAX_RPS. Production caps at 2 mechanically. */
    maxRpsPerHost?: number;
    /** v0.20.0: per-item variant cap override. Env REDTEAM_MAX_VARIANTS. Undefined = env default (25 staging, 10 production). */
    maxVariantsPerItem?: number;
    /**
     * v0.26.0: log-rotation overrides. CLI --log-max-bytes / --log-max-archives,
     * env REDTEAM_LOG_MAX_BYTES / REDTEAM_LOG_MAX_ARCHIVES. Undefined = env,
     * then defaults (50 MiB, 5 archives). events.jsonl and engagement.md
     * rotate together when the cap is hit; the fresh file leads with a
     * `log_rotated` audit event so the audit trail stays resolvable.
     */
    maxLogBytes?: number;
    maxLogArchives?: number;
    dryRunAgents?: boolean;
    /** LOCAL SANDBOX MODE ONLY. See ResolvedRunnerConfig.localSandbox. Default false. */
    localSandbox?: boolean;
    /** TEST MODE. See ResolvedRunnerConfig.testMode. Env REDTEAM_TEST_MODE=1. Default false. */
    testMode?: boolean;
    deps?: RunnerDeps;
}
