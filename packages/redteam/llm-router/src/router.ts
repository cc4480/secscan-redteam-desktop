/**
 * The router: provider registry + dispatch.
 *
 * Usage:
 *   import { completeForRole } from "@secscan/redteam-llm-router";
 *   const res = await completeForRole("exploiter", [
 *     { role: "system", content: EXPLOITER_PROMPT },
 *     { role: "user", content: "Begin phase 2." },
 *   ], { tools: harnessTools });
 *
 * completeForRole() applies ROLE_MODEL_POLICY automatically. complete() lets
 * callers pick provider+model explicitly. Unknown provider ids and
 * unconfigured providers (missing API key) throw with actionable messages.
 *
 * The built-in providers are registered pre-wrapped in ResilientProvider
 * (resilience.ts): failures are classified by reason, pooled credentials
 * bench/rotate, and a call that exhausts its provider cascades ONCE to the
 * configured fallback provider (REDTEAM_LLM_FALLBACK_PROVIDERS) when the
 * classification's hints allow it. REDTEAM_LLM_RESILIENCE=off restores the
 * raw registrations. Resilience configuration and pools are built once at
 * module load — pool bench state must persist across calls to mean anything.
 */

import type {
  AgentRole,
  ChatMessage,
  ChatResult,
  CompleteOptions,
  JsonSchemaTool,
  LlmProvider,
  RoleRoute,
} from './types.js'
import { roleModelPolicy } from './policy.js'
import type { CharterEngagement, CharterRole } from './charter/loader.js'
import { assembleCharterMessages } from './charter/prompt.js'
import { assertLocalOnlyRoute, resolveCharterRoute } from './charter/routing.js'
import { DeepSeekProvider, DEEPSEEK_API_KEY_ENV } from './providers/deepseek.js'
import { MetaProvider, META_API_KEY_ENV } from './providers/meta.js'
import { QwenProvider, QWEN_API_KEY_ENV } from './providers/qwen.js'
import { LocalOpenAiProvider } from './providers/local.js'
import { ResilienceError } from './executor.js'
import { CredentialPool } from './pool.js'
import {
  ResilientProvider,
  resilienceConfigFromEnv,
  type ResilienceConfig,
} from './resilience.js'

const providers = new Map<string, LlmProvider>()

export function registerProvider(provider: LlmProvider): void {
  if (providers.has(provider.id)) {
    throw new Error(`[llm-router] provider '${provider.id}' is already registered.`)
  }
  providers.set(provider.id, provider)
}

export function listProviders(): Array<{ id: string; label: string; configured: boolean }> {
  return [...providers.values()].map(p => ({
    id: p.id,
    label: p.label,
    configured: safeIsConfigured(p),
  }))
}

function safeIsConfigured(p: LlmProvider): boolean {
  try {
    return p.isConfigured()
  } catch {
    return false
  }
}

function getProvider(id: string): LlmProvider {
  const p = providers.get(id)
  if (!p) {
    const known = [...providers.keys()].join(', ') || '(none)'
    throw new Error(
      `[llm-router] unknown provider '${id}'. Registered: ${known}. ` +
        'To add one, implement LlmProvider (see src/providers/README.md).',
    )
  }
  if (!safeIsConfigured(p)) {
    throw new Error(
      `[llm-router] provider '${id}' is registered but not configured ` +
        '(its API key env var is missing). Enter the key via the Secure Vault.',
    )
  }
  return p
}

export async function complete(
  providerId: string,
  options: CompleteOptions,
): Promise<ChatResult> {
  try {
    return await getProvider(providerId).complete(options)
  } catch (err) {
    // Provider cascade: exactly one hop, only when the resilience layer
    // gave up with a classification whose hints allow a provider fallback
    // and a fallback target is configured for this provider.
    if (err instanceof ResilienceError && err.classified.hints.fallbackProvider) {
      const target = resilienceConfig.fallbackProviders[providerId]
      if (target && target.provider !== providerId) {
        const fallbackOptions: CompleteOptions =
          target.model !== undefined ? { ...options, model: target.model } : options
        return getProvider(target.provider).complete(fallbackOptions)
      }
    }
    throw err
  }
}

