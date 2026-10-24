/**
 * Core types for the provider-pluggable LLM router.
 *
 * A provider implements `LlmProvider.complete()`. The router dispatches by
 * provider id; adding Claude / ChatGPT / Gemini / GLM / Qwen later means
 * writing one new class against this interface and calling
 * `registerProvider()` — no changes to agents or the harness plugin.
 */
export {};
