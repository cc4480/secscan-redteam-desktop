/**
 * The router: provider registry + dispatch.
 *
 * Usage:
 *   import { completeForRole } from "@secscan/redteam-llm-router";
 *   const res = await completeForRole("exploiter", [
 *     { role: "system", content: EXPLOITER_PROMPT },
 *     { role: "user", content: "Begin phase 2." },
 *   ], { tools: harnessTools });
 *
 * completeForRole() applies ROLE_MODEL_POLICY automatically. complete() lets
 * callers pick provider+model explicitly. Unknown provider ids and
 * unconfigured providers (missing API key) throw with actionable messages.
 *
 * The built-in providers are registered pre-wrapped in ResilientProvider
 * (resilience.ts): failures are classified by reason, pooled credentials
 * bench/rotate, and a call that exhausts its provider cascades ONCE to the
 * configured fallback provider (REDTEAM_LLM_FALLBACK_PROVIDERS) when the
 * classification's hints allow it. REDTEAM_LLM_RESILIENCE=off restores the
 * raw registrations. Resilience configuration and pools are built once at
 * module load — pool bench state must persist across calls to mean anything.
 * With pool persistence on (the default; REDTEAM_LLM_POOL_PERSIST=off
 * disables it), that state also survives the process: every pool restores
 * from the one shared state document at construction (see pool-store.ts
 * for path resolution) and writes its mutations through. Construction is
 * not the pool's last word on its key set: before every dispatch and
 * every poolSnapshots() read, each pool reconciles against the keys the
 * fleet resolver currently answers (CredentialPool.refreshKeys), so a
 * key seated or rotated in the app's credentials store reaches the fleet
 * — and a re-seated valid key revives a provider whose old key died —
 * with no process restart.
 */
import { validateResponseFormat } from './adapter.js';
import { roleModelPolicy, LLM_PROVIDER_ENV } from './policy.js';
import { CHARTER_ROUTE_ENV } from './charter/routing.js';
import { LOCAL_MODEL_ENV } from './providers/local.js';
import { fleetDispatchEnv, fleetValue } from './resolver.js';
import { assembleCharterMessages } from './charter/prompt.js';
import { assertLocalOnlyRoute, resolveCharterRoute } from './charter/routing.js';
import { DeepSeekProvider, DEEPSEEK_API_KEY_ENV } from './providers/deepseek.js';
import { MetaProvider, META_API_KEY_ENV, META_API_KEY_FALLBACK_ENV } from './providers/meta.js';
import { QwenProvider, QWEN_API_KEY_ENV, QWEN_API_KEY_FALLBACK_ENV } from './providers/qwen.js';
import { OpenAiProvider, OPENAI_API_KEY_ENV } from './providers/openai.js';
import { AnthropicProvider, ANTHROPIC_API_KEY_ENV } from './providers/anthropic.js';
import { XaiProvider, XAI_API_KEY_ENV } from './providers/xai.js';
import { ZaiProvider, ZAI_API_KEY_ENV } from './providers/zai.js';
import { GeminiProvider, GEMINI_API_KEY_ENV } from './providers/gemini.js';
import { LocalOpenAiProvider } from './providers/local.js';
import { ResilienceError } from './executor.js';
import { CredentialPool, collectCredentialEnv } from './pool.js';
import { FilePoolStateStore } from './pool-store.js';
import { ResilientProvider, resilienceConfigFromEnv, } from './resilience.js';
const providers = new Map();
export function registerProvider(provider) {
    if (providers.has(provider.id)) {
        throw new Error(`[llm-router] provider '${provider.id}' is already registered.`);
    }
    providers.set(provider.id, provider);
}
export function listProviders() {
    return [...providers.values()].map(p => ({
        id: p.id,
        label: p.label,
        configured: safeIsConfigured(p),
    }));
}
function safeIsConfigured(p) {
    try {
        return p.isConfigured();
    }
    catch {
        return false;
    }
}
function getProvider(id) {
    const p = providers.get(id);
    if (!p) {
        const known = [...providers.keys()].join(', ') || '(none)';
        throw new Error(`[llm-router] unknown provider '${id}'. Registered: ${known}. ` +
            'To add one, implement LlmProvider (see src/providers/README.md).');
    }
    if (!safeIsConfigured(p)) {
        throw new Error(`[llm-router] provider '${id}' is registered but not configured ` +
            '(its API key env var is missing). Enter the key via the Secure Vault.');
    }
    return p;
}
export async function complete(providerId, options) {
    // Client-side structured-output validation (deepseek-recipe discipline):
    // a malformed response_format fails here, at home — never as a paid API
    // round-trip. Both higher entry points funnel through complete(), so this
    // one hook covers completeForRole and completeWithCharter too.
    if (options.responseFormat)
        validateResponseFormat(options.responseFormat);
    try {
        return await getProvider(providerId).complete(options);
    }
    catch (err) {
        // Provider cascade: exactly one hop, only when the resilience layer
        // gave up with a classification whose hints allow a provider fallback
        // and a fallback target is configured for this provider.
        if (err instanceof ResilienceError && err.classified.hints.fallbackProvider) {
            const target = resilienceConfig.fallbackProviders[providerId];
            if (target && target.provider !== providerId) {
                const fallbackOptions = target.model !== undefined ? { ...options, model: target.model } : options;
                return getProvider(target.provider).complete(fallbackOptions);
            }
        }
        throw err;
    }
}
/** Environment names route resolution reads; the fleet resolver's current answers apply to each at dispatch time. */
const DISPATCH_ENV_NAMES = [
    LLM_PROVIDER_ENV,
    LOCAL_MODEL_ENV,
    CHARTER_ROUTE_ENV['exploiter-operator'].provider,
    CHARTER_ROUTE_ENV['exploiter-operator'].model,
    CHARTER_ROUTE_ENV['exploiter-challenger'].provider,
    CHARTER_ROUTE_ENV['exploiter-challenger'].model,
];
export async function completeForRole(role, messages, opts = {}) {
    const route = roleModelPolicy(fleetDispatchEnv(DISPATCH_ENV_NAMES))[role];
    return complete(route.provider, {
        model: route.model,
        messages,
        tools: opts.tools,
        reasoningEffort: route.reasoningEffort,
        signal: opts.signal,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        responseFormat: opts.responseFormat,
    });
}
/**
 * Complete one chartered agent call: assemble the system prompt from the
 * charter (assembleCharterMessages), resolve the seat's route as data
 * (resolveCharterRoute), and dispatch through the provider registry.
 * This is the entry point spec §2 mandates for fleet agent calls; the
 * charter is built — and throws — before any provider is touched, so a
 * call with a broken engagement record never reaches a model.
 *
 * @param opts - the chartered call options
 * @returns the provider's result for the assembled call
 */
