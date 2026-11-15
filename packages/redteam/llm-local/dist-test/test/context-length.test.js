/**
 * Context-window setting tests: the store round-trip in `./state.ts`,
 * the `localModels` context actions (read / set / clear) called
 * through the Typert Gateway face against direct compositions in both
 * serving modes, and the llama seam — a value the action persists in
 * `settings.json` is the value the llama store-settings reader hands
 * to the server argv builder as `-c`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import * as llmLocal from '../src/index.js';
import { llamaServerArgs, parseGgufContextLength, readGgufContextLength, readLlamaStoreSettings, readLocalModelsDirectory, resolveEffectiveLlamaContextLength, resolveEffectiveOllamaContextLength, startLlamaServer, stopLlamaServer, writeLocalModelsSettings, } from '../src/index.js';
import { ACTIVE_MODEL_FILE, ACTIVE_MODEL_ID, createFixtureModelsDir, SECOND_MODEL_ID } from './fixtures.js';
/** Stub model id the Ollama endpoint serves, with a 131072 catalog maximum. */
const STUB_MODEL_ID = 'stub-model:9b';
/** Stub model id the Ollama endpoint serves, with a 32768 catalog maximum. */
const STUB_SECOND_MODEL_ID = 'stub-other:27b';
/**
 * Start a stub Ollama endpoint whose `/api/tags` reports a distinct
 * catalog maximum per model (the ceiling source for Ollama-mode sets).
 * @returns the running server.
 */
function startStubOllama() {
    const server = createServer((request, response) => {
        const url = request.url ?? '';
        if (url.endsWith('/v1/models')) {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ object: 'list', data: [{ id: STUB_MODEL_ID }, { id: STUB_SECOND_MODEL_ID }] }));
            return;
        }
        if (url.endsWith('/api/ps')) {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ models: [] }));
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
        response.statusCode = 404;
        response.end('not found');
    });
    return server;
}
/**
 * Call one `localModels` context action through the Gateway face.
 * @param context - composition carrying the Gateway.
 * @param method - the method name.
 * @param args - the method's arguments by parameter name.
 * @returns the payload the Remote method returned.
 */
async function invokeContext(context, method, args) {
    return await context.typertGateway.invoke({ namespace: 'localModels', method, args });
}
/**
 * Boot one direct composition of the plugin in the given serving mode.
 * @param modelsDir - the fixture models directory.
 * @param config - plugin configuration (serving mode and, for Ollama, the stub endpoint).
 * @returns the booted context; the caller disposes it.
 */
async function boot(modelsDir, config) {
    const context = new Context();
    await context.plugin(TypertRegistry);
    await context.plugin(TypertGatewayService);
    await context.plugin(LlmRuntime);
    await context.plugin(llmLocal, { modelsDir, ollamaProbeIntervalMs: 60000, ...config });
    return context;
}
/**
 * Read one fixture directory's raw settings document.
 * @param directory - the fixture models directory.
 * @returns the parsed settings document.
 */
