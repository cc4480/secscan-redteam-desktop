/**
 * S2-H7 — per-gate redirect budgets.
 *
 * The defect (comm-flow audit slice 2, Hop 7; reproduced on or12): a single
 * scalar `ctx.redirects` (budget 2) was shared by all three phase-gate
 * sign-offs (plan→recon / recon→exploit / exploit→report) AND the exploit
 * wall redirect in the agents layer. Recon's two redirects — burned on an
 * infrastructure blocker the fleet could not fix — left exploit→report's
 * first REDIRECT nowhere to go: the gate threw HaltError before the
 * redirect's corrective work ran, and the halt message attributed the
 * shared count to the current transition.
 *
 * The fix: `ctx.redirects` is a record keyed by transition, each gate with
 * its own budget of 2; the wall redirect spends from its own counter
 * (`ctx.wallRedirects`, budget 2); the halt message and the sign-off
 * prompt report the gate-local count.
 *
 * These tests drive the real coordinatorSignOff and the real agentLoop
 * wall path through the scripted completion seam (the directive-failure /
 * reflector fixture shape).
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ChatResult } from '@secscan/redteam-llm-router'
import { coordinatorSignOff } from '../src/phases/signoff.js'
import { agentLoop } from '../src/agents.js'
import { EventLog, readEvents } from '../src/events.js'
import type { EngagementEvent } from '../src/types.js'
import { HaltError, type Ctx } from '../src/context.js'
import type { SignOffTransition } from '../src/phases/exploit-one.js'

let dir = ''
beforeEach(() => {
  dir = join(tmpdir(), `signoff-redirect-budget-${process.pid}-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const noRedirects = (): Record<SignOffTransition, number> => ({
  'plan→recon': 0,
  'recon→exploit': 0,
  'exploit→report': 0,
})

type CompleteFn = (
  role: unknown,
  messages: Array<{ role: string; content: string }>,
  opts?: { responseFormat?: { type: string } },
) => Promise<ChatResult>

const reply = (text: string): ChatResult => ({ text, toolCalls: [], provider: 'fake', model: 'fake' })

/** A loop-ready fake Ctx (directive-failure / struct-adoption shape). */
function makeCtx(eventsDir: string, completeForRole: CompleteFn, redirects: Record<SignOffTransition, number>, wallRedirects = 0): Ctx {
  return {
    actions: 0,
    consecutive5xx: 0,
    deniedStreak: 0,
    redirects,
    wallRedirects,
    startedAt: Date.now(),
    hosts: ['shop.example.test'],
    domain: 'shop.example.test',
    config: { maxActions: 1000, maxDurationMs: 60_000, dryRunAgents: false, localSandbox: false },
    input: {
      target: 'https://shop.example.test',
      mode: 'red',
      objective: 'assess the shop',
      roe: { blackoutWindows: [], scope: ['shop.example.test'] },
      fullBattery: false,
    },
    deps: { completeForRole },
    events: new EventLog(eventsDir, 'eng-signoff-redirect-budget', {
      target: 'shop.example.test',
      mode: 'red',
      objective: 'assess the shop',
    }),
    coverage: new Set(),
    targetCoverage: new Map(),
    itemLedger: new Map(),
    registryHits: [],
    probesUsed: 0,
    opsecCooldown: new Set(),
    liveFindings: [],
    killedLive: [],
    targetMap: [],
    plan: null,
    fingerprint: { stack: [], appType: 'unknown' },
    tier: { current: 0, chainSteps: new Map<string, number>() },
    safety: { killSwitchAborts: 0 },
    hostKill: { aborted: false, controllers: new Set<AbortController>() },
  } as unknown as Ctx
}

function eventsOf(action: string): EngagementEvent[] {
  return readEvents(dir).filter(e => e.action === action)
}

