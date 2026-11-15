/**
 * Restore tests for llama serving mode: probe-verified status, Hugging
 * Face downloads through the single-string pull contract, and
 * llama-server start/stop/delete against a stub server binary.
 *
 * Status is proven against a real hit-counted HTTP stub: the published
 * server-state document alone must never read as endpoint truth, in
 * either direction. Downloads run against a stub Hub transport (no real
 * network, no real models): the finalize case keeps the companion
 * (mmproj) fetch hanging past the point where the job must already
 * report done. Server control spawns a stub `llama-server` script that
 * answers the readiness routes, so state transitions, the recorded pid,
 * and process death are all observed, not assumed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmError } from '@deepseek-ai/dsh-llm';
import { LLAMA_FULL_OFFLOAD_LAYERS, LocalLlamaAdapter, llamaServerArgs, readLlamaRegistry, readLlamaStoreSettings, readLocalServerState, resolveGpuOffload, startLlamaServer, stopLlamaServer, } from '../src/index.js';
/** Registry id of the fixture store's first model. */
const MODEL_ONE_ID = 'model-one-id';
/** GGUF file name of the fixture store's first model. */
const MODEL_ONE_FILE = 'Model-One-Q4_K_M.gguf';
/** Registry id of the fixture store's second model. */
const MODEL_TWO_ID = 'model-two-id';
/** GGUF file name of the fixture store's second model. */
const MODEL_TWO_FILE = 'Model-Two-Q8_0.gguf';
/** Hub repository the download stubs serve. */
const HF_REPO = 'test-owner/test-repo';
/** Main GGUF file name inside the stub Hub repository. */
const HF_MAIN_FILE = 'TestModel-Q4_K_M.gguf';
/** Registry id the main file's download must derive. */
const HF_MAIN_ID = 'test-owner--test-repo--testmodel-q4-k-m';
/** Projector file name inside the stub Hub repository. */
const HF_PROJECTOR_FILE = 'mmproj-f16.gguf';
/**
 * Create one fixture models store in the desktop writer's shape:
 * a full registry (repo/file/path/sizeBytes/downloadedAt) with two
 * models, their GGUF files on disk, and the operator's settings.
 * @returns the absolute models directory.
 */
async function createStore() {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-llm-local-restore-'));
    await writeFile(join(directory, MODEL_ONE_FILE), 'gguf-fixture-one');
    await writeFile(join(directory, MODEL_TWO_FILE), 'gguf-fixture-two');
    await writeFile(join(directory, 'registry.json'), JSON.stringify({
        version: 1,
        models: [
            {
                id: MODEL_ONE_ID, repo: 'owner-one/model-one', file: MODEL_ONE_FILE,
                path: join(directory, MODEL_ONE_FILE), sizeBytes: 16, downloadedAt: 1793600000000,
            },
            {
                id: MODEL_TWO_ID, repo: 'owner-two/model-two', file: MODEL_TWO_FILE,
                path: join(directory, MODEL_TWO_FILE), sizeBytes: 16, downloadedAt: 1793500000000,
            },
        ],
    }, null, 2));
    await writeFile(join(directory, 'settings.json'), JSON.stringify({
        version: 1, activeModelId: MODEL_ONE_ID, contextLength: 4096, threads: 2,
    }));
    return directory;
}
/**
 * Publish one running server-state document into a fixture store.
 * @param directory - the models directory.
 * @param baseUrl - the endpoint the document claims.
 * @param modelId - the model the document claims is served.
 */
async function writeRunningState(directory, baseUrl, modelId) {
    await writeFile(join(directory, 'server-state.json'), JSON.stringify({
        version: 1, status: 'running', baseUrl, modelId, updatedAt: Date.now(),
    }, null, 2));
}
/**
 * Start a stub llama endpoint answering `/v1/models` with one served id.
 * @param servedId - the model id the endpoint reports serving.
 * @returns the running server and its OpenAI-compatible base URL.
 */