async function rawSettings(directory) {
    return JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'));
}
describe('context settings store', () => {
    it('round-trips the per-model record and preserves fields this package does not own', async () => {
        const directory = await createFixtureModelsDir();
        await writeFile(join(directory, 'settings.json'), JSON.stringify({
            version: 1, activeModelId: ACTIVE_MODEL_ID, contextLength: 32768, threads: 4, huggingFaceToken: 'hf-fixture',
        }));
        writeLocalModelsSettings(directory, { contextLengthByModel: { [STUB_MODEL_ID]: 65536 } });
        let state = readLocalModelsDirectory(directory);
        assert.equal(state.settings.contextLengthByModel?.[STUB_MODEL_ID], 65536);
        assert.equal(state.settings.contextLength, 32768);
        const raw = await rawSettings(directory);
        assert.equal(raw['huggingFaceToken'], 'hf-fixture');
        assert.equal(raw['version'], 1);
        assert.equal(raw['threads'], 4);
        writeLocalModelsSettings(directory, { contextLengthByModel: { [STUB_MODEL_ID]: null } });
        state = readLocalModelsDirectory(directory);
        assert.equal(state.settings.contextLengthByModel, undefined);
        assert.equal((await rawSettings(directory))['contextLengthByModel'], undefined);
    });
    it('drops unusable per-model entries instead of failing the read', async () => {
        const directory = await createFixtureModelsDir();
        await writeFile(join(directory, 'settings.json'), JSON.stringify({
            contextLengthByModel: { good: 8192.9, zero: 0, text: 'x', '': 4096 },
        }));
        const state = readLocalModelsDirectory(directory);
        assert.deepEqual(state.settings.contextLengthByModel, { good: 8192 });
    });
    it('resolves the Ollama start precedence: persisted, then construction, then catalog maximum', () => {
        assert.equal(resolveEffectiveOllamaContextLength(65536, 8192, 131072), 65536);
        assert.equal(resolveEffectiveOllamaContextLength(undefined, 8192, 131072), 8192);
        assert.equal(resolveEffectiveOllamaContextLength(undefined, undefined, 131072), 131072);
        assert.equal(resolveEffectiveOllamaContextLength(undefined, undefined, undefined), undefined);
    });
});
describe('ollama context actions through the Gateway', () => {
    it('persists per model, reads back, validates the catalog ceiling, and clears', async () => {
        const modelsDir = await createFixtureModelsDir();
        const server = startStubOllama();
        await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
        const port = server.address().port;
        const context = await boot(modelsDir, { serving: 'ollama', ollamaBaseUrl: `http://127.0.0.1:${port}/v1` });
        try {
            // Unset reads as unset, with the catalog maximum named as the ceiling.
            assert.deepEqual(await invokeContext(context, 'modelContext', { modelId: STUB_MODEL_ID }), { modelId: STUB_MODEL_ID, maxContextLength: 131072 });
            const set = await invokeContext(context, 'setModelContext', { modelId: STUB_MODEL_ID, contextLength: 65536 });
            assert.deepEqual(set, { modelId: STUB_MODEL_ID, contextLength: 65536, maxContextLength: 131072 });
            // The value is in the store, keyed to this model only.
            const stored = readLocalModelsDirectory(modelsDir);
            assert.equal(stored.settings.contextLengthByModel?.[STUB_MODEL_ID], 65536);
            assert.equal(stored.settings.contextLengthByModel?.[STUB_SECOND_MODEL_ID], undefined);
            assert.equal(stored.settings.contextLength, 32768);
            // Above the model's own maximum: honest rejection, store unchanged.
            await assert.rejects(invokeContext(context, 'setModelContext', { modelId: STUB_SECOND_MODEL_ID, contextLength: 65536 }));
            assert.equal(readLocalModelsDirectory(modelsDir).settings.contextLengthByModel?.[STUB_SECOND_MODEL_ID], undefined);
            // Non-positive and fractional values reject too.
            await assert.rejects(invokeContext(context, 'setModelContext', { modelId: STUB_MODEL_ID, contextLength: 0 }));
            await assert.rejects(invokeContext(context, 'setModelContext', { modelId: STUB_MODEL_ID, contextLength: 4096.5 }));
            assert.equal(readLocalModelsDirectory(modelsDir).settings.contextLengthByModel?.[STUB_MODEL_ID], 65536);
            // A model the endpoint does not serve fails loud while it is up.
            await assert.rejects(invokeContext(context, 'setModelContext', { modelId: 'ghost:1b', contextLength: 4096 }));
            const cleared = await invokeContext(context, 'clearModelContext', { modelId: STUB_MODEL_ID });
            assert.deepEqual(cleared, { modelId: STUB_MODEL_ID, maxContextLength: 131072 });
            assert.equal(readLocalModelsDirectory(modelsDir).settings.contextLengthByModel, undefined);
        }
        finally {
            await context.fiber.dispose();
            await new Promise(resolveClose => server.close(() => resolveClose()));
        }
    });
});
describe('llama context actions and the -c seam', () => {
    it('writes the global field the argv builder consumes, with the llama bounds enforced', async () => {
        const modelsDir = await createFixtureModelsDir();
        const context = await boot(modelsDir, { serving: 'llama' });
        try {
            const set = await invokeContext(context, 'setModelContext', { modelId: ACTIVE_MODEL_ID, contextLength: 65536 });
            assert.equal(set.contextLength, 65536);
            assert.equal(set.maxContextLength, 262144);
            // Both ends of the seam: the state reader sees the field, and the
            // llama store-settings reader — the function startLlamaServer
            // feeds llamaServerArgs from — resolves the same value into -c.
            assert.equal(readLocalModelsDirectory(modelsDir).settings.contextLength, 65536);
            const storeSettings = readLlamaStoreSettings(modelsDir);
            assert.equal(storeSettings.contextLength, 65536);
            const args = llamaServerArgs({
                modelPath: '/models/model.gguf',
                modelId: ACTIVE_MODEL_ID,
                contextLength: storeSettings.contextLength,
                threads: storeSettings.threads,
                port: 18080,
            });
            const cIndex = args.indexOf('-c');
            assert.ok(cIndex >= 0);
            assert.equal(args[cIndex + 1], '65536');
            // Above the hard ceiling and below the llama minimum reject; the
            // persisted value survives both failed sets.
            await assert.rejects(invokeContext(context, 'setModelContext', { modelId: ACTIVE_MODEL_ID, contextLength: 300000 }));
            await assert.rejects(invokeContext(context, 'setModelContext', { modelId: SECOND_MODEL_ID, contextLength: 512 }));
            assert.equal(readLocalModelsDirectory(modelsDir).settings.contextLength, 65536);
            const cleared = await invokeContext(context, 'clearModelContext', { modelId: ACTIVE_MODEL_ID });
            assert.equal(cleared.contextLength, undefined);
            assert.equal(readLocalModelsDirectory(modelsDir).settings.contextLength, undefined);
            // The store reader's own fallback is unchanged; what Start does
            // with an unset value is the declared-maximum resolution proven
            // in the GGUF describes below.
            assert.equal(readLlamaStoreSettings(modelsDir).contextLength, 32768);
        }
        finally {
            await context.fiber.dispose();
        }
    });
});
/** Context length the GGUF fixture declares. */
const GGUF_DECLARED_CONTEXT = 131072;
/**
 * Build one GGUF header declaring the given context length, with the
 * value types the walker must skip (a string array, a string, and a
 * scalar) ordered BEFORE the context key, so the parse only reaches
 * the key by walking them.
 * @param contextLength - the `<arch>.context_length` value to declare.
 * @returns the header bytes.
 */
