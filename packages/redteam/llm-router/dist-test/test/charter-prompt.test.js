/**
 * Spec §2/§8: chartered prompt assembly, charter-role routing as data,
 * the exemplar pack loader, and the completeWithCharter dispatch. The
 * assembly order is a fleet invariant — charter first, addendum, anchor,
 * pack, persona last — and these tests pin it.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CharterError, assembleCharterMessages, buildPhaseAnchor, exemplarPackIncludedByDefault, exemplarPackVersion, loadExemplarPackText, } from '../src/index.js';
import { CHARTER_ROLE_AGENT_ROLE, resolveCharterRoute } from '../src/charter/routing.js';
import { completeWithCharter, registerProvider } from '../src/router.js';
import { roleModelPolicy } from '../src/policy.js';
const ENGAGEMENT = {
    engagementId: 'eng-2026-10-25-7f3a',
    owner: 'Acme Widgets LLC',
    proofMethod: 'DNS TXT record verified 2026-10-25',
    inScope: 'app.acme.example and api.acme.example',
};
const ANCHOR = buildPhaseAnchor({
    engagement: 'eng-2026-10-25-7f3a for Acme Widgets LLC',
    scope: 'app.acme.example',
    objective: 'validate the search parameter',
    artifact: 'a payload set with a negative control',
});
describe('exemplar pack loader', () => {
    test('loads the bundled pack and reads its version', () => {
        const text = loadExemplarPackText();
        assert.ok(text.includes('Exemplar pack v1'));
        assert.equal(exemplarPackVersion(text), 1);
    });
    test('throws CharterError for an unreadable pack path', () => {
        assert.throws(() => loadExemplarPackText('/nonexistent/exemplars.md'), CharterError);
    });
    test('throws CharterError when the pack carries no version marker', () => {
        assert.throws(() => exemplarPackVersion('# a pack with no stamp'), CharterError);
    });
    test('includes the pack by default only for the exploiter cell', () => {
        assert.equal(exemplarPackIncludedByDefault('exploiter-operator'), true);
        assert.equal(exemplarPackIncludedByDefault('exploiter-challenger'), true);
        assert.equal(exemplarPackIncludedByDefault('coordinator'), false);
        assert.equal(exemplarPackIncludedByDefault('recon'), false);
        assert.equal(exemplarPackIncludedByDefault('reporter'), false);
    });
    test('the bundled pack pairs are derived from named records', () => {
        const text = loadExemplarPackText();
        for (const source of ['sqli-product-search', 'xss-reflected-search', 'cycle-1']) {
            assert.ok(text.includes(source), `pack is missing its derived-from record: ${source}`);
        }
    });
});
describe('assembleCharterMessages', () => {
    test('orders charter, addendum, anchor, pack, persona in one system message', () => {
        const assembled = assembleCharterMessages(ENGAGEMENT, 'exploiter-operator', [
            { role: 'system', content: 'PERSONA-TEXT' },
            { role: 'user', content: 'Begin.' },
        ], { anchor: ANCHOR });
        assert.equal(assembled.messages.length, 2);
        const system = assembled.messages[0];
        assert.equal(system.role, 'system');
        const at = (needle) => system.content.indexOf(needle);
        assert.ok(at('You are an agent of SecScan RedTeam') === 0);
        assert.ok(at('Convert recon into PROVEN findings') > 0);
        assert.ok(at('Phase anchor (agent-generated for this phase)') > at('Convert recon into PROVEN findings'));
        assert.ok(at('Exemplar pack v1') > at('Phase anchor (agent-generated for this phase)'));
        assert.ok(at('PERSONA-TEXT') > at('Exemplar pack v1'));
        assert.equal(assembled.messages[1].content, 'Begin.');
        assert.equal(assembled.exemplarPackVersion, 1);
        assert.equal(assembled.anchorPresent, true);
    });
    test('omits the pack for recon by default and reports no version', () => {
        const assembled = assembleCharterMessages(ENGAGEMENT, 'recon', [{ role: 'user', content: 'Map it.' }]);
        assert.ok(!assembled.messages[0].content.includes('Exemplar pack v1'));
        assert.equal(assembled.exemplarPackVersion, undefined);
        assert.equal(assembled.anchorPresent, false);
    });
    test('an explicit includeExemplars override wins over the role default', () => {
        const assembled = assembleCharterMessages(ENGAGEMENT, 'reporter', [{ role: 'user', content: 'Write it.' }], {
            includeExemplars: true,
        });
        assert.ok(assembled.messages[0].content.includes('Exemplar pack v1'));
        assert.equal(assembled.exemplarPackVersion, 1);
    });
    test('keeps non-system task messages in order and untouched', () => {
        const assembled = assembleCharterMessages(ENGAGEMENT, 'coordinator', [
            { role: 'user', content: 'one' },
            { role: 'assistant', content: 'two' },
            { role: 'user', content: 'three' },
        ]);
        assert.deepEqual(assembled.messages.slice(1).map(m => m.content), ['one', 'two', 'three']);
    });
});
describe('resolveCharterRoute', () => {
    test('maps every charter role onto its agent-role route', () => {
        const policy = roleModelPolicy({});
        for (const [charterRole, agentRole] of Object.entries(CHARTER_ROLE_AGENT_ROLE)) {
            assert.deepEqual(resolveCharterRoute(charterRole, {}), policy[agentRole]);
        }
    });
    test('per-seat env overrides apply to the exploiter cell only', () => {
        const env = { REDTEAM_LLM_OPERATOR_PROVIDER: 'uncensored-x', REDTEAM_LLM_CHALLENGER_MODEL: 'challenger-m' };
        const operator = resolveCharterRoute('exploiter-operator', env);
        assert.equal(operator.provider, 'uncensored-x');
        assert.equal(operator.model, roleModelPolicy({}).exploiter.model);
        const challenger = resolveCharterRoute('exploiter-challenger', env);
        assert.equal(challenger.provider, roleModelPolicy({}).exploiter.provider);
        assert.equal(challenger.model, 'challenger-m');
        assert.deepEqual(resolveCharterRoute('recon', env), roleModelPolicy({}).recon);
    });
    test('an explicit override wins over env and policy', () => {
        const override = { provider: 'pinned', model: 'pinned-m' };
        assert.deepEqual(resolveCharterRoute('exploiter-operator', { REDTEAM_LLM_OPERATOR_PROVIDER: 'env-x' }, override), override);
    });
});
class RecordingProvider {
    id = 'charter-test';
    label = 'Charter Test';
    calls = [];
    isConfigured() {
        return true;
    }
    async complete(options) {
        this.calls.push(options);
        return { text: 'ok', toolCalls: [], provider: this.id, model: options.model };
    }
}
describe('completeWithCharter', () => {
    const provider = new RecordingProvider();
    registerProvider(provider);
    test('dispatches the assembled charter prompt to the resolved route', async () => {
        const result = await completeWithCharter({
            engagement: ENGAGEMENT,
            role: 'exploiter-operator',
            messages: [{ role: 'user', content: 'Validate the search parameter.' }],
            anchor: ANCHOR,
            routeOverride: { provider: 'charter-test', model: 'm1' },
        });
        assert.equal(result.text, 'ok');
        assert.equal(provider.calls.length, 1);
        const sent = provider.calls[0];
        assert.equal(sent.model, 'm1');
        assert.equal(sent.messages[0].role, 'system');
        assert.ok(sent.messages[0].content.startsWith('You are an agent of SecScan RedTeam'));
        assert.ok(sent.messages[0].content.includes(ENGAGEMENT.engagementId));
        assert.ok(sent.messages[0].content.includes('Exemplar pack v1'));
    });
    test('a broken engagement record throws before any provider call', async () => {
        const before = provider.calls.length;
        await assert.rejects(completeWithCharter({
            engagement: { ...ENGAGEMENT, inScope: '  ' },
            role: 'recon',
            messages: [{ role: 'user', content: 'Map it.' }],
            routeOverride: { provider: 'charter-test', model: 'm1' },
        }), CharterError);
        assert.equal(provider.calls.length, before);
    });
});
