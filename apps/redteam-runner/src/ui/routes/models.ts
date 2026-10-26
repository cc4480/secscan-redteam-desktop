/**
 * GET /api/models — which model providers the fleet can use right now and
 * which provider/model each role is seated on. Backs the chat view's engine
 * banner so the operator can SEE the active models (e.g. Meta Muse Spark)
 * instead of trusting an env var.
 */
import type { ServerResponse } from 'node:http'
import { listProviders, roleModelPolicy, ROLE_ORDER } from '@secscan/redteam-llm-router'
import { json } from './http.js'

export function handleModels(res: ServerResponse): void {
  const policy = roleModelPolicy()
  const seats = ROLE_ORDER.map((role) => {
    const route = policy[role]
    return { role, provider: route.provider, model: route.model }
  })
  json(res, 200, {
    providers: listProviders(),
    activeProvider: seats[0]?.provider ?? null,
    seats,
  })
}
