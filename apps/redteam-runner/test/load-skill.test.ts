/**
 * load_skill (fleet audit M4): the seat-facing Layer-2 path. The Layer-1
 * index in every seat prompt promises the full SKILL.md on trigger;
 * these tests pin that the promise is keepable through dispatch — a
 * bundled skill loads by name through its handler, an unknown name
 * comes back as a plain result listing what exists, and the tool sits
 * in every seat's catalog exactly once.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ToolCallRequest } from '@secscan/redteam-llm-router'
import type { Ctx } from '../src/context.js'
import { handleBookkeepingTools } from '../src/dispatch/bookkeeping.js'
import { handleSkillLoadTools, loadSkill } from '../src/dispatch/skill-load.js'
import { EXPLOIT_TOOLS, FULL_TOOLS, RECON_TOOLS } from '../src/tools/compose.js'

const call = (name: string, args: Record<string, unknown>): ToolCallRequest => ({
  id: `call-${name}`,
  name,
  arguments: args,
})
// The skill-load handler touches no engagement state — resolution is
// against the fleet package root, exactly as assembly resolves it. The
// bookkeeping handler answers its allowlist check before touching any.
const ctx = {} as unknown as Ctx

describe('load_skill dispatch (Layer 2 on trigger)', () => {
  it('returns the full SKILL.md body for a bundled skill named in the index', async () => {
    const r = await handleSkillLoadTools(ctx, 'coordinator', 'recon', call('load_skill', { name: 'webapp-scan' }), { name: 'webapp-scan' })
    assert.ok(r)
    assert.ok(r.result.includes('name: webapp-scan'), 'frontmatter rides along')
    assert.ok(r.result.includes('# Web App Scan — Fleet Skill'), 'full body, not the index summary')
    assert.equal(r.target, 'skills')
  })

  it('an unknown name is a plain result naming the miss and listing what exists — never a throw', async () => {
    const r = await handleSkillLoadTools(ctx, 'coordinator', 'recon', call('load_skill', { name: 'no-such-skill' }), { name: 'no-such-skill' })
    assert.ok(r)
    assert.match(r.result, /no skill named "no-such-skill"/)
    assert.ok(r.result.includes('webapp-scan'), 'the available names are listed')
  })

  it('a missing name argument is a plain instructional result', async () => {
    const r = await handleSkillLoadTools(ctx, 'coordinator', 'recon', call('load_skill', {}), {})
    assert.ok(r)
    assert.match(r.result, /a skill name is required/)
  })

  it('claims only its own tool; the bookkeeping handler does not claim it', async () => {
    assert.equal(await handleSkillLoadTools(ctx, 'coordinator', 'recon', call('record_finding', {}), {}), null)
    assert.equal(await handleBookkeepingTools(ctx, 'coordinator', 'recon', call('load_skill', { name: 'webapp-scan' }), { name: 'webapp-scan' }), null)
  })

  it('loadSkill mechanics: an undefined name is a structured miss', () => {
    assert.equal(loadSkill(undefined).ok, false)
  })

  it('is in every seat catalog exactly once', () => {
    for (const set of [RECON_TOOLS, EXPLOIT_TOOLS, FULL_TOOLS]) {
      assert.equal(set.filter(t => t.name === 'load_skill').length, 1)
    }
    assert.equal(FULL_TOOLS.length, 36, 'the universal catalog grew by exactly the loader (42 before the six Seclayer battery tools were extracted on 2026-11-08)')
  })
})
