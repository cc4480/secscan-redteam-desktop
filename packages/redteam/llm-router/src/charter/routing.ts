/**
 * Charter-role routing as data (spec §2). The five charter roles map onto
 * the router's four agent-role routes; the two exploiter-cell seats are
 * separately overridable so the bake-off winners — a different endpoint
 * for the operator, the challenger, or both — plug in through data, not
 * code changes.
 */

import type { AgentRole, RoleRoute } from '../types.js'
import { roleModelPolicy } from '../policy.js'
import type { CharterRole } from './loader.js'

/** Which agent-role route each charter role rides by default. */
export const CHARTER_ROLE_AGENT_ROLE: Record<CharterRole, AgentRole> = {
  coordinator: 'coordinator',
  recon: 'recon',
  'exploiter-operator': 'exploiter',
  'exploiter-challenger': 'exploiter',
  reporter: 'reporter',
}

/**
 * Per-seat environment overrides for the exploiter cell. Each seat reads a
 * provider and a model variable; either may be set alone, and the unset
 * half falls back to the seat's base route.
 */
export const CHARTER_ROUTE_ENV: Record<'exploiter-operator' | 'exploiter-challenger', { provider: string; model: string }> = {
  'exploiter-operator': { provider: 'REDTEAM_LLM_OPERATOR_PROVIDER', model: 'REDTEAM_LLM_OPERATOR_MODEL' },
  'exploiter-challenger': { provider: 'REDTEAM_LLM_CHALLENGER_PROVIDER', model: 'REDTEAM_LLM_CHALLENGER_MODEL' },
}

/**
 * Resolve the route for one charter role.
 *
 * Resolution order: an explicit `override` wins outright; then the seat's
 * environment override (exploiter cell only); then the role policy for the
 * mapped agent role, which itself honours the offline local-provider switch.
 *
 * @param role - the charter role to route
 * @param env - environment to read (defaults to `process.env`, read per call)
 * @param override - an explicit route (per-engagement configuration)
 * @returns the effective route for the role
 */
export function resolveCharterRoute(
  role: CharterRole,
  env: NodeJS.ProcessEnv = process.env,
  override?: RoleRoute,
): RoleRoute {
  if (override !== undefined) return override
  const base = roleModelPolicy(env)[CHARTER_ROLE_AGENT_ROLE[role]]
  if (role === 'exploiter-operator' || role === 'exploiter-challenger') {
    const names = CHARTER_ROUTE_ENV[role]
    const provider = env[names.provider]?.trim()
    const model = env[names.model]?.trim()
    if (provider || model) {
      return {
        ...base,
        provider: provider ? provider : base.provider,
        model: model ? model : base.model,
      }
    }
  }
  return base
}
