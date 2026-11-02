/**
 * GET /api/models — which model providers the fleet can use right now and
 * which provider/model each role is seated on. Backs the chat view's engine
 * banner so the operator can SEE the active models (e.g. Meta Muse Spark)
 * instead of trusting an env var.
 *
 * `localModel` is the desktop's bundled local model while its llama-server
 * provably serves the operator's active pick (see ../local-model.ts): the
 * one entry the chat picker can route to outside the fleet seats. It is
 * null whenever no local server is serving — the picker then simply has no
 * local option. Fleet seats are reported exactly as the policy resolves
 * them; the local entry never changes a seat.
 */
import type { ServerResponse } from 'node:http'
import { listProviders, roleModelPolicy, ROLE_ORDER } from '@secscan/redteam-llm-router'
import { readLocalModelEntry, type LocalModelProbe } from '../local-model.js'
import { json } from './http.js'

/** Seams for tests: the environment to read and the endpoint probe. */
export interface ModelsRouteDeps {
  readonly env?: NodeJS.ProcessEnv
  readonly probe?: LocalModelProbe
}

export async function handleModels(res: ServerResponse, deps: ModelsRouteDeps = {}): Promise<void> {
  const env = deps.env ?? process.env
  const policy = roleModelPolicy(env)
  const seats = ROLE_ORDER.map((role) => {
    const route = policy[role]
    return { role, provider: route.provider, model: route.model }
  })
  const localModel = await readLocalModelEntry(env, deps.probe)
  json(res, 200, {
    providers: listProviders(),
    activeProvider: seats[0]?.provider ?? null,
    seats,
    localModel,
  })
}
