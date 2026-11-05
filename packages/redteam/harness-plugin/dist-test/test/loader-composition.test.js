/**
 * REAL-composition test (packages/AGENTS.md): the hand-built ctx in
 * section.test.ts proves what apply() registers, but not that the plugin
 * composes. This test boots a test-only cordis.yml through the Cordis
 * Loader with the plugin's declared inject closure — the SystemPrompt and
 * ToolRuntime services — and asserts the model-visible output: the
 * assembled system prompt carries the doctrine section and, immediately
 * after it, the SOUL section with the llm-router's served asset text.
 * Only the module-resolution seam is stubbed (the Loader's internal
 * import map); every plugin in the composition is the real one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Include from '@deepseek-ai/cordis-plugin-include';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import { defaultSoulText } from '@secscan/redteam-llm-router';
import * as harnessPlugin from '../src/index.js';
describe('harness plugin real Loader composition', () => {
    it('assembles the doctrine and SOUL sections through the Loader', async () => {
        const root = await mkdtemp(join(tmpdir(), 'dsh-redteam-loader-'));
        const configPath = join(root, 'cordis.yml');
        await writeFile(configPath, [
            "- name: '@deepseek-ai/dsh-system-prompt'",
            "- name: '@deepseek-ai/dsh-tools'",
            "- name: '@secscan/redteam-harness-plugin'",
            '',
        ].join('\n'));
        const context = new Context();
        try {
            context.baseUrl = pathToFileURL(root).href + '/';
            await context.plugin(Loader);
            context.loader.builtins.include = Include;
            const modules = new Map([
                ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
                ['@deepseek-ai/dsh-tools', ToolRuntime],
                ['@secscan/redteam-harness-plugin', harnessPlugin],
            ]);
            context.loader.internal = {
                version: 'v2',
                async import(specifier) {
                    if (!modules.has(specifier))
                        throw new Error(`unexpected Loader import: ${specifier}`);
                    return modules.get(specifier);
                },
            };
            await context.loader.create({
                name: 'cordis:include',
                config: { path: pathToFileURL(configPath).href },
            });
            await context.loader.await();
            const assembly = await context.systemPrompt.assemble();
            const names = assembly.sections.map(section => section.name);
            // The real SystemPrompt composed: its always-present identity section
            // is there, and so are both of the plugin's sections.
            assert.ok(names.includes('harness:identity'), `identity section missing from: ${names.join(', ')}`);
            const doctrineAt = names.indexOf('secscan-redteam');
            const soulAt = names.indexOf('secscan-redteam-soul');
            assert.ok(doctrineAt !== -1, `doctrine section missing from: ${names.join(', ')}`);
            assert.ok(soulAt !== -1, `SOUL section missing from: ${names.join(', ')}`);
            assert.ok(soulAt > doctrineAt, 'the SOUL section assembles after the doctrine section');
            const soul = assembly.sections[soulAt];
            assert.equal(soul.text, defaultSoulText());
            const doctrine = assembly.sections[doctrineAt];
            assert.match(doctrine.text, /engagement doctrine/);
            // The fleet briefs ride inside the doctrine section through the real
            // composition: the Lead's own commission and at least one spawn-brief
            // block carrying the shared base — the guard that the packaged staging
            // kept the package (and its agents/ directory) whole.
            assert.match(doctrine.text, /### Your own commission/);
            assert.match(doctrine.text, /<!-- BEGIN SPAWN BRIEF: recon -->/);
            assert.match(doctrine.text, /The playbook is a floor, not a ceiling/);
        }
        finally {
            await context.fiber.dispose();
            await rm(root, { recursive: true, force: true });
        }
    });
});
