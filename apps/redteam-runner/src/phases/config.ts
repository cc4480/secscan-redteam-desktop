/**
 * Runner config resolution (v0.19.0 refactor — extracted from phases.ts).
 */
import { type ResolvedRunnerConfig } from '../types.js'
import { resolveEstopPaths } from '../safety/estop.js'
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
  mcpToken?: string
  deepseekApiKey?: string
  /** Meta Model API key. Env MODEL_API_KEY (META_API_KEY fallback). The fleet's provider key. */
  modelApiKey?: string
  /** Opt-in service verification (env REDTEAM_VERIFY_VIA_SERVICE=1). Default: verification from the engagement record. */
  verifyViaService?: boolean
  qwenApiKey?: string
  mcpEndpoint?: string
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
  // The SecScan MCP token is NOT a startup requirement: it is only read
  // when the operator opts into service verification
  // (REDTEAM_VERIFY_VIA_SERVICE=1). The default authorize path verifies
  // from the engagement record and never touches the service.
  const mcpToken = opts.mcpToken ?? env['SECSCAN_MCP_TOKEN'] ?? ''
  const verifyViaService = opts.verifyViaService ?? env['REDTEAM_VERIFY_VIA_SERVICE'] === '1'
  if (verifyViaService && !mcpToken) {
    throw new Error(
      '[runner] REDTEAM_VERIFY_VIA_SERVICE=1 asks the SecScan service to verify domains, but SECSCAN_MCP_TOKEN is not set. Enter the SecScan MCP token via the Secure Vault, or unset REDTEAM_VERIFY_VIA_SERVICE to verify from the engagement record.',
    )
  }
  const deepseekApiKey = opts.deepseekApiKey ?? env['DEEPSEEK_API_KEY']
  const modelApiKey = opts.modelApiKey ?? env['MODEL_API_KEY'] ?? env['META_API_KEY']
  // A live engagement needs ONE configured model provider: the fleet's
  // Meta key, a DeepSeek key, or the offline local provider
  // (REDTEAM_LLM_PROVIDER=local, keyless by design). Nothing else — in
  // particular not the SecScan service — gates the start.
  const localProvider = env['REDTEAM_LLM_PROVIDER']?.trim().toLowerCase() === 'local'
  if (!modelApiKey && !deepseekApiKey && !localProvider && !opts.dryRunAgents) {
    throw new Error(
      "[runner] No model provider key is configured. Set MODEL_API_KEY (Meta Model API — the fleet's provider) via the Secure Vault (it lands in the environment).",
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
  // Q-ESTOP-APP: hoisted out of the return literal because the ESTOP
  // sentinel's primary path is defined relative to it (safety/estop.ts).
  const registryPath =
    opts.registryPath ??
    (env['REDTEAM_HOME'] ? join(env['REDTEAM_HOME'], 'engagements', 'registry.json') : join(process.cwd(), 'engagements', 'registry.json'))
  // Q-MEMTIER memory root (§3.1): explicit override → REDTEAM_MEMORY_ROOT
  // → sibling of the registry file. An empty-string env value is a
  // misconfiguration and fails loud, naming the variable (the same rule
  // memory/cli.ts and memory/lifecycle.ts enforce).
  const memoryRootEnv = env['REDTEAM_MEMORY_ROOT']
  if (memoryRootEnv !== undefined && memoryRootEnv.trim() === '') {
    throw new MemoryError('SCHEMA_INVALID', 'REDTEAM_MEMORY_ROOT is set but empty — misconfiguration fails loud')
  }
  const memoryRoot = opts.memoryRoot ?? memoryRootEnv ?? join(dirname(registryPath), 'memory')
  return {
    // Blank-but-present SECSCAN_MCP_URL (the .env.example convention for
    // "unset, use the default") must fall through too — "" ?? x is "",
    // not x, so a stray fetch("") blew up here before the .trim()/|| guard.
    mcpEndpoint: opts.mcpEndpoint || env['SECSCAN_MCP_URL']?.trim() || 'https://secscan.us/api/mcp',
    mcpToken,
    deepseekApiKey: deepseekApiKey ?? '',
    modelApiKey: modelApiKey ?? '',
    verifyViaService,
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
    estopPaths: resolveEstopPaths(env, { registryPath }),
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

