/**
 * The Meta plugin: seats Meta's Muse models in the harness LLM registry
 * as the `meta` provider, the way `@deepseek-ai/dsh-llm-deepseek` seats
 * its provider and `@secscan/redteam-llm-local` seats the `local` route —
 * construct an adapter, register it with `ctx.llm`, and let the Host model
 * catalog and session routing treat it like every other provider.
 *
 * The catalog half needs no credential: the four models in `./models.ts`
 * are listed unconditionally. The dispatch half resolves the key per
 * request through the credentials service under the env-ref
 * `MODEL_API_KEY` — the same seating the engagement runner uses — so a
 * key seated or rotated after the Host booted reaches the next request
 * without a restart. In a composition with no credentials service, the
 * launching environment is the whole credential plane, mirroring the
 * DeepSeek plugin's fallback.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { assertUsableApiKey } from '@deepseek-ai/dsh-llm'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { MetaAdapter } from './adapter.ts'
import { META_API_KEY_ENV, META_PROVIDER_ID } from './models.ts'

export * from './adapter.ts'
export * from './models.ts'

/** Desugared plugin name. */
export const name = 'llm-meta'

/** Services this plugin depends on. */
export const inject = ['llm']

/** Meta plugin configuration. */
export interface Config {
  /**
   * Explicit Meta Model API base URL. Deployment-varying: when unset, the
   * adapter resolves `META_BASE_URL`, then the default endpoint the
   * router's Meta provider uses (`https://api.meta.ai/v1`).
   */
  baseUrl?: string
}

/** Meta plugin configuration schema. */
export const Config: z<Config> = z.object({
  baseUrl: z.string(),
})

/**
 * Apply the Meta plugin: register the adapter for the `meta` route with a
 * key resolver that reads the credentials service per request.
 * @param ctx - the composition context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  // Per-request resolution: a hit is validated here (a stored value no
  // HTTP header can carry keeps its own INVALID_CREDENTIAL diagnosis);
  // a miss comes back undefined and the adapter raises the named
  // MISSING_CREDENTIAL failure, so the seating remedy is stated once.
  const resolveApiKey = async (): Promise<string | undefined> => {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(credentialRef(META_API_KEY_ENV))
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-meta', META_API_KEY_ENV)
      return undefined
    }
    // Without the seam there is no managed store to rank against, so the
    // environment is the whole credential plane.
    const ambient = launchEnvironmentOf(ctx).get(META_API_KEY_ENV)
    if (ambient !== undefined && ambient.value.length > 0) {
      return assertUsableApiKey(ambient.value, 'llm-meta', META_API_KEY_ENV)
    }
    return undefined
  }

  const adapter = new MetaAdapter({
    ...config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl },
    resolveApiKey,
  })
  ctx.llm.registerAdapter([META_PROVIDER_ID], adapter)
}
