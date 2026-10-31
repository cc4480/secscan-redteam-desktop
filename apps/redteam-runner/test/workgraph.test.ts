/**
 * A4 Deeper — persistent work-graph (Flow → Task → Subtask → Action).
 *
 * The headline proof is the executor kill/resume test: a run stopped
 * mid-graph leaves a persisted graph at a settled boundary; a fresh
 * executor over the loaded graph resumes WITHOUT re-running settled
 * subtasks, respects the recon→exploit dependency order, and runs the
 * refiner after every subtask it completes.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  addSubtask,
  buildFlowFromPlan,
  completeSubtask,
  flowNodeCount,
  flowProgress,
  nextReady,
  recordAction,
  startSubtask,
  MAX_SUBTASKS_PER_TASK,
  MAX_TASKS_PER_FLOW,
} from '../src/workgraph/graph.js'
import { loadFlow, saveFlow } from '../src/workgraph/store.js'
import { refineAfterSubtask } from '../src/workgraph/refiner.js'
import { executeFlow } from '../src/workgraph/executor.js'
import {
  completeGraphSubtask,
  ensureWorkGraph,
  graphSubtaskFor,
  startGraphSubtask,
} from '../src/workgraph/wiring.js'
import { EventLog } from '../src/events.js'
import type { Ctx } from '../src/context.js'
import type { PlanStep } from '../src/types.js'

const STEPS: PlanStep[] = [
  { phase: 'recon', attackId: 'T1595', description: 'Map the surface' },
  { phase: 'recon', attackId: 'T1589', description: 'Gather victim identity' },
  { phase: 'exploit', attackId: 'T1190', description: 'Exploit public app' },
]

function sampleFlow() {
  return buildFlowFromPlan({ engagementId: 'eng-wg', objective: 'obj', target: 'shop.example.test', steps: STEPS })
}

describe('graph — generator decomposition', () => {
  it('builds one task per plan step with structural recon→exploit dependencies', () => {
    const flow = sampleFlow()
    assert.equal(flow.tasks.length, 3)
    const exploit = flow.tasks.find(t => t.phase === 'exploit')!
    const reconIds = flow.tasks.filter(t => t.phase === 'recon').map(t => t.id)
    assert.deepEqual([...exploit.dependsOn].sort(), [...reconIds].sort())
    assert.deepEqual(nextReady(flow).map(t => t.phase), ['recon', 'recon'])
  })

  it('task ids are idempotency keys: the same plan rebuilds the same ids', () => {
    assert.deepEqual(sampleFlow().tasks.map(t => t.id), sampleFlow().tasks.map(t => t.id))
  })

  it('enforces the 15-subtask Generator cap and subtask idempotency', () => {
    const flow = sampleFlow()
    const taskId = flow.tasks[0]!.id
    const first = addSubtask(flow, taskId, { title: 'probe A', kind: 'probe' })
    assert.ok(first.ok)
    const again = addSubtask(flow, taskId, { title: 'probe A', kind: 'probe' })
    assert.ok(again.ok && again.subtask.id === (first.ok && first.subtask.id))
    for (let i = 0; i < MAX_SUBTASKS_PER_TASK - 1; i++) {
      assert.ok(addSubtask(flow, taskId, { title: `probe ${i}`, kind: 'probe' }).ok)
    }
    const over = addSubtask(flow, taskId, { title: 'one too many', kind: 'probe' })
    assert.equal(over.ok, false)
  })

  it('transitions roll up: subtask completion settles its task and counts actions', () => {
    const flow = sampleFlow()
    const task = flow.tasks[0]!
    const sub = addSubtask(flow, task.id, { title: 'probe A', kind: 'probe' })
    assert.ok(sub.ok)
    assert.equal(startSubtask(flow, sub.subtask.id), true)
    recordAction(flow, sub.subtask.id)
    recordAction(flow, sub.subtask.id)
    assert.equal(completeSubtask(flow, sub.subtask.id, 'done'), true)
    assert.equal(task.status, 'done')
    assert.equal(sub.subtask.actions, 2)
    // A settled subtask cannot transition again.
    assert.equal(startSubtask(flow, sub.subtask.id), false)
  })
})

describe('graph — flow node budget (Item 3)', () => {
  const manySteps = (n: number): PlanStep[] =>
    Array.from({ length: n }, (_, i) => ({ phase: 'recon', description: `step ${i}` }))

  it("flowNodeCount counts tasks plus every task's subtasks", () => {
    const flow = sampleFlow()
    assert.equal(flowNodeCount(flow), 3)
    const t0 = flow.tasks[0]!
    assert.ok(addSubtask(flow, t0.id, { title: 'a', kind: 'probe' }).ok)
    assert.ok(addSubtask(flow, t0.id, { title: 'b', kind: 'probe' }).ok)
    assert.ok(addSubtask(flow, flow.tasks[1]!.id, { title: 'c', kind: 'probe' }).ok)
    assert.equal(flowNodeCount(flow), 6)
  })

  it('buildFlowFromPlan accepts exactly the budget and throws one step over it', () => {
    const atBudget = buildFlowFromPlan({
      engagementId: 'eng-cap', objective: 'obj', target: 't', steps: manySteps(MAX_TASKS_PER_FLOW),
    })
    assert.equal(atBudget.tasks.length, MAX_TASKS_PER_FLOW)
    assert.throws(
      () => buildFlowFromPlan({
        engagementId: 'eng-cap', objective: 'obj', target: 't', steps: manySteps(MAX_TASKS_PER_FLOW + 1),
      }),
      new RegExp(`${MAX_TASKS_PER_FLOW}`),
    )
  })

  it('addSubtask is admitted at budget-1 and refused at budget, naming the cap', () => {
    const flow = buildFlowFromPlan({
      engagementId: 'eng-cap', objective: 'obj', target: 't', steps: manySteps(MAX_TASKS_PER_FLOW - 1),
    })
    assert.equal(flowNodeCount(flow), MAX_TASKS_PER_FLOW - 1)
    const taskId = flow.tasks[0]!.id
    const admitted = addSubtask(flow, taskId, { title: 'last node', kind: 'probe' })
    assert.ok(admitted.ok)
    assert.equal(flowNodeCount(flow), MAX_TASKS_PER_FLOW)
    const refused = addSubtask(flow, taskId, { title: 'one too many', kind: 'probe' })
    assert.equal(refused.ok, false)
    assert.ok(!refused.ok && refused.reason.includes(`${MAX_TASKS_PER_FLOW}`))
    assert.equal(flowNodeCount(flow), MAX_TASKS_PER_FLOW, 'a refusal creates nothing')
  })

  it('the per-task cap still fires first on a full task in an under-budget flow', () => {
    const flow = sampleFlow()
    const taskId = flow.tasks[0]!.id
    for (let i = 0; i < MAX_SUBTASKS_PER_TASK; i++) {
      assert.ok(addSubtask(flow, taskId, { title: `probe ${i}`, kind: 'probe' }).ok)
    }
    const over = addSubtask(flow, taskId, { title: 'one too many', kind: 'probe' })
    assert.equal(over.ok, false)
    assert.ok(!over.ok && over.reason.includes(`${MAX_SUBTASKS_PER_TASK}-subtask cap`))
  })

  it('a budget-refused refiner pass reports no change', async () => {
    const flow = buildFlowFromPlan({
      engagementId: 'eng-cap', objective: 'obj', target: 't', steps: manySteps(MAX_TASKS_PER_FLOW),
    })
    const outcome = await refineAfterSubtask(
      flow,
      { completedSubtaskId: 'x', resultSummary: '' },
      async () => ({ addSubtasks: [{ taskId: flow.tasks[0]!.id, title: 'follow-up', kind: 'probe' }] }),
    )
    assert.equal(outcome.changed, false)
    assert.deepEqual(outcome.applied, [])
    assert.equal(outcome.dropped.length, 1)
    assert.ok(outcome.dropped[0]!.reason.includes('budget'))
    assert.equal(flow.revision, 0)
  })

  it('an at-budget graph resumes and completes pending subtasks, creating nothing new', async () => {
    const dir = join(tmpdir(), `wg-budget-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      const flow = buildFlowFromPlan({
        engagementId: 'eng-cap',
        objective: 'obj',
        target: 't',
        steps: manySteps(MAX_TASKS_PER_FLOW - 2),
      })
      const host = flow.tasks[0]!
      assert.ok(addSubtask(flow, host.id, { title: 'pending A', kind: 'probe' }).ok)
      assert.ok(addSubtask(flow, host.id, { title: 'pending B', kind: 'probe' }).ok)
      assert.equal(flowNodeCount(flow), MAX_TASKS_PER_FLOW)
      saveFlow(dir, flow)

      const loaded = loadFlow(dir)
      assert.ok(loaded)
      const ran: string[] = []
      const summary = await executeFlow(loaded, {
        runSubtask: async (id) => { ran.push(id); return 'ok' },
        save: f => saveFlow(dir, f),
      })
      assert.equal(ran.length, 2, 'both pre-existing pending subtasks complete')
      assert.equal(summary.complete, true)
      assert.equal(flowNodeCount(loaded), MAX_TASKS_PER_FLOW, 'the resumed run created no new nodes')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('store — persistence', () => {
  let dir = ''
  beforeEach(() => {
    dir = join(tmpdir(), `wg-store-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('round-trips a graph through workgraph.json', () => {
    const flow = sampleFlow()
    saveFlow(dir, flow)
    const loaded = loadFlow(dir)
    assert.ok(loaded)
    assert.equal(loaded.engagementId, 'eng-wg')
    assert.deepEqual(loaded.tasks.map(t => t.id), flow.tasks.map(t => t.id))
  })

  it('returns null for a missing or corrupt graph file', () => {
    assert.equal(loadFlow(dir), null)
    writeFileSync(join(dir, 'workgraph.json'), '{not json')
    assert.equal(loadFlow(dir), null)
  })
})

describe('refiner — validated re-planning', () => {
  it('applies valid ops, drops invalid ones with reasons, bumps revision once', async () => {
    const flow = sampleFlow()
    const t0 = flow.tasks[0]!
    const doneSub = addSubtask(flow, t0.id, { title: 'finished', kind: 'probe' })
    assert.ok(doneSub.ok)
    startSubtask(flow, doneSub.subtask.id)
    completeSubtask(flow, doneSub.subtask.id, 'result')
    const pendingSub = addSubtask(flow, t0.id, { title: 'pending one', kind: 'probe' })
    assert.ok(pendingSub.ok)
    const outcome = await refineAfterSubtask(
      flow,
      { completedSubtaskId: doneSub.subtask.id, resultSummary: 'result' },
      async () => ({
        addSubtasks: [{ taskId: t0.id, title: 'follow-up', kind: 'probe' }],
        skipSubtaskIds: [pendingSub.subtask.id, doneSub.subtask.id],
        reprioritize: [
          { taskId: flow.tasks[2]!.id, priority: 42 },
          { taskId: 'task-nope', priority: 1 },
        ],
      }),
    )
    assert.equal(outcome.changed, true)
    assert.equal(flow.revision, 1)
    assert.equal(flow.refinements, 1)
    assert.equal(pendingSub.subtask.status, 'skipped')
    assert.equal(flow.tasks[2]!.priority, 42)
    // Skipping a settled subtask and reprioritizing an unknown task are dropped.
    assert.equal(outcome.dropped.length, 2)
  })

  it('a no-op pass leaves the revision untouched', async () => {
    const flow = sampleFlow()
    const outcome = await refineAfterSubtask(flow, { completedSubtaskId: 'x', resultSummary: '' }, async () => null)
    assert.equal(outcome.changed, false)
    assert.equal(flow.revision, 0)
  })
})

describe('executor — kill and resume', () => {
  let dir = ''
  beforeEach(() => {
    dir = join(tmpdir(), `wg-exec-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('resumes a stopped run without re-running settled subtasks', async () => {
    const flow = sampleFlow()
    const r1 = flow.tasks[0]!
    const r2 = flow.tasks[1]!
    const ex = flow.tasks[2]!
    addSubtask(flow, r1.id, { title: 'surface scan', kind: 'recon' })
    addSubtask(flow, r2.id, { title: 'identity pull', kind: 'recon' })
    addSubtask(flow, ex.id, { title: 'exploit attempt', kind: 'probe' })
    saveFlow(dir, flow)

    // First run: stop after the first subtask settles (the "kill").
    let stopped = false
    const firstRun: string[] = []
    const first = await executeFlow(flow, {
      runSubtask: async (id) => { firstRun.push(id); return 'ok' },
      save: f => saveFlow(dir, f),
      shouldStop: () => stopped,
      onEvent: (action) => { if (action === 'subtask_done') stopped = true },
    })
    assert.equal(first.stoppedEarly, true)
    assert.equal(firstRun.length, 1)

    // Resume: a fresh executor over the graph loaded from disk.
    const loaded = loadFlow(dir)
    assert.ok(loaded)
    const resumedRun: string[] = []
    let refineCalls = 0
    const second = await executeFlow(loaded, {
      runSubtask: async (id) => { resumedRun.push(id); return 'ok' },
      save: f => saveFlow(dir, f),
      refine: async () => { refineCalls++; return null },
    })
    assert.equal(second.complete, true)
    assert.equal(resumedRun.length, 2, 'only the two unsettled subtasks run')
    assert.ok(!resumedRun.includes(firstRun[0]!), 'the settled subtask is never re-run')
    assert.equal(refineCalls, 2, 'refiner ran after every subtask the resumed run completed')
    // Dependency order: the exploit subtask ran last.
    const exploitSub = loaded.tasks.find(t => t.phase === 'exploit')!.subtasks[0]!
    assert.equal(resumedRun[resumedRun.length - 1], exploitSub.id)
    assert.equal(flowProgress(loaded).complete, true)
  })
})

describe('wiring — plan builds the graph, relaunch resumes it', () => {
  let dir = ''
  beforeEach(() => {
    dir = join(tmpdir(), `wg-wire-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function fakeCtx(events: EventLog, refineTargetTaskId: () => string): Ctx {
    return {
      input: { target: 'shop.example.test', objective: 'obj', mode: 'red' },
      plan: { mode: 'red', objective: 'obj', adversaryProfile: 't', steps: STEPS },
      events,
      deps: {
        completeForRole: async (_role: unknown, messages: Array<{ content: string }>) => {
          const system = messages[0]?.content ?? ''
          if (system.includes('refining a penetration-test work-graph')) {
            return { text: JSON.stringify({ addSubtasks: [{ taskId: refineTargetTaskId(), title: 'refiner follow-up', kind: 'probe' }] }) }
          }
          return { text: '' }
        },
      },
    } as unknown as Ctx
  }

  it('persists the graph at plan time and resumes it on a fresh context', async () => {
    const events = new EventLog(dir, 'eng-wg', { target: 'shop.example.test', mode: 'red', objective: 'obj' })
    const holder = { id: '' }
    const ctx = fakeCtx(events, () => holder.id)
    const flow = ensureWorkGraph(ctx)
    assert.ok(flow)
    assert.equal(flow.tasks.length, 3)
    assert.ok(existsSync(join(dir, 'workgraph.json')))

    // One subtask runs to completion; the scripted refiner adds a follow-up.
    const exploitTaskId = flow.tasks.find(t => t.phase === 'exploit')!.id
    holder.id = exploitTaskId
    const sub = graphSubtaskFor(ctx, { kind: 'probe', brief: 'exploit the app', attackId: 'T1190' })
    assert.ok(sub)
    startGraphSubtask(ctx, sub.id)
    const applied = await completeGraphSubtask(ctx, sub.id, 'confirmed finding', 3)
    assert.ok(applied.some(a => a.startsWith('add ')), 'refiner follow-up applied')
    assert.equal(sub.actions, 3)
    assert.equal(sub.status, 'done')

    // Relaunch: fresh EventLog + fresh ctx over the same dir resumes.
    const events2 = EventLog.open(dir)
    const ctx2 = fakeCtx(events2, () => exploitTaskId)
    const resumed = ensureWorkGraph(ctx2)
    assert.ok(resumed)
    assert.equal(resumed.revision, 1, 'the refined graph is what resumes')
    const settled = resumed.tasks.flatMap(t => t.subtasks).filter(s => s.status === 'done')
    assert.equal(settled.length, 1, 'the completed subtask stayed settled across the relaunch')
  })
})
