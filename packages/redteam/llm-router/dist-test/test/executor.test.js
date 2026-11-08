/**
 * Step-boundary executor: the durable-before-wait event order, streamed
 * single-attempt, abort passthrough, and decision plumbing.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ProviderError } from '../src/errors.js';
import { ResilienceError, defaultBackoffMs, executeStep, } from '../src/executor.js';
function serverError() {
    return new ProviderError({
        provider: 'fake',
        message: '[llm-router] Fake HTTP 500: boom',
        status: 500,
    });
}
/** A step that fails `failures` times with a 500, then returns `value`. */
function scriptedStep(failures, value = 'ok') {
    const contexts = [];
    let calls = 0;
    const run = async (ctx) => {
        calls += 1;
        contexts.push({ attempt: ctx.attempt, model: ctx.model, keyId: ctx.keyId });
        if (calls <= failures)
            throw serverError();
        return value;
    };
    return { run, contexts, calls: () => calls };
}
const INITIAL = { providerId: 'fake', model: 'model-a' };
describe('executeStep', () => {
    test('success on the first attempt emits no events', async () => {
        const events = [];
        const step = scriptedStep(0);
        const out = await executeStep({ run: step.run, initial: INITIAL, onEvent: e => events.push(e) });
        assert.equal(out, 'ok');
        assert.equal(step.calls(), 1);
        assert.deepEqual(events, []);
    });
    test('retries at the step boundary and returns the eventual result', async () => {
        const events = [];
        const step = scriptedStep(2);
        const out = await executeStep({
            run: step.run,
            initial: INITIAL,
            onEvent: e => events.push(e),
            sleep: async () => { },
        });
        assert.equal(out, 'ok');
        assert.equal(step.calls(), 3);
        assert.deepEqual(events.map(e => `${e.kind}#${e.attempt}`), [
            'attempt-failed#1',
            'retry-scheduled#2',
            'retry-started#2',
            'attempt-failed#2',
            'retry-scheduled#3',
            'retry-started#3',
        ]);
    });
    test('the retry is recorded BEFORE the backoff sleep (durable before wait)', async () => {
        const trace = [];
        const step = scriptedStep(1);
        await executeStep({
            run: step.run,
            initial: INITIAL,
            onEvent: e => trace.push(`event:${e.kind}`),
            sleep: async (ms) => {
                trace.push(`sleep:${ms}`);
            },
        });
        const scheduledAt = trace.indexOf('event:retry-scheduled');
        const sleptAt = trace.findIndex(t => t.startsWith('sleep:'));
        assert.ok(scheduledAt >= 0 && sleptAt > scheduledAt, `trace: ${trace.join(', ')}`);
        assert.equal(trace[sleptAt], 'sleep:500', 'first backoff is the ladder default');
    });
    test('streamed steps are single-attempt: recorded, never re-run', async () => {
        const events = [];
        const step = scriptedStep(99);
        await assert.rejects(executeStep({
            run: step.run,
            initial: INITIAL,
            streamed: true,
            onEvent: e => events.push(e),
            sleep: async () => { },
        }), (err) => err instanceof ResilienceError && err.attempts === 1);
        assert.equal(step.calls(), 1);
        assert.deepEqual(events.map(e => e.kind), ['attempt-failed']);
    });
    test('maxAttempts bounds the loop; the thrown error carries the classification', async () => {
        const step = scriptedStep(99);
        await assert.rejects(executeStep({ run: step.run, initial: INITIAL, maxAttempts: 2, sleep: async () => { } }), (err) => err instanceof ResilienceError &&
            err.attempts === 2 &&
            err.classified.reason === 'server_error');
        assert.equal(step.calls(), 2);
    });
    test('a decision of retry:false stops immediately', async () => {
        const step = scriptedStep(99);
        await assert.rejects(executeStep({
            run: step.run,
            initial: INITIAL,
            decide: () => ({ retry: false }),
            sleep: async () => { },
        }), (err) => err instanceof ResilienceError);
        assert.equal(step.calls(), 1);
    });
    test('decision overrides land on the next attempt context (rotation/model switch)', async () => {
        const step = scriptedStep(1);
        const out = await executeStep({
            run: step.run,
            initial: INITIAL,
            decide: () => ({ retry: true, delayMs: 0, next: { model: 'model-b', keyId: 7 } }),
            sleep: async () => { },
        });
        assert.equal(out, 'ok');
        assert.deepEqual(step.contexts[1], { attempt: 2, model: 'model-b', keyId: 7 });
    });
    test('a caller abort propagates the original error, unclassified and unwrapped', async () => {
        const controller = new AbortController();
        controller.abort();
        const sentinel = new Error('provider exploded');
        await assert.rejects(executeStep({
            run: async () => {
                throw sentinel;
            },
            initial: INITIAL,
            signal: controller.signal,
            sleep: async () => { },
        }), (err) => err === sentinel);
    });
    test('abort during backoff rejects with AbortError, not a wrapped retry', async () => {
        const controller = new AbortController();
        const step = scriptedStep(99);
        await assert.rejects(executeStep({
            run: step.run,
            initial: INITIAL,
            signal: controller.signal,
            sleep: async (_ms, signal) => {
                controller.abort();
                if (signal?.aborted) {
                    const err = new Error('aborted');
                    err.name = 'AbortError';
                    throw err;
                }
            },
        }), (err) => err instanceof Error && err.name === 'AbortError');
        assert.equal(step.calls(), 1);
    });
    test('non-retryable classifications do not retry by default', async () => {
        const step = {
            calls: 0,
            run: async () => {
                step.calls += 1;
                throw new ProviderError({
                    provider: 'fake',
                    message: '[llm-router] Fake HTTP 400: prompt is too long (context_length_exceeded)',
                    status: 400,
                    code: 'context_length_exceeded',
                });
            },
        };
        await assert.rejects(executeStep({ run: step.run, initial: INITIAL, sleep: async () => { } }), (err) => err instanceof ResilienceError && err.classified.reason === 'context_overflow');
        assert.equal(step.calls, 1);
    });
});
describe('defaultBackoffMs', () => {
    test('500ms doubling, capped at 10s', () => {
        assert.equal(defaultBackoffMs(1), 500);
        assert.equal(defaultBackoffMs(2), 1000);
        assert.equal(defaultBackoffMs(3), 2000);
        assert.equal(defaultBackoffMs(20), 10_000);
    });
});
describe('executeStep attempt-failed cause fields (Q-HALT Item 1)', () => {
    test('a ProviderError failure carries status, code, and causeExcerpt on the event', async () => {
        const events = [];
        const failure = new ProviderError({
            provider: 'fake',
            message: '[llm-router] Fake HTTP 400: {"error":{"message":"blocked by the safety system"}}',
            status: 400,
            code: 'safety_blocked',
        });
        await assert.rejects(executeStep({
            run: async () => {
                throw failure;
            },
            initial: INITIAL,
            maxAttempts: 1,
            onEvent: e => events.push(e),
        }), (err) => err instanceof ResilienceError);
        assert.equal(events.length, 1);
        const event = events[0];
        assert.equal(event?.kind, 'attempt-failed');
        assert.equal(event?.status, 400);
        assert.equal(event?.code, 'safety_blocked');
        assert.ok(event?.causeExcerpt?.includes('blocked by the safety system'), event?.causeExcerpt);
        assert.ok(!(event?.causeExcerpt ?? '').includes('[llm-router]'), event?.causeExcerpt);
    });
    test('a plain Error failure leaves status and code absent (not empty strings)', async () => {
        const events = [];
        await assert.rejects(executeStep({
            run: async () => {
                throw new Error('plain boom');
            },
            initial: INITIAL,
            maxAttempts: 1,
            onEvent: e => events.push(e),
        }), (err) => err instanceof ResilienceError);
        const event = events[0];
        assert.equal(event?.status, undefined);
        assert.equal(event?.code, undefined);
        // The helper's documented fallback: the deepest Error's message.
        assert.equal(event?.causeExcerpt, 'plain boom');
    });
});
