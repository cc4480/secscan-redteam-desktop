/**
 * Per-role model policy — the cost/latency brain of the router.
 *
 * DeepSeek is the fleet's default provider: roleModelPolicy() resolves
 * the DeepSeek seats whenever the selector is unset (operator ruling,
 * 2026-11-07: DeepSeek is the default, wired to everything). Every
 * other registered fleet family — Meta, Qwen, OpenAI, Anthropic, xAI,
 * Z.ai (GLM), Gemini, local — seats its own table when it is selected
 * explicitly, by the operator's selector or by their saved model pick.
 * A selector that names NO fleet family throws: an unknown selection
 * is an operator error to surface, never a silent conversion to
 * DeepSeek. A missing key for the seated provider likewise fails
 * honestly at dispatch — it never silently seats another provider.
 *
 * ROLE_MODEL_POLICY below is the DeepSeek seat table (v0.6 seat table):
 *   coordinator → deepseek / deepseek-flash   (fast orchestration, tool use)
 *   recon       → deepseek / deepseek-flash   (cheap recon loops)
 *   exploiter   → deepseek / deepseek-v4-pro  (strongest reasoning: hypotheses,
 *                                              exploit chains, pivot decisions)
 *   reporter    → deepseek / deepseek-flash   (fast write-up)
 *   architect   → deepseek / deepseek-flash   (consistency review of team output)
 *
 * Rationale: recon burns the most tokens on the least thinking (listing
 * endpoints, reading headers, paging scan history) — the cheap tier
 * keeps engagements affordable. The exploiter is where the product's
 * differentiator lives (dynamic hypothesis-driven testing), so every
 * family's table gives it the family's strongest reasoner. The
 * coordinator and reporter need speed and reliable tool use, not deep
 * thought.
 */
import { fleetProviderFamilyForProvider, FLEET_PROVIDER_SELECTIONS } from './fleet-provider-record.js';
import { ANTHROPIC_MODELS, ANTHROPIC_PROVIDER_ID } from './providers/anthropic.js';
import { DEEPSEEK_MODELS } from './providers/deepseek.js';
import { GEMINI_MODELS, GEMINI_PROVIDER_ID } from './providers/gemini.js';
import { LOCAL_MODEL_ENV, LOCAL_PROVIDER_ID } from './providers/local.js';
import { META_MODELS, META_PROVIDER_ID } from './providers/meta.js';
import { OPENAI_MODELS, OPENAI_PROVIDER_ID } from './providers/openai.js';
import { QWEN_MODELS } from './providers/qwen.js';
import { XAI_MODELS, XAI_PROVIDER_ID } from './providers/xai.js';
import { ZAI_MODELS, ZAI_PROVIDER_ID } from './providers/zai.js';
/**
 * Selects the provider family for every agent role.
 *
 * `REDTEAM_LLM_PROVIDER` names the family (canonical id or alias, see
 * fleet-provider-record.ts): `local` routes all five roles to the local
 * OpenAI-compatible endpoint (llama.cpp / Ollama) so an engagement can
 * run with no cloud API at all, with `REDTEAM_LOCAL_MODEL` naming the
 * model that server exposes; every other registered family routes all
 * five roles to that family's seat table below. With the selector
 * unset, the fleet seats DeepSeek: DeepSeek is the fleet's default
 * provider (operator ruling, 2026-11-07); every other provider is an
 * option the operator picks, never the default. A selector naming no
 * fleet family throws — never a silent DeepSeek conversion. A missing
 * key for the seated provider surfaces at dispatch as the router's
 * not-configured error, never as a silent seat change. An explicit
 * selector always wins.
 */
export const LLM_PROVIDER_ENV = 'REDTEAM_LLM_PROVIDER';
/**
 * Meta Model API seats (operator decisions, 2026-10-26: Meta models
 * seated in this harness, for explicit selection). These seats resolve
 * only when Meta is picked: REDTEAM_LLM_PROVIDER=meta, or a saved model
 * selection naming Meta. The fleet's default is DeepSeek (operator
 * ruling, 2026-11-07); Meta is an option, never the default. When Meta
 * is selected, Spark takes all five fleet seats -- the brain the
 * operator chose for the complicated work, exploiter included. Wonder
 * stays registered for
 * explicit complete() calls, small one-off jobs, and A/B lanes against
 * these seats; it is not seated by default. The charter prefix is
 * byte-stable per role, so repeated calls ride the cached-input rate
 * instead of full price.
 */
