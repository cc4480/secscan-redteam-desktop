/**
 * Local provider base-URL resolution. The desktop app starts its bundled
 * llama-server on an ephemeral loopback port and publishes the endpoint
 * through REDTEAM_LOCAL_BASE_URL only once the server is up — which can be
 * long after the provider was constructed — so the endpoint is resolved on
 * every call. A constructor-pinned endpoint still wins over the environment.
 * All fakes — no network, no real server.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { LOCAL_BASE_URL, LOCAL_BASE_URL_ENV, LocalOpenAiProvider, } from '../src/providers/local.js';
const realFetch = globalThis.fetch;
const LOCAL_API_KEY_ENV = 'REDTEAM_LOCAL_API_KEY';
const savedBaseUrl = process.env[LOCAL_BASE_URL_ENV];
const savedApiKey = process.env[LOCAL_API_KEY_ENV];
afterEach(() => {
    globalThis.fetch = realFetch;
    if (savedBaseUrl === undefined)
        delete process.env[LOCAL_BASE_URL_ENV];
    else
        process.env[LOCAL_BASE_URL_ENV] = savedBaseUrl;
    if (savedApiKey === undefined)
        delete process.env[LOCAL_API_KEY_ENV];
    else
        process.env[LOCAL_API_KEY_ENV] = savedApiKey;
});
function stubFetch(handler) {
    globalThis.fetch = (async (input) => handler(String(input)));
}
function okChat() {
    return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
const MESSAGES = [{ role: 'user', content: 'hi' }];
describe('LocalOpenAiProvider base URL resolution', () => {
    test('defaults to the llama.cpp root when nothing names an endpoint', async () => {
        delete process.env[LOCAL_BASE_URL_ENV];
        const urls = [];
        stubFetch(async (url) => {
            urls.push(url);
            return okChat();
        });
        await new LocalOpenAiProvider().complete({ model: 'm', messages: MESSAGES });
        assert.deepEqual(urls, [`${LOCAL_BASE_URL}/chat/completions`]);
    });
    test('re-reads REDTEAM_LOCAL_BASE_URL on every call from one instance', async () => {
        delete process.env[LOCAL_BASE_URL_ENV];
        const provider = new LocalOpenAiProvider();
        const urls = [];
        stubFetch(async (url) => {
            urls.push(url);
            return okChat();
        });
        await provider.complete({ model: 'm', messages: MESSAGES });
        // The desktop publishes the live endpoint only once its server is up:
        // the same long-lived instance must follow without being rebuilt.
        process.env[LOCAL_BASE_URL_ENV] = 'http://127.0.0.1:52731/v1/';
        await provider.complete({ model: 'm', messages: MESSAGES });
        assert.deepEqual(urls, [
            `${LOCAL_BASE_URL}/chat/completions`,
            'http://127.0.0.1:52731/v1/chat/completions',
        ]);
    });
    test('a constructor-pinned endpoint wins over the environment', async () => {
        process.env[LOCAL_BASE_URL_ENV] = 'http://127.0.0.1:9999/v1';
        const urls = [];
        stubFetch(async (url) => {
            urls.push(url);
            return okChat();
        });
        await new LocalOpenAiProvider('http://127.0.0.1:1234/v1').complete({
            model: 'm',
            messages: MESSAGES,
        });
        assert.deepEqual(urls, ['http://127.0.0.1:1234/v1/chat/completions']);
    });
    test('sends no authorization header when no local key is configured', async () => {
        delete process.env[LOCAL_BASE_URL_ENV];
        delete process.env['REDTEAM_LOCAL_API_KEY'];
        let headers;
        globalThis.fetch = (async (_input, init) => {
            headers = init?.headers;
            return okChat();
        });
        await new LocalOpenAiProvider().complete({ model: 'm', messages: MESSAGES });
        assert.ok(headers);
        assert.equal(headers['Authorization'], undefined);
    });
});