export async function completeWithCharter(opts) {
    const route = resolveCharterRoute(opts.role, fleetDispatchEnv(DISPATCH_ENV_NAMES), opts.routeOverride);
    assertLocalOnlyRoute(opts.engagement, route);
    const assembled = assembleCharterMessages(opts.engagement, opts.role, opts.messages, {
        anchor: opts.anchor,
        includeExemplars: opts.includeExemplars,
        pseudonyms: opts.pseudonyms,
    });
    return complete(route.provider, {
        model: route.model,
        messages: assembled.messages,
        tools: opts.tools,
        reasoningEffort: route.reasoningEffort,
        signal: opts.signal,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        responseFormat: opts.responseFormat,
    });
}
// Providers. To add the next one (Kimi was the runner-up): implement
// LlmProvider in src/providers/<id>.ts (see providers/README.md) and
// register it here — no changes to the router core or the harness.
const resilienceConfig = resilienceConfigFromEnv();
/** The pools resilient() built at module load, by provider id (for poolSnapshots()). */
const livePools = new Map();
let sharedPoolStore;
let poolStoreResolved = false;
/**
 * The one pool-state store shared by every provider's pool (the document
 * is keyed by provider id), resolved lazily from the environment.
 * @returns The shared store, or undefined when persistence is off.
 */
function poolStateStore() {
    if (!poolStoreResolved) {
        poolStoreResolved = true;
        sharedPoolStore = FilePoolStateStore.fromEnv(process.env);
    }
    return sharedPoolStore;
}
/**
 * Snapshots of the router's live credential pools — the operator-visibility
 * surface the runner's readiness report renders from. Empty when
 * resilience is off (no pools are built then). Each pool first
 * reconciles with the keys the fleet resolver currently answers, so a
 * snapshot (and the runner's dead-credential gate that reads it) sees a
 * key seated or rotated in the app on the very next read — the revival
 * path that needs no restart.
 * @returns One snapshot per pooled provider, in registration order.
 */
export function poolSnapshots() {
    for (const refresh of poolRefreshers.values())
        refresh();
    return [...livePools.entries()].map(([providerId, pool]) => ({ providerId, entries: pool.snapshot() }));
}
/** Pool refresh callbacks by provider id, registered alongside each live pool. */
const poolRefreshers = new Map();
/** Numbered sibling depth for pool keys, matching collectCredentialEnv's default. */
const POOL_KEY_SIBLINGS = 8;
/**
 * The keys the fleet resolver currently answers for one provider: the
 * primary credential ref and its numbered siblings, plus the fallback
 * ref's family when the provider has one (Meta's META_API_KEY, Qwen's
 * DASHSCOPE_API_KEY), deduplicated in priority order. Resolved through
 * the fleet resolver — never process.env directly — so the app's
 * credentials store is a first-class source, exactly as it is for the
 * providers' own per-call key reads.
 * @param keyEnv - The provider's primary credential ref name.
 * @param fallbackKeyEnv - The provider's fallback credential ref name, when it has one.
 * @returns The current key set for the provider's pool.
 */
