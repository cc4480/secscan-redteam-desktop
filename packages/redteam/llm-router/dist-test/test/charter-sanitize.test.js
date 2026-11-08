/**
 * Spec §4: the sanitizer egress hook (pseudonyms + generic secret shapes,
 * fail-closed re-scan, findings as kinds/counts only) and local_only
 * route enforcement in both chartered entry points.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CharterError, SanitizerError, assertLocalOnlyRoute, completeWithCharter, completeWithFallback, findSecretKinds, registerProvider, sanitizeMessages, sanitizeText, } from '../src/index.js';
const ENGAGEMENT = {
    engagementId: 'eng-2026-10-25-7f3a',
    owner: 'Acme Widgets LLC',
    proofMethod: 'DNS TXT record verified 2026-10-25',
    inScope: 'app.acme.example',
};
const FAKE_KEY = `sk-${'a1b2c3d4e5f6a7b8c9d0'}`;
describe('sanitizeText', () => {
    test('replaces pseudonym terms everywhere and reports counts, never values', () => {
        const { text, findings } = sanitizeText('Acme Widgets LLC owns app.acme.example; Acme Widgets LLC operates it.', { 'Acme Widgets LLC': 'CLIENT-1' });
        assert.ok(!text.includes('Acme Widgets'));
        assert.equal(text.split('CLIENT-1').length - 1, 2);
        assert.equal(findings['pseudonym'], 2);
    });
    test('redacts generic secret shapes: api key, bearer token, password assignment, JWT', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart123';
        const { text, findings } = sanitizeText(`key ${FAKE_KEY}; auth Bearer abcdefghijklmnopqrstuvwxyz; password: hunter2; token ${jwt}`);
        assert.ok(!text.includes(FAKE_KEY));
        assert.ok(!text.includes('hunter2'));
        assert.ok(!text.includes(jwt));
        assert.ok(!text.includes('abcdefghijklmnopqrstuvwxyz'));
        assert.equal(findings['api-key'], 1);
        assert.equal(findings['bearer-token'], 1);
        assert.equal(findings['password-assignment'], 1);
        assert.equal(findings['jwt'], 1);
        assert.deepEqual(findSecretKinds(text), []);
    });
    test('pseudonymizes emails stably within one text', () => {
        const { text, findings } = sanitizeText('mail jane@acme.example, then jane@acme.example, or ops@acme.example');
        assert.ok(!text.includes('@acme.example'));
        assert.equal(text.split('EMAIL-1').length - 1, 2);
        assert.ok(text.includes('EMAIL-2'));
        assert.equal(findings['email'], 3);
    });
    test('redacts a quoted password value whole, spaces and all', () => {
        const { text, findings } = sanitizeText('config: password: "my secret phrase"');
        assert.ok(!text.includes('secret phrase'));
        assert.equal(findings['password-assignment'], 1);
    });
    test('fails closed when a secret survives: a truncated private-key block cannot be safely replaced', () => {
        const truncated = '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK++\n(no end line)';
        assert.throws(() => sanitizeText(truncated), SanitizerError);
    });
    test('never mutates the input messages and leaves clean text untouched', () => {
        const original = [{ role: 'user', content: 'scan app.acme.example please' }];
        const { messages, findings } = sanitizeMessages(original);
        assert.equal(messages[0].content, 'scan app.acme.example please');
        assert.deepEqual(findings, {});
        assert.equal(original[0].content, 'scan app.acme.example please');
    });
});
describe('local_only enforcement', () => {
    test('assertLocalOnlyRoute throws for a non-local route and passes for local', () => {
        const localOnly = { ...ENGAGEMENT, localOnly: true };
        assert.throws(() => assertLocalOnlyRoute(localOnly, { provider: 'deepseek', model: 'm' }), CharterError);
        assert.doesNotThrow(() => assertLocalOnlyRoute(localOnly, { provider: 'local', model: 'm' }));
        assert.doesNotThrow(() => assertLocalOnlyRoute(ENGAGEMENT, { provider: 'deepseek', model: 'm' }));
    });
    test('completeWithCharter refuses a local_only engagement on a non-local route before any provider call', async () => {
        let calls = 0;
        const provider = {
            id: 'sanitize-test',
            label: 'Sanitize Test',
            isConfigured: () => true,
            complete: async (options) => {
                calls++;
                return { text: 'ok', toolCalls: [], provider: 'sanitize-test', model: options.model };
            },
        };
        registerProvider(provider);
        await assert.rejects(completeWithCharter({
            engagement: { ...ENGAGEMENT, localOnly: true },
            role: 'recon',
            messages: [{ role: 'user', content: 'Map it.' }],
            routeOverride: { provider: 'sanitize-test', model: 'm' },
        }), CharterError);
        assert.equal(calls, 0);
    });
    test('completeWithFallback fails loud when ANY hop would leave local infrastructure', async () => {
        let calls = 0;
        const callImpl = async (route) => {
            calls++;
            return { text: 'ok', toolCalls: [], provider: route.provider, model: route.model };
        };
        await assert.rejects(completeWithFallback({
            engagement: { ...ENGAGEMENT, localOnly: true },
            role: 'exploiter-operator',
            taskId: 't-local-only',
            taskType: 'payload',
            messages: [{ role: 'user', content: 'Build it.' }],
            routes: {
                primary: { provider: 'local', model: 'deephat-7b' },
                uncensored: { provider: 'uncensored-x', model: 'u-m' },
            },
            callImpl,
        }), CharterError);
        assert.equal(calls, 0);
    });
    test('completeWithFallback sanitizes task material on every hop when pseudonyms are supplied', async () => {
        const seenContents = [];
        const callImpl = async (route, assembled) => {
            seenContents.push(assembled.messages.map(m => m.content).join('\n'));
            return {
                text: seenContents.length === 1 ? "I can't help with that request." : 'PAYLOAD: ok',
                toolCalls: [],
                provider: route.provider,
                model: route.model,
            };
        };
        const outcome = await completeWithFallback({
            engagement: ENGAGEMENT,
            role: 'exploiter-operator',
            taskId: 't-sanitized',
            taskType: 'payload',
            messages: [{ role: 'user', content: `For Acme Widgets LLC, use key ${FAKE_KEY} against app.acme.example.` }],
            pseudonyms: { 'Acme Widgets LLC': 'CLIENT-1' },
            routes: { primary: { provider: 'primary-x', model: 'm' } },
            artifactTask: true,
            artifactCheck: text => text.startsWith('PAYLOAD:'),
            callImpl,
        });
        assert.equal(outcome.hopTaken, 0);
        assert.equal(seenContents.length, 2);
        for (const content of seenContents) {
            assert.ok(!content.includes(FAKE_KEY), 'a raw secret reached a hop context');
            assert.ok(content.includes('CLIENT-1'));
        }
    });
});
