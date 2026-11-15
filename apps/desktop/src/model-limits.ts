/**
 * One place that decides a model's effective limits.
 *
 * Context length is a fact the model declares (GGUF `<arch>.context_length`, or
 * Ollama's `model_info`). Max output is usually NOT declared — neither GGUF nor
 * Ollama has a standard "maximum output tokens" field — so it is derived, and
 * this module says so explicitly with `source`. The app must never present a
 * derived number as though the model declared it: an operator choosing a model
 * for a long tool loop is entitled to know which number is a fact and which is a
 * policy.
 *
 * The rule, for a model that declares nothing:
 *
 *   maxOutput = clamp(contextLength / 4, 256, 8192)
 *
 * A quarter of the window keeps a long conversation or a multi-step tool loop
 * from being starved of input budget by a single greedy completion, and the
 * ceiling reflects that agent output is measured in a few thousand tokens, not
 * tens of thousands. A caller that knows better (an explicit operator setting, a
 * declared value) always wins.
 */

/** Smallest output budget the derivation will ever produce. */
export const MIN_DERIVED_OUTPUT_TOKENS = 256

/** Largest output budget the derivation will produce without a declared value. */
export const MAX_DERIVED_OUTPUT_TOKENS = 8192

/** Fraction of the context window a derived output budget may consume. */
const DERIVED_OUTPUT_FRACTION = 0.25

/** Output budget assumed when the model declares no context window at all. */
export const FALLBACK_CONTEXT_LENGTH = 4096

/** Where a number came from, so the UI can label it honestly. */
export type LimitSource = 'declared' | 'derived'

/** A model's effective limits. */
export interface ModelLimits {
  /** The context window that will be used. */
  readonly contextLength: number
  /** The output budget that will be used. */
  readonly maxOutputTokens: number
  /** Whether `contextLength` came from the model or from a fallback. */
  readonly contextSource: LimitSource
  /** Whether `maxOutputTokens` came from the model or from {@link deriveMaxOutputTokens}. */
  readonly maxOutputSource: LimitSource
}

/** Raw facts a source can offer about one model. */
export interface ModelLimitFacts {
  /** Context window the model declares, when it declares one. */
  readonly contextLength?: number
  /** Output cap the model declares, when it carries one at all. */
  readonly declaredMaxOutputTokens?: number
}

/**
 * @param contextLength - a declared context window.
 * @returns a positive integer, or undefined when the value is not usable.
 */
function positiveInteger(contextLength: number | undefined): number | undefined {
  if (contextLength === undefined) return undefined
  if (!Number.isFinite(contextLength)) return undefined
  const truncated = Math.trunc(contextLength)
  return truncated > 0 ? truncated : undefined
}

/**
 * Derive an output budget from a context window.
 * @param contextLength - the window the model will actually serve.
 * @returns the derived budget, clamped to the documented bounds.
 */
export function deriveMaxOutputTokens(contextLength: number): number {
  const quarter = Math.trunc(contextLength * DERIVED_OUTPUT_FRACTION)
  return Math.min(MAX_DERIVED_OUTPUT_TOKENS, Math.max(MIN_DERIVED_OUTPUT_TOKENS, quarter))
}

/**
 * Resolve a model's limits from the facts available about it.
 *
 * A declared output cap is used as-is but never allowed to exceed the context
 * window: a model cannot emit more than it can hold, and a header that claims
 * otherwise is wrong in a way that would break any caller trusting it.
 * @param facts - declared context and output, when the source knows them.
 * @returns the effective limits, each carrying its source.
 */
export function resolveModelLimits(facts: ModelLimitFacts): ModelLimits {
  const declaredContext = positiveInteger(facts.contextLength)
  const declaredOutput = positiveInteger(facts.declaredMaxOutputTokens)

  if (declaredContext === undefined) {
    // No declared window: assume a small safe one and derive from it. Both
    // numbers are labelled derived, because neither came from the model.
    const contextLength = FALLBACK_CONTEXT_LENGTH
    return {
      contextLength,
      maxOutputTokens: deriveMaxOutputTokens(contextLength),
      contextSource: 'derived',
      maxOutputSource: 'derived',
    }
  }

  if (declaredOutput !== undefined) {
    return {
      contextLength: declaredContext,
      maxOutputTokens: Math.min(declaredOutput, declaredContext),
      contextSource: 'declared',
      maxOutputSource: 'declared',
    }
  }

  return {
    contextLength: declaredContext,
    maxOutputTokens: deriveMaxOutputTokens(declaredContext),
    contextSource: 'declared',
    maxOutputSource: 'derived',
  }
}
