import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createUserMessage, LlmError, ToolCallId } from '@deepseek-ai/dsh-llm';
import { LocalLlamaAdapter, OLLAMA_DEFAULT_CONTEXT_WINDOW, watchOllamaCatalog, writeLocalModelsSettings, } from '../src/index.js';
import { ACTIVE_MODEL_ID, createFixtureModelsDir, SECOND_MODEL_ID, } from './fixtures.js';
/** OpenAI-compatible base URL the stub Ollama endpoint answers on. */
const OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
/** First stub model id, used verbatim. */
const MODEL_A = 'alpha-model:9b';
/** Second stub model id, used verbatim. */
const MODEL_B = 'beta-model:27b';
/** Maximum context the stub tags report for the first model (never the resolved window). */
const MODEL_A_MAX_CONTEXT = 262144;
/** Runtime context allocation the stub `/api/ps` reports for the first model. */
const MODEL_A_RUNTIME_CONTEXT = 6144;
/**
 * @param text - user text.
 * @returns a one-block user message.
 */
function user(text) {
    return createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] });
}
/**
 * @param model - model id to request.
 * @returns minimal generate options for the adapter, with a sane token budget.
 */
function options(model) {
    return { provider: 'local', model, messages: [user('Say hello.')], maxTokens: 512 };
}
/**
 * Drain one adapter stream into an array.
 * @param chunks - the stream.
 * @returns the chunks in order.
 */
async function collect(chunks) {
    const collected = [];
    for await (const chunk of chunks)
        collected.push(chunk);
    return collected;
}
/**
 * Await one stream's rejection.
 * @param chunks - the stream.
 * @returns the rejection reason.
 */
async function rejectionOf(chunks) {
    try {
        await collect(chunks);
    }
    catch (error) {
        return error;
    }
    throw new Error('expected the stream to reject, but it completed');
}
/**
 * Build a fetch seam that answers like Ollama: `/v1/models` from the id
 * list, `/api/ps` and `/api/tags` from the stub state, and
 * `/v1/chat/completions` with the stub SSE body. Requests are recorded.
 * @param chatBody - the SSE payload for chat requests.
 * @returns the fetch seam, its request log, and its mutable state.
 */
