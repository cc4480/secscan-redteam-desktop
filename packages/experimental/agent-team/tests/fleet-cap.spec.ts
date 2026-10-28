/**
 * Fleet-cap behavior at the raised deployment bounds (maxMembers 100,
 * maxMemberDepth 4, maxTasks 4096 - the values both shipped patch layers now
 * carry): the roster admits 100 teammates and refuses the 101st, a non-Lead
 * member spawns helpers at will down to the depth bound, the task board
 * admits work past the previous 1024-task sizing, and the subagent service's
 * active-turn cap binds at its default of 8 until raised to the roster width.
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

/** The raised fleet bounds, as composed from the shipped patch layers. */
const FLEET = { maxMembers: 100, maxMemberDepth: 4, maxTasks: 4096 }

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function setup(
  script: ConstructorParameters<typeof MockAdapter>[0],
  config: ConstructorParameters<typeof TeamService>[1] = {},
  subagentConfig: { maxActiveSubagents?: number } = {},
) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-team-cap-'))
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

async function waitRunning(ctx: Context, id: SessionId): Promise<Agent> {
  return vi.waitFor(() => {
    const agent = ctx.agents.get(id)
    expect(agent?.status).toBe('running')
    return agent!
  }, { timeout: 5_000 })
}

describe('Fleet cap at the raised bounds', () => {
  it('admits 100 teammates and refuses the 101st', async () => {
    const script = Array.from({ length: 128 }, (_, index) => textResponse(`member ${index} answer`))
    const { ctx, lead } = await setup(script, FLEET)
    for (let index = 1; index <= 100; index++) {
      const name = `member-${String(index).padStart(3, '0')}`
      const started = await spawn(ctx, lead, name)
      expect(started.member).toMatchObject({ name, spawnedBy: 'lead', depth: 1 })
    }
    // The roster view carries the Lead plus every admitted teammate.
    expect(ctx.agentTeams.listMembers(lead)).toHaveLength(101)
    await expect(spawn(ctx, lead, 'member-101')).rejects.toMatchObject({ code: 'TEAM_MEMBER_LIMIT' })
  }, 120_000)

  it('lets a non-Lead member spawn helpers at will down to the depth bound', async () => {
    const { ctx, lead } = await setup(['hang', 'hang', 'hang', 'hang'], FLEET)
    const recon = await spawn(ctx, lead, 'recon')
    const reconAgent = await waitRunning(ctx, recon.member.id)
    // Spawn authority is not Lead-only: the depth-1 specialist creates its
    // own helper without any approval step, and the chain continues until a
    // member sits AT the depth bound.
    const helper = await spawn(ctx, reconAgent, 'recon-helper')
    expect(helper.member).toMatchObject({ spawnedBy: 'recon', depth: 2 })
    const helperAgent = await waitRunning(ctx, helper.member.id)
    const deep = await spawn(ctx, helperAgent, 'deep-helper')
    expect(deep.member).toMatchObject({ spawnedBy: 'recon-helper', depth: 3 })
    const deepAgent = await waitRunning(ctx, deep.member.id)
    const deepest = await spawn(ctx, deepAgent, 'deepest-helper')
    expect(deepest.member).toMatchObject({ spawnedBy: 'deep-helper', depth: 4 })
    const deepestAgent = await waitRunning(ctx, deepest.member.id)
    await expect(spawn(ctx, deepestAgent, 'past-depth')).rejects.toMatchObject({ code: 'TEAM_MEMBER_DEPTH' })
    expect(ctx.agentTeams.listMembers(lead).map(row => [row.name, row.depth])).toEqual([
      ['lead', 0],
      ['recon', 1],
      ['recon-helper', 2],
      ['deep-helper', 3],
      ['deepest-helper', 4],
    ])
  }, 60_000)

  it('runs the fleet concurrently past the subagent service default of 8 active', async () => {
    const names = Array.from({ length: 12 }, (_, index) => `parallel-${String(index + 1).padStart(2, '0')}`)
    // Raised active cap (the patch layers' maxActiveSubagents override): all
    // 12 hanging members hold a running turn at once.
    const raised = await setup(Array.from({ length: 16 }, () => 'hang'), FLEET, { maxActiveSubagents: 100 })
    const started = await Promise.all(names.map(name => spawn(raised.ctx, raised.lead, name)))
    await vi.waitFor(() => {
      for (const member of started) expect(raised.ctx.agents.get(member.member.id)?.status).toBe('running')
    }, { timeout: 10_000 })
    expect(raised.ctx.agentTeams.listMembers(raised.lead)).toHaveLength(13)

    // Service default (8): the first 8 members run; the 9th spawn is refused
    // outright by the activation pool and its roster row lands as failed -
    // the throttle the override removes.
    const capped = await setup(Array.from({ length: 16 }, () => 'hang'), FLEET)
    const admitted: (Awaited<ReturnType<typeof spawn>> | undefined)[] = []
    for (const name of names) {
      try {
        admitted.push(await spawn(capped.ctx, capped.lead, name))
      } catch (error) {
        expect(error).toMatchObject({ code: 'ACTIVATION_LIMIT_REACHED' })
        admitted.push(undefined)
      }
    }
    expect(admitted.filter(member => member !== undefined)).toHaveLength(8)
    await vi.waitFor(() => {
      for (const member of admitted) {
        if (member !== undefined) expect(capped.ctx.agents.get(member.member.id)?.status).toBe('running')
      }
    }, { timeout: 10_000 })
    const rows = capped.ctx.agentTeams.listMembers(capped.lead)
    expect(rows).toHaveLength(13)
    expect(rows.filter(row => row.status === 'failed')).toHaveLength(4)
  }, 60_000)

  it('admits tasks past the previous 1024-task board sizing', async () => {
    const { ctx, lead } = await setup([], FLEET)
    for (let index = 1; index <= 1100; index++) {
      await ctx.agentTeams.createTask(lead, { subject: `task ${index}`, description: 'board headroom' })
    }
    expect(ctx.agentTeams.listTasks(lead)).toHaveLength(1100)
  }, 120_000)
})
