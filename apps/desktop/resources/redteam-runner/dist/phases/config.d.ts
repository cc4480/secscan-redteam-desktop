/**
 * Runner config resolution (v0.19.0 refactor — extracted from phases.ts).
 */
import { type ResolvedRunnerConfig } from '../types.js';
export declare function resolveConfig(env: NodeJS.ProcessEnv, opts?: {
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
    /** Reflection cap override (see ResolvedRunnerConfig). Env REDTEAM_REFLECTOR_CAP. */
    reflectorCap?: number;
    maxActions?: number;
    maxDurationMs?: number;
    probeDelayMs?: number;
    engagementsDir?: string;
    registryPath?: string;
    /** Q-MEMTIER memory root override. Env REDTEAM_MEMORY_ROOT, then <registry dir>/memory. */
    memoryRoot?: string;
    dryRunAgents?: boolean;
    localSandbox?: boolean;
    /** TEST MODE. See ResolvedRunnerConfig.testMode. Env REDTEAM_TEST_MODE=1. Default false. */
    testMode?: boolean;
    /** Per-host rate limit override (requests/sec). Env REDTEAM_MAX_RPS. Production caps at 2 mechanically. */
    maxRpsPerHost?: number;
    /** v0.20.0: per-item variant cap override. Env REDTEAM_MAX_VARIANTS. Undefined = env default (25 staging, 10 production). */
    maxVariantsPerItem?: number;
    /** Q-LOCKOUT: operator-declared expected account-lockout threshold. Env REDTEAM_LOCKOUT_THRESHOLD. Undefined = interlock default 5. */
    lockoutThreshold?: number;
    /** Q-LOCKOUT: campaign ceiling on total failed validations. Env REDTEAM_LOCKOUT_TOTAL. Undefined = interlock default 25. */
    lockoutTotalFailures?: number;
    /** Q-LOCKOUT: per-host call budget for opaque multi-attempt runs. Env REDTEAM_LOCKOUT_OPAQUE_RUNS. Undefined = interlock default 1. */
    lockoutOpaqueRuns?: number;
}): ResolvedRunnerConfig;