export const META_ROLE_MODEL_POLICY = {
    coordinator: { provider: META_PROVIDER_ID, model: META_MODELS.spark },
    recon: { provider: META_PROVIDER_ID, model: META_MODELS.spark, reasoningEffort: 'low' },
    exploiter: { provider: META_PROVIDER_ID, model: META_MODELS.spark, reasoningEffort: 'high' },
    reporter: { provider: META_PROVIDER_ID, model: META_MODELS.spark },
    architect: { provider: META_PROVIDER_ID, model: META_MODELS.spark },
};
export const ROLE_MODEL_POLICY = {
    coordinator: { provider: 'deepseek', model: DEEPSEEK_MODELS.flash },
    recon: { provider: 'deepseek', model: DEEPSEEK_MODELS.flash, reasoningEffort: 'low' },
    exploiter: { provider: 'deepseek', model: DEEPSEEK_MODELS.pro, reasoningEffort: 'high' },
    reporter: { provider: 'deepseek', model: DEEPSEEK_MODELS.flash },
    architect: { provider: 'deepseek', model: DEEPSEEK_MODELS.flash },
};
/**
 * Qwen seats: the one hosted model (qwen3.8-max, thinking on) takes
 * every seat, with the effort hint splitting the work — recon cheap,
 * exploiter at full depth. Qwen was the exploiter's reasoner through
 * v0.5; the full table makes it a complete pickable family again.
 */
export const QWEN_ROLE_MODEL_POLICY = {
    coordinator: { provider: 'qwen', model: QWEN_MODELS.reasoning },
    recon: { provider: 'qwen', model: QWEN_MODELS.reasoning, reasoningEffort: 'low' },
    exploiter: { provider: 'qwen', model: QWEN_MODELS.reasoning, reasoningEffort: 'high' },
    reporter: { provider: 'qwen', model: QWEN_MODELS.reasoning },
    architect: { provider: 'qwen', model: QWEN_MODELS.reasoning },
};
/** OpenAI seats: the production tier everywhere; the flagship reasons for the exploiter. */
export const OPENAI_ROLE_MODEL_POLICY = {
    coordinator: { provider: OPENAI_PROVIDER_ID, model: OPENAI_MODELS.standard },
    recon: { provider: OPENAI_PROVIDER_ID, model: OPENAI_MODELS.standard, reasoningEffort: 'low' },
    exploiter: { provider: OPENAI_PROVIDER_ID, model: OPENAI_MODELS.flagship, reasoningEffort: 'high' },
    reporter: { provider: OPENAI_PROVIDER_ID, model: OPENAI_MODELS.standard },
    architect: { provider: OPENAI_PROVIDER_ID, model: OPENAI_MODELS.standard },
};
/** Anthropic seats: Sonnet everywhere; Opus reasons for the exploiter; Haiku keeps recon cheap. */
export const ANTHROPIC_ROLE_MODEL_POLICY = {
    coordinator: { provider: ANTHROPIC_PROVIDER_ID, model: ANTHROPIC_MODELS.sonnet },
    recon: { provider: ANTHROPIC_PROVIDER_ID, model: ANTHROPIC_MODELS.haiku, reasoningEffort: 'low' },
    exploiter: { provider: ANTHROPIC_PROVIDER_ID, model: ANTHROPIC_MODELS.opus, reasoningEffort: 'high' },
    reporter: { provider: ANTHROPIC_PROVIDER_ID, model: ANTHROPIC_MODELS.sonnet },
    architect: { provider: ANTHROPIC_PROVIDER_ID, model: ANTHROPIC_MODELS.sonnet },
};
/** xAI seats: the 1M-context tier everywhere; the flagship reasons for the exploiter. */
export const XAI_ROLE_MODEL_POLICY = {
    coordinator: { provider: XAI_PROVIDER_ID, model: XAI_MODELS.standard },
    recon: { provider: XAI_PROVIDER_ID, model: XAI_MODELS.standard, reasoningEffort: 'low' },
    exploiter: { provider: XAI_PROVIDER_ID, model: XAI_MODELS.flagship, reasoningEffort: 'high' },
    reporter: { provider: XAI_PROVIDER_ID, model: XAI_MODELS.standard },
    architect: { provider: XAI_PROVIDER_ID, model: XAI_MODELS.standard },
};
/** Z.ai (GLM) seats: the established tier everywhere; the flagship reasons for the exploiter. */
export const ZAI_ROLE_MODEL_POLICY = {
    coordinator: { provider: ZAI_PROVIDER_ID, model: ZAI_MODELS.standard },
    recon: { provider: ZAI_PROVIDER_ID, model: ZAI_MODELS.standard, reasoningEffort: 'low' },
    exploiter: { provider: ZAI_PROVIDER_ID, model: ZAI_MODELS.flagship, reasoningEffort: 'high' },
    reporter: { provider: ZAI_PROVIDER_ID, model: ZAI_MODELS.standard },
    architect: { provider: ZAI_PROVIDER_ID, model: ZAI_MODELS.standard },
};
/** Gemini seats: Flash everywhere; the Pro tier reasons for the exploiter. */
export const GEMINI_ROLE_MODEL_POLICY = {
    coordinator: { provider: GEMINI_PROVIDER_ID, model: GEMINI_MODELS.flash },
    recon: { provider: GEMINI_PROVIDER_ID, model: GEMINI_MODELS.flash, reasoningEffort: 'low' },
    exploiter: { provider: GEMINI_PROVIDER_ID, model: GEMINI_MODELS.pro, reasoningEffort: 'high' },
    reporter: { provider: GEMINI_PROVIDER_ID, model: GEMINI_MODELS.flash },
    architect: { provider: GEMINI_PROVIDER_ID, model: GEMINI_MODELS.flash },
};
/** Seat tables for the families whose table is a constant (local builds its own from the model name). */
const FAMILY_POLICIES = {
    deepseek: ROLE_MODEL_POLICY,
    meta: META_ROLE_MODEL_POLICY,
    qwen: QWEN_ROLE_MODEL_POLICY,
    openai: OPENAI_ROLE_MODEL_POLICY,
    anthropic: ANTHROPIC_ROLE_MODEL_POLICY,
    xai: XAI_ROLE_MODEL_POLICY,
    zai: ZAI_ROLE_MODEL_POLICY,
    gemini: GEMINI_ROLE_MODEL_POLICY,
};
/**
 * The credential ref a provider's key is seated under, for operator
 * messages that must name exactly where to re-seat a key. Mirrors each
 * provider's key constants (Meta's primary ref is MODEL_API_KEY with
 * META_API_KEY as its fallback; local needs no key).
 * @param providerId - Router provider id.
 * @returns The ref label, or undefined for an unknown/keyless provider.
 */
