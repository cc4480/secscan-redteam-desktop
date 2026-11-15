/**
 * Publishing an Ollama choice to the engagement fleet.
 *
 * Kept apart from the shell so it can be exercised without Electron: this is the
 * function that decides whether a runner dispatches to Ollama, and it writes the
 * persisted provider record, so it must be testable on its own.
 *
 * Two surfaces move together, and a bug in either leaves the fleet pointing at a
 * model it cannot serve:
 *   - the environment a runner child inherits (`REDTEAM_LLM_PROVIDER`, the daemon
 *     address, the model, and the detected limits);
 *   - the published record (`fleet-provider.json`) the runner's store resolver
 *     reads when it was launched before this choice was made.
 */

import { writeFleetProviderRecord } from '@secscan/redteam-llm-router'
import type { OllamaSelection } from './ollama-api.ts'

/** Environment name the router reads to choose the fleet family. */
export const PROVIDER_ENVIRONMENT_NAME = 'REDTEAM_LLM_PROVIDER'

/** Environment name carrying the daemon root. */
export const OLLAMA_BASE_URL_ENV = 'OLLAMA_BASE_URL'

/** Environment name carrying the model the daemon should serve. */
export const OLLAMA_MODEL_ENV = 'OLLAMA_MODEL'

/** Environment name carrying the context window to request. */
export const OLLAMA_NUM_CTX_ENV = 'OLLAMA_NUM_CTX'

/** Environment name carrying the output ceiling. */
export const OLLAMA_MAX_OUTPUT_TOKENS_ENV = 'OLLAMA_MAX_OUTPUT_TOKENS'

/** Default published when nothing is selected: the fleet's DeepSeek seats. */
export const DEFAULT_FLEET_PROVIDER = 'deepseek'

/**
 * Publish one selection to the fleet.
 *
 * Selecting mirrors the model's detected limits as well as its name: without
 * them the router would ask the daemon for Ollama's small default context, which
 * is exactly the silent degradation the native provider exists to avoid.
 * Standing down clears every model-specific name and republishes the DeepSeek
 * default, so no later runner can inherit a stale model.
 * @param environment - the environment a runner child inherits.
 * @param selection - the chosen model, or null to stand the fleet down.
 * @param limits - the model's detected limits, mirrored so dispatch honours them.
 */
export function publishOllamaSelection(
  environment: NodeJS.ProcessEnv,
  selection: OllamaSelection | null,
  limits: { readonly contextLength?: number; readonly maxOutputTokens?: number } = {},
): void {
  if (selection === null || selection.activeModel === null) {
    delete environment[OLLAMA_BASE_URL_ENV]
    delete environment[PROVIDER_ENVIRONMENT_NAME]
    delete environment[OLLAMA_MODEL_ENV]
    delete environment[OLLAMA_NUM_CTX_ENV]
    delete environment[OLLAMA_MAX_OUTPUT_TOKENS_ENV]
    writeFleetProviderRecord(environment, DEFAULT_FLEET_PROVIDER)
    return
  }
  environment[PROVIDER_ENVIRONMENT_NAME] = 'ollama'
  environment[OLLAMA_BASE_URL_ENV] = selection.baseUrl
  environment[OLLAMA_MODEL_ENV] = selection.activeModel
  if (limits.contextLength === undefined) delete environment[OLLAMA_NUM_CTX_ENV]
  else environment[OLLAMA_NUM_CTX_ENV] = String(limits.contextLength)
  if (limits.maxOutputTokens === undefined) delete environment[OLLAMA_MAX_OUTPUT_TOKENS_ENV]
  else environment[OLLAMA_MAX_OUTPUT_TOKENS_ENV] = String(limits.maxOutputTokens)
  writeFleetProviderRecord(environment, 'ollama')
}
