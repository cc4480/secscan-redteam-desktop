/**
 * RedTeam slash commands: handler behavior at the agent seam (followup /
 * steer / cancel spies over the real invocation shape) and a real
 * composition through the harness command registry — real session, real
 * `command/run`/`command/done` lifecycle records, real descriptor list.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime, { CommandId } from '@deepseek-ai/dsh-commands'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import { apply } from '../src/index.js'
import { createRedteamCommandDefinitions } from '../src/commands.js'
import {
  catalogSample,
  parseUseInput,
  reportDirective,
  scanDirective,
  statusDirective,
  useDirective,
} from '../src/directive.js'

/** A recording stand-in for the agent's model-visible input channels. */
interface RecordedAgent {
  followups: string[]
  steers: string[]
  cancels: unknown[]
  agent: Agent
}

function textOf(message: unknown): string {
  const content = (message as { content: readonly { type: string; text?: string }[] }).content
  return content.map(block => block.text ?? '').join('')
}

function recordedAgent(session?: unknown, id?: unknown): RecordedAgent {
  const recorded: RecordedAgent = {
    followups: [],
    steers: [],
    cancels: [],
    agent: undefined as unknown as Agent,
  }
  recorded.agent = {
    id,
    session,
    followup: (message: unknown) => { recorded.followups.push(textOf(message)) },
    steer: (message: unknown) => { recorded.steers.push(textOf(message)) },
    cancel: (cause: unknown) => { recorded.cancels.push(cause) },
  } as unknown as Agent
  return recorded
}

function invocation(agent: Agent, rawInput: string): CommandInvocation {
  return {
    commandId: CommandId('cmd-test-1'),
    agent,
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
  } as CommandInvocation
}

/** A fake tools service carrying exactly the given catalog, or none. */
function fakeCtx(names: readonly string[] | undefined): Context {
  const catalog = names === undefined
    ? undefined
    : {
        get: (name: string) => names.includes(name) ? { name } : undefined,
        schemas: () => names.map(name => ({ name })),
      }
  return { get: (name: string) => name === 'tools' ? catalog : undefined } as unknown as Context
}

const LEAD_CATALOG = [
  'mcp__redteam__engagement_launch',
  'mcp__redteam__engagement_status',
  'mcp__redteam__engagement_report',
  'shell',
  'spawn_teammate',
] as const

test('directive texts are fixed and carry the operator input verbatim', () => {
  assert.equal(
    scanDirective('https://example.com'),
    'OPERATOR DIRECTIVE (/scan): launch a new engagement now against https://example.com using your engagement_launch tool, with the target exactly as the operator gave it. Report the engagement id and the first status back in this thread. Do not substitute a service scan for the engagement.',
  )
  assert.ok(statusDirective().includes('engagement_status'))
  assert.ok(reportDirective().includes('engagement_report'))
  assert.ok(reportDirective().includes('ready:false'))
  assert.equal(
    useDirective('shell', ''),
    'OPERATOR DIRECTIVE (/use): for your next tool action, use the tool `shell`. This directive comes from the operator\'s /use command and overrides your default tool choice for the next action only.',
  )
  assert.ok(useDirective('shell', 'check the logs').includes('Operator instruction: check the logs'))
})

test('parseUseInput splits the tool token from the instruction', () => {
  assert.deepEqual(parseUseInput(''), undefined)
  assert.deepEqual(parseUseInput('   '), undefined)
  assert.deepEqual(parseUseInput(' shell'), { tool: 'shell', instruction: '' })
  assert.deepEqual(parseUseInput(' shell  read the logs '), { tool: 'shell', instruction: 'read the logs' })
})

test('catalogSample sorts and truncates with an explicit count', () => {
  assert.equal(catalogSample(['b', 'a'], 40), 'a, b')
  assert.equal(catalogSample(['c', 'a', 'b', 'd'], 2), 'a, b, … (4 total)')
})

test('/use steers with the directive when the tool is in the real catalog', async () => {
  const definitions = createRedteamCommandDefinitions(fakeCtx(LEAD_CATALOG))
  const use = definitions.find(d => d.name === 'use')
  assert.ok(use)
  const recorded = recordedAgent()
  const result = await use.handler(invocation(recorded.agent, ' mcp__redteam__engagement_launch'))
  assert.equal(result.kind, 'success')
  assert.equal(recorded.steers.length, 1)
  assert.ok(recorded.steers[0]?.includes('`mcp__redteam__engagement_launch`'))
  assert.equal(recorded.followups.length, 0)
})

test('/use rejects an unknown tool and names the real catalog', async () => {
  const definitions = createRedteamCommandDefinitions(fakeCtx(LEAD_CATALOG))
  const use = definitions.find(d => d.name === 'use')
  assert.ok(use)
  const recorded = recordedAgent()
  const result = await use.handler(invocation(recorded.agent, ' msf_exec'))
  assert.equal(result.kind, 'error')
  // msf_exec lives inside the runner, not in this seat's catalog: the
  // rejection is the honest behavior, and it lists what IS available.
  assert.ok(result.kind === 'error' && result.text.includes('Unknown tool "msf_exec"'))
  assert.ok(result.kind === 'error' && result.text.includes('mcp__redteam__engagement_launch'))
  assert.equal(recorded.steers.length, 0)
})