async function startStubEndpoint(servedId) {
    const server = createServer((request, response) => {
        if ((request.url ?? '').endsWith('/models')) {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ object: 'list', data: [{ id: servedId }] }));
            return;
        }
        response.statusCode = 404;
        response.end('not found');
    });
    await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
    const port = server.address().port;
    return { server, baseUrl: `http://127.0.0.1:${port}/v1` };
}
/**
 * Close one stub server.
 * @param server - the server to close.
 */
async function closeServer(server) {
    await new Promise(resolveClose => server.close(() => resolveClose()));
}
/**
 * @returns a loopback port nothing listens on (bound, captured, released).
 */
async function deadPort() {
    const server = createServer();
    await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
    const port = server.address().port;
    await closeServer(server);
    return port;
}
/**
 * Poll one adapter pull job until it settles or the deadline passes.
 * @param adapter - the adapter holding the job.
 * @param jobId - the job handle.
 * @param deadlineMs - how long to wait before returning the last state.
 * @returns the settled status, or the last observed one at the deadline.
 */
async function settledPull(adapter, jobId, deadlineMs = 5_000) {
    const deadline = Date.now() + deadlineMs;
    let status = adapter.localModelPullStatus(jobId);
    while (status.state === 'running' && Date.now() < deadline) {
        await new Promise(resolveWait => setTimeout(resolveWait, 5));
        status = adapter.localModelPullStatus(jobId);
    }
    return status;
}
describe('llama status (probe-verified)', () => {
    it('shows the files and the served model when the endpoint confirms the published state', async () => {
        const directory = await createStore();
        const { server, baseUrl } = await startStubEndpoint(MODEL_ONE_ID);
        try {
            await writeRunningState(directory, baseUrl, MODEL_ONE_ID);
            const adapter = new LocalLlamaAdapter({ modelsDir: directory });
            const status = await adapter.localModelsStatus();
            assert.equal(status.serving, 'llama');
            assert.deepEqual(status.endpoint, { up: true, baseUrl });
            assert.deepEqual(status.models.map(model => [model.id, model.loaded]), [
                [MODEL_ONE_ID, true],
                [MODEL_TWO_ID, false],
            ]);
            assert.deepEqual(status.folderModels.map(model => model.id), [MODEL_ONE_ID, MODEL_TWO_ID]);
        }
        finally {
            await closeServer(server);
        }
    });
    it('shows endpoint down but still lists the files when the endpoint does not answer', async () => {
        const directory = await createStore();
        const port = await deadPort();
        // The published document claims a running server; nothing listens.
        await writeRunningState(directory, `http://127.0.0.1:${port}/v1`, MODEL_ONE_ID);
        const adapter = new LocalLlamaAdapter({ modelsDir: directory });
        const status = await adapter.localModelsStatus();
        assert.equal(status.endpoint.up, false);
        assert.deepEqual(status.models.map(model => model.loaded), [false, false]);
        assert.deepEqual(status.folderModels.map(model => model.id), [MODEL_ONE_ID, MODEL_TWO_ID]);
    });
});
/**
 * Build a stub Hugging Face transport: the repository listing and tree
 * answer from the given siblings, resolve URLs answer the given bytes
 * per file, and — when `hangCompanion` is set — the projector's resolve
 * hangs until the caller's abort signal fires.
 * @param siblings - the repository listing's siblings.
 * @param fileBytes - resolve payload per repository file name.
 * @param hangCompanion - whether the projector download hangs until aborted.
 * @returns the fetch seam and its observation state.
 */