function resolvedPoolKeys(keyEnv, fallbackKeyEnv) {
    const envLike = {};
    const primaries = fallbackKeyEnv !== undefined ? [keyEnv, fallbackKeyEnv] : [keyEnv];
    for (const name of primaries) {
        for (let i = 1; i <= POOL_KEY_SIBLINGS + 1; i += 1) {
            const candidate = i === 1 ? name : `${name}_${i}`;
            const value = fleetValue(candidate);
            if (value !== undefined)
                envLike[candidate] = value;
        }
    }
    const keys = collectCredentialEnv(envLike, keyEnv);
    if (fallbackKeyEnv !== undefined) {
        for (const key of collectCredentialEnv(envLike, fallbackKeyEnv)) {
            if (!keys.includes(key))
                keys.push(key);
        }
    }
    return keys;
}
/**
 * Wrap a built-in provider in the resilience layer, with a credential pool
 * built from its key env var (+ numbered siblings) when it has one.
 * The pool's key set is resolved through the fleet resolver and kept
 * current by a refresh callback (see resolvedPoolKeys): the wrapper
 * refreshes before every call, and poolSnapshots() refreshes before
 * every read. Resilience off (REDTEAM_LLM_RESILIENCE=off) returns the
 * provider raw.
 */
function resilient(provider, keyEnv, fallbackKeyEnv) {
    if (!resilienceConfig.enabled)
        return provider;
    const pool = keyEnv
        ? new CredentialPool(provider.id, resolvedPoolKeys(keyEnv, fallbackKeyEnv), { store: poolStateStore() })
        : undefined;
    if (pool !== undefined && keyEnv !== undefined) {
        livePools.set(provider.id, pool);
        const report = pool.restoreReport;
        if (report !== null &&
            (report.restoredEntries > 0 || report.restoredBenches > 0 || report.prunedEntries > 0 || report.droppedLapsed > 0)) {
            console.log(`[llm-router] credential pool state restored for '${provider.id}': ` +
                `${report.restoredEntries} entries, ${report.restoredBenches} benches` +
                (report.prunedEntries > 0 ? `, ${report.prunedEntries} pruned` : '') +
                (report.droppedLapsed > 0 ? `, ${report.droppedLapsed} lapsed dropped` : ''));
        }
        const refresh = () => {
            pool.refreshKeys(resolvedPoolKeys(keyEnv, fallbackKeyEnv));
        };
        poolRefreshers.set(provider.id, refresh);
        return new ResilientProvider(provider, { pool, config: resilienceConfig, refreshPool: refresh });
    }
    return new ResilientProvider(provider, { pool, config: resilienceConfig });
}
registerProvider(resilient(new DeepSeekProvider(), DEEPSEEK_API_KEY_ENV));
registerProvider(resilient(new QwenProvider(), QWEN_API_KEY_ENV, QWEN_API_KEY_FALLBACK_ENV));
// Meta Model API: routed for all roles when REDTEAM_LLM_PROVIDER=meta (see policy.ts).
registerProvider(resilient(new MetaProvider(), META_API_KEY_ENV, META_API_KEY_FALLBACK_ENV));
// OpenAI (ChatGPT): routed for all roles when REDTEAM_LLM_PROVIDER=openai (see policy.ts).
registerProvider(resilient(new OpenAiProvider(), OPENAI_API_KEY_ENV));
// Anthropic (Claude): the one native-wire provider; routed when REDTEAM_LLM_PROVIDER=anthropic.
registerProvider(resilient(new AnthropicProvider(), ANTHROPIC_API_KEY_ENV));
// xAI (Grok): routed for all roles when REDTEAM_LLM_PROVIDER=xai (see policy.ts).
registerProvider(resilient(new XaiProvider(), XAI_API_KEY_ENV));
// Z.ai (GLM): routed for all roles when REDTEAM_LLM_PROVIDER=zai (see policy.ts).
registerProvider(resilient(new ZaiProvider(), ZAI_API_KEY_ENV));
// Gemini via Google's OpenAI-compatible endpoint: routed when REDTEAM_LLM_PROVIDER=gemini.
registerProvider(resilient(new GeminiProvider(), GEMINI_API_KEY_ENV));
// Offline/self-hosted route: selected by REDTEAM_LLM_PROVIDER=local (see policy.ts).
registerProvider(resilient(new LocalOpenAiProvider()));