/**
 * A completion seam that answers sign-off reviews from a per-transition
 * reply script (the last reply repeats), answers every corrective-work
 * loop with plain text, and records the sign-off system prompts it saw.
 * After six REDIRECT replies at one gate it answers SIGN-OFF so a broken
 * budget (one that never halts) terminates instead of looping forever.
 */
function signOffScript(script: Partial<Record<SignOffTransition, string[]>>): {
  completeForRole: CompleteFn
  signOffSystems: string[]
} {
  const signOffSystems: string[] = []
  const calls = new Map<SignOffTransition, number>()
  const completeForRole: CompleteFn = async (_role, messages) => {
    const userText = messages.filter(m => m.role === 'user').map(m => m.content).join('\n')
    const m = userText.match(/Transition awaiting sign-off: (\S+)/)
    if (m) {
      signOffSystems.push(messages.filter(x => x.role === 'system').map(x => x.content).join('\n'))
      const transition = m[1] as SignOffTransition
      const n = (calls.get(transition) ?? 0) + 1
      calls.set(transition, n)
      if (n > 6) return reply('SIGN-OFF: forced stop')
      const queue = script[transition] ?? ['SIGN-OFF: approved']
      return reply(queue[Math.min(n - 1, queue.length - 1)]!)
    }
    return reply('corrective work done')
  }
  return { completeForRole, signOffSystems }
}

describe('coordinatorSignOff — per-gate redirect budgets (S2-H7)', () => {
  it("one gate's exhausted budget does not halt a different gate's first REDIRECT, and its corrective work runs", async () => {
    // or12's shape: recon→exploit burned both its redirects on an
    // infrastructure blocker; exploit→report's first REDIRECT must still
    // be funded from its own gate budget.
    const { completeForRole, signOffSystems } = signOffScript({
      'exploit→report': ['REDIRECT: zero tasks cannot advance to report', 'SIGN-OFF: approved'],
    })
    const redirects = { ...noRedirects(), 'recon→exploit': 2 }
    const ctx = makeCtx(dir, completeForRole, redirects)

    await coordinatorSignOff(ctx, 'exploit→report', () => 'exploit summary payload')

    assert.equal(ctx.redirects['exploit→report'], 1, "the gate spent from its OWN budget")
    assert.equal(ctx.redirects['recon→exploit'], 2, "the other gate's count is untouched")
    assert.equal(ctx.wallRedirects, 0, 'a sign-off redirect never spends the wall budget')
    assert.equal(eventsOf('redirect_exploit').length, 1, "the redirect's corrective work ran")
    assert.equal(eventsOf('signoff').length, 1, 'the gate then signed off')
    // The sign-off prompt tells the truth about the budget: per gate, and
    // this gate's own used count (0 at first review — not the shared 2).
    assert.match(signOffSystems[0] ?? '', /at most 2 redirects per gate/)
    assert.match(signOffSystems[0] ?? '', /used: 0/)
  })

  it('an exhausted gate halts on its own count: the message names that gate and its own 2 redirects, before any corrective work', async () => {
    const { completeForRole } = signOffScript({
      'exploit→report': ['REDIRECT: zero tasks cannot advance to report'],
    })
    const redirects = { ...noRedirects(), 'exploit→report': 2 }
    const ctx = makeCtx(dir, completeForRole, redirects)

    await assert.rejects(
      coordinatorSignOff(ctx, 'exploit→report', () => 'exploit summary payload'),
      (err: unknown) => {
        assert.ok(err instanceof HaltError, 'the gate halts with HaltError')
        assert.match(err.message, /exploit→report/, 'the halt names the gate')
        assert.match(err.message, /after 2 redirects/, "the halt reports that gate's own count")
        return true
      },
    )
    assert.equal(ctx.redirects['exploit→report'], 2, 'a halted redirect spends nothing further')
    assert.equal(eventsOf('redirect_exploit').length, 0, 'no corrective work runs once the gate budget is spent')
  })

  it('a fresh gate funds exactly two redirects, then halts on the third', async () => {
    const { completeForRole } = signOffScript({
      'exploit→report': ['REDIRECT: more work needed'],
    })
    const ctx = makeCtx(dir, completeForRole, noRedirects())

    await assert.rejects(
      coordinatorSignOff(ctx, 'exploit→report', () => 'exploit summary payload'),
      (err: unknown) => err instanceof HaltError && /exploit→report/.test(err.message) && /after 2 redirects/.test(err.message),
    )
    assert.equal(ctx.redirects['exploit→report'], 2, 'the gate stopped at its own budget of 2')
    assert.equal(eventsOf('redirect_exploit').length, 2, 'both funded redirects ran their corrective work')
    assert.equal(ctx.redirects['recon→exploit'], 0, 'no other gate was touched')
  })
})

