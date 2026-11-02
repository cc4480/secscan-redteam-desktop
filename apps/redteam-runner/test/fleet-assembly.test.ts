/**
 * Fleet prompt assembly (Phase 2 W3): every live seat's system prompt is
 * assembled by @secscan/redteam-fleet-skills in the pack order — master →
 * soul → verified-engagement injection → knobs → the runner's existing
 * seat prompt → Layer-1 skills index → the seat's Layer-2 skill bodies.
 *
 * These tests pin: the assembled order, the soul per role, the injection
 * carrying the fixture record's targets and proof, the index listing all
 * 9 bundled skills, the per-role skill bodies (and no other role's), the
 * record mapping from the authorize phase's stamped Ctx fields, the
 * fail-loud path when proof data is absent, and the byte-stability of
 * engagement-independent contexts (agent-docs canonical rendering).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { VerifiedEngagementRecord } from '@secscan/redteam-fleet-skills'
import { promptCtx } from '../src/agents.js'
import type { Ctx } from '../src/context.js'
import { coordinatorPrompt, exploiterPrompt, reconPrompt, reporterPrompt } from '../src/prompts.js'
import { canonicalAgentDocContext, renderAgentMarkdown } from '../src/prompts/agent-docs.js'
import { verifiedRecordFor } from '../src/prompts/fleet-assembly.js'
import type { PromptContext } from '../src/prompts/shared.js'

const FIXTURE_RECORD: VerifiedEngagementRecord = {
  engagementId: 'eng-fixture-1',
  operator: 'Fixture Operator',
  owner: 'Fixture Owner LLC',
  proofMethod: 'DNS TXT ownership proof (fixture)',
  recordId: 'eng-fixture-1',
  verifiedAt: '2026-11-01T00:00:00.000Z',
  targets: ['app.example.com', 'example.com'],
  outOfScope: ['staging.example.com'],
  accessLevel: 'verified-domain',
  roe: 'Mode: RED. Scope: app.example.com, example.com.',
  sessionsAllowed: true,
}

function fixtureCtx(fleet: boolean): PromptContext {
  return {
    mode: 'red',
    objective: 'assess the fixture attack surface',
    target: 'example.com',
    scopeHosts: ['app.example.com', 'example.com'],
    roe: { scope: ['app.example.com', 'example.com'], outOfScope: ['staging.example.com'] },
    ...(fleet ? { fleet: { record: FIXTURE_RECORD } } : {}),
  }
}

const ALL_SKILLS = [
  'blackteam-adversary-emulation',
  'browser-action-execution',
  'deep-research-osint',
  'exploit-coding-toolbuilding',
  'findings-grading-reporting',
  'html-report-design',
  'redteam-ops-coordination',
  'webapp-exploit',
  'webapp-scan',
]

describe('fleet prompt assembly', () => {
  it('assembles the coordinator prompt in pack order with the MORPHEUS soul', () => {
    const prompt = coordinatorPrompt(fixtureCtx(true))
    const masterAt = prompt.indexOf('<identity>')
    const soulAt = prompt.indexOf('# MORPHEUS — Coordinator')
    const injectionAt = prompt.indexOf('<verified_engagement>')
    const knobsAt = prompt.indexOf('AGGRESSION = full')
    const seatAt = prompt.indexOf('# Coordinator — MORPHEUS, the one who opens your eyes')
    const indexAt = prompt.indexOf('<fleet_skills_index>')
    const bodyAt = prompt.indexOf('<skill_content name="redteam-ops-coordination">')
    assert.equal(masterAt, 0, 'the master block opens the assembled prompt')
    assert.ok(soulAt > masterAt, 'soul follows master')
    assert.ok(injectionAt > soulAt, 'engagement injection follows soul')
    assert.ok(knobsAt > injectionAt, 'rendered knobs follow injection')
    assert.ok(seatAt > knobsAt, 'the existing seat prompt follows knobs')
    assert.ok(indexAt > seatAt, 'the skills index follows the seat prompt')
    assert.ok(bodyAt > indexAt, 'Layer-2 skill bodies follow the index')
  })

  it('carries the fixture record\u2019s targets, proof, and exclusions in the injection', () => {
    const prompt = coordinatorPrompt(fixtureCtx(true))
    assert.ok(prompt.includes('engagement_id: eng-fixture-1'))
    assert.ok(prompt.includes('DNS TXT ownership proof (fixture)'))
    assert.ok(prompt.includes('verified at 2026-11-01T00:00:00.000Z'))
    assert.ok(prompt.includes('- app.example.com'))
    assert.ok(prompt.includes('- example.com'))
    assert.ok(prompt.includes('- staging.example.com'), 'out-of-scope entries ride the injection')
    assert.equal(prompt.split('<verified_engagement>').length - 1, 1, 'exactly one injection block')
  })

  it('gives each role its own soul and only its own Layer-2 skill bodies', () => {
    const cases: { prompt: string; soul: string; bodies: string[]; foreignBody: string }[] = [
      {
        prompt: coordinatorPrompt(fixtureCtx(true)),
        soul: '# MORPHEUS — Coordinator',
        bodies: ['redteam-ops-coordination'],
        foreignBody: 'webapp-exploit',
      },
      {
        prompt: reconPrompt(fixtureCtx(true)),
        soul: '# The OPERATOR — Recon / Research',
        bodies: ['deep-research-osint', 'webapp-scan'],
        foreignBody: 'webapp-exploit',
      },
      {
        prompt: exploiterPrompt(fixtureCtx(true)),
        soul: '# NEO — Exploiter',
        bodies: ['webapp-exploit', 'browser-action-execution'],
        foreignBody: 'deep-research-osint',
      },
      {
        prompt: reporterPrompt(fixtureCtx(true)),
        soul: '# The ARCHITECT — Evaluator / Reporter',
        bodies: ['findings-grading-reporting', 'html-report-design'],
        foreignBody: 'webapp-scan',
      },
    ]
    for (const c of cases) {
      assert.ok(c.prompt.includes(c.soul), `soul present: ${c.soul}`)
      for (const body of c.bodies) {
        assert.ok(c.prompt.includes(`<skill_content name="${body}">`), `body attached: ${body}`)
      }
      assert.ok(
        !c.prompt.includes(`<skill_content name="${c.foreignBody}">`),
        `no foreign body attached: ${c.foreignBody}`,
      )
    }
  })

  it('lists all 9 bundled skills in the Layer-1 index of every assembled prompt', () => {
    const prompt = exploiterPrompt(fixtureCtx(true))
    const index = prompt.slice(prompt.indexOf('<fleet_skills_index>'), prompt.indexOf('</fleet_skills_index>'))
    for (const name of ALL_SKILLS) assert.ok(index.includes(`- ${name}:`), `index lists ${name}`)
  })

  it('keeps the runner\u2019s existing seat text intact inside the assembly', () => {
    const assembled = reconPrompt(fixtureCtx(true))
    const bare = reconPrompt(fixtureCtx(false))
    assert.ok(assembled.includes(bare), 'the historical recon prompt survives verbatim as the seat layer')
  })

  it('renders engagement-independent contexts byte-identical to the historical prompts', () => {
    const bare = coordinatorPrompt(fixtureCtx(false))
    assert.ok(bare.startsWith('# Coordinator — MORPHEUS'))
    assert.ok(!bare.includes('<verified_engagement>'))
    assert.ok(!bare.includes('<fleet_skills_index>'))
    const doc = renderAgentMarkdown('coordinator')
    assert.ok(
      doc.includes(coordinatorPrompt(canonicalAgentDocContext())),
      'agent docs render the same un-assembled seat text',
    )
    assert.ok(!doc.includes('<verified_engagement>'), 'agent docs carry no engagement injection')
  })
})

describe('black-team mode — the SMITH mask (H2)', () => {
  it('swaps the seat soul for SMITH and binds the blackteam skill full-body, seat delta kept', () => {
    const prompt = exploiterPrompt({ ...fixtureCtx(true), mode: 'black' })
    assert.ok(
      prompt.includes('# AGENT SMITH — Black-Team Mode Only'),
      'the SMITH soul is the seat\u2019s soul in black mode',
    )
    assert.ok(!prompt.includes('# NEO — Exploiter'), 'the seat soul is swapped out, not stacked under the mask')
    assert.ok(
      prompt.includes('<skill_content name="blackteam-adversary-emulation">'),
      'the blackteam skill is bound full-body in black mode',
    )
    assert.ok(
      prompt.includes('# Exploiter — NEO, the One who bends the Matrix'),
      'the runner\u2019s seat delta is kept under the mask',
    )
    assert.ok(
      prompt.includes('<skill_content name="webapp-exploit">'),
      'the seat\u2019s own Layer-2 bodies still ride in black mode',
    )
    assert.ok(prompt.includes('<verified_engagement>'), 'the verified record is injected in black mode too')
  })

  it('applies the mask to every seat, not only the exploiter', () => {
    const prompt = coordinatorPrompt({ ...fixtureCtx(true), mode: 'black' })
    assert.ok(prompt.includes('# AGENT SMITH — Black-Team Mode Only'))
    assert.ok(!prompt.includes('# MORPHEUS — Coordinator'))
    assert.ok(prompt.includes('<skill_content name="blackteam-adversary-emulation">'))
  })

  it('red mode assembles without the mask or the blackteam body', () => {
    const prompt = exploiterPrompt(fixtureCtx(true))
    assert.ok(prompt.includes('# NEO — Exploiter'))
    assert.ok(!prompt.includes('AGENT SMITH'), 'no SMITH soul in red mode')
    assert.ok(
      !prompt.includes('<skill_content name="blackteam-adversary-emulation">'),
      'the blackteam skill stays index-only in red mode',
    )
  })
})

describe('verifiedRecordFor — the authorize record mapping', () => {
  function fakeCtx(over: { proof?: string; verifiedAt?: string; input?: Partial<Ctx['input']> }): Ctx {
    return {
      domain: 'example.com',
      hosts: ['app.example.com', 'example.com'],
      verifiedScope: ['app.example.com', 'example.com'],
      ...(over.proof !== undefined ? { verificationProof: over.proof } : {}),
      ...(over.verifiedAt !== undefined ? { verifiedAt: over.verifiedAt } : {}),
      events: { engagementId: 'eng-ctx-7' },
      config: { localSandbox: false, testMode: false },
      input: {
        target: 'https://example.com',
        mode: 'red',
        objective: 'assess the external attack surface',
        client: 'Example Owner LLC',
        operatorName: 'Named Operator',
        roe: { scope: ['app.example.com', 'example.com'], outOfScope: ['staging.example.com'] },
        ...(over.input ?? {}),
      },
    } as Ctx
  }

  it('maps the stamped authorize output onto the fleet record', () => {
    const record = verifiedRecordFor(
      fakeCtx({ proof: 'Operator-attested ownership: Named Operator attests…', verifiedAt: '2026-11-01T05:00:00.000Z' }),
    )
    assert.equal(record.engagementId, 'eng-ctx-7')
    assert.equal(record.recordId, 'eng-ctx-7')
    assert.equal(record.operator, 'Named Operator')
    assert.equal(record.owner, 'Example Owner LLC')
    assert.equal(record.proofMethod, 'Operator-attested ownership: Named Operator attests…')
    assert.equal(record.verifiedAt, '2026-11-01T05:00:00.000Z')
    assert.deepEqual(record.targets, ['app.example.com', 'example.com'])
    assert.deepEqual(record.outOfScope, ['staging.example.com'])
    assert.equal(record.accessLevel, 'verified-domain')
  })

  it('carries the input accessLevel/sessionsAllowed into the record (L12)', () => {
    const record = verifiedRecordFor(
      fakeCtx({
        proof: 'Credentialed access attested',
        verifiedAt: '2026-11-01T05:00:00.000Z',
        input: { accessLevel: 'credentialed', sessionsAllowed: false },
      }),
    )
    assert.equal(record.accessLevel, 'credentialed')
    assert.equal(record.sessionsAllowed, false)
  })

  it('unset accessLevel/sessionsAllowed reproduce the historical record (L12)', () => {
    const stamp = { proof: 'DNS TXT record', verifiedAt: '2026-11-01T05:00:00.000Z' }
    const unset = verifiedRecordFor(fakeCtx(stamp))
    const explicitDefaults = verifiedRecordFor(
      fakeCtx({ ...stamp, input: { accessLevel: 'verified-domain', sessionsAllowed: true } }),
    )
    assert.deepEqual(unset, explicitDefaults)
    assert.equal(unset.accessLevel, 'verified-domain')
    assert.equal(unset.sessionsAllowed, true)
  })

  it('fails loud when authorize has not stamped proof data', () => {
    assert.throws(() => verifiedRecordFor(fakeCtx({})), /verification record/)
    assert.throws(
      () => verifiedRecordFor(fakeCtx({ proof: 'some proof' })),
      /verifiedAt ABSENT/,
    )
  })

  it('promptCtx carries the fleet record once authorize has stamped it', () => {
    const ctx = promptCtx(
      fakeCtx({ proof: 'DNS TXT record', verifiedAt: '2026-11-01T05:00:00.000Z' }),
    )
    assert.equal(ctx.fleet?.record.proofMethod, 'DNS TXT record')
    assert.deepEqual(ctx.fleet?.record.targets, ['app.example.com', 'example.com'])
    const assembled = coordinatorPrompt(ctx)
    assert.ok(assembled.includes('<verified_engagement>'), 'the production context assembles')
  })

  it('promptCtx omits the fleet input on contexts authorize never stamped', () => {
    // Direct phase calls on hand-built contexts (unit fixtures) render
    // the historical seat text; the fail-loud gate for real engagements
    // is runEngagement's post-authorize verifiedRecordFor call, pinned
    // by the throws test above.
    const ctx = promptCtx(fakeCtx({}))
    assert.equal(ctx.fleet, undefined)
    assert.ok(!coordinatorPrompt(ctx).includes('<verified_engagement>'))
  })
})