function stubHub(siblings, fileBytes, hangCompanion) {
    const state = { companionStarted: false, companionSettled: false, urls: [] };
    const fetchImpl = (async (input, init) => {
        const url = String(input);
        state.urls.push(url);
        if (url === `${'https://huggingface.co'}/api/models/${HF_REPO}`) {
            return Response.json({ siblings });
        }
        if (url === `${'https://huggingface.co'}/api/models/${HF_REPO}/tree/main`) {
            return Response.json([]);
        }
        const resolvePrefix = `${'https://huggingface.co'}/${HF_REPO}/resolve/main/`;
        if (url.startsWith(resolvePrefix)) {
            const file = decodeURIComponent(url.slice(resolvePrefix.length));
            if (file === HF_PROJECTOR_FILE && hangCompanion) {
                state.companionStarted = true;
                return await new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        state.companionSettled = true;
                        reject(new Error('aborted'));
                    });
                });
            }
            const bytes = fileBytes.get(file);
            if (bytes === undefined)
                return new Response('not found', { status: 404 });
            return new Response(new Blob([bytes]), { headers: { 'content-length': String(bytes.byteLength) } });
        }
        return new Response('not found', { status: 404 });
    });
    return { fetchImpl, state };
}
describe('llama chat round-trip (real HTTP endpoint)', () => {
    it('dispatches through the gate to a real local endpoint and assembles its streamed completion', async () => {
        const directory = await createStore();
        const hits = [];
        const server = createServer((request, response) => {
            hits.push(`${request.method} ${request.url}`);
            if ((request.url ?? '').endsWith('/v1/models')) {
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify({ object: 'list', data: [{ id: MODEL_ONE_ID }] }));
                return;
            }
            if ((request.url ?? '').endsWith('/v1/chat/completions')) {
                response.setHeader('content-type', 'text/event-stream');
                response.end([
                    'data: {"choices":[{"delta":{"content":"Local"},"finish_reason":null}]}',
                    'data: {"choices":[{"delta":{"content":" answer"},"finish_reason":null}]}',
                    'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}',
                    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
                    'data: [DONE]',
                    '',
                ].join('\n'));
                return;
            }
            response.statusCode = 404;
            response.end('not found');
        });
        await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
        const port = server.address().port;
        const baseUrl = `http://127.0.0.1:${port}/v1`;
        try {
            await writeRunningState(directory, baseUrl, MODEL_ONE_ID);
            // No fetch seam: the adapter's real fetch carries the whole path —
            // catalog seating, the server-state dispatch gate, the wire
            // request, and the SSE translation — exactly as the served app's
            // local route will exercise it.
            const adapter = new LocalLlamaAdapter({ modelsDir: directory });
            assert.deepEqual((await adapter.listModels('local')).map(model => model.id), [MODEL_ONE_ID, MODEL_TWO_ID]);
            const chunks = [];
            for await (const chunk of adapter.stream({
                provider: 'local',
                model: MODEL_ONE_ID,
                messages: [{ role: 'user', content: [{ type: 'text', text: 'Say hello.' }] }],
            })) {
                chunks.push(chunk);
            }
            const text = chunks
                .filter((chunk) => chunk.type === 'text-delta')
                .map(chunk => chunk.text)
                .join('');
            assert.equal(text, 'Local answer');
            const finish = chunks[chunks.length - 1];
            assert.ok(finish?.type === 'finish');
            assert.equal(finish.reason.kind, 'stop');
            assert.ok(hits.some(hit => hit === 'POST /v1/chat/completions'));
        }
        finally {
            await closeServer(server);
        }
    });
});
describe('llama Hugging Face pull (single-string contract)', () => {
    it('downloads the exact file of "owner/name/file.gguf" and reports done while the companion fetch still hangs', async () => {
        const directory = await createStore();
        const mainBytes = new TextEncoder().encode('gguf-main-bytes');
        const { fetchImpl, state } = stubHub([{ rfilename: HF_MAIN_FILE }, { rfilename: HF_PROJECTOR_FILE }], new Map([[HF_MAIN_FILE, mainBytes]]), true);
        const adapter = new LocalLlamaAdapter({ modelsDir: directory, fetchImpl, companionTimeoutMs: 500 });
        const startedAt = Date.now();
        const { jobId } = await adapter.startLocalModelPull(`${HF_REPO}/${HF_MAIN_FILE}`);
        const settled = await settledPull(adapter, jobId);
        const elapsed = Date.now() - startedAt;
        // Done is the main file landed + registered: it must arrive well
        // before the hanging companion's 500ms timeout can settle it.
        assert.equal(settled.state, 'done', settled.error ?? '');
        assert.ok(elapsed < 450, `done took ${elapsed}ms while the companion fetch hung`);
        assert.equal(state.companionSettled, false);
        assert.equal(settled.modelId, HF_MAIN_ID);
        assert.equal(settled.completedBytes, mainBytes.byteLength);
        assert.equal(settled.totalBytes, mainBytes.byteLength);
        const landed = join(directory, `${HF_MAIN_ID}.gguf`);
        assert.equal(await readFile(landed, 'utf8'), 'gguf-main-bytes');
        const registry = await readLlamaRegistry(directory);
        const entry = registry.find(model => model.id === HF_MAIN_ID);
        assert.ok(entry !== undefined);
        assert.equal(entry.repo, HF_REPO);
        assert.equal(entry.file, HF_MAIN_FILE);
        assert.equal(entry.path, landed);
    });
    it('downloads the repository main GGUF for "owner/name", never the projector', async () => {
        const directory = await createStore();
        const mainBytes = new TextEncoder().encode('gguf-q8-bytes');
        const { fetchImpl, state } = stubHub([
            { rfilename: HF_PROJECTOR_FILE, size: 100 },
            { rfilename: 'Tiny-Q4_K_M.gguf', size: 10 },
            { rfilename: 'test-repo-Q8_0.gguf', size: 50 },
        ], new Map([
            ['test-repo-Q8_0.gguf', mainBytes],
            ['Tiny-Q4_K_M.gguf', new TextEncoder().encode('tiny')],
            [HF_PROJECTOR_FILE, new TextEncoder().encode('proj')],
        ]), false);
        const adapter = new LocalLlamaAdapter({ modelsDir: directory, fetchImpl });
        const { jobId } = await adapter.startLocalModelPull(HF_REPO);
        const settled = await settledPull(adapter, jobId);
        // The projector is the largest file in the repo and must still never
        // be picked as the main model; the largest GGUF wins.
        assert.equal(settled.state, 'done', settled.error ?? '');
        assert.equal(settled.modelId, 'test-owner--test-repo--test-repo-q8-0');
        const registry = await readLlamaRegistry(directory);
        const entry = registry.find(model => model.id === settled.modelId);
        assert.ok(entry !== undefined);
        assert.equal(entry.file, 'test-repo-Q8_0.gguf');
        assert.ok(state.urls.some(url => url.endsWith('/resolve/main/test-repo-Q8_0.gguf')));
    });
    it('fails loud for a pull target that is not a Hugging Face repository', async () => {
        const directory = await createStore();
        const adapter = new LocalLlamaAdapter({ modelsDir: directory });
        await assert.rejects(adapter.startLocalModelPull(MODEL_ONE_ID), (error) => error instanceof LlmError && error.failure.code === 'LOCAL_PULL_TARGET_INVALID');
    });
});
/**
 * Write a stub `llama-server` executable: a Node script that parses
 * `--port`/`--alias` and answers the readiness routes like the real
 * server.
 * @param directory - where to write the script.
 * @returns the script's path.
 */
