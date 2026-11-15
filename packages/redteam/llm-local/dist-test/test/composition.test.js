/**
 * REAL-composition test (packages/AGENTS.md): the unit suites prove what
 * the adapter registers and returns, but not that the plugin composes.
 * This suite boots a test-only cordis.yml through the real Cordis Loader
 * with the real `LlmRuntime` and this plugin — resolved by name through
 * Node module resolution, exactly as the desktop bundle's row resolves
 * them — and asserts the model-visible output: the Host model catalog
 * built by `buildModelCatalog` (the `session/modelCatalog` RPC's own
 * builder) carries the Local group with the downloaded models while the
 * server is stopped. A second suite proves the registration disposes with
 * the plugin fiber and that the models-directory watcher emits
 * `llm/adapters-updated`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Include from '@deepseek-ai/cordis-plugin-include';
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm';
import { buildModelCatalog } from '@deepseek-ai/dsh-api-session-controller';
import * as llmLocal from '../src/index.js';
import { ACTIVE_MODEL_ID, createFixtureModelsDir, FIXTURE_BASE_URL, SECOND_MODEL_ID, writeServerState, } from './fixtures.js';
describe('llm-local real Loader composition', () => {
    it('seats the Local group in the Host model catalog with the server stopped', async () => {
        const modelsDir = await createFixtureModelsDir();
        // No server-state.json exists: the server is stopped. The catalog
        // must still list the downloaded models (the reported bug's shape).
        const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
        const root = await mkdtemp(join(packageRoot, '.composition-'));
        const previousEnv = process.env['DSH_LOCAL_MODELS_DIR'];
        process.env['DSH_LOCAL_MODELS_DIR'] = modelsDir;
        const context = new Context();
        try {
            const configPath = join(root, 'cordis.yml');
            await writeFile(configPath, [
                "- name: '@deepseek-ai/dsh-llm'",
                "- name: '@secscan/redteam-llm-local'",
                '',
            ].join('\n'));
            context.baseUrl = pathToFileURL(root).href + '/';
            await context.plugin(Loader);
            context.loader.builtins.include = Include;
            await context.loader.create({
                name: 'cordis:include',
                config: { path: pathToFileURL(configPath).href },
            });
            await context.loader.await();
            assert.ok(context.llm.listProviders().map(provider => provider.id).includes('local'));
            const catalog = await buildModelCatalog(context, { provider: 'local', model: ACTIVE_MODEL_ID });
            const localGroup = catalog.groups.find(group => group.id === 'local');
            assert.ok(localGroup !== undefined, `Local group missing from: ${catalog.groups.map(group => group.id).join(', ')}`);
            assert.equal(localGroup.name, 'Local');
            assert.deepEqual(localGroup.models.map(model => model.id), [ACTIVE_MODEL_ID, SECOND_MODEL_ID]);
            assert.deepEqual(catalog.default, { provider: 'local', model: ACTIVE_MODEL_ID });
            assert.ok(catalog.routableProviders.includes('local'));
        }
        finally {
            if (previousEnv === undefined)
                delete process.env['DSH_LOCAL_MODELS_DIR'];
            else
                process.env['DSH_LOCAL_MODELS_DIR'] = previousEnv;
            await context.fiber.dispose();
            await rm(root, { recursive: true, force: true });
        }
    });
});
/** Stub model id the composition Ollama endpoint serves first. */
const STUB_MODEL_ID = 'stub-model:9b';
/** Stub model id the composition Ollama endpoint serves second. */
const STUB_SECOND_MODEL_ID = 'stub-other:27b';
/**
 * Start a stub Ollama endpoint on an ephemeral loopback port: the OpenAI
 * model list, `/api/ps` naming the first model loaded with a 4096 runtime
 * allocation, `/api/tags` naming a much larger maximum, and an SSE chat
 * endpoint. Chat request bodies are recorded.
 * @param chatRequests - sink for parsed chat request bodies.
 * @returns the running server.
 */
