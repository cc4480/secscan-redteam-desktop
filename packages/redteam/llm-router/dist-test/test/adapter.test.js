/**
 * AdapterProvider retry discipline (runner corrections Item 5, 2026-10-31).
 *
 * The pinned retry budget is 3 retries (4 attempts) with backoff consumed
 * in pinned order [400, 1200, 3000]. Worst-case wire calls per
 * persistently-failing step: 9 → 12 ((2+1)×3 → (3+1)×3), accepted per
 * directive; per-call `retries` telemetry verified accurate in the
 * trajectory record. All fakes — no network. Timing assertions are
 * lower bounds only (timers never fire early).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { ADAPTER_PINNED, AdapterProvider } from '../src/adapter.js';
const OPTIONS = {
    model: 'fake-model',
    messages: [{ role: 'user', content: 'go' }],
};
function scriptedProvider(script, onCall) {
    let calls = 0;
    const provider = {
        id: 'fake',
        label: 'Fake',
        isConfigured: () => true,
        complete: async (options) => {
            onCall?.(options);
            const step = script[Math.min(calls, script.length - 1)];
            calls++;
            if (step === 'ok')
                return { text: 'done', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
            throw step;
        },
    };
    return { provider, calls: () => calls };
}
function trajectory(logPath) {
    return readFileSync(logPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l));
}
function tmpLog() {
    const dir = mkdtempSync(join(tmpdir(), 'adapter-test-'));
    return { dir, logPath: join(dir, 'trajectories.jsonl') };
}
describe('adapter retry pin', () => {
    test('the pinned budget is 3 retries with the full three-entry backoff ladder', () => {
        assert.equal(ADAPTER_PINNED.maxRetries, 3);
        assert.deepEqual(ADAPTER_PINNED.retryBackoffMs, [400, 1200, 3000]);
    });
    test('a persistently failing 5xx step gets 4 attempts, the full backoff ladder, and retries=3 telemetry', async () => {
        const { dir, logPath } = tmpLog();
        try {
            const { provider, calls } = scriptedProvider([new Error('HTTP 503 upstream unavailable')]);
            const adapter = new AdapterProvider(provider, { logPath });
            const started = Date.now();
            await assert.rejects(() => adapter.complete(OPTIONS), /HTTP 503/);
            assert.equal(calls(), 4, '1 initial attempt + 3 retries');
            assert.ok(Date.now() - started >= 4400, 'backoff 400 + 1200 + 3000 was consumed in order');
            const records = trajectory(logPath);
            assert.equal(records.length, 1);
            assert.equal(records[0]['retries'], 3, 'trajectory retries telemetry is accurate');
            assert.match(String(records[0]['error']), /HTTP 503/);
        }
        finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
    test('two transient failures then success: result returned, retries=2 telemetry', async () => {
        const { dir, logPath } = tmpLog();
        try {
            const { provider, calls } = scriptedProvider([
                new Error('HTTP 502 bad gateway'),
                new Error('HTTP 503 upstream unavailable'),
                'ok',
            ]);
            const adapter = new AdapterProvider(provider, { logPath });
            const started = Date.now();
            const result = await adapter.complete(OPTIONS);
            assert.equal(result.text, 'done');
            assert.equal(calls(), 3);
            assert.ok(Date.now() - started >= 1500, 'backoff 400 + 1200 consumed before the success');
            assert.equal(trajectory(logPath)[0]['retries'], 2);
        }
        finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
    test('a 4xx failure is never retried', async () => {
        const { dir, logPath } = tmpLog();
        try {
            const { provider, calls } = scriptedProvider([new Error('HTTP 400 bad request')]);
            const adapter = new AdapterProvider(provider, { logPath });
            await assert.rejects(() => adapter.complete(OPTIONS), /HTTP 400/);
            assert.equal(calls(), 1);
            assert.equal(trajectory(logPath)[0]['retries'], 0);
        }
        finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
    test('an abort raised mid-failure stops the retry loop', async () => {
        const { dir, logPath } = tmpLog();
        try {
            const controller = new AbortController();
            const { provider, calls } = scriptedProvider([new Error('HTTP 503 upstream unavailable')], () => {
                controller.abort();
            });
            const adapter = new AdapterProvider(provider, { logPath });
            await assert.rejects(() => adapter.complete({ ...OPTIONS, signal: controller.signal }), /HTTP 503/);
            assert.equal(calls(), 1, 'no retry once the signal is aborted');
        }
        finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
    test('AdapterConfig.maxRetries still overrides the pin', async () => {
        const { dir, logPath } = tmpLog();
        try {
            const zero = scriptedProvider([new Error('HTTP 503 upstream unavailable')]);
            await assert.rejects(() => new AdapterProvider(zero.provider, { logPath, maxRetries: 0 }).complete(OPTIONS), /HTTP 503/);
            assert.equal(zero.calls(), 1);
            const one = scriptedProvider([new Error('HTTP 503 upstream unavailable')]);
            const started = Date.now();
            await assert.rejects(() => new AdapterProvider(one.provider, { logPath, maxRetries: 1 }).complete(OPTIONS), /HTTP 503/);
            assert.equal(one.calls(), 2);
            assert.ok(Date.now() - started >= 350, 'the single permitted retry waited the first backoff');
        }
        finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