test('/use without a tool name returns usage plus the catalog sample', async () => {
  const definitions = createRedteamCommandDefinitions(fakeCtx(LEAD_CATALOG))
  const use = definitions.find(d => d.name === 'use')
  assert.ok(use)
  const result = await use.handler(invocation(recordedAgent().agent, ''))
  assert.equal(result.kind, 'error')
  assert.ok(result.kind === 'error' && result.text.includes('Usage: /use'))
  assert.ok(result.kind === 'error' && result.text.includes('spawn_teammate'))
})

/** Mount the real registry + session store + this plugin on one context. */
async function mount(): Promise<{ ctx: Context; recorded: RecordedAgent }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  apply(ctx)
  const session = ctx.sessions.create(SessionId('slash-commands'))
  const recorded = recordedAgent(session, session.id)
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, recorded.agent) }, { inject: ['commands'] }))
  void scope
  return { ctx, recorded }
}

test('composition: the registry lists exactly the five RedTeam commands', async () => {
  const { ctx, recorded } = await mount()
  const names = ctx.commands.list(recorded.agent).map(d => d.name)
  assert.deepEqual(names, ['report', 'scan', 'status', 'stop', 'use'])
  const scan = ctx.commands.list(recorded.agent).find(d => d.name === 'scan')
  assert.equal(scan?.input?.hint, '<target>')
})

test('composition: /scan executes through the registry and logs its lifecycle', async () => {
  const { ctx, recorded } = await mount()
  const execution = await ctx.commands.execute(recorded.agent, '/scan https://example.com', [], new AbortController().signal)
  assert.equal(execution?.result.kind, 'success')
  assert.equal(recorded.followups.length, 1)
  assert.ok(recorded.followups[0]?.includes('https://example.com'))
  assert.ok(recorded.followups[0]?.includes('engagement_launch'))
  const events = recorded.agent.session.snapshotEvents() as readonly { type: string; data: unknown }[]
  const lifecycle = events
    .filter(event => event.type === 'command/run' || event.type === 'command/done')
    .map(event => ({ type: event.type, data: event.data }))
  assert.equal(lifecycle.length, 2)
  assert.deepEqual(lifecycle[0]?.data, {
    commandId: execution?.commandId,
    name: 'scan',
    args: ' https://example.com',
    source: { kind: 'user' },
  })
  assert.equal((lifecycle[1]?.data as { kind: string }).kind, 'success')
})

test('composition: /scan without a target is a usage error and sends nothing', async () => {
  const { ctx, recorded } = await mount()
  const execution = await ctx.commands.execute(recorded.agent, '/scan', [], new AbortController().signal)
  assert.equal(execution?.result.kind, 'error')
  assert.ok(execution?.result.kind === 'error' && execution.result.text.includes('Usage: /scan'))
  assert.equal(recorded.followups.length, 0)
})

test('composition: /status and /report queue their directives', async () => {
  const { ctx, recorded } = await mount()
  const signal = new AbortController().signal
  assert.equal((await ctx.commands.execute(recorded.agent, '/status', [], signal))?.result.kind, 'success')
  assert.equal((await ctx.commands.execute(recorded.agent, '/report', [], signal))?.result.kind, 'success')
  assert.equal(recorded.followups.length, 2)
  assert.ok(recorded.followups[0]?.includes('engagement_status'))
  assert.ok(recorded.followups[1]?.includes('engagement_report'))
})

test('composition: /stop cancels the active turn and queues nothing', async () => {
  const { ctx, recorded } = await mount()
  const execution = await ctx.commands.execute(recorded.agent, '/stop', [], new AbortController().signal)
  assert.equal(execution?.result.kind, 'success')
  assert.deepEqual(recorded.cancels, [{ kind: 'user' }])
  assert.equal(recorded.followups.length, 0)
  assert.equal(recorded.steers.length, 0)
})

test('composition: /use without a tools service fails honestly, steering nothing', async () => {
  const { ctx, recorded } = await mount()
  const execution = await ctx.commands.execute(recorded.agent, '/use shell', [], new AbortController().signal)
  assert.equal(execution?.result.kind, 'error')
  assert.ok(execution?.result.kind === 'error' && execution.result.text.includes('no tool catalog service'))
  assert.equal(recorded.steers.length, 0)
})

test('composition: an unknown slash name resolves to no execution', async () => {
  const { ctx, recorded } = await mount()
  const execution = await ctx.commands.execute(recorded.agent, '/bogus hello', [], new AbortController().signal)
  assert.equal(execution, undefined)
  assert.equal(recorded.followups.length, 0)
})