function startStubOllama(chatRequests) {
    const server = createServer((request, response) => {
        const url = request.url ?? '';
        if (url.endsWith('/v1/models')) {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ object: 'list', data: [{ id: STUB_MODEL_ID }, { id: STUB_SECOND_MODEL_ID }] }));
            return;
        }
        if (url.endsWith('/api/ps')) {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ models: [{ name: STUB_MODEL_ID, context_length: 4096, size_vram: 42 }] }));
            return;
        }
        if (url.endsWith('/api/tags')) {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({
                models: [
                    { name: STUB_MODEL_ID, details: { context_length: 131072 } },
                    { name: STUB_SECOND_MODEL_ID, details: { context_length: 32768 } },
                ],
            }));
            return;
        }
        if (url.endsWith('/v1/chat/completions')) {
            let body = '';
            request.on('data', chunk => { body += String(chunk); });
            request.on('end', () => {
                chatRequests.push(JSON.parse(body));
                response.setHeader('content-type', 'text/event-stream');
                response.end([
                    'data: {"choices":[{"delta":{"reasoning":"Thinking. "},"finish_reason":null}]}',
                    'data: {"choices":[{"delta":{"content":"Stub answer."},"finish_reason":null}]}',
                    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
                    'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8},"timings":{"total_duration":7}}',
                    'data: [DONE]',
                    '',
                ].join('\n'));
            });
            return;
        }
        response.statusCode = 404;
        response.end('not found');
    });
    return server;
}
describe('llm-local Ollama real Loader composition', () => {
    it('seats the Local group from Ollama with no llama server, and a selection dispatches to Ollama', async () => {
        const modelsDir = await createFixtureModelsDir();
        // The fixture registry names GGUF models and has no server-state.json:
        // in Ollama mode the catalog must come from the endpoint, not the
        // registry, and dispatch must not need a llama server.
        const chatRequests = [];
        const server = startStubOllama(chatRequests);
        await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
        const port = server.address().port;
        const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
        const root = await mkdtemp(join(packageRoot, '.composition-'));
        const context = new Context();
        try {
            const configPath = join(root, 'cordis.yml');
            await writeFile(configPath, [
                "- name: '@deepseek-ai/dsh-llm'",
                "- name: '@secscan/redteam-llm-local'",
                '  config:',
                '    serving: ollama',
                `    ollamaBaseUrl: http://127.0.0.1:${port}/v1`,
                `    modelsDir: ${modelsDir}`,
                '    ollamaProbeIntervalMs: 60000',
                '',
            ].join('\n'));
            context.baseUrl = pathToFileURL(root).href + '/';
            await context.plugin(Loader);
            context.loader.builtins.include = Include;
            await context.loader.create({
                name: 'cordis:include',
                config: { path: pathToFileURL(configPath).href },
            });
            await context.loader.await();
            const catalog = await buildModelCatalog(context, { provider: 'local', model: STUB_MODEL_ID });
            const localGroup = catalog.groups.find(group => group.id === 'local');
            assert.ok(localGroup !== undefined, `Local group missing from: ${catalog.groups.map(group => group.id).join(', ')}`);
            assert.equal(localGroup.name, 'Local');
            assert.deepEqual(localGroup.models.map(model => model.id), [STUB_MODEL_ID, STUB_SECOND_MODEL_ID]);
            assert.ok(catalog.routableProviders.includes('local'));
            // The resolved window is the /api/ps runtime allocation (4096),
            // never the /api/tags maximum (131072).
            const resolved = await context.llm.resolveModelInfo('local', STUB_MODEL_ID);
            assert.equal(resolved.context?.contextWindow, 4096);
            // Selection → dispatch through the real runtime: the stub endpoint
            // receives the chat request and its streamed answer comes back.
            const chunks = [];
            for await (const chunk of context.llm.stream({
                provider: 'local',
                model: STUB_MODEL_ID,
                messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Say hello.' }] })],
                maxTokens: 512,
            })) {
                chunks.push(chunk);
            }
            assert.equal(chatRequests.length, 1);
            assert.equal(chatRequests[0]?.['model'], STUB_MODEL_ID);
            const text = chunks
                .filter((chunk) => chunk.type === 'text-delta')
                .map(chunk => chunk.text)
                .join('');
            assert.equal(text, 'Stub answer.');
            const usage = chunks.find((chunk) => chunk.type === 'usage');
            assert.ok(usage !== undefined);
            assert.deepEqual(usage.usage, { inputTokens: 5, outputTokens: 3, totalTokens: 8 });
            const finish = chunks[chunks.length - 1];
            assert.ok(finish?.type === 'finish');
            assert.equal(finish.reason.kind, 'stop');
        }
        finally {
            await context.fiber.dispose();
            await rm(root, { recursive: true, force: true });
            await new Promise(resolveClose => server.close(() => resolveClose()));
        }
    });
});
describe('llm-local plugin lifecycle', () => {
    it('registers on apply, disposes with the fiber, and announces directory changes', async () => {
        const modelsDir = await createFixtureModelsDir();
        const context = new Context();
        try {
            await context.plugin(LlmRuntime);
            let announced = 0;
            context.on('llm/adapters-updated', () => { announced += 1; });
            const fiber = await context.plugin(llmLocal, { modelsDir });
            assert.ok(context.llm.listProviders().map(provider => provider.id).includes('local'));
            const models = await context.llm.listModels('local');
            assert.deepEqual(models.map(model => model.id), [ACTIVE_MODEL_ID, SECOND_MODEL_ID]);
            // Publishing a server state is a catalog-affecting change: the
            // watcher must announce it so open pickers refresh.
            await writeServerState(modelsDir, { status: 'running', baseUrl: FIXTURE_BASE_URL, modelId: ACTIVE_MODEL_ID });
            const deadline = Date.now() + 5000;
            while (announced === 0 && Date.now() < deadline) {
                await new Promise(resolveWait => setTimeout(resolveWait, 25));
            }
            assert.ok(announced > 0, 'the watcher did not emit llm/adapters-updated after server-state changed');
            await fiber.dispose();
            assert.ok(!context.llm.listProviders().map(provider => provider.id).includes('local'));
        }
        finally {
            await context.fiber.dispose();
        }
    });
});