export function providerKeyEnvLabel(providerId) {
    switch (providerId) {
        case 'deepseek': return 'DEEPSEEK_API_KEY';
        case 'meta': return 'MODEL_API_KEY (or META_API_KEY)';
        case 'qwen': return 'QWEN_API_KEY (or DASHSCOPE_API_KEY)';
        case 'openai': return 'OPENAI_API_KEY';
        case 'anthropic': return 'ANTHROPIC_API_KEY';
        case 'xai': return 'XAI_API_KEY';
        case 'zai': return 'ZAI_API_KEY';
        case 'gemini': return 'GEMINI_API_KEY';
        default: return undefined;
    }
}
/** Roles in a fixed, dependency-safe order for policy display. */
export const ROLE_ORDER = ['coordinator', 'recon', 'exploiter', 'reporter', 'architect'];
/**
 * Resolve the role→provider/model map, honouring the offline switch.
 * @param env - Environment to read (defaults to `process.env`, read per call so a
 *   supervised runner picks up changes without re-importing the module).
 * @returns The effective policy for this process.
 * @throws When the selector names no fleet family, or when the local
 *   provider is selected without naming a model.
 */
export function roleModelPolicy(env = process.env) {
    const selected = env[LLM_PROVIDER_ENV]?.trim().toLowerCase();
    if (selected === undefined || selected === '') {
        // DeepSeek is the fleet's default provider (operator ruling,
        // 2026-11-07): an unset selector seats DeepSeek. Every other
        // family seats only when named.
        return ROLE_MODEL_POLICY;
    }
    const family = fleetProviderFamilyForProvider(selected);
    if (family === undefined) {
        // An explicit selector naming no fleet family is an operator
        // error: fail loud HERE, at selection time — never convert it to
        // DeepSeek silently (the pre-universality collapse did exactly
        // that to every non-Meta pick).
        throw new Error(`[llm-router] ${LLM_PROVIDER_ENV} names '${selected}', which is not a fleet provider. ` +
            `Known fleet providers: ${FLEET_PROVIDER_SELECTIONS.join(', ')}. ` +
            'Name one of those, or unset it to run the DeepSeek default.');
    }
    if (family !== LOCAL_PROVIDER_ID) {
        const table = FAMILY_POLICIES[family];
        if (table !== undefined)
            return table;
        // Unreachable while FLEET_PROVIDER_SELECTIONS and FAMILY_POLICIES
        // are kept in step; a throw, not a fallback, if they ever drift.
        throw new Error(`[llm-router] fleet provider '${family}' has no seat table.`);
    }
    const model = env[LOCAL_MODEL_ENV]?.trim();
    if (model === undefined || model.length === 0) {
        throw new Error(`[llm-router] ${LLM_PROVIDER_ENV}=local requires ${LOCAL_MODEL_ENV}: ` +
            'the model name the local llama.cpp/Ollama server exposes (for example the GGUF stem).');
    }
    const route = { provider: LOCAL_PROVIDER_ID, model };
    return { coordinator: route, recon: route, exploiter: route, reporter: route, architect: route };
}
