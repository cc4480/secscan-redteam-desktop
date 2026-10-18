/**
 * Per-role model policy — the cost/latency brain of the router.
 *
 * v0.6 (DeepSeek only for now; Qwen stays registered for later reinstatement):
 *   coordinator → deepseek / deepseek-flash   (fast orchestration, tool use)
 *   recon       → deepseek / deepseek-flash   (cheap recon loops)
 *   exploiter   → deepseek / deepseek-v4-pro  (strongest reasoning: hypotheses,
 *                                              exploit chains, pivot decisions)
 *   reporter    → deepseek / deepseek-flash   (fast write-up)
 *
 * Rationale: recon burns the most tokens on the least thinking (listing
 * endpoints, reading headers, paging scan history) — flash keeps engagements
 * cheap. The exploiter is where the product's differentiator lives (dynamic
 * hypothesis-driven testing), so it gets the strongest reasoner. The
 * coordinator and reporter need speed and reliable tool use, not deep thought.
 *
 * Qwen (qwen3.8-max) was the exploiter's reasoner through v0.5; the operator
 * has asked to run DeepSeek-only for now and bring Qwen back later. The
 * provider stays registered in router.ts so switching back is a one-line
 * change here, not a re-integration.
 */

import type { AgentRole, RoleRoute } from './types.js'
import { DEEPSEEK_MODELS } from './providers/deepseek.js'
import { LOCAL_MODEL_ENV, LOCAL_PROVIDER_ID } from './providers/local.js'

/**
 * Selects the provider family for every agent role.
 *
 * `REDTEAM_LLM_PROVIDER=local` routes all four roles to the local
 * OpenAI-compatible endpoint (llama.cpp / Ollama) so an engagement can run with
 * no cloud API at all; `REDTEAM_LOCAL_MODEL` names the model that server
 * exposes. Any other value, or unset, uses the default policy below.
 */
export const LLM_PROVIDER_ENV = 'REDTEAM_LLM_PROVIDER'

export const ROLE_MODEL_POLICY: Record<AgentRole, RoleRoute> = {
  coordinator: { provider: 'deepseek', model: DEEPSEEK_MODELS.flash },
  recon: { provider: 'deepseek', model: DEEPSEEK_MODELS.flash, reasoningEffort: 'low' },
  exploiter: { provider: 'deepseek', model: DEEPSEEK_MODELS.pro, reasoningEffort: 'high' },
  reporter: { provider: 'deepseek', model: DEEPSEEK_MODELS.flash },
}

/** Roles in a fixed, dependency-safe order for policy display. */
export const ROLE_ORDER: AgentRole[] = ['coordinator', 'recon', 'exploiter', 'reporter']

/**
 * Resolve the role→provider/model map, honouring the offline switch.
 * @param env - Environment to read (defaults to `process.env`, read per call so a
 *   supervised runner picks up changes without re-importing the module).
 * @returns The effective policy for this process.
 * @throws When the local provider is selected without naming a model.
 */
export function roleModelPolicy(env: NodeJS.ProcessEnv = process.env): Record<AgentRole, RoleRoute> {
  const selected = env[LLM_PROVIDER_ENV]?.trim().toLowerCase()
  if (selected !== LOCAL_PROVIDER_ID) return ROLE_MODEL_POLICY
  const model = env[LOCAL_MODEL_ENV]?.trim()
  if (model === undefined || model.length === 0) {
    throw new Error(
      `[llm-router] ${LLM_PROVIDER_ENV}=local requires ${LOCAL_MODEL_ENV}: ` +
        'the model name the local llama.cpp/Ollama server exposes (for example the GGUF stem).',
    )
  }
  const route: RoleRoute = { provider: LOCAL_PROVIDER_ID, model }
  return { coordinator: route, recon: route, exploiter: route, reporter: route }
}
