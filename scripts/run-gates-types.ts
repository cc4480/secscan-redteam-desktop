/**
 * Shared declarations for the gate runner: aggregate names, gate descriptors,
 * observed results, and the injected executor and observer signatures.
 */

/** A named aggregate exposed by the gate runner. */
export type Mode =
  | 'ci-primary'
  | 'ci-linux-primary'
  | 'ci-static'
  | 'ci-lint-contracts-ready'
  | 'ci-coverage'
  | 'ci-bench'
  | 'ci-snapshot'
  | 'ci-artifacts'
  | 'ci-consumers'
  | 'ci-windows-blocking'
  | 'ci-windows-complete'
  | 'ci-windows-observational-ready'
  | 'node-compat'
  | 'check-all'
  | 'hygiene'
  | 'doc-sync'
  | 'doc-quick'

/** Settled outcome recorded for one gate. */
export type GateResultStatus = 'passed' | 'failed' | 'skipped'

/** Scheduler state of one gate inside its aggregate. */
export type GateState = 'pending' | 'running' | GateResultStatus

/** A command and its dependency metadata inside one aggregate. */
export interface Gate {
  id: string
  label: string
  displayCommand: string
  command: string
  args: string[]
  needs?: string[]
  /** Gate ids that must settle, regardless of outcome, before this gate starts. */
  after?: string[]
  env?: Record<string, string | undefined>
  /** Include this leaf in the build-free documentation aggregate. */
  quick?: boolean
  /** Keep a failure visible without failing the aggregate. */
  allowFailure?: boolean
  /** Write child output as it arrives instead of buffering it until completion. */
  streamOutput?: boolean
}

/** The observed outcome of one gate process. */
export interface GateResult {
  gate: Gate
  status: GateResultStatus
  durationMs: number
  output: GateOutputChunk[]
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  error?: string
  /** True when the shared abort signal terminated this gate before its outcome
   * was observed; such a result must not be reported as passed, even if the
   * child trapped the signal and exited zero. */
  aborted?: boolean
}

/** One stdout or stderr chunk buffered from a gate process. */
export interface GateOutputChunk {
  stream: 'stdout' | 'stderr'
  text: string
}

/** One gate currently executing inside the scheduler. */
export interface RunningGate {
  gate: Gate
  promise: Promise<GateResult>
}

/** The default worker count for one aggregate and the source that produced it. */
export interface ConcurrencyDefault {
  workers: number
  source: string
}

/**
 * Execute one gate.
 * @param gate - command and scheduler environment to execute.
 * @param signal - abort signal that terminates the gate's process tree.
 * @returns the complete process outcome.
 */
export type GateExecutor = (gate: Gate, signal?: AbortSignal) => Promise<GateResult>

/**
 * Receive each gate result as it settles.
 * @param result - the settled gate outcome.
 * @returns nothing.
 */
export type ResultObserver = (result: GateResult) => void
