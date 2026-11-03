/**
 * The Meta model catalog for the harness `meta` provider.
 *
 * IDs, endpoint, and rates are the ones the codebase already uses: they are
 * transcribed from the engagement router's Meta provider
 * (`packages/redteam/llm-router/src/providers/meta.ts`), whose header takes
 * them from the Meta Model API quickstart and pricing pages. Fix these
 * constants, never the call sites, if the API disagrees.
 */

/** Provider route this package owns in the harness LLM registry. */
export const META_PROVIDER_ID = 'meta'

/** Display name of the provider group in the model catalog. */
export const META_PROVIDER_NAME = 'Meta'

/** Default Meta Model API endpoint (OpenAI-compatible wire format). */
export const META_BASE_URL = 'https://api.meta.ai/v1'

/** Environment variable that can override {@link META_BASE_URL}. */
export const META_BASE_URL_ENV = 'META_BASE_URL'

/**
 * Credential reference the key is resolved through, per request, via the
 * credentials service — the same env-ref seating the runner uses
 * (`MODEL_API_KEY`, the name Meta's quickstart exports).
 */
export const META_API_KEY_ENV = 'MODEL_API_KEY'

/** One catalog entry: a Meta model the picker can offer. */
export interface MetaCatalogModel {
  /** Exact model id passed to the Meta Model API. */
  readonly id: string
  /** Picker label. */
  readonly name: string
  /** Context window in tokens, only where the codebase already states one. */
  readonly contextWindow?: number
}

/**
 * The four Meta models, in the router's declaration order. Listing is
 * unconditional: a model is offered because Meta serves it, never gated on
 * a key being seated or a server running — credential gating fails at
 * dispatch with a named error, exactly as the DeepSeek route behaves.
 */
export const META_MODELS: readonly MetaCatalogModel[] = [
  { id: 'muse-wonder-1.0', name: 'Muse Wonder 1.0' },
  { id: 'muse-spark-1.3', name: 'Muse Spark 1.3' },
  { id: 'muse-spark-1.2', name: 'Muse Spark 1.2', contextWindow: 1_000_000 },
  { id: 'muse-spark-1.1', name: 'Muse Spark 1.1' },
]
