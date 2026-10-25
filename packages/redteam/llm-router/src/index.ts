export type {
  AgentRole,
  ChatMessage,
  ChatResult,
  CompleteOptions,
  JsonSchemaTool,
  LlmProvider,
  RoleRoute,
  ToolCallRequest,
} from './types.js'
export {
  complete,
  completeForRole,
  completeWithCharter,
  listProviders,
  registerProvider,
  type CharterCompleteOptions,
} from './router.js'
export { LLM_PROVIDER_ENV, ROLE_MODEL_POLICY, ROLE_ORDER, roleModelPolicy } from './policy.js'
export {
  ProviderError,
  parseRateLimitResetHeader,
  parseRetryAfterHeader,
  providerErrorFromResponse,
  providerTransportError,
  type FailedResponse,
  type ProviderErrorInit,
} from './errors.js'
export {
  classifyError,
  type ClassifiedFailure,
  type FailoverReason,
  type RecoveryHints,
} from './classifier.js'
export {
  CredentialPool,
  collectCredentialEnv,
  cooldownMsForFailure,
  COOLDOWN_BASE_MS,
  COOLDOWN_MAX_MS,
  type AcquiredCredential,
  type PoolEntrySnapshot,
} from './pool.js'
export {
  ResilienceError,
  abortableSleep,
  defaultBackoffMs,
  executeStep,
  type AttemptContext,
  type ExecuteStepOptions,
  type RetryDecision,
  type RetryEvent,
  type RetryEventKind,
  type RetryEventSink,
} from './executor.js'
export {
  ResilientProvider,
  resilienceConfigFromEnv,
  RESILIENCE_ENV,
  type FallbackProviderTarget,
  type ResilienceConfig,
  type ResilientProviderOptions,
} from './resilience.js'
export {
  DeepSeekProvider,
  DEEPSEEK_API_KEY_ENV,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_MODELS,
} from './providers/deepseek.js'
export {
  LocalOpenAiProvider,
  LOCAL_API_KEY_ENV,
  LOCAL_BASE_URL,
  LOCAL_BASE_URL_ENV,
  LOCAL_ENABLE_THINKING_ENV,
  LOCAL_MODEL_ENV,
  LOCAL_PROVIDER_ID,
} from './providers/local.js'
export {
  QwenProvider,
  QWEN_API_KEY_ENV,
  QWEN_API_KEY_FALLBACK_ENV,
  QWEN_BASE_URL_ENV,
  QWEN_BASE_URL,
  QWEN_MODELS,
} from './providers/qwen.js'
export {
  CharterError,
  CHARTER_ROLES,
  ROLE_ADDENDA,
  buildSystemPrompt,
  charterAssetCandidates,
  defaultCharterPath,
  defaultCharterText,
  fillCharter,
  loadCharterText,
  roleAddendum,
  type CharterEngagement,
  type CharterRole,
} from './charter/loader.js'
export {
  CHARTER_MARKER_QUESTIONS,
  buildPhaseAnchor,
  type CharterAnchorAnswers,
  type CharterMarkerQuestion,
} from './charter/markers.js'
export {
  EXEMPLAR_PACK_ROLES,
  defaultExemplarPackPath,
  exemplarPackCandidates,
  exemplarPackIncludedByDefault,
  exemplarPackVersion,
  loadExemplarPackText,
} from './charter/exemplars.js'
export {
  assembleCharterMessages,
  type CharterPrompt,
  type CharterPromptOptions,
} from './charter/prompt.js'
export {
  CHARTER_ROLE_AGENT_ROLE,
  CHARTER_ROUTE_ENV,
  assertLocalOnlyRoute,
  resolveCharterRoute,
} from './charter/routing.js'
export {
  SanitizerError,
  findSecretKinds,
  sanitizeMessages,
  sanitizeText,
  type SanitizeFindings,
  type SanitizedText,
} from './charter/sanitize.js'
export {
  classifyResponse,
  type ClassifiedResponse,
  type RefusalClass,
  type RefusalTaskContext,
} from './charter/refusal.js'
export {
  SessionAffinity,
  completeWithFallback,
  type FallbackCallImpl,
  type FallbackFinalOutcome,
  type FallbackOutcome,
  type FallbackRoutes,
  type FallbackTaskOptions,
  type RefusalTelemetryEvent,
} from './charter/fallback.js'
