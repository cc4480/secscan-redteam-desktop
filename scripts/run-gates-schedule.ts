/**
 * Bounded in-process scheduler: claims ready gates, races their promises, and
 * records fail-fast skips.
 */
import { validateGateGraph } from './run-gates-graph.ts'
import type {
  Gate,
  GateExecutor,
  GateResult,
  GateState,
  ResultObserver,
  RunningGate,
} from './run-gates-types.ts'

/**
 * Scheduling options for one aggregate.
 */
export interface RunGatesOptions {
  /** Stop the aggregate at the first blocking gate failure. */
  failFast?: boolean
  /** Forward host SIGINT/SIGTERM to the abort path so detached gate trees are
   * terminated when the run itself is interrupted or the runner cancels it.
   * Tree termination additionally requires failFast, because only then is the
   * abort signal passed to the executor and children detached. */
  forwardProcessSignals?: boolean
}

/**
 * Validate and run one aggregate before the injected executor can start a child.
 * @param gates - complete aggregate to execute.
 * @param maxActive - maximum concurrent child count.
 * @param execute - child-process executor; receives the abort signal only when
 * fail-fast is enabled, so ordinary runs keep their children in the host
 * process group.
 * @param observe - result observer invoked when each gate settles.
 * @param options - scheduling options; fail-fast aborts the aggregate at the
 * first blocking gate failure by killing running children and skipping every
 * not-yet-run gate.
 * @returns results in aggregate order.
 */
export async function runGates(
  gates: Gate[],
  maxActive: number,
  execute: GateExecutor,
  observe: ResultObserver = () => {},
  options: RunGatesOptions = {},
): Promise<GateResult[]> {
  validateGateGraph(gates)
  if (!Number.isSafeInteger(maxActive) || maxActive < 1) {
    throw new Error(`run-gates: max concurrency must be a positive integer, got ${JSON.stringify(maxActive)}.`)
  }
  if (options.forwardProcessSignals === true && options.failFast !== true) {
    throw new Error('run-gates: forwardProcessSignals requires failFast, otherwise no child is detached or killed.')
  }
  const states = new Map<string, GateState>(gates.map(gate => [gate.id, 'pending']))
  const results = new Map<string, GateResult>()
  const running: RunningGate[] = []
  const abort = new AbortController()
  let abortCause: string | undefined
  // Host interruption (terminal Ctrl+C, runner cancellation) drains through
  // the same abort path as a gate failure, so detached trees are killed and
  // never orphaned. Handlers are removed before returning.
  const hostSignals = options.forwardProcessSignals === true ? ['SIGINT', 'SIGTERM'] as const : []
  const hostHandlers = hostSignals.map((name) => {
    const handler = () => {
      abortCause = abortCause ?? 'host interruption'
      abort.abort()
    }
    process.on(name, handler)
    return { name, handler }
  })
  const failFastSignal = options.failFast === true ? abort.signal : undefined

  try {
    for (;;) {
      let madeProgress = false
      if (abortCause === undefined) {
        while (running.length < maxActive) {
          const ready = gates.find(gate => states.get(gate.id) === 'pending' && predecessorsReady(gate, states))
          if (ready === undefined) break
          states.set(ready.id, 'running')
          running.push({ gate: ready, promise: execute(ready, failFastSignal) })
          console.log(`run-gates: start ${ready.label}`)
          madeProgress = true
        }
      }

      if (running.length === 0) {
        if (abortCause !== undefined) {
          for (const gate of gates) {
            if (states.get(gate.id) !== 'pending') continue
            const skipped = skippedByFailFast(gate, abortCause)
            states.set(gate.id, 'skipped')
            results.set(gate.id, skipped)
            observe(skipped)
          }
          break
        }
        const pending = gates.filter(gate => states.get(gate.id) === 'pending')
        if (pending.length === 0) break
        const gate = pending.find(item => (item.needs ?? []).some(id => gateFailed(states.get(id))))
        if (gate === undefined) throw new Error('run-gates: validated graph stalled without a failed dependency.')
        const failedDeps = (gate.needs ?? []).filter(id => gateFailed(states.get(id)))
        const result: GateResult = {
          gate,
          status: 'skipped',
          durationMs: 0,
          output: [],
          exitCode: null,
          signalCode: null,
          error: `dependency failed or skipped: ${failedDeps.join(', ')}`,
        }
        states.set(gate.id, 'skipped')
        results.set(gate.id, result)
        observe(result)
        continue
      }

      if (!madeProgress) {
        const settled = await Promise.race(running.map(async item => ({ item, result: await item.promise })))
        running.splice(running.indexOf(settled.item), 1)
        const observed = abortCause === undefined || settled.result.aborted !== true
          ? settled.result
          : skippedByFailFast(settled.item.gate, abortCause)
        states.set(settled.item.gate.id, observed.status)
        results.set(settled.item.gate.id, observed)
        observe(observed)
        if (abortCause === undefined && options.failFast === true
          && observed.status === 'failed' && settled.item.gate.allowFailure !== true) {
          abortCause = `${observed.gate.label} failed`
          abort.abort()
          console.error(`run-gates: fail-fast aborting: ${abortCause}.`)
          for (const gate of gates) {
            if (states.get(gate.id) !== 'pending') continue
            const skipped = skippedByFailFast(gate, abortCause)
            states.set(gate.id, 'skipped')
            results.set(gate.id, skipped)
            observe(skipped)
          }
        }
      }
    }
  } finally {
    for (const { name, handler } of hostHandlers) process.removeListener(name, handler)
  }

  return gates.map((gate) => {
    const result = results.get(gate.id)
    if (result === undefined) throw new Error(`run-gates: missing result for ${gate.id}.`)
    return result
  })
}

/**
 * The result of a gate that produced no evidence because fail-fast aborted.
 * A gate whose process settled before the abort took effect keeps its real
 * result instead: it did produce evidence, and the summary must say so. Any
 * result settling after the abort — including a genuine independent failure
 * in the race window, and a child that trapped the signal and exited zero —
 * is recorded skipped with its partial output discarded, because on Windows a
 * killed process is indistinguishable from a failed one by exit code alone.
 * @param gate - the gate that produced no evidence.
 * @param cause - the full clause naming what aborted the aggregate, e.g.
 * `typecheck failed` or `host interruption`.
 * @returns the skipped record with the fail-fast error.
 */
function skippedByFailFast(gate: Gate, cause: string): GateResult {
  return {
    gate,
    status: 'skipped',
    durationMs: 0,
    output: [],
    exitCode: null,
    signalCode: null,
    error: `aborted by fail-fast: ${cause}`,
  }
}

function predecessorsReady(gate: Gate, states: Map<string, GateState>): boolean {
  return (gate.needs ?? []).every(id => states.get(id) === 'passed')
    && (gate.after ?? []).every(id => gateSettled(states.get(id)))
}

function gateSettled(state: GateState | undefined): boolean {
  return state === 'passed' || state === 'failed' || state === 'skipped'
}

function gateFailed(state: GateState | undefined): boolean {
  return state === 'failed' || state === 'skipped'
}