export async function completeForRole(
  role: AgentRole,
  messages: ChatMessage[],
  opts: {
    tools?: JsonSchemaTool[]
    signal?: AbortSignal
    maxTokens?: number
    temperature?: number
  } = {},
): Promise<ChatResult> {
  const route = roleModelPolicy()[role]
  return complete(route.provider, {
    model: route.model,
    messages,
    tools: opts.tools,
    reasoningEffort: route.reasoningEffort,
    signal: opts.signal,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
  })
}

/** Options for a chartered completion: the fleet's standard agent call. */
export interface CharterCompleteOptions {
  /** The engagement record the charter is filled from. No engagement, no call. */
  engagement: CharterEngagement
  /** The agent's charter role (five seats; see CHARTER_ROLE_AGENT_ROLE). */
  role: CharterRole
  /** Task messages; any system messages are treated as persona text and appended after the charter. */
  messages: ChatMessage[]
  /** The agent's generated phase anchor, from buildPhaseAnchor. */
  anchor?: string
  /** Include the exemplar pack; defaults per role. */
  includeExemplars?: boolean
  /** Per-engagement route override for this seat; wins over env and policy. */
  routeOverride?: RoleRoute
  /** Per-engagement pseudonym map; task messages are sanitized before assembly (spec §4). */
  pseudonyms?: Record<string, string>
  tools?: JsonSchemaTool[]
  signal?: AbortSignal
  maxTokens?: number
  temperature?: number
}

/**
 * Complete one chartered agent call: assemble the system prompt from the
 * charter (assembleCharterMessages), resolve the seat's route as data
 * (resolveCharterRoute), and dispatch through the provider registry.
 * This is the entry point spec §2 mandates for fleet agent calls; the
 * charter is built — and throws — before any provider is touched, so a
 * call with a broken engagement record never reaches a model.
 *
 * @param opts - the chartered call options
 * @returns the provider's result for the assembled call
 */
export async function completeWithCharter(opts: CharterCompleteOptions): Promise<ChatResult> {
  const route = resolveCharterRoute(opts.role, process.env, opts.routeOverride)
  assertLocalOnlyRoute(opts.engagement, route)
  const assembled = assembleCharterMessages(opts.engagement, opts.role, opts.messages, {
    anchor: opts.anchor,
    includeExemplars: opts.includeExemplars,
    pseudonyms: opts.pseudonyms,
  })
  return complete(route.provider, {
    model: route.model,
    messages: assembled.messages,
    tools: opts.tools,
    reasoningEffort: route.reasoningEffort,
    signal: opts.signal,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
  })
}

// Providers. To add the next one (Kimi was the runner-up): implement
// LlmProvider in src/providers/<id>.ts (see providers/README.md) and
// register it here — no changes to the router core or the harness.
const resilienceConfig: ResilienceConfig = resilienceConfigFromEnv()

/**
 * Wrap a built-in provider in the resilience layer, with a credential pool
 * built from its key env var (+ numbered siblings) when it has one.
 * Resilience off (REDTEAM_LLM_RESILIENCE=off) returns the provider raw.
 */
function resilient(provider: LlmProvider, keyEnv?: string): LlmProvider {
  if (!resilienceConfig.enabled) return provider
  const pool = keyEnv ? CredentialPool.fromEnv(provider.id, keyEnv) : undefined
  return new ResilientProvider(provider, { pool, config: resilienceConfig })
}

registerProvider(resilient(new DeepSeekProvider(), DEEPSEEK_API_KEY_ENV))
registerProvider(resilient(new QwenProvider(), QWEN_API_KEY_ENV))
// Meta Model API: routed for all roles when REDTEAM_LLM_PROVIDER=meta (see policy.ts).
registerProvider(resilient(new MetaProvider(), META_API_KEY_ENV))
// Offline/self-hosted route: selected by REDTEAM_LLM_PROVIDER=local (see policy.ts).
registerProvider(resilient(new LocalOpenAiProvider()))
