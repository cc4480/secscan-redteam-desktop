/**
 * Per-member child cap (maxChildrenPerMember 25, the deployment value both
 * shipped patch layers carry): one member's live direct children are bounded
 * per creator, independently of the Team-wide roster cap. The bound admits
 * 25 children for one member and refuses the 26th, counts the Lead's own
 * children against the Lead, yields to the global cap when that is smaller,
 * ignores creations that failed, cannot be overrun by concurrent spawns,
 * and - when the knob is unset - imposes no bound at all.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService from '../src/index.ts'
import { TestSessionQuery } from './test-session-query.ts'

const SIGNAL = new AbortController().signal
const roots: string[] = []
const contexts: Context[] = []

type Scripts = ConstructorParameters<typeof MockAdapter>[0]

/** The deployment bounds: the transplanted fleet width plus the per-member cap. */
const FLEET = { maxMembers: 100, maxMemberDepth: 4, maxChildrenPerMember: 25 }

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function setup(
  script: Scripts,
  config: ConstructorParameters<typeof TeamService>[1] = {},
  subagentConfig: { maxActiveSubagents?: number } = {},
) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-team-child-cap-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService, subagentConfig)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  await ctx.plugin(TeamService, config)
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const lead = await ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'mock' })
  return { ctx, lead }
}

function content(text: string) {
  return [{ type: 'text' as const, text }]
}

function spawn(ctx: Context, caller: Agent, name: string) {
  return ctx.agentTeams.spawnTeammate(caller, {
    name,
    description: `${name} responsibility`,
    prompt: content(`${name} initial`),
    context: 'fresh',
    provider: 'spawn',
    signal: SIGNAL,
  })
}

/** Resolve one admitted member's live Agent once the registry holds it. */
async function waitAgent(ctx: Context, id: SessionId): Promise<Agent> {
  return vi.waitFor(() => {
    const agent = ctx.agents.get(id)
    expect(agent).toBeDefined()
    return agent!
  }, { timeout: 5_000 })
}

