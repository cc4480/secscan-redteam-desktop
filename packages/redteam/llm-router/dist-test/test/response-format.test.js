/**
 * Structured outputs (Q-STRUCT): home validation of response formats,
 * entry-point plumbing, per-provider wire translation, and
 * requested-vs-sent provenance. All fakes — no network, no real keys.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { complete, completeForRole, completeWithCharter } from '../src/router.js';
import { META_API_KEY_ENV, META_API_KEY_FALLBACK_ENV, META_MODELS, MetaProvider } from '../src/providers/meta.js';
import { DEEPSEEK_API_KEY_ENV, DEEPSEEK_MODELS, DeepSeekProvider } from '../src/providers/deepseek.js';
import { QWEN_API_KEY_ENV, QWEN_API_KEY_FALLBACK_ENV, QWEN_MODELS, QwenProvider } from '../src/providers/qwen.js';
import { LocalOpenAiProvider } from '../src/providers/local.js';
const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };
const TOUCHED_ENV = [
    META_API_KEY_ENV,
    META_API_KEY_FALLBACK_ENV,
    DEEPSEEK_API_KEY_ENV,
    QWEN_API_KEY_ENV,
    QWEN_API_KEY_FALLBACK_ENV,
    'REDTEAM_LLM_PROVIDER',
];
afterEach(() => {
    globalThis.fetch = realFetch;
    for (const key of TOUCHED_ENV) {
        if (savedEnv[key] === undefined)
            delete process.env[key];
        else
            process.env[key] = savedEnv[key];
    }
});
function stubFetch(handler) {
    globalThis.fetch = (async (input, init) => handler(String(input), init));
}
function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
function okChat() {
    return jsonResponse({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    });
}
/** Capture the parsed request body of the single fetch a call makes. */
function capturingFetch() {
    const seen = { bodies: [] };
    stubFetch(async (_url, init) => {
        seen.bodies.push(JSON.parse(String(init?.body)));
        return okChat();
    });
    return seen;
}
const asFormat = (value) => value;
describe('home validation through complete()', () => {
    test('a json_schema without a name is rejected before any dispatch', async () => {
        process.env[META_API_KEY_ENV] = 'test-key';
        let fetched = false;
        stubFetch(async () => {
            fetched = true;
            return okChat();
        });
        await assert.rejects(complete('meta', {
            model: META_MODELS.spark,
            messages: [{ role: 'user', content: 'hi' }],
            responseFormat: { type: 'json_schema', name: '', schema: { type: 'object' } },
        }), /requires a name/);
        assert.equal(fetched, false);
    });
    test('a schema with an unknown property type is rejected before any dispatch', async () => {
        process.env[META_API_KEY_ENV] = 'test-key';
        let fetched = false;
        stubFetch(async () => {
            fetched = true;
            return okChat();
        });
        await assert.rejects(complete('meta', {
            model: META_MODELS.spark,
            messages: [{ role: 'user', content: 'hi' }],
            responseFormat: asFormat({
                type: 'json_schema',
                name: 'verdict',
                schema: { type: 'object', properties: { v: { type: 'strnig' } } },
            }),
        }), /invalid JSON Schema type/);
        assert.equal(fetched, false);
    });
    test('a non-string required entry is rejected before any dispatch', async () => {
        process.env[META_API_KEY_ENV] = 'test-key';
        let fetched = false;
        stubFetch(async () => {
            fetched = true;
            return okChat();
        });
        await assert.rejects(complete('meta', {
            model: META_MODELS.spark,
            messages: [{ role: 'user', content: 'hi' }],
            responseFormat: asFormat({
                type: 'json_schema',
                name: 'verdict',
                schema: { type: 'object', required: [42] },
            }),
        }), /required must be an array of strings/);
        assert.equal(fetched, false);
    });
    test('an uncompilable regex is rejected before any dispatch', async () => {
        process.env[META_API_KEY_ENV] = 'test-key';
        let fetched = false;
        stubFetch(async () => {
            fetched = true;
            return okChat();
        });
        await assert.rejects(complete('meta', {
            model: META_MODELS.spark,
            messages: [{ role: 'user', content: 'hi' }],
            responseFormat: { type: 'regex', pattern: '(' },
        }), /does not compile/);
        assert.equal(fetched, false);
    });
    test('a well-formed format passes validation and reaches the provider', async () => {
        process.env[META_API_KEY_ENV] = 'test-key';
        const seen = capturingFetch();
        const result = await complete('meta', {
            model: META_MODELS.spark,
            messages: [{ role: 'user', content: 'hi' }],
            responseFormat: { type: 'json_object' },
        });
        assert.equal(seen.bodies.length, 1);
        assert.deepEqual(seen.bodies[0]?.['response_format'], { type: 'json_object' });
        assert.equal(result.text, 'ok');
    });
});
describe('per-provider wire translation', () => {
    test('meta sends json_object as chosen and returns the exact body as requestBody', async () => {
        process.env[META_API_KEY_ENV] = 'test-key';
        const seen = capturingFetch();
        const result = await new MetaProvider().complete({
            model: META_MODELS.spark,
            messages: [{ role: 'user', content: 'hi' }],
            responseFormat: { type: 'json_object' },
        });
        assert.deepEqual(seen.bodies[0]?.['response_format'], { type: 'json_object' });
        assert.deepEqual(result.requestBody, seen.bodies[0]);
    });
    test('meta degrades json_schema to json_object, provably from requestBody', async () => {
        process.env[META_API_KEY_ENV] = 'test-key';
        const seen = capturingFetch();
        const result = await new MetaProvider().complete({
            model: META_MODELS.spark,
            messages: [{ role: 'user', content: 'hi' }],
            responseFormat: {
                type: 'json_schema',
                name: 'verdict',
                schema: { type: 'object', properties: { v: { type: 'string' } }, required: ['v'] },
            },
        });
        assert.deepEqual(seen.bodies[0]?.['response_format'], { type: 'json_object' });
        assert.deepEqual(result.requestBody, seen.bodies[0]);
    });
    test('meta with tools sends no response_format — the tool block is the constraint', async () => {
        process.env[META_API_KEY_ENV] = 'test-key';
        const seen = capturingFetch();
        await new MetaProvider().complete({
            model: META_MODELS.spark,
            messages: [{ role: 'user', content: 'hi' }],
            tools: [{ name: 'scan', description: 'run a scan', parameters: { type: 'object' } }],
            responseFormat: { type: 'json_object' },
        });
        assert.ok(Array.isArray(seen.bodies[0]?.['tools']));
        assert.equal('response_format' in (seen.bodies[0] ?? {}), false);
    });
    test('meta without a format sends no response_format key (baseline body unchanged)', async () => {
        process.env[META_API_KEY_ENV] = 'test-key';
        const seen = capturingFetch();
        await new MetaProvider().complete({
            model: META_MODELS.spark,
            messages: [{ role: 'user', content: 'hi' }],
        });
        assert.equal('response_format' in (seen.bodies[0] ?? {}), false);
    });
    test('deepseek sends json_object', async () => {
        process.env[DEEPSEEK_API_KEY_ENV] = 'test-key';
        const seen = capturingFetch();
        await new DeepSeekProvider().complete({
            model: DEEPSEEK_MODELS.flash,
            messages: [{ role: 'user', content: 'hi' }],
            responseFormat: { type: 'json_object' },
        });
        assert.deepEqual(seen.bodies[0]?.['response_format'], { type: 'json_object' });
    });
    test('deepseek refuses json_schema loudly, before any fetch', async () => {
        process.env[DEEPSEEK_API_KEY_ENV] = 'test-key';
        let fetched = false;
        stubFetch(async () => {
            fetched = true;
            return okChat();
        });
        await assert.rejects(new DeepSeekProvider().complete({
            model: DEEPSEEK_MODELS.flash,
            messages: [{ role: 'user', content: 'hi' }],
            responseFormat: { type: 'json_schema', name: 'verdict', schema: { type: 'object' } },
        }), /provider 'deepseek' does not support response_format json_schema/);
        assert.equal(fetched, false);
    });
    test('every provider refuses regex loudly, before any fetch', async () => {
        process.env[META_API_KEY_ENV] = 'test-key';
        let fetched = false;
        stubFetch(async () => {
            fetched = true;
            return okChat();
        });
        await assert.rejects(new MetaProvider().complete({
            model: META_MODELS.spark,
            messages: [{ role: 'user', content: 'hi' }],
            responseFormat: { type: 'regex', pattern: 'a+' },
        }), /provider 'meta' does not support response_format regex/);
        await assert.rejects(new LocalOpenAiProvider().complete({
            model: 'local-model',
            messages: [{ role: 'user', content: 'hi' }],
            responseFormat: { type: 'regex', pattern: 'a+' },
        }), /provider 'local' does not support response_format regex/);
        assert.equal(fetched, false);
    });
    test('qwen sends json_object', async () => {
        process.env[QWEN_API_KEY_ENV] = 'test-key';
        const seen = capturingFetch();
        await new QwenProvider().complete({
            model: QWEN_MODELS.reasoning,
            messages: [{ role: 'user', content: 'hi' }],
            responseFormat: { type: 'json_object' },
        });
        assert.deepEqual(seen.bodies[0]?.['response_format'], { type: 'json_object' });
    });
    test('local sends json_schema with name, schema, and strict carried through', async () => {
        const seen = capturingFetch();
        const schema = { type: 'object', properties: { v: { type: 'string' } }, required: ['v'] };
        const result = await new LocalOpenAiProvider().complete({
            model: 'local-model',
            messages: [{ role: 'user', content: 'hi' }],
            responseFormat: { type: 'json_schema', name: 'verdict', schema, strict: true },
        });
        assert.deepEqual(seen.bodies[0]?.['response_format'], {
            type: 'json_schema',
            json_schema: { name: 'verdict', schema, strict: true },
        });
        assert.deepEqual(result.requestBody, seen.bodies[0]);
    });
});
describe('entry-point plumbing', () => {
    const engagement = {
        engagementId: 'eng-2026-10-25-7f3a',
        owner: 'Acme Widgets LLC',
        proofMethod: 'DNS TXT record verified 2026-10-25',
        inScope: 'app.acme.example and api.acme.example',
    };
    test('completeForRole forwards responseFormat to the seated provider', async () => {
        delete process.env['REDTEAM_LLM_PROVIDER'];
        process.env[DEEPSEEK_API_KEY_ENV] = 'test-key';
        const seen = capturingFetch();
        await completeForRole('coordinator', [{ role: 'user', content: 'hi' }], {
            responseFormat: { type: 'json_object' },
        });
        assert.equal(seen.bodies.length, 1);
        assert.deepEqual(seen.bodies[0]?.['response_format'], { type: 'json_object' });
    });
    test('completeWithCharter forwards responseFormat to the seated provider', async () => {
        delete process.env['REDTEAM_LLM_PROVIDER'];
        process.env[DEEPSEEK_API_KEY_ENV] = 'test-key';
        const seen = capturingFetch();
        await completeWithCharter({
            role: 'coordinator',
            engagement,
            messages: [{ role: 'user', content: 'hi' }],
            responseFormat: { type: 'json_object' },
        });
        assert.equal(seen.bodies.length, 1);
        assert.deepEqual(seen.bodies[0]?.['response_format'], { type: 'json_object' });
    });
});
