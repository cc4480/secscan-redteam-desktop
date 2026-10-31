/**
 * Runner config resolution (v0.19.0 refactor — extracted from phases.ts).
 */
import { type ResolvedRunnerConfig } from '../types.js'
export declare function resolveConfig(env: NodeJS.ProcessEnv, opts?: {
  mcpToken?: string
  deepseekApiKey?: string
  qwenApiKey?: string
  mcpEndpoint?: string
  maxReconTurns?: number
  maxExploitProbes?: number
  /** Progress-aware round caps (see ResolvedRunnerConfig). Env REDTEAM_SOFT_ROUND_CAP / REDTEAM_HARD_ROUND_CAP. */
  softRoundCap?: number
  hardRoundCap?: number
  maxActions?: number
  maxDurationMs?: number
  probeDelayMs?: number
  engagementsDir?: string
  registryPath?: string
  dryRunAgents?: boolean
  localSandbox?: boolean
  /** Per-host rate limit override (requests/sec). Env REDTEAM_MAX_RPS. Production caps at 2 mechanically. */
  maxRpsPerHost?: number
  /** v0.20.0: per-item variant cap override. Env REDTEAM_MAX_VARIANTS. Undefined = env default (25 staging, 10 production). */
  maxVariantsPerItem?: number
}): ResolvedRunnerConfig