// ---------------------------------------------------------------------------
// The wall redirect (agents layer) — its own counter, never the gates'.
// Mirrors reflector.test.ts's wall drive: denied batches of unknown-tool
// calls in the exploit phase, reflection disabled so the wall is reached
// on the first wall batch.
// ---------------------------------------------------------------------------

const USAGE = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
const idleTurn: ChatResult = { text: 'done', toolCalls: [], provider: 'fake', model: 'fake', usage: USAGE }

function deniedBatch(n: number): ChatResult {
  return {
    text: '',
    toolCalls: Array.from({ length: n }, (_, i) => ({
      id: `c-${Date.now()}-${i}-${Math.random()}`,
      name: 'no_such_tool',
      arguments: {},
    })),
    provider: 'fake',
    model: 'fake',
    usage: USAGE,
  }
}

function wallModel(): CompleteFn {
  return async (_role, messages) => {
    const texts = messages.map(m => m.content)
    if (texts.some(t => t.includes('COMMANDER REDIRECT — focused re-recon'))) return idleTurn
    if (texts.some(t => t.startsWith('COMMANDER REDIRECT — re-recon complete'))) return idleTurn
    return deniedBatch(4)
  }
}

describe('agentLoop wall redirect — its own budget (S2-H7)', () => {
  it('the wall redirect spends the wall counter only — no sign-off gate budget is consumed', async () => {
    const ctx = makeCtx(dir, wallModel(), noRedirects())
    await agentLoop(ctx, 'exploiter', 'exploit', 's', 'u', [], 12, { reflectorCap: 0 })
    assert.equal(eventsOf('redirect_rerecon').length, 1, 'the wall redirect fired')
    assert.equal(ctx.wallRedirects, 1, 'the wall counter paid for it')
    assert.deepEqual(ctx.redirects, noRedirects(), 'every sign-off gate budget is untouched')
  })

  it('exhausted sign-off gates do not suppress the wall redirect', async () => {
    const allSpent: Record<SignOffTransition, number> = {
      'plan→recon': 2,
      'recon→exploit': 2,
      'exploit→report': 2,
    }
    const ctx = makeCtx(dir, wallModel(), { ...allSpent })
    await agentLoop(ctx, 'exploiter', 'exploit', 's', 'u', [], 12, { reflectorCap: 0 })
    assert.equal(eventsOf('redirect_rerecon').length, 1, 'the wall redirect still fires on its own budget')
    assert.equal(ctx.wallRedirects, 1)
    assert.deepEqual(ctx.redirects, allSpent, 'the wall redirect spent no gate budget')
  })

  it("the wall redirect stops at its own budget of 2 even when every gate budget is fresh", async () => {
    const ctx = makeCtx(dir, wallModel(), noRedirects(), 2)
    await agentLoop(ctx, 'exploiter', 'exploit', 's', 'u', [], 6, { reflectorCap: 0 })
    assert.equal(eventsOf('redirect_rerecon').length, 0, 'no wall redirect once the wall budget is spent')
    assert.equal(ctx.wallRedirects, 2, 'the wall counter is unchanged')
    assert.deepEqual(ctx.redirects, noRedirects(), 'gate budgets are untouched')
  })
})