function stubOllama(chatBody = '') {
    const requests = [];
    const state = {
        down: false,
        chatBody,
        psModels: [{ name: MODEL_A, model: MODEL_A, context_length: MODEL_A_RUNTIME_CONTEXT, size_vram: 424242 }],
    };
    const fetchImpl = (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        if (state.down)
            throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
        const path = String(url);
        if (path.endsWith('/v1/models')) {
            return Response.json({ object: 'list', data: [{ id: MODEL_A }, { id: MODEL_B }] });
        }
        if (path.endsWith('/api/ps'))
            return Response.json({ models: state.psModels });
        if (path.endsWith('/api/tags')) {
            return Response.json({
                models: [
                    { name: MODEL_A, details: { context_length: MODEL_A_MAX_CONTEXT } },
                    { name: MODEL_B, details: { context_length: 32768 } },
                ],
            });
        }
        if (path.endsWith('/api/generate')) {
            // A load request (empty prompt, held resident) marks the model
            // loaded, so the adapter's verified read-back sees it in /api/ps.
            const body = typeof init?.body === 'string'
                ? JSON.parse(init.body)
                : {};
            if (body.prompt === '' && typeof body.model === 'string'
                && !state.psModels.some(entry => entry['name'] === body.model)) {
                state.psModels = [...state.psModels, { name: body.model, model: body.model }];
            }
            return Response.json({});
        }
        if (path.endsWith('/v1/chat/completions')) {
            return new Response(state.chatBody, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response('not found', { status: 404 });
    });
    return { fetchImpl, requests, state };
}
/**
 * @param directory - fixture models directory.
 * @param fetchImpl - the stub fetch seam.
 * @param extra - extra adapter deps.
 * @returns an adapter in Ollama mode against the stub endpoint.
 */
function ollamaAdapter(directory, fetchImpl, extra = {}) {
    return new LocalLlamaAdapter({
        modelsDir: directory,
        fetchImpl,
        serving: 'ollama',
        ollamaBaseUrl: OLLAMA_BASE_URL,
        ...extra,
    });
}
describe('ollama serving mode selection', () => {
    it('defaults to llama, honors the config field, and lets the env override win', async () => {
        const directory = await createFixtureModelsDir();
        assert.equal(new LocalLlamaAdapter({ modelsDir: directory, environment: {} }).servingMode(), 'llama');
        assert.equal(new LocalLlamaAdapter({ modelsDir: directory, environment: {}, serving: 'ollama' }).servingMode(), 'ollama');
        assert.equal(new LocalLlamaAdapter({ modelsDir: directory, environment: { DSH_LOCAL_MODELS_SERVING: 'ollama' } }).servingMode(), 'ollama');
        // Deployment flips the mode through the environment without editing
        // bundle configuration, so the environment outranks the config field.
        assert.equal(new LocalLlamaAdapter({
            modelsDir: directory,
            environment: { DSH_LOCAL_MODELS_SERVING: 'llama' },
            serving: 'ollama',
        }).servingMode(), 'llama');
    });
});
describe('ollama adapter catalog', () => {
    it('lists the endpoint model ids verbatim with local labels, text-only', async () => {
        const directory = await createFixtureModelsDir();
        const { fetchImpl, requests } = stubOllama();
        const adapter = ollamaAdapter(directory, fetchImpl);
        const models = await adapter.listModels('local');
        assert.deepEqual(models.map(model => model.id), [MODEL_A, MODEL_B]);
        assert.equal(models[0]?.name, `${MODEL_A} · Local`);
        assert.deepEqual(models[0]?.inputModalities, ['text']);
        assert.ok(requests.some(request => request.url === `${OLLAMA_BASE_URL}/models`));
    });
    it('fails loud when the endpoint is down, naming it and asking whether Ollama is running', async () => {
        const directory = await createFixtureModelsDir();
        const { fetchImpl, state } = stubOllama();
        state.down = true;
        const adapter = ollamaAdapter(directory, fetchImpl);
        const error = await adapter.listModels('local').then(() => { throw new Error('expected listModels to reject'); }, (reason) => reason);
        assert.ok(error instanceof LlmError);
        assert.equal(error.failure.code, 'LOCAL_OLLAMA_UNREACHABLE');
        assert.match(error.failure.message, /127\.0\.0\.1:11434/);
        assert.match(error.failure.message, /Is Ollama running on the host\?/);
        assert.doesNotMatch(error.failure.message, /Start server/);
    });
});
describe('ollama resolveModel context order', () => {
    it('uses the loaded runtime allocation from /api/ps, never the model maximum', async () => {
        const directory = await createFixtureModelsDir();
        const { fetchImpl } = stubOllama();
        const adapter = ollamaAdapter(directory, fetchImpl, { contextWindow: 16384 });
        const resolved = await adapter.resolveModel('local', MODEL_A);
        assert.equal(resolved.context?.contextWindow, MODEL_A_RUNTIME_CONTEXT);
        assert.notEqual(resolved.context?.contextWindow, MODEL_A_MAX_CONTEXT);
        assert.equal(resolved.name, `${MODEL_A} · Local`);
        assert.deepEqual(resolved.inputModalities, ['text']);
    });
    it('falls back to the configured override for a model that is not loaded', async () => {
        const directory = await createFixtureModelsDir();
        const { fetchImpl } = stubOllama();
        const adapter = ollamaAdapter(directory, fetchImpl, { contextWindow: 16384 });
        const resolved = await adapter.resolveModel('local', MODEL_B);
        // The tags maximum for this model is 32768; the override must win over it.
        assert.equal(resolved.context?.contextWindow, 16384);
    });
    it('falls back to the Ollama default allocation without an override', async () => {
        const directory = await createFixtureModelsDir();
        const { fetchImpl } = stubOllama();
        const adapter = ollamaAdapter(directory, fetchImpl);
        const resolved = await adapter.resolveModel('local', MODEL_B);
        assert.equal(resolved.context?.contextWindow, OLLAMA_DEFAULT_CONTEXT_WINDOW);
        assert.equal(OLLAMA_DEFAULT_CONTEXT_WINDOW, 4096);
    });
    it('fails loud for a model the endpoint does not serve', async () => {
        const directory = await createFixtureModelsDir();
        const { fetchImpl } = stubOllama();
        const adapter = ollamaAdapter(directory, fetchImpl);
        const error = await adapter.resolveModel('local', 'not-served:1b').then(() => { throw new Error('expected resolveModel to reject'); }, (reason) => reason);
        assert.ok(error instanceof LlmError);
        assert.equal(error.failure.code, 'LOCAL_MODEL_NOT_FOUND');
        assert.match(error.failure.message, /not-served:1b/);
    });
});
describe('ollama persisted context precedence', () => {
    it('loads with the persisted per-model num_ctx, beating the construction override and the tag maximum', async () => {
        const directory = await createFixtureModelsDir();
        writeLocalModelsSettings(directory, { contextLengthByModel: { [MODEL_A]: 65536 } });
        const { fetchImpl, requests } = stubOllama();
        const adapter = ollamaAdapter(directory, fetchImpl, { contextWindow: 16384 });
        const result = await adapter.startLocalModel(MODEL_A);
        assert.equal(result.loaded, true);
        const generate = requests.find(request => request.url.endsWith('/api/generate'));
        assert.ok(generate !== undefined);
        const body = JSON.parse(String(generate.init.body));
        // Persisted 65536, construction override 16384, tag maximum 262144:
        // the persisted value is the one the load carries.
        assert.equal(body.options?.num_ctx, 65536);
    });
    it('loads at the tag maximum when nothing is persisted and no override is configured', async () => {
        const directory = await createFixtureModelsDir();
        const { fetchImpl, requests } = stubOllama();
        const adapter = ollamaAdapter(directory, fetchImpl);
        const result = await adapter.startLocalModel(MODEL_B);
        assert.equal(result.loaded, true);
        const generate = requests.find(request => request.url.endsWith('/api/generate'));
        const body = JSON.parse(String(generate?.init.body));
        assert.equal(body.options?.num_ctx, 32768);
    });
    it('resolves an unloaded model with the persisted value over the construction override', async () => {
        const directory = await createFixtureModelsDir();
        writeLocalModelsSettings(directory, { contextLengthByModel: { [MODEL_B]: 8192 } });
        const { fetchImpl } = stubOllama();
        const adapter = ollamaAdapter(directory, fetchImpl, { contextWindow: 16384 });
        const resolved = await adapter.resolveModel('local', MODEL_B);
        assert.equal(resolved.context?.contextWindow, 8192);
    });
});
describe('ollama dispatch', () => {
    it('streams reasoning from the `reasoning` field and captures usage that trails the finish chunk', async () => {
        const directory = await createFixtureModelsDir();
        // The live-probe chunk order: the finish chunk arrives BEFORE the
        // usage chunk (which also carries an Ollama-only `timings` object),
        // then [DONE]. The reader must not stop at finish_reason.
        const sse = [
            'data: {"choices":[{"delta":{"role":"assistant","reasoning":"Let me think. "},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
            'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18},"timings":{"total_duration":42}}',
            'data: [DONE]',
            '',
        ].join('\n');
        const { fetchImpl, requests } = stubOllama(sse);
        const adapter = ollamaAdapter(directory, fetchImpl);
        // No server-state.json exists in the fixture: dispatch must not consult one.
        const chunks = await collect(adapter.stream(options(MODEL_A)));
        const chat = requests.filter(request => request.url.endsWith('/chat/completions'));
        assert.equal(chat.length, 1);
        assert.equal(chat[0]?.url, `${OLLAMA_BASE_URL}/chat/completions`);
        assert.equal(chat[0]?.init.method, 'POST');
        const headers = chat[0]?.init.headers;
        assert.ok(!Object.keys(headers).some(key => key.toLowerCase() === 'authorization'));
        const sent = JSON.parse(String(chat[0]?.init.body));
        assert.equal(sent['model'], MODEL_A);
        assert.equal(sent['stream'], true);
        assert.equal(sent['max_tokens'], 512);
        assert.ok(!('enable_thinking' in sent));
        const text = chunks
            .filter((chunk) => chunk.type === 'text-delta')
            .map(chunk => chunk.text)
            .join('');
        assert.equal(text, 'Hello world');
        const reasoning = chunks
            .filter((chunk) => chunk.type === 'reasoning-delta')
            .map(chunk => chunk.text)
            .join('');
        assert.equal(reasoning, 'Let me think. ');
        const usage = chunks.find((chunk) => chunk.type === 'usage');
        assert.ok(usage !== undefined);
        assert.deepEqual(usage.usage, { inputTokens: 11, outputTokens: 7, totalTokens: 18 });
        const finish = chunks[chunks.length - 1];
        assert.ok(finish?.type === 'finish');
        assert.equal(finish.reason.kind, 'stop');
    });
    it('still tolerates the `reasoning_content` field', async () => {
        const directory = await createFixtureModelsDir();
        const sse = [
            'data: {"choices":[{"delta":{"reasoning_content":"Thinking. "},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}]}',
            'data: [DONE]',
            '',
        ].join('\n');
        const { fetchImpl } = stubOllama(sse);
        const adapter = ollamaAdapter(directory, fetchImpl);
        const chunks = await collect(adapter.stream(options(MODEL_A)));
        const reasoning = chunks
            .filter((chunk) => chunk.type === 'reasoning-delta')
            .map(chunk => chunk.text)
            .join('');
        assert.equal(reasoning, 'Thinking. ');
    });
    it('assembles the single-delta tool call Ollama sends and finishes tool-calls', async () => {
        const directory = await createFixtureModelsDir();
        // Live-probe shape: one delta carries id, index, type, name, and the
        // full arguments as one string — no incremental argument streaming.
        const sse = [
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"probe","arguments":"{\\"target\\":\\"x\\"}"}}]},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
            'data: [DONE]',
            '',
        ].join('\n');
        const { fetchImpl } = stubOllama(sse);
        const adapter = ollamaAdapter(directory, fetchImpl);
        const request = {
            provider: 'local',
            model: MODEL_A,
            messages: [user('Probe it.')],
            maxTokens: 512,
            tools: [{ name: 'probe', description: 'Probe a target.', parameters: { type: 'object' } }],
        };
        const chunks = await collect(adapter.stream(request));
        const end = chunks.find((chunk) => chunk.type === 'block-end');
        assert.ok(end !== undefined);
        assert.deepEqual(end.block, {
            type: 'tool-call',
            id: ToolCallId('call_1'),
            name: 'probe',
            arguments: '{"target":"x"}',
        });
        const finish = chunks[chunks.length - 1];
        assert.ok(finish?.type === 'finish');
        assert.equal(finish.reason.kind, 'tool-calls');
    });
    it('fails a down endpoint with the Ollama remedy, never the desktop start action', async () => {
        const directory = await createFixtureModelsDir();
        const { fetchImpl, state } = stubOllama();
        state.down = true;
        const adapter = ollamaAdapter(directory, fetchImpl);
        const error = await rejectionOf(adapter.stream(options(MODEL_A)));
        assert.ok(error instanceof LlmError);
        assert.equal(error.failure.code, 'LOCAL_OLLAMA_UNREACHABLE');
        assert.match(error.failure.message, /Is Ollama running on the host\?/);
        assert.doesNotMatch(error.failure.message, /Start server/);
    });
});
describe('ollama status read', () => {
    it('reports endpoint, load state, both context numbers, and on-disk GGUFs separately', async () => {
        const directory = await createFixtureModelsDir();
        const { fetchImpl } = stubOllama();
        const adapter = ollamaAdapter(directory, fetchImpl);
        const status = await adapter.localModelsStatus();
        assert.equal(status.serving, 'ollama');
        assert.deepEqual(status.endpoint, { up: true, baseUrl: OLLAMA_BASE_URL });
        assert.equal(status.models.length, 2);
        assert.deepEqual(status.models[0], {
            id: MODEL_A,
            loaded: true,
            contextLength: MODEL_A_RUNTIME_CONTEXT,
            maxContextLength: MODEL_A_MAX_CONTEXT,
            sizeVram: 424242,
        });
        assert.deepEqual(status.models[1], { id: MODEL_B, loaded: false, maxContextLength: 32768 });
        // The fixture registry's GGUFs are on disk but not served by Ollama:
        // they appear only as folder models.
        assert.deepEqual(status.folderModels.map(model => model.id), [ACTIVE_MODEL_ID, SECOND_MODEL_ID]);
    });
    it('reports a down endpoint with folder models still listed', async () => {
        const directory = await createFixtureModelsDir();
        const { fetchImpl, state } = stubOllama();
        state.down = true;
        const adapter = ollamaAdapter(directory, fetchImpl);
        const status = await adapter.localModelsStatus();
        assert.deepEqual(status.endpoint, { up: false, baseUrl: OLLAMA_BASE_URL });
        assert.deepEqual(status.models, []);
        assert.deepEqual(status.folderModels.map(model => model.id), [ACTIVE_MODEL_ID, SECOND_MODEL_ID]);
    });
});
describe('ollama catalog poller', () => {
    it('notifies only when the catalog key changes, including a load change', async () => {
        let key = 'a:9b|';
        let notifications = 0;
        const dispose = watchOllamaCatalog(() => Promise.resolve(key), () => { notifications += 1; }, { intervalMs: 10 });
        try {
            // Baseline probe plus several unchanged probes: no notification.
            await new Promise(resolveWait => setTimeout(resolveWait, 60));
            assert.equal(notifications, 0);
            // A model loading changes the key (name@runtime-context): notify.
            key = 'a:9b|a:9b@4096';
            const deadline = Date.now() + 5000;
            while (notifications === 0 && Date.now() < deadline) {
                await new Promise(resolveWait => setTimeout(resolveWait, 10));
            }
            assert.equal(notifications, 1);
        }
        finally {
            dispose();
        }
        // After disposal a further change notifies nobody.
        key = 'a:9b|';
        await new Promise(resolveWait => setTimeout(resolveWait, 40));
        assert.equal(notifications, 1);
    });
    it('adapter catalog key reflects the loaded set', async () => {
        const directory = await createFixtureModelsDir();
        const { fetchImpl, state } = stubOllama();
        const adapter = ollamaAdapter(directory, fetchImpl);
        const loadedKey = await adapter.ollamaCatalogKey();
        assert.ok(loadedKey.includes(`${MODEL_A}@${MODEL_A_RUNTIME_CONTEXT}`));
        state.psModels = [];
        const unloadedKey = await adapter.ollamaCatalogKey();
        assert.notEqual(unloadedKey, loadedKey);
        state.down = true;
        assert.equal(await adapter.ollamaCatalogKey(), 'unreachable');
    });
});