async function writeStubLlamaServer(directory) {
    const path = join(directory, 'llama-server-stub');
    const script = [
        '#!/usr/bin/env node',
        "import { createServer } from 'node:http'",
        'const args = process.argv.slice(2)',
        "const port = Number(args[args.indexOf('--port') + 1])",
        "const alias = args[args.indexOf('--alias') + 1]",
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
    await writeFile(path, script);
    await chmod(path, 0o755);
    return path;
}
/**
 * @param pid - the process id to test.
 * @returns whether a process with that pid currently exists.
 */
function processExists(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
describe('llama server control (stub llama-server)', () => {
    it('starts, reports, and stops the recorded server, flipping server-state both ways', async () => {
        const directory = await createStore();
        const binary = await writeStubLlamaServer(directory);
        const adapter = new LocalLlamaAdapter({
            modelsDir: directory,
            llamaServerBin: binary,
            llamaReadyTimeoutMs: 15_000,
        });
        const started = await adapter.startLocalModel(MODEL_ONE_ID);
        assert.deepEqual(started, { modelId: MODEL_ONE_ID, loaded: true });
        const running = readLocalServerState(directory);
        assert.equal(running?.status, 'running');
        assert.equal(running?.modelId, MODEL_ONE_ID);
        assert.ok(running?.pid !== undefined && running.pid > 0);
        assert.ok(processExists(running.pid));
        assert.match(running.baseUrl ?? '', /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
        const status = await adapter.localModelsStatus();
        assert.equal(status.endpoint.up, true);
        assert.equal(status.endpoint.baseUrl, running.baseUrl);
        assert.deepEqual(status.models.map(model => model.loaded), [true, false]);
        // A second start for the model already serving is the same server.
        const restarted = await adapter.startLocalModel(MODEL_ONE_ID);
        assert.deepEqual(restarted, { modelId: MODEL_ONE_ID, loaded: true });
        assert.equal(readLocalServerState(directory)?.pid, running.pid);
        // The served model cannot be deleted; the other one can.
        await assert.rejects(adapter.deleteLocalModel(MODEL_ONE_ID), (error) => error instanceof LlmError && error.failure.code === 'LOCAL_MODEL_CURRENTLY_SERVED');
        const deleted = await adapter.deleteLocalModel(MODEL_TWO_ID);
        assert.deepEqual(deleted, { modelId: MODEL_TWO_ID, deleted: true });
        assert.equal(existsSync(join(directory, MODEL_TWO_FILE)), false);
        assert.deepEqual((await readLlamaRegistry(directory)).map(model => model.id), [MODEL_ONE_ID]);
        const stopped = await adapter.stopLocalModel(MODEL_ONE_ID);
        assert.deepEqual(stopped, { modelId: MODEL_ONE_ID, loaded: false });
        const stoppedState = readLocalServerState(directory);
        assert.equal(stoppedState?.status, 'stopped');
        const deadline = Date.now() + 5_000;
        while (processExists(running.pid) && Date.now() < deadline) {
            await new Promise(resolveWait => setTimeout(resolveWait, 25));
        }
        assert.equal(processExists(running.pid), false);
        const downStatus = await adapter.localModelsStatus();
        assert.equal(downStatus.endpoint.up, false);
        assert.deepEqual(downStatus.folderModels.map(model => model.id), [MODEL_ONE_ID]);
    });
});
describe('llama GPU offload (settings + argv builder)', () => {
    it('honors a settings gpuLayers verbatim as the -ngl argument', async () => {
        const directory = await createStore();
        await writeFile(join(directory, 'settings.json'), JSON.stringify({
            version: 1, activeModelId: MODEL_ONE_ID, contextLength: 4096, threads: 2, gpuLayers: 7,
        }));
        const settings = readLlamaStoreSettings(directory);
        assert.equal(settings.gpuLayers, 7);
        const args = llamaServerArgs({
            modelPath: join(directory, MODEL_ONE_FILE),
            modelId: MODEL_ONE_ID,
            contextLength: settings.contextLength,
            threads: settings.threads,
            port: 1234,
            gpuLayers: settings.gpuLayers,
        });
        assert.equal(args[args.indexOf('-ngl') + 1], '7');
    });
    it('defaults to -ngl 0 when the settings carry no gpuLayers', async () => {
        const directory = await createStore();
        const settings = readLlamaStoreSettings(directory);
        assert.equal(settings.gpuLayers, undefined);
        const args = llamaServerArgs({
            modelPath: join(directory, MODEL_ONE_FILE),
            modelId: MODEL_ONE_ID,
            contextLength: settings.contextLength,
            threads: settings.threads,
            port: 1234,
        });
        assert.equal(args[args.indexOf('-ngl') + 1], '0');
    });
    it('resolves the automatic path: freest fitting GPU, full offload', () => {
        const offload = resolveGpuOffload({
            modelSizeBytes: 1000,
            gpus: [
                { index: 0, freeBytes: 900 },
                { index: 1, freeBytes: 5000 },
                { index: 2, freeBytes: 3000 },
            ],
        });
        assert.deepEqual(offload, { gpuLayers: LLAMA_FULL_OFFLOAD_LAYERS, gpuIndex: 1 });
    });
    it('resolves CPU when the freest GPU cannot fit the model plus headroom', () => {
        // 1000 bytes of model needs 1300 bytes of free VRAM; 1299 is not enough.
        assert.deepEqual(resolveGpuOffload({ modelSizeBytes: 1000, gpus: [{ index: 0, freeBytes: 1299 }] }), { gpuLayers: 0 });
        assert.deepEqual(resolveGpuOffload({ modelSizeBytes: 1000, gpus: [{ index: 0, freeBytes: 1300 }] }), { gpuLayers: LLAMA_FULL_OFFLOAD_LAYERS, gpuIndex: 0 });
    });
    it('resolves CPU when there is no NVIDIA GPU', () => {
        assert.deepEqual(resolveGpuOffload({ modelSizeBytes: 1000, gpus: [] }), { gpuLayers: 0 });
    });
    it('resolves a settings gpuLayers ahead of any GPU query result', () => {
        assert.deepEqual(resolveGpuOffload({ settingsGpuLayers: 12, modelSizeBytes: 1000, gpus: [] }), { gpuLayers: 12 });
    });
});
/**
 * Write a recording stub `llama-server`: like {@link writeStubLlamaServer}
 * it answers the readiness routes, and it also appends one JSON line per
 * spawn (its `-ngl` value and `CUDA_VISIBLE_DEVICES`) to
 * `spawn-capture.jsonl` beside the script. With `oomOnGpu`, a spawn
 * whose `-ngl` is not `0` instead writes a ggml CUDA allocation failure
 * to its log output and exits, like a real server that ran out of VRAM.
 * @param directory - where to write the script.
 * @param oomOnGpu - whether GPU spawns die with an OOM log line.
 * @returns the script's path.
 */
async function writeRecordingStubLlamaServer(directory, oomOnGpu) {
    const path = join(directory, 'llama-server-gpu-stub');
    const script = [
        '#!/usr/bin/env node',
        "import { createServer } from 'node:http'",
        "import { appendFileSync } from 'node:fs'",
        'const args = process.argv.slice(2)',
        "const port = Number(args[args.indexOf('--port') + 1])",
        "const alias = args[args.indexOf('--alias') + 1]",
        "const ngl = args[args.indexOf('-ngl') + 1]",
        "appendFileSync(new URL('./spawn-capture.jsonl', import.meta.url), JSON.stringify({ ngl, cuda: process.env.CUDA_VISIBLE_DEVICES ?? null }) + '\\n')",
        ...oomOnGpu
            ? [
                "if (ngl !== '0') {",
                "  console.error('ggml_cuda_alloc_buffer: failed to allocate 1024.00 MiB on device 0: cudaMalloc failed: out of memory')",
                '  process.exit(1)',
                '}',
            ]
            : [],
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
    await writeFile(path, script);
    await chmod(path, 0o755);
    return path;
}
/**
 * @param directory - the fixture store holding the capture file.
 * @returns every spawn the recording stub observed, in spawn order.
 */
async function readSpawnCaptures(directory) {
    const raw = await readFile(join(directory, 'spawn-capture.jsonl'), 'utf8');
    return raw.split('\n').filter(line => line !== '').map(line => JSON.parse(line));
}
describe('llama GPU offload (stub llama-server start)', () => {
    it('spawns with the settings gpuLayers and never queries the GPUs', async () => {
        const directory = await createStore();
        await writeFile(join(directory, 'settings.json'), JSON.stringify({
            version: 1, activeModelId: MODEL_ONE_ID, contextLength: 4096, threads: 2, gpuLayers: 7,
        }));
        const binary = await writeRecordingStubLlamaServer(directory, false);
        const deps = {
            directory,
            fetchImpl: fetch,
            binary,
            readyTimeoutMs: 15_000,
            gpuQueryImpl: async () => {
                throw new Error('the GPU query must not run when the settings set gpuLayers');
            },
        };
        try {
            const result = await startLlamaServer(deps, { id: MODEL_ONE_ID, path: join(directory, MODEL_ONE_FILE) });
            assert.equal(result.gpuLayers, 7);
            assert.equal(result.gpuIndex, undefined);
            assert.deepEqual(await readSpawnCaptures(directory), [{ ngl: '7', cuda: null }]);
        }
        finally {
            await stopLlamaServer(deps).catch(() => undefined);
        }
    });
    it('spawns a full offload pinned to the freest fitting GPU', async () => {
        const directory = await createStore();
        const binary = await writeRecordingStubLlamaServer(directory, false);
        const deps = {
            directory,
            fetchImpl: fetch,
            binary,
            readyTimeoutMs: 15_000,
            // The fixture model file is 16 bytes: GPU 0's 10 free bytes cannot
            // fit it plus headroom, GPU 1's can.
            gpuQueryImpl: async () => [
                { index: 0, freeBytes: 10 },
                { index: 1, freeBytes: 1_000_000_000_000 },
            ],
        };
        try {
            const result = await startLlamaServer(deps, { id: MODEL_ONE_ID, path: join(directory, MODEL_ONE_FILE) });
            assert.equal(result.gpuLayers, LLAMA_FULL_OFFLOAD_LAYERS);
            assert.equal(result.gpuIndex, 1);
            assert.equal(result.fellBackToCpu, undefined);
            assert.deepEqual(await readSpawnCaptures(directory), [
                { ngl: String(LLAMA_FULL_OFFLOAD_LAYERS), cuda: '1' },
            ]);
        }
        finally {
            await stopLlamaServer(deps).catch(() => undefined);
        }
    });
    it('spawns on the CPU when the VRAM does not fit', async () => {
        const directory = await createStore();
        const binary = await writeRecordingStubLlamaServer(directory, false);
        const deps = {
            directory,
            fetchImpl: fetch,
            binary,
            readyTimeoutMs: 15_000,
            gpuQueryImpl: async () => [{ index: 0, freeBytes: 10 }],
        };
        try {
            const result = await startLlamaServer(deps, { id: MODEL_ONE_ID, path: join(directory, MODEL_ONE_FILE) });
            assert.equal(result.gpuLayers, 0);
            assert.equal(result.gpuIndex, undefined);
            assert.deepEqual(await readSpawnCaptures(directory), [{ ngl: '0', cuda: null }]);
        }
        finally {
            await stopLlamaServer(deps).catch(() => undefined);
        }
    });
    it('spawns on the CPU when there is no NVIDIA GPU', async () => {
        const directory = await createStore();
        const binary = await writeRecordingStubLlamaServer(directory, false);
        const deps = {
            directory,
            fetchImpl: fetch,
            binary,
            readyTimeoutMs: 15_000,
            gpuQueryImpl: async () => [],
        };
        try {
            const result = await startLlamaServer(deps, { id: MODEL_ONE_ID, path: join(directory, MODEL_ONE_FILE) });
            assert.equal(result.gpuLayers, 0);
            assert.deepEqual(await readSpawnCaptures(directory), [{ ngl: '0', cuda: null }]);
        }
        finally {
            await stopLlamaServer(deps).catch(() => undefined);
        }
    });
    it('retries once on the CPU when the GPU spawn dies with an OOM log, and reports the fallback', async () => {
        const directory = await createStore();
        const binary = await writeRecordingStubLlamaServer(directory, true);
        const deps = {
            directory,
            fetchImpl: fetch,
            binary,
            readyTimeoutMs: 15_000,
            gpuQueryImpl: async () => [{ index: 2, freeBytes: 1_000_000_000_000 }],
        };
        try {
            const result = await startLlamaServer(deps, { id: MODEL_ONE_ID, path: join(directory, MODEL_ONE_FILE) });
            assert.equal(result.gpuLayers, 0);
            assert.equal(result.fellBackToCpu, true);
            assert.deepEqual(await readSpawnCaptures(directory), [
                { ngl: String(LLAMA_FULL_OFFLOAD_LAYERS), cuda: '2' },
                { ngl: '0', cuda: null },
            ]);
            assert.equal(readLocalServerState(directory)?.status, 'running');
        }
        finally {
            await stopLlamaServer(deps).catch(() => undefined);
        }
    });
});
describe('llama restore F3 (previousPids recovery + serialized starts)', () => {
    const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
    async function waitForDeath(pid, timeoutMs = 5_000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (!processExists(pid))
                return;
            await sleep(25);
        }
    }
    it('SWITCH: starting model two kills model one pid, records previousPids, and stop clears pid', async () => {
        const directory = await createStore();
        const binary = await writeStubLlamaServer(directory);
        const adapter = new LocalLlamaAdapter({
            modelsDir: directory,
            llamaServerBin: binary,
            llamaReadyTimeoutMs: 15_000,
        });
        const startedOne = await adapter.startLocalModel(MODEL_ONE_ID);
        assert.deepEqual(startedOne, { modelId: MODEL_ONE_ID, loaded: true });
        const runningOne = readLocalServerState(directory);
        assert.equal(runningOne?.status, 'running');
        assert.equal(runningOne?.modelId, MODEL_ONE_ID);
        assert.ok(runningOne?.pid !== undefined && runningOne.pid > 0);
        const pidOne = runningOne.pid;
        assert.equal(processExists(pidOne), true);
        // Switch: starting model two must terminate model one.
        const startedTwo = await adapter.startLocalModel(MODEL_TWO_ID);
        assert.deepEqual(startedTwo, { modelId: MODEL_TWO_ID, loaded: true });
        await waitForDeath(pidOne);
        assert.equal(processExists(pidOne), false);
        const runningTwo = readLocalServerState(directory);
        assert.equal(runningTwo?.status, 'running');
        assert.equal(runningTwo?.modelId, MODEL_TWO_ID);
        assert.ok(runningTwo?.pid !== undefined && runningTwo.pid > 0);
        const pidTwo = runningTwo.pid;
        assert.notEqual(pidTwo, pidOne);
        assert.equal(processExists(pidTwo), true);
        // previousPids, if present, must never contain a live pid.
        if (runningTwo?.previousPids !== undefined) {
            for (const pid of runningTwo.previousPids) {
                assert.equal(processExists(pid), false);
            }
        }
        const stopped = await adapter.stopLocalModel(MODEL_TWO_ID);
        assert.deepEqual(stopped, { modelId: MODEL_TWO_ID, loaded: false });
        await waitForDeath(pidTwo);
        assert.equal(processExists(pidTwo), false);
        assert.equal(readLocalServerState(directory)?.status, 'stopped');
    });
    it('CONCURRENT STARTS: serialization leaves exactly one live pid; every previousPids entry is dead', async () => {
        const directory = await createStore();
        const binary = await writeStubLlamaServer(directory);
        const adapter = new LocalLlamaAdapter({
            modelsDir: directory,
            llamaServerBin: binary,
            llamaReadyTimeoutMs: 15_000,
        });
        const results = await Promise.allSettled([
            adapter.startLocalModel(MODEL_ONE_ID),
            adapter.startLocalModel(MODEL_TWO_ID),
        ]);
        // Both starts are serialized by the directory mutex, so both settle.
        for (const r of results) {
            assert.equal(r.status, 'fulfilled');
        }
        // Invariant guaranteed by the mutex: the loser's spawn is stopped by the
        // winner's start before that start returns, so the final state's pid plus
        // its previousPids together account for every spawned process — state.pid
        // is the sole live one and every previousPids entry is dead.
        const state = readLocalServerState(directory);
        assert.equal(state?.status, 'running');
        assert.ok(state?.pid !== undefined && state.pid > 0);
        const livePid = state.pid;
        assert.equal(processExists(livePid), true);
        if (state?.previousPids !== undefined) {
            for (const pid of state.previousPids) {
                assert.notEqual(pid, livePid);
                assert.equal(processExists(pid), false);
            }
        }
        const modelId = state.modelId;
        const stopped = await adapter.stopLocalModel(modelId);
        assert.deepEqual(stopped, { modelId, loaded: false });
        await waitForDeath(livePid);
        assert.equal(processExists(livePid), false);
        assert.equal(readLocalServerState(directory)?.status, 'stopped');
    });
});
