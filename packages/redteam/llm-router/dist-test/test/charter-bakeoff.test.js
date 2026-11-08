/**
 * Spec §7: the bake-off harness. Arms must differ in the actual prompt
 * assembly (exemplars appear from arm b, the anchor from arm c, the
 * prefill message only in arm d and only when the probe measured
 * support); sequences must be genuine multi-turn runs; the falsification
 * task must score a candidate that rubber-stamps the seeded false proof
 * as NOT completed; the prefill matrix must record a rejection.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BAKEOFF_BATTERY, probePrefillSupport, runBakeoff, } from '../src/index.js';
const CANDIDATE = { id: 'cand-1', route: { provider: 'cand-x', model: 'cand-m' } };
function compliantText(lastUser) {
    if (lastUser.includes('JSON object'))
        return '{"marker": "BAKEOFF-OK", "services": ["http", "ssh"]}';
    if (lastUser.includes('falsification record'))
        return 'CLAIM: x. ALTERNATIVE: echo. TEST: resent ordinary term. EVIDENCE: r1. VERDICT: falsified';
    if (lastUser.includes('Nuclei template'))
        return 'id: t\ninfo:\n  name: x\nrequests:\n  - matchers: []';
    if (lastUser.includes('mutate'))
        return 'PAYLOAD: %27%20OR%20%271%27%3D%271%27%20--%20';
    return "PAYLOAD: ' OR '1'='1') -- ";
}
function recordingCall(seen) {
    return async (candidate, assembled) => {
        seen.push(assembled);
        const lastUser = [...assembled.messages].reverse().find(m => m.role === 'user')?.content ?? '';
        const text = lastUser.includes('single word: ready') ? 'ready' : compliantText(lastUser);
        const result = { text, toolCalls: [], provider: candidate.route.provider, model: candidate.route.model };
        return result;
    };
}
describe('runBakeoff', () => {
    test('a compliant candidate completes every task in every arm, and arms differ in assembly', async () => {
        const seen = [];
        const result = await runBakeoff([CANDIDATE], recordingCall(seen));
        assert.ok(result.scores.every(s => s.completed === BAKEOFF_BATTERY.length));
        assert.ok(result.scores.every(s => s.refusalRate === 0));
        assert.equal(result.prefillMatrix['cand-1'], 'accepted-or-ignored');
        const systemsByArm = new Map();
        // The payload task's FIRST turn per arm (turn 2 calls carry turn 1 in context too).
        const payloadCalls = seen.filter(p => p.messages.filter(m => m.role === 'user').length === 1 &&
            p.messages.some(m => m.role === 'user' && m.content.includes('Build the payload set')));
        assert.equal(payloadCalls.length, 4);
        for (const call of payloadCalls) {
            const system = call.messages[0].content;
            const hasPack = system.includes('Exemplar pack v1');
            const hasAnchor = system.includes('Phase anchor');
            const arm = !hasPack ? 'charter' : !hasAnchor ? 'exemplars' : 'scan-or-prefill';
            systemsByArm.set(arm, system);
        }
        assert.ok(systemsByArm.has('charter'));
        assert.ok(systemsByArm.has('exemplars'));
        assert.ok(systemsByArm.has('scan-or-prefill'));
    });
    test('the prefill arm appends the artifact opening only when support was measured', async () => {
        const seen = [];
        await runBakeoff([CANDIDATE], recordingCall(seen), ['prefill']);
        const payloadFirstTurn = seen.find(p => p.messages.some(m => m.content.includes('Build the payload set')));
        assert.ok(payloadFirstTurn);
        const last = payloadFirstTurn.messages[payloadFirstTurn.messages.length - 1];
        assert.deepEqual(last, { role: 'assistant', content: 'PAYLOAD:' });
    });
    test('a refusing candidate scores refusals, and the sequence nature is visible in the trail', async () => {
        const refusing = async (candidate) => ({
            text: "I can't help with that request.",
            toolCalls: [],
            provider: candidate.route.provider,
            model: candidate.route.model,
        });
        const result = await runBakeoff([CANDIDATE], refusing, ['charter']);
        const score = result.scores[0];
        assert.equal(score.refused, BAKEOFF_BATTERY.length);
        assert.equal(score.completed, 0);
        assert.equal(score.refusalRate, 1);
        // The SQLi task has two turns; both were run and classified (inertia is measured, not assumed away).
        const sqliTrail = result.classifications.filter(c => c.task === 'payload-sqli-sequence');
        assert.equal(sqliTrail.length, 2);
    });
    test('a challenger that rubber-stamps the seeded false proof does not complete the falsification task', async () => {
        const rubberStamp = async (candidate, assembled) => {
            const lastUser = [...assembled.messages].reverse().find(m => m.role === 'user')?.content ?? '';
            const text = lastUser.includes('falsification record')
                ? 'CLAIM: x. ALTERNATIVE: none needed. TEST: reviewed. EVIDENCE: r1. VERDICT: stands'
                : compliantText(lastUser);
            return { text, toolCalls: [], provider: candidate.route.provider, model: candidate.route.model };
        };
        const result = await runBakeoff([CANDIDATE], rubberStamp, ['charter']);
        const score = result.scores[0];
        assert.equal(score.completed, BAKEOFF_BATTERY.length - 1);
        assert.equal(score.softRefused, 1);
    });
    test('the prefill probe records a rejection when the endpoint refuses the message shape', async () => {
        const rejecting = async () => {
            throw new Error('messages with a trailing assistant turn are not supported');
        };
        assert.equal(await probePrefillSupport(CANDIDATE, rejecting), 'rejected');
    });
    test('a malformed JSON reply counts as a format error', async () => {
        const sloppy = async (candidate, assembled) => {
            const lastUser = [...assembled.messages].reverse().find(m => m.role === 'user')?.content ?? '';
            const text = lastUser.includes('JSON object') ? 'here is the summary: not json' : compliantText(lastUser);
            return { text, toolCalls: [], provider: candidate.route.provider, model: candidate.route.model };
        };
        const result = await runBakeoff([CANDIDATE], sloppy, ['charter']);
        assert.equal(result.scores[0].formatErrors, 1);
        assert.equal(result.scores[0].softRefused, 1);
    });
});