function buildGgufHeader(contextLength) {
    const parts = [];
    /**
     * @param value - the value to append as a little-endian u32.
     */
    const u32 = (value) => {
        const bytes = Buffer.alloc(4);
        bytes.writeUInt32LE(value);
        parts.push(bytes);
    };
    /**
     * @param value - the value to append as a little-endian u64.
     */
    const u64 = (value) => {
        const bytes = Buffer.alloc(8);
        bytes.writeBigUInt64LE(BigInt(value));
        parts.push(bytes);
    };
    /**
     * @param value - the string to append, length-prefixed.
     */
    const str = (value) => {
        u64(value.length);
        parts.push(Buffer.from(value, 'utf8'));
    };
    parts.push(Buffer.from('GGUF', 'ascii'));
    u32(3);
    u64(0);
    u64(5);
    str('tokenizer.ggml.tokens');
    u32(9);
    u32(8);
    u64(2);
    str('a');
    str('bb');
    str('general.architecture');
    u32(8);
    str('qwen3');
    str('general.alignment');
    u32(4);
    u32(32);
    str('qwen3.context_length');
    u32(4);
    u32(contextLength);
    return Buffer.concat(parts);
}
describe('GGUF declared context length', () => {
    it('parses the declared maximum past every skippable value type', () => {
        assert.equal(parseGgufContextLength(buildGgufHeader(GGUF_DECLARED_CONTEXT)), GGUF_DECLARED_CONTEXT);
    });
    it('reads the declaration from a GGUF file on disk, and nothing from a non-GGUF or missing file', async () => {
        const directory = await createFixtureModelsDir();
        const path = join(directory, ACTIVE_MODEL_FILE);
        await writeFile(path, buildGgufHeader(GGUF_DECLARED_CONTEXT));
        assert.equal(readGgufContextLength(path), GGUF_DECLARED_CONTEXT);
        await writeFile(path, 'gguf-fixture');
        assert.equal(readGgufContextLength(path), undefined);
        assert.equal(readGgufContextLength(join(directory, 'absent.gguf')), undefined);
        assert.equal(parseGgufContextLength(buildGgufHeader(GGUF_DECLARED_CONTEXT).subarray(0, 24)), undefined);
    });
    it('resolves the llama start precedence: persisted, then declared maximum, then the named fallback', () => {
        assert.equal(resolveEffectiveLlamaContextLength(4096, GGUF_DECLARED_CONTEXT), 4096);
        assert.equal(resolveEffectiveLlamaContextLength(undefined, GGUF_DECLARED_CONTEXT), GGUF_DECLARED_CONTEXT);
        // A declaration past the accepted range clamps to it, in both directions.
        assert.equal(resolveEffectiveLlamaContextLength(undefined, 999999), 262144);
        assert.equal(resolveEffectiveLlamaContextLength(undefined, 512), 1024);
        // No declaration knowable: the named fallback is the desktop default.
        assert.equal(resolveEffectiveLlamaContextLength(undefined, undefined), 32768);
    });
});
describe('llama context facts and start honor the GGUF declaration', () => {
    it('reports the declared maximum as the ceiling and validates sets against it', async () => {
        const modelsDir = await createFixtureModelsDir();
        await writeFile(join(modelsDir, ACTIVE_MODEL_FILE), buildGgufHeader(GGUF_DECLARED_CONTEXT));
        await writeFile(join(modelsDir, 'settings.json'), JSON.stringify({
            version: 1, activeModelId: ACTIVE_MODEL_ID, threads: 4,
        }));
        const context = await boot(modelsDir, { serving: 'llama' });
        try {
            // Unset reads as unset, with the model's own declared maximum —
            // not the hard ceiling — named as the ceiling.
            assert.deepEqual(await invokeContext(context, 'modelContext', { modelId: ACTIVE_MODEL_ID }), { modelId: ACTIVE_MODEL_ID, maxContextLength: GGUF_DECLARED_CONTEXT });
            // Above the declared maximum rejects, even below the hard ceiling.
            await assert.rejects(invokeContext(context, 'setModelContext', {
                modelId: ACTIVE_MODEL_ID, contextLength: 200000,
            }));
            assert.equal(readLocalModelsDirectory(modelsDir).settings.contextLength, undefined);
            const set = await invokeContext(context, 'setModelContext', {
                modelId: ACTIVE_MODEL_ID, contextLength: 65536,
            });
            assert.deepEqual(set, {
                modelId: ACTIVE_MODEL_ID, contextLength: 65536, maxContextLength: GGUF_DECLARED_CONTEXT,
            });
            const cleared = await invokeContext(context, 'clearModelContext', { modelId: ACTIVE_MODEL_ID });
            assert.deepEqual(cleared, { modelId: ACTIVE_MODEL_ID, maxContextLength: GGUF_DECLARED_CONTEXT });
        }
        finally {
            await context.fiber.dispose();
        }
    });
    it('starts the server at the declared maximum when unset, and at the persisted value when set', async () => {
        const directory = await createFixtureModelsDir();
        const modelPath = join(directory, ACTIVE_MODEL_FILE);
        await writeFile(modelPath, buildGgufHeader(GGUF_DECLARED_CONTEXT));
        await writeFile(join(directory, 'settings.json'), JSON.stringify({
            version: 1, activeModelId: ACTIVE_MODEL_ID, threads: 2, gpuLayers: 0,
        }));
        const binaryPath = join(directory, 'llama-server-context-stub');
        const script = [
            '#!/usr/bin/env node',
            "import { createServer } from 'node:http'",
            "import { appendFileSync } from 'node:fs'",
            'const args = process.argv.slice(2)',
            "const port = Number(args[args.indexOf('--port') + 1])",
            "const alias = args[args.indexOf('--alias') + 1]",
            "appendFileSync(new URL('./spawn-capture.jsonl', import.meta.url), JSON.stringify({ c: args[args.indexOf('-c') + 1] }) + '\\n')",
            'createServer((req, res) => {',
            "  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return }",
            "  if (req.url === '/v1/models' || req.url === '/models') {",
            "    res.writeHead(200, { 'content-type': 'application/json' })",
            "    res.end(JSON.stringify({ object: 'list', data: [{ id: alias }] }))",
            '    return',
            '  }',
            "  res.writeHead(404); res.end('not found')",
            "}).listen(port, '127.0.0.1')",
            '',
        ].join('\n');
        await writeFile(binaryPath, script);
        await chmod(binaryPath, 0o755);
        const deps = { directory, fetchImpl: fetch, binary: binaryPath, readyTimeoutMs: 15_000 };
        try {
            await startLlamaServer(deps, { id: ACTIVE_MODEL_ID, path: modelPath });
            await stopLlamaServer(deps);
            writeLocalModelsSettings(directory, { contextLength: 4096 });
            await startLlamaServer(deps, { id: ACTIVE_MODEL_ID, path: modelPath });
            const captures = (await readFile(join(directory, 'spawn-capture.jsonl'), 'utf8'))
                .split('\n')
                .filter(line => line !== '')
                .map(line => JSON.parse(line));
            assert.deepEqual(captures, [{ c: String(GGUF_DECLARED_CONTEXT) }, { c: '4096' }]);
        }
        finally {
            await stopLlamaServer(deps).catch(() => undefined);
        }
    });
});
