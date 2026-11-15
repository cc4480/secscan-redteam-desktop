/**
 * Remote-seat test for the `localModels` lifecycle actions: start,
 * stop, delete, and pull, called through the Typert Gateway face
 * (`ctx.typertGateway.invoke`) — never by calling the adapter or the
 * service directly — against compositions that boot the real plugin in
 * Ollama serving mode over a stub Ollama HTTP endpoint. One suite
 * boots through the real Cordis Loader, which reads the package's
 * generated `./typert` descriptor, so the actions are proven present
 * in the built artifacts as well as in source-mode discovery.
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
import LlmRuntime from '@deepseek-ai/dsh-llm';
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import * as llmLocal from '../src/index.js';
import { createFixtureModelsDir } from './fixtures.js';
/** Stub model id the endpoint's library holds first. */
const STUB_MODEL_ID = 'stub-model:9b';
/** Stub model id the endpoint's library holds second. */
const STUB_SECOND_MODEL_ID = 'stub-other:27b';
/**
 * Start a stub Ollama endpoint on an ephemeral loopback port with the
 * full native surface the actions use: catalog reads, generate
 * (load/unload per `keep_alive`), delete, and an immediately
 * succeeding pull stream.
 * @returns the running server and its mutable state.
 */
function startStubOllama() {
    const state = {
        library: new Set([STUB_MODEL_ID, STUB_SECOND_MODEL_ID]),
        loaded: new Set(),
    };
    const server = createServer((request, response) => {
        const url = request.url ?? '';
        /**
         * Read the request's JSON body, then run the endpoint handler.
         * @param handler - called with the parsed body (empty record for bodyless requests).
         */
        const withBody = (handler) => {
            const chunks = [];
            request.on('data', chunk => chunks.push(chunk));
            request.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                handler(text === '' ? {} : JSON.parse(text));
            });
        };
        if (url.endsWith('/v1/models')) {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ object: 'list', data: [...state.library].map(id => ({ id })) }));
            return;
        }
        if (url.endsWith('/api/ps')) {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ models: [...state.loaded].map(name => ({ name })) }));
            return;
        }
        if (url.endsWith('/api/tags')) {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ models: [...state.library].map(name => ({ name })) }));
            return;
        }
        if (url.endsWith('/api/generate')) {
            withBody((body) => {
                const model = body['model'];
                if (typeof model === 'string') {
                    if (body['keep_alive'] === 0)
                        state.loaded.delete(model);
                    else
                        state.loaded.add(model);
                }
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify({ model, done: true }));
            });
            return;
        }
        if (url.endsWith('/api/delete')) {
            withBody((body) => {
                const model = body['model'];
                if (typeof model !== 'string' || !state.library.has(model)) {
                    response.statusCode = 404;
                    response.end('model not found');
                    return;
                }
                state.library.delete(model);
                state.loaded.delete(model);
                response.statusCode = 200;
                response.end();
            });
            return;
        }
        if (url.endsWith('/api/pull')) {
            withBody(() => {
                response.setHeader('content-type', 'application/x-ndjson');
                response.end('{"status":"pulling manifest"}\n{"status":"success"}\n');
            });
            return;
        }
        response.statusCode = 404;
        response.end('not found');
    });
    return { server, state };
}
/**
 * Call one action through the Gateway face, as the web transport does.
 * @param context - composition carrying the Gateway.
 * @param method - the `localModels` method name.
 * @param args - the method's arguments by parameter name.
 * @returns the payload the Remote method returned.
 */
async function invokeAction(context, method, args) {
    return await context.typertGateway.invoke({ namespace: 'localModels', method, args });
}
/**
 * Poll one pull job through the Gateway until it settles.
 * @param context - composition carrying the Gateway.
 * @param jobId - the job handle.
 * @returns the settled pull status.
 */
async function settledPull(context, jobId) {
    const deadline = Date.now() + 5000;
    for (;;) {
        const status = await invokeAction(context, 'pullStatus', { jobId });
        if (status.state !== 'running')
            return status;
        if (Date.now() > deadline)
            throw new Error(`pull job ${jobId} never settled`);
        await new Promise(resolveWait => setTimeout(resolveWait, 5));
    }
}
/**
 * Exercise the full action set against one booted composition.
 * @param context - composition carrying the Gateway and the plugin.
 * @param state - the stub endpoint's state, for cross-checks.
 */
async function exerciseActions(context, state) {
    const started = await invokeAction(context, 'startModel', { modelId: STUB_MODEL_ID });
    assert.deepEqual(started, { modelId: STUB_MODEL_ID, loaded: true });
    assert.ok(state.loaded.has(STUB_MODEL_ID));
    const stopped = await invokeAction(context, 'stopModel', { modelId: STUB_MODEL_ID });
    assert.deepEqual(stopped, { modelId: STUB_MODEL_ID, loaded: false });
    assert.ok(!state.loaded.has(STUB_MODEL_ID));
    const { jobId } = await invokeAction(context, 'startPull', { modelId: STUB_SECOND_MODEL_ID });
    assert.equal(typeof jobId, 'string');
    const pull = await settledPull(context, jobId);
    assert.equal(pull.state, 'done');
    assert.equal(pull.modelId, STUB_SECOND_MODEL_ID);
    await assert.rejects(invokeAction(context, 'pullStatus', { jobId: 'no-such-job' }));
    const deleted = await invokeAction(context, 'deleteModel', { modelId: STUB_SECOND_MODEL_ID });
    assert.deepEqual(deleted, { modelId: STUB_SECOND_MODEL_ID, deleted: true });
    assert.ok(!state.library.has(STUB_SECOND_MODEL_ID));
    // Deleting what the library no longer holds is an honest failure,
    // and the failed call changes nothing.
    await assert.rejects(invokeAction(context, 'deleteModel', { modelId: STUB_SECOND_MODEL_ID }));
    assert.ok(state.library.has(STUB_MODEL_ID));
}
describe('llm-local Remote actions (Ollama, direct composition)', () => {
    it('runs start, stop, pull, and delete through the Gateway', async () => {
        const modelsDir = await createFixtureModelsDir();
        const { server, state } = startStubOllama();
        await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
        const port = server.address().port;
        const context = new Context();
        try {
            await context.plugin(TypertRegistry);
            await context.plugin(TypertGatewayService);
            await context.plugin(LlmRuntime);
            await context.plugin(llmLocal, {
                modelsDir,
                serving: 'ollama',
                ollamaBaseUrl: `http://127.0.0.1:${port}/v1`,
                ollamaProbeIntervalMs: 60000,
            });
            await exerciseActions(context, state);
        }
        finally {
            await context.fiber.dispose();
            await new Promise(resolveClose => server.close(() => resolveClose()));
        }
    });
});
describe('llm-local Remote actions (Ollama, real Loader composition)', () => {
    it('runs the actions through the Gateway from the generated descriptor', async () => {
        const modelsDir = await createFixtureModelsDir();
        const { server, state } = startStubOllama();
        await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
        const port = server.address().port;
        const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
        const root = await mkdtemp(join(packageRoot, '.composition-'));
        const context = new Context();
        try {
            const configPath = join(root, 'cordis.yml');
            await writeFile(configPath, [
                "- name: '@deepseek-ai/dsh-llm'",
                "- name: '@deepseek-ai/dsh-typert-registry'",
                "- name: '@deepseek-ai/dsh-api-gateway'",
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
            await exerciseActions(context, state);
        }
        finally {
            await context.fiber.dispose();
            await rm(root, { recursive: true, force: true });
            await new Promise(resolveClose => server.close(() => resolveClose()));
        }
    });
});
