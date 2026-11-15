/**
 * Repository-listing tests: the `localModels` `listRepoFiles` action
 * called through the Typert Gateway face (never by calling the service
 * directly) against a direct composition in llama serving mode. The
 * service delegates to the Hub listing in `./llama.ts` with the global
 * fetch, so the suite replaces the global fetch with a stub that
 * answers the Hub's listing URL — the seam the listing reads — and
 * records the authorization header it was called with, which is how
 * the store's Hub token forwarding is observed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import * as llmLocal from '../src/index.js';
import { createFixtureModelsDir } from './fixtures.js';
/** Repository the stub Hub lists. */
const REPO = 'owner/repo';
/** Hub token the fixture store carries, forwarded to the listing. */
const FIXTURE_TOKEN = 'hf-fixture-token';
/**
 * Build the stub fetch that answers the Hub listing for {@link REPO}:
 * two GGUFs (one a vision projector) and one non-GGUF file, every
 * sibling carrying its size so the listing needs no tree read. Any
 * other repository answers 404.
 * @param calls - record of the calls received, appended in order.
 * @returns the fetch implementation to install as the global fetch.
 */
function stubHubFetch(calls) {
    return async (input, init) => {
        const url = String(input);
        calls.push({ url, authorization: new Headers(init?.headers).get('authorization') });
        if (url === `https://huggingface.co/api/models/${REPO}`) {
            return new Response(JSON.stringify({
                siblings: [
                    { rfilename: 'model.Q4_K_M.gguf', size: 5898000000 },
                    { rfilename: 'mmproj-model.gguf', size: 100 },
                    { rfilename: 'README.md' },
                ],
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response('not found', { status: 404 });
    };
}
/**
 * Boot one direct composition of the plugin in the given serving mode.
 * @param modelsDir - the fixture models directory.
 * @param config - plugin configuration (serving mode).
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
 * Call the `listRepoFiles` action through the Gateway face.
 * @param context - composition carrying the Gateway.
 * @param repo - the repository to list.
 * @returns the listing the Remote method returned.
 */
async function invokeList(context, repo) {
    return await context.typertGateway.invoke({ namespace: 'localModels', method: 'listRepoFiles', args: { repo } });
}
describe('llm-local Remote listRepoFiles (llama mode)', () => {
    it('lists the repository files with sizes and GGUF/projector flags, forwarding the store token', async () => {
        const modelsDir = await createFixtureModelsDir();
        await writeFile(join(modelsDir, 'settings.json'), JSON.stringify({
            version: 1, huggingFaceToken: FIXTURE_TOKEN,
        }));
        const context = await boot(modelsDir, { serving: 'llama' });
        const calls = [];
        const originalFetch = globalThis.fetch;
        globalThis.fetch = stubHubFetch(calls);
        try {
            const files = await invokeList(context, REPO);
            // Sized entries first in ascending size order; the unsized entry last.
            assert.deepEqual(files, [
                { file: 'mmproj-model.gguf', isGguf: false, isProjector: true, sizeBytes: 100 },
                { file: 'model.Q4_K_M.gguf', isGguf: true, sizeBytes: 5898000000 },
                { file: 'README.md', isGguf: false },
            ]);
            // The siblings listing first, then the listing's one best-effort
            // tree read for the sibling that carried no size (the stub
            // answers it 404, which never fails the listing) — both carrying
            // the store's token the way the downloader sends it.
            assert.equal(calls.length, 2);
            assert.equal(calls[0]?.url, `https://huggingface.co/api/models/${REPO}`);
            assert.equal(calls[0]?.authorization, `Bearer ${FIXTURE_TOKEN}`);
            assert.equal(calls[1]?.url, `https://huggingface.co/api/models/${REPO}/tree/main`);
            assert.equal(calls[1]?.authorization, `Bearer ${FIXTURE_TOKEN}`);
        }
        finally {
            globalThis.fetch = originalFetch;
            await context.fiber.dispose();
        }
    });
    it('fails loud for a missing repository and for a malformed repository name', async () => {
        const modelsDir = await createFixtureModelsDir();
        const context = await boot(modelsDir, { serving: 'llama' });
        const calls = [];
        const originalFetch = globalThis.fetch;
        globalThis.fetch = stubHubFetch(calls);
        try {
            await assert.rejects(invokeList(context, 'owner/missing'));
            await assert.rejects(invokeList(context, 'not-a-repo'));
        }
        finally {
            globalThis.fetch = originalFetch;
            await context.fiber.dispose();
        }
    });
    it('refuses in Ollama mode, where a download names a registry model instead', async () => {
        const modelsDir = await createFixtureModelsDir();
        const context = await boot(modelsDir, {
            serving: 'ollama',
            ollamaBaseUrl: 'http://127.0.0.1:1/v1',
        });
        try {
            await assert.rejects(invokeList(context, REPO));
        }
        finally {
            await context.fiber.dispose();
        }
    });
});
