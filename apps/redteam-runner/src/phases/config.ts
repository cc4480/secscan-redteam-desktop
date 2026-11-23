/**
 * Runner config resolution (v0.19.0 refactor — extracted from phases.ts).
 */
import { type ResolvedRunnerConfig } from '../types.js'
import { MemoryError } from '../memory/errors.js'
import { dirname, join } from 'node:path'

/**
 * Parse an env-provided positive number at config-parse time (v0.28.0).
 * Mirrors the rotation config precedent: fail fast with a message naming
 * the exact variable instead of dying later on NaN deep inside a
 * constructor or limiter.
 */
function parseEnvPositiveNumber(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`[runner] bad ${name}=${JSON.stringify(raw)}; want a positive number`)
  }
  return n
}

export function resolveConfig(env: NodeJS.ProcessEnv, opts: {
  deepseekApiKey?: string
  /** Meta Model API key. Env MODEL_API_KEY (META_API_KEY fallback). Used when REDTEAM_LLM_PROVIDER=meta. */
  modelApiKey?: string
  qwenApiKey?: string
  maxReconTurns?: number
  maxExploitProbes?: number
  /** Progress-aware round caps (see ResolvedRunnerConfig). Env REDTEAM_SOFT_ROUND_CAP / REDTEAM_HARD_ROUND_CAP. */
  softRoundCap?: number
  hardRoundCap?: number
  /** Reflection cap override (see ResolvedRunnerConfig). Env REDTEAM_REFLECTOR_CAP. */
  reflectorCap?: number
  maxActions?: number
  maxDurationMs?: number
  probeDelayMs?: number
  engagementsDir?: string
  registryPath?: string
  /** Q-MEMTIER memory root override. Env REDTEAM_MEMORY_ROOT, then <registry dir>/memory. */
  memoryRoot?: string
  dryRunAgents?: boolean
  localSandbox?: boolean
  /** TEST MODE. See ResolvedRunnerConfig.testMode. Env REDTEAM_TEST_MODE=1. Default false. */
  testMode?: boolean
  /** Per-host rate limit override (requests/sec). Env REDTEAM_MAX_RPS. Production caps at 2 mechanically. */
  maxRpsPerHost?: number
  /** v0.20.0: per-item variant cap override. Env REDTEAM_MAX_VARIANTS. Undefined = env default (25 staging, 10 production). */
  maxVariantsPerItem?: number
  /** Q-LOCKOUT: operator-declared expected account-lockout threshold. Env REDTEAM_LOCKOUT_THRESHOLD. Undefined = interlock default 5. */
  lockoutThreshold?: number
  /** Q-LOCKOUT: campaign ceiling on total failed validations. Env REDTEAM_LOCKOUT_TOTAL. Undefined = interlock default 25. */
  lockoutTotalFailures?: number
  /** Q-LOCKOUT: per-host call budget for opaque multi-attempt runs. Env REDTEAM_LOCKOUT_OPAQUE_RUNS. Undefined = interlock default 1. */
  lockoutOpaqueRuns?: number
} = {}): ResolvedRunnerConfig {
  const deepseekApiKey = opts.deepseekApiKey ?? env['DEEPSEEK_API_KEY']
  const modelApiKey = opts.modelApiKey ?? env['MODEL_API_KEY'] ?? env['META_API_KEY']
  // The fleet seats DeepSeek unless REDTEAM_LLM_PROVIDER selects another
  // family: the DeepSeek seats need DEEPSEEK_API_KEY, the Meta seats need
  // MODEL_API_KEY, and the offline local provider (REDTEAM_LLM_PROVIDER=local)
  // needs no key. No external service gates the start.
  const provider = env['REDTEAM_LLM_PROVIDER']?.trim().toLowerCase() ?? ''
  const localProvider = provider === 'local'
  let keyConfigured: boolean
  if (provider === 'meta') keyConfigured = !!modelApiKey
  else if (provider === '' || provider === 'deepseek') keyConfigured = !!deepseekApiKey
  else keyConfigured = !!(modelApiKey || deepseekApiKey)
  if (!keyConfigured && !localProvider && !opts.dryRunAgents) {
    if (provider === 'meta') {
      throw new Error(
        '[runner] No model provider key is configured. REDTEAM_LLM_PROVIDER=meta needs MODEL_API_KEY (Meta Model API) via the Secure Vault (it lands in the environment).',
      )
    }
    if (provider === '' || provider === 'deepseek') {
      throw new Error(
        '[runner] No model provider key is configured. The fleet seats DeepSeek by default: set DEEPSEEK_API_KEY via the Secure Vault (it lands in the environment), or select Meta with REDTEAM_LLM_PROVIDER=meta and MODEL_API_KEY.',
      )
    }
    throw new Error(
      `[runner] No model provider key is configured for REDTEAM_LLM_PROVIDER=${provider}. Set that provider's key via the Secure Vault (it lands in the environment).`,
    )
  }
  // v0.6: no role currently routes to Qwen (see llm-router/src/policy.ts),
  // so its key is optional here. It's still read/threaded through so
  // flipping policy.ts back to Qwen for the exploiter needs no
  // config-layer change.
  const qwenApiKey = opts.qwenApiKey ?? env['QWEN_API_KEY'] ?? env['DASHSCOPE_API_KEY']
  if (opts.qwenApiKey && !env['QWEN_API_KEY'] && !env['DASHSCOPE_API_KEY']) {
    // Key passed programmatically: make it visible to the provider, which
    // reads env only. Never logged, never persisted.
    env['QWEN_API_KEY'] = opts.qwenApiKey
  }
  const registryPath =
    opts.registryPath ??
    (env['REDTEAM_HOME'] ? join(env['REDTEAM_HOME'], 'engagements', 'registry.json') : join(process.cwd(), 'engagements', 'registry.json'))
  // Q-MEMTIER memory root (§3.1): explicit override → REDTEAM_MEMORY_ROOT
  // → sibling of the registry file. An empty-string env value is a
  // misconfiguration and fails loud, naming the variable (the same rule
  // memory/cli.ts and memory/lifecycle.ts enforce).
  const memoryRootEnv = env['REDTEAM_MEMORY_ROOT']
  if (memoryRootEnv !== undefined && memoryRootEnv.trim() === '') {
    throw new MemoryError('SCHEMA_INVALID', 'REDTEAM_MEMORY_ROOT is set but empty - misconfiguration fails loud')
  }
  const memoryRoot = opts.memoryRoot ?? memoryRootEnv ?? join(dirname(registryPath), 'memory')
  return {
    deepseekApiKey: deepseekApiKey ?? '',
    modelApiKey: modelApiKey ?? '',
    qwenApiKey: qwenApiKey ?? '',
    maxReconTurns: opts.maxReconTurns ?? 10,
    maxExploitProbes: opts.maxExploitProbes ?? 12,
    reflectorCap: opts.reflectorCap ?? parseEnvPositiveNumber(env['REDTEAM_REFLECTOR_CAP'], 'REDTEAM_REFLECTOR_CAP') ?? 3,
    softRoundCap: opts.softRoundCap ?? parseEnvPositiveNumber(env['REDTEAM_SOFT_ROUND_CAP'], 'REDTEAM_SOFT_ROUND_CAP'),
    hardRoundCap: opts.hardRoundCap ?? parseEnvPositiveNumber(env['REDTEAM_HARD_ROUND_CAP'], 'REDTEAM_HARD_ROUND_CAP'),
    maxActions: opts.maxActions ?? 100,
    maxDurationMs: opts.maxDurationMs ?? 45 * 60_000,
    probeDelayMs: opts.probeDelayMs ?? 800,
    engagementsDir:
      opts.engagementsDir ??
      (env['REDTEAM_HOME'] ? join(env['REDTEAM_HOME'], 'engagements', 'live') : join(process.cwd(), 'engagements', 'live')),
    registryPath,
    memoryRoot,
    dryRunAgents: opts.dryRunAgents ?? false,
    localSandbox: opts.localSandbox ?? env['REDTEAM_LOCAL_SANDBOX'] === '1',
    testMode: opts.testMode ?? env['REDTEAM_TEST_MODE'] === '1',
    maxRpsPerHost: opts.maxRpsPerHost ?? parseEnvPositiveNumber(env['REDTEAM_MAX_RPS'], 'REDTEAM_MAX_RPS'),
    maxVariantsPerItem: opts.maxVariantsPerItem ?? parseEnvPositiveNumber(env['REDTEAM_MAX_VARIANTS'], 'REDTEAM_MAX_VARIANTS'),
    lockoutThreshold: opts.lockoutThreshold ?? parseEnvPositiveNumber(env['REDTEAM_LOCKOUT_THRESHOLD'], 'REDTEAM_LOCKOUT_THRESHOLD'),
    lockoutTotalFailures: opts.lockoutTotalFailures ?? parseEnvPositiveNumber(env['REDTEAM_LOCKOUT_TOTAL'], 'REDTEAM_LOCKOUT_TOTAL'),
    lockoutOpaqueRuns: opts.lockoutOpaqueRuns ?? parseEnvPositiveNumber(env['REDTEAM_LOCKOUT_OPAQUE_RUNS'], 'REDTEAM_LOCKOUT_OPAQUE_RUNS'),
  }
}

