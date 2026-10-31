/**
 * How to add a provider later (Claude / ChatGPT / Gemini / GLM / Qwen):
 *
 *   1. Create src/providers/<id>.ts exporting a class that implements
 *      LlmProvider from ../types.js (see meta.ts and deepseek.ts for references).
 *   2. Read its key from a dedicated env var (e.g. ANTHROPIC_API_KEY) —
 *      never from a file, never hardcoded.
 *   3. Register it in src/router.ts via registerProvider(new MyProvider()).
 *   4. Optionally add role routes in src/policy.ts.
 *
 * Provider statuses:
 *   - deepseek : ACTIVE (v0.6) — all roles: coordinator/recon/reporter on
 *     deepseek-v4.1-flash, exploiter on deepseek-v4.1-pro (reasoning).
 *   - qwen (Alibaba) : REGISTERED, not routed (v0.5 had exploiter on
 *     qwen3.8-max; operator asked to run DeepSeek-only for now and bring
 *     Qwen back later — swap it back in via src/policy.ts).
 *   - meta (Meta Model API) : REGISTERED 2026-10-26 — Muse Wonder
 *     (muse-wonder-1.0) + Muse Spark (muse-spark-1.3). Routed for all
 *     roles when REDTEAM_LLM_PROVIDER=meta, and by default whenever a
 *     Meta key is configured and the selector is unset (seats in
 *     src/policy.ts). Key env: MODEL_API_KEY (fallback META_API_KEY).
 *   - anthropic (Claude), openai (ChatGPT), google (Gemini), zhipu (GLM),
 *     moonshot (Kimi — the runner-up for the next swap) : PLANNED —
 *     interface is ready, no implementation yet.
 */
export {};
