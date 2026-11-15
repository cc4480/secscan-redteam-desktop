/**
 * Doctrine section tests.
 *
 * The plugin's contract with the desktop chat is the pair of sections it
 * registers: apply() must install the auth gate hook and publish the
 * 'secscan-redteam' doctrine with the engagement-fulfilment hard rule in
 * it — a scan request starts a runner engagement via engagement_launch,
 * never a service scan, and the report lands in the thread — followed by
 * the 'secscan-redteam-soul' section carrying the fleet SOUL, loaded from
 * the llm-router's one asset. These tests pin that wording and that text
 * so an edit cannot quietly drop the rule or the SOUL.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSoulText } from '@secscan/redteam-llm-router';
import { apply } from '../src/index.js';
import { isDeferredTool } from '../src/local-profile.js';
/** Assembly context for a non-local route: no agent, so no local profile. */
const REMOTE_CONTEXT = {};
/** Assembly context for a small local window (4K-class model). */
const SMALL_LOCAL_CONTEXT = {
    agent: {
        options: { provider: 'local' },
        session: {
            requestHeader: () => ({ config: { provider: 'local' } }),
            requestContext: () => ({ provider: 'local', model: 'qwen', contextWindow: 4_096 }),
        },
    },
};
/** Assembly context for a roomy local window. */
const ROOMY_LOCAL_CONTEXT = {
    agent: {
        options: { provider: 'local' },
        session: {
            requestHeader: () => ({ config: { provider: 'local' } }),
            requestContext: () => ({ provider: 'local', model: 'qwen', contextWindow: 32_768 }),
        },
    },
};
/** Assembly context whose routed request names the local provider. */
const LOCAL_CONTEXT = {
    agent: {
        options: { provider: 'local' },
        session: {
            requestHeader: () => ({ config: { provider: 'local' } }),
            requestContext: () => ({ provider: 'local', model: 'qwen', contextWindow: 32_768 }),
        },
    },
};
function captureApply(context = REMOTE_CONTEXT) {
    const registered = [];
    const hooks = [];
    const listeners = new Map();
    const ctx = {
        on: (event, listener) => {
            hooks.push(event);
            listeners.set(event, listener);
            return () => { };
        },
        systemPrompt: {
            section: (s) => {
                registered.push(s);
            },
        },
    };
    apply(ctx);
    return {
        sections: registered.map(section => ({
            name: section.name,
            order: section.order,
            text: typeof section.text === 'function' ? section.text(context) : section.text,
        })),
        hooks,
        listeners,
    };
}
const flat = (text) => text.replace(/\s+/g, ' ');
describe('apply', () => {
    it('installs the auth gate hook and publishes the doctrine and SOUL sections', () => {
        const { sections, hooks } = captureApply();
        assert.deepEqual(hooks, ['tools/pre-execute', 'system-prompt/assemble']);
        assert.equal(sections.length, 2);
        assert.equal(sections[0].name, 'secscan-redteam');
        assert.equal(sections[0].order, 117);
        assert.equal(sections[1].name, 'secscan-redteam-soul');
        assert.equal(sections[1].order, 118);
    });
    it('carries the loaded SOUL text in the soul section, not a copy', () => {
        const { sections } = captureApply();
        assert.equal(sections[1].text, defaultSoulText());
        assert.ok(sections[1].text.length > 0);
    });
    it('teaches the engagement fulfilment path and the never-services hard rule', () => {
        const { sections } = captureApply();
        const text = flat(sections[0].text);
        assert.match(text, /mcp__redteam__engagement_launch/);
        assert.match(text, /mcp__redteam__engagement_status/);
        assert.match(text, /mcp__redteam__engagement_report/);
        assert.match(text, /never fulfilled by the SecScan or Seclayer live services/);
        assert.match(text, /do not substitute a service scan/);
        assert.match(text, /delivers the report IN THIS THREAD/);
        assert.match(text, /A scan request starts a runner engagement via `mcp__redteam__engagement_launch`/);
    });
    it('inventories the SecLayer tools as native runner tools inside engagements', () => {
        const { sections } = captureApply();
        const text = flat(sections[0].text);
        assert.match(text, /### SecLayer tools \(native, inside the runner\)/);
        assert.match(text, /seclayer_redteam/);
        assert.match(text, /seclayer_bola/);
        assert.match(text, /seclayer_api/);
        assert.match(text, /seclayer_webhook/);
        assert.match(text, /seclayer_dast/);
        assert.match(text, /seclayer_aggressive/);
        assert.match(text, /there is no external Seclayer service/);
        // The SecLayer inventory sits between the SecScan inventory and the
        // engagement-engine inventory, mirroring the bundle's row order.
        const secscanAt = text.indexOf('### SecScan engines');
        const seclayerAt = text.indexOf('### SecLayer tools');
        const engineAt = text.indexOf('### Engagement engine');
        assert.ok(secscanAt !== -1 && seclayerAt > secscanAt && engineAt > seclayerAt, 'the SecLayer inventory follows the SecScan inventory and precedes the engine inventory');
    });
    it('teaches SecLayer as native suites: no account or credits, blind-SSRF stated as not-run', () => {
        const { sections } = captureApply();
        const text = flat(sections[0].text);
        // Placement: the section sits after the fulfilment passage, before the
        // team roster passage.
        assert.match(text, /### SecLayer tests: native suites inside the runner/);
        const serviceAt = text.indexOf('### SecLayer tests');
        const fulfilAt = text.indexOf('delivers the report IN THIS THREAD');
        const teamAt = text.indexOf('### The team');
        assert.ok(fulfilAt !== -1 && serviceAt > fulfilAt && teamAt > serviceAt, 'the SecLayer doctrine follows the fulfilment passage and precedes the team passage');
        // Native and in-process; nothing external exists to key or spend.
        assert.match(text, /execute in-process as part of an engagement/);
        assert.match(text, /There is no Seclayer account, no API key, no credits/);
        assert.match(text, /When a request names "Seclayer" it means these native suites/);
        // The blind-SSRF limitation is stated, never papered over.
        assert.match(text, /blind SSRF and other out-of-band checks currently no-op/);
        assert.match(text, /must not claim blind-SSRF coverage it did not run/);
        // The external service surface is gone from the doctrine entirely.
        assert.doesNotMatch(text, /mcp__seclayer__/);
        assert.doesNotMatch(text, /seclayer_scan/);
        assert.doesNotMatch(text, /spends one credit/);
    });
    it('rosters four spawned teammates, the architect among them', () => {
        const { sections } = captureApply();
        const text = flat(sections[0].text);
        assert.match(text, /lead \+ recon \+ exploiter \+ reporter \+ architect/);
        assert.match(text, /Spawn all four with `spawn_teammate`/);
        // The generated roster lists every member except the coordinator (the
        // Lead's own brief), each followed by its assembled doctrine brief block.
        assert.doesNotMatch(text, /- `coordinator` —/);
        assert.match(text, /- `architect` — Consistency layer/);
        assert.doesNotMatch(text, /Brief: /);
        // The generated DAG seats the architect's review between the exploiter's
        // findings and the reporter's final assembly.
        assert.match(text, /`review` — Architecture and consistency review \(owner: architect; after recon, exploit\)/);
        assert.match(text, /`report` — Client report \(owner: reporter; after exploit, review\)/);
    });
    it('renders the assembled doctrine briefs: spawn blocks per member and the Lead block', () => {
        const { sections } = captureApply();
        const raw = sections[0].text;
        const block = (name) => {
            const begin = raw.indexOf(`<!-- BEGIN SPAWN BRIEF: ${name} -->`);
            const end = raw.indexOf(`<!-- END SPAWN BRIEF: ${name} -->`);
            assert.ok(begin !== -1 && end > begin, `spawn brief block missing for ${name}`);
            return raw.slice(begin, end);
        };
        const baseProof = 'The playbook is a floor, not a ceiling';
        const roleProof = {
            recon: 'A page is not a target. A workflow is.',
            exploiter: 'Interesting is a direction. Impact is a finding.',
            reporter: 'The evidence never bends to the prose.',
            architect: 'A finding recorded in the wrong shape',
        };
        for (const [name, proof] of Object.entries(roleProof)) {
            assert.ok(raw.includes(`#### Spawn brief — \`${name}\``), `spawn brief heading missing for ${name}`);
            const text = block(name);
            // The assembled brief — shared base first, then the role file — not a paragraph.
            assert.ok(text.includes(baseProof), `shared base missing from ${name}'s brief`);
            assert.ok(text.includes(proof), `role doctrine missing from ${name}'s brief`);
            assert.ok(text.indexOf(baseProof) < text.indexOf(proof), `base must precede the role file for ${name}`);
        }
        // The Lead's own commission sits immediately before the team roster and
        // carries the coordinator's assembled brief.
        const commissionAt = raw.indexOf('### Your own commission');
        const teamAt = raw.indexOf('### The team');
        assert.ok(commissionAt !== -1 && teamAt > commissionAt, 'Lead block must precede ### The team');
        const lead = raw.slice(raw.indexOf('<!-- BEGIN LEAD BRIEF -->'), raw.indexOf('<!-- END LEAD BRIEF -->'));
        assert.ok(lead.includes(baseProof), 'shared base missing from the Lead brief');
        assert.ok(lead.includes('Malformed output gets returned for repair'), 'coordinator doctrine missing from the Lead brief');
        // None of the five deleted executionPrompt paragraphs survive anywhere.
        for (const fragment of [
            'promote only what survives demonstration',
            'Map like an attacker choosing the entry point',
            'You are the black hat. One mission',
            'no claim outruns its evidence by one degree',
            'Flag drift and coverage gaps the moment',
        ]) {
            assert.ok(!raw.includes(fragment), `deleted executionPrompt fragment survived: ${fragment}`);
        }
    });
    it('replaces the deployment prompt with the compact profile on the local route', () => {
        const local = captureApply(LOCAL_CONTEXT);
        const remote = captureApply();
        // The local doctrine is the lean brief, far smaller than the deployment prompt.
        assert.ok(local.sections[0].text.length > 0);
        assert.ok(local.sections[0].text.length < remote.sections[0].text.length / 2);
        assert.match(local.sections[0].text, /fleet opening \(lean\)/);
        // The profile carries its own soul, so the deployment SOUL is suppressed.
        assert.equal(local.sections[1].text, '');
        // Every other route is untouched.
        assert.equal(remote.sections[1].text, defaultSoulText());
    });
    it('keeps the local prompt inside a 32,768-token window', () => {
        const local = captureApply(LOCAL_CONTEXT);
        const text = local.sections.map(section => section.text).join('\n\n');
        // The token meter prices four characters per token; the profile must leave
        // room for the conversation on the shipped Local Models default window.
        const priced = Math.ceil(text.length / 4);
        assert.ok(priced < 16_384, `local prompt priced at ${priced} tokens must stay under half the window`);
    });
    it('defers the indexed Layer-1 tool schemas from the local assembly only', async () => {
        const { listeners } = captureApply();
        const assemble = listeners.get('system-prompt/assemble');
        assert.ok(assemble !== undefined, 'the assemble listener is registered');
        const withTools = (tools) => ({ sections: [], contexts: [], tools });
        const schemas = [
            { name: 'mcp__alterego__doctor' },
            { name: 'mcp__redteam__nmap_exec' },
            { name: 'mcp__secscan__scan_url' },
            { name: 'bash' },
        ];
        const local = await assemble(withTools(schemas), LOCAL_CONTEXT, async () => withTools(schemas));
        assert.deepEqual(local.tools.map(tool => tool.name), ['mcp__redteam__nmap_exec', 'mcp__secscan__scan_url', 'bash']);
        const remote = await assemble(withTools(schemas), REMOTE_CONTEXT, async () => withTools(schemas));
        assert.deepEqual(remote.tools.map(tool => tool.name), schemas.map(tool => tool.name));
    });
    it('matches an indexed tool through its MCP namespace', () => {
        assert.equal(isDeferredTool('mcp__alterego__doctor', new Set(['doctor'])), true);
        assert.equal(isDeferredTool('doctor', new Set(['doctor'])), true);
        assert.equal(isDeferredTool('mcp__redteam__doctor_jobs', new Set(['doctor'])), false);
        assert.equal(isDeferredTool('bash', new Set(['doctor'])), false);
    });
    it('gives a small local window the tight brief, and a roomy one the lean brief', () => {
        const small = captureApply(SMALL_LOCAL_CONTEXT);
        const roomy = captureApply(ROOMY_LOCAL_CONTEXT);
        const tightChars = small.sections[0].text.length;
        const leanChars = roomy.sections[0].text.length;
        assert.match(small.sections[0].text, /compact operating brief/);
        assert.ok(tightChars < leanChars, `tight brief (${tightChars}) must be smaller than the lean brief (${leanChars})`);
        // Under 2,000 tokens at the token meter's four-characters-per-token price.
        assert.ok(Math.ceil(tightChars / 4) <= 2_000, 'tight brief stays under the 2,000-token ceiling');
        // The hard rule survives the compression: scans are engagements, never service scans.
        assert.match(small.sections[0].text, /mcp__redteam__engagement_launch/);
        assert.match(small.sections[0].text, /never a SecScan or Seclayer\s+service scan/);
        // Roomier local windows open on the lean brief, not the full profile (F2).
        assert.match(roomy.sections[0].text, /fleet opening \(lean\)/);
        assert.ok(Math.ceil(leanChars / 4) <= 2_000, `lean brief priced at ${Math.ceil(leanChars / 4)} tokens must stay under the 2,000-token ceiling`);
    });
    it('a fresh local session opens on the lean brief', () => {
        const roomy = captureApply(ROOMY_LOCAL_CONTEXT);
        // The first fleet section IS the lean opening, priced in the low thousands
        // of tokens at the meter's four-characters-per-token price — the fix for
        // the five-figure first-turn prefill on CPU-served local models.
        assert.match(roomy.sections[0].text, /^# SecScan Red Team — fleet opening \(lean\)/);
        const priced = Math.ceil(roomy.sections[0].text.length / 4);
        assert.ok(priced <= 2_000, `lean opening priced at ${priced} tokens`);
        // The lean brief carries its own stance, so the deployment SOUL stays suppressed.
        assert.equal(roomy.sections[1].text, '');
        // The hard rules ride in the lean text: engagements, never service scans.
        assert.match(roomy.sections[0].text, /mcp__redteam__engagement_launch/);
        assert.match(roomy.sections[0].text, /no MCP servers/);
    });
    it('keeps only the engagement tools on a window too small for a tool surface', async () => {
        const { listeners } = captureApply();
        const assemble = listeners.get('system-prompt/assemble');
        assert.ok(assemble !== undefined);
        const withTools = (tools) => ({ sections: [], contexts: [], tools });
        const schemas = [
            { name: 'mcp__redteam__engagement_launch' },
            { name: 'mcp__redteam__engagement_status' },
            { name: 'mcp__redteam__engagement_report' },
            { name: 'read' },
            { name: 'bash' },
            { name: 'mcp__alterego__doctor' },
            { name: 'mcp__secscan__scan_url' },
            { name: 'write' },
        ];
        const small = await assemble(withTools(schemas), SMALL_LOCAL_CONTEXT, async () => withTools(schemas));
        assert.deepEqual(small.tools.map(tool => tool.name), [
            'mcp__redteam__engagement_launch',
            'mcp__redteam__engagement_status',
            'mcp__redteam__engagement_report',
            'read',
            'bash',
        ]);
        // A roomy local window keeps everything except the deferred Layer-1 set.
        const roomy = await assemble(withTools(schemas), ROOMY_LOCAL_CONTEXT, async () => withTools(schemas));
        assert.deepEqual(roomy.tools.map(tool => tool.name), [
            'mcp__redteam__engagement_launch',
            'mcp__redteam__engagement_status',
            'mcp__redteam__engagement_report',
            'read',
            'bash',
            'mcp__secscan__scan_url',
            'write',
        ]);
    });
    it('no longer teaches the service scan as the recon baseline', () => {
        const { sections } = captureApply();
        const text = flat(sections[0].text);
        assert.doesNotMatch(text, /baseline `mcp__secscan__scan_url` scan/);
        assert.match(text, /baseline scan the runner engagement runs in its recon phase/);
    });
});