describe('Per-member child cap', () => {
  it('admits 25 children for one member and refuses the 26th', async () => {
    // Hanging turns keep every member loaded in the registry (a completed
    // continuable child unloads), and the raised activation cap lets all 25
    // helpers hold a turn at once - the fleet-cap concurrency shape.
    const script: Scripts = Array.from({ length: 64 }, () => 'hang')
    const { ctx, lead } = await setup(script, FLEET, { maxActiveSubagents: 100 })
    const recon = await spawn(ctx, lead, 'recon')
    const reconAgent = await waitAgent(ctx, recon.member.id)
    for (let index = 1; index <= 25; index++) {
      const name = `recon-helper-${String(index).padStart(2, '0')}`
      const started = await spawn(ctx, reconAgent, name)
      expect(started.member).toMatchObject({ name, spawnedBy: 'recon', depth: 2 })
    }
    const refusal = await spawn(ctx, reconAgent, 'recon-helper-26').catch((error: unknown) => error)
    expect(refusal).toMatchObject({ code: 'TEAM_MEMBER_CHILD_LIMIT' })
    expect((refusal as Error).message).toContain('member "recon"')
    expect((refusal as Error).message).toContain('25')
    // The count is per member: recon's full quota leaves the Lead's and a
    // peer's quotas untouched.
    const reporter = await spawn(ctx, lead, 'reporter')
    const reporterAgent = await waitAgent(ctx, reporter.member.id)
    const helper = await spawn(ctx, reporterAgent, 'reporter-helper')
    expect(helper.member).toMatchObject({ spawnedBy: 'reporter', depth: 2 })
  }, 120_000)

  it('counts the Lead\'s own children against the Lead', async () => {
    const script = Array.from({ length: 96 }, (_, index) => textResponse(`answer ${index}`))
    const { ctx, lead } = await setup(script, FLEET)
    for (let index = 1; index <= 25; index++) {
      const name = `member-${String(index).padStart(2, '0')}`
      const started = await spawn(ctx, lead, name)
      expect(started.member).toMatchObject({ name, spawnedBy: 'lead', depth: 1 })
    }
    // The global cap is 100, so this refusal is the per-member bound, and it
    // names the Lead as the member at it.
    const refusal = await spawn(ctx, lead, 'member-26').catch((error: unknown) => error)
    expect(refusal).toMatchObject({ code: 'TEAM_MEMBER_CHILD_LIMIT' })
    expect((refusal as Error).message).toContain('member "lead"')
  }, 120_000)

  it('lets the global cap bind first when it is the smaller bound', async () => {
    const script = Array.from({ length: 32 }, (_, index) => textResponse(`answer ${index}`))
    const { ctx, lead } = await setup(script, { maxMembers: 6, maxMemberDepth: 4, maxChildrenPerMember: 25 })
    for (let index = 1; index <= 6; index++) await spawn(ctx, lead, `member-${index}`)
    await expect(spawn(ctx, lead, 'member-7')).rejects.toMatchObject({ code: 'TEAM_MEMBER_LIMIT' })
  }, 60_000)

  it('imposes no per-member bound when the knob is unset', async () => {
    const script: Scripts = Array.from({ length: 32 }, () => 'hang')
    const { ctx, lead } = await setup(script, { maxMembers: 40, maxMemberDepth: 4 }, { maxActiveSubagents: 100 })
    const recon = await spawn(ctx, lead, 'recon')
    const reconAgent = await waitAgent(ctx, recon.member.id)
    // Twelve helpers from one member: any per-member default would refuse
    // long before the global 40 is in sight.
    for (let index = 1; index <= 12; index++) {
      await spawn(ctx, reconAgent, `recon-helper-${String(index).padStart(2, '0')}`)
    }
    expect(ctx.agentTeams.listMembers(lead)).toHaveLength(14)
  }, 90_000)

  it('does not consume the quota for creations that failed', async () => {
    // Default subagent service (8 active turns): recon plus its first
    // helpers fill the activation pool, later creations are refused by the
    // pool and their roster rows land as failed. Twelve attempts against a
    // per-member cap of 10 overrun the cap only if failed rows count.
    const { ctx, lead } = await setup(Array.from({ length: 16 }, () => 'hang'), {
      maxMembers: 100,
      maxMemberDepth: 4,
      maxChildrenPerMember: 10,
    })
    const recon = await spawn(ctx, lead, 'recon')
    const reconAgent = await waitAgent(ctx, recon.member.id)
    const codes: string[] = []
    for (let index = 1; index <= 12; index++) {
      const name = `recon-helper-${String(index).padStart(2, '0')}`
      await spawn(ctx, reconAgent, name).catch((error: unknown) => {
        codes.push((error as { code?: string }).code ?? 'UNKNOWN')
      })
    }
    expect(codes).toContain('ACTIVATION_LIMIT_REACHED')
    expect(codes).not.toContain('TEAM_MEMBER_CHILD_LIMIT')
    const rows = ctx.agentTeams.listMembers(lead)
    expect(rows.filter(row => row.spawnedBy === 'recon' && row.status === 'failed').length)
      .toBeGreaterThanOrEqual(2)
  }, 60_000)

  it('cannot be overrun by concurrent spawns from one member', async () => {
    const script: Scripts = Array.from({ length: 48 }, () => 'hang')
    const { ctx, lead } = await setup(script, FLEET, { maxActiveSubagents: 100 })
    const recon = await spawn(ctx, lead, 'recon')
    const reconAgent = await waitAgent(ctx, recon.member.id)
    const names = Array.from({ length: 30 }, (_, index) => `burst-${String(index + 1).padStart(2, '0')}`)
    const outcomes = await Promise.allSettled(names.map(name => spawn(ctx, reconAgent, name)))
    const admitted = outcomes.filter(outcome => outcome.status === 'fulfilled')
    const refused = outcomes.filter(outcome => outcome.status === 'rejected')
    expect(admitted).toHaveLength(25)
    expect(refused).toHaveLength(5)
    for (const outcome of refused) {
      expect((outcome as PromiseRejectedResult).reason).toMatchObject({ code: 'TEAM_MEMBER_CHILD_LIMIT' })
    }
  }, 120_000)

  it('refuses a non-positive per-member cap at startup', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-team-child-cap-'))
    roots.push(storageRoot)
    await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
    await ctx.plugin(TestSessionQuery)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentService, {})
    await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
    await ctx.plugin(SubagentFork, { providerName: 'fork' })
    await expect(ctx.plugin(TeamService, { maxChildrenPerMember: 0 })).rejects.toThrow(/maxChildrenPerMember/)
  }, 60_000)
})
