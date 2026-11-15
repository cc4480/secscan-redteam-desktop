/**
 * CLI entrypoint: parse the requested aggregate, apply its worker environment,
 * run it, and print the per-gate and aggregate diagnostics.
 */
import { performance } from 'node:perf_hooks'
import {
  ciWorkerEnvironment,
  concurrencyFromEnv,
  defaultConcurrency,
  flagEnabled,
} from './run-gates-environment.ts'
import { runGate } from './run-gates-exec.ts'
import { gatesForMode } from './run-gates-modes.ts'
import { runGates, type RunGatesOptions } from './run-gates-schedule.ts'
import type { GateOutputChunk, GateResult, Mode } from './run-gates-types.ts'

/**
 * Run one aggregate named on the command line.
 * @param args - arguments after the script name; the first names the aggregate.
 * @returns the process exit code for the aggregate.
 */
export async function main(args: string[]): Promise<number> {
  const mode = parseMode(args[0])
  const workerEnv = ciWorkerEnvironment(mode, process.env)
  Object.assign(process.env, workerEnv)
  if (Object.keys(workerEnv).length > 0) console.log(`run-gates: worker settings ${JSON.stringify(workerEnv)}`)
  const gates = gatesForMode(mode)
  const concurrencyDefault = defaultConcurrency(mode, gates.length)
  const concurrencyOverride = process.env.DSH_GATE_CONCURRENCY
  const maxConcurrency = concurrencyFromEnv('DSH_GATE_CONCURRENCY', concurrencyDefault.workers)
  const concurrencySource = concurrencyOverride === undefined || concurrencyOverride === ''
    ? concurrencyDefault.source
    : '$DSH_GATE_CONCURRENCY'
  const failFast = flagEnabled('DSH_GATE_FAIL_FAST')
  const startedAt = performance.now()
  console.log(`run-gates: ${mode} running ${gates.length} gate(s) with ${maxConcurrency} worker(s) from ${concurrencySource}${failFast ? ', fail-fast after first blocking failure' : ''}.`)

  const results = await runGates(gates, maxConcurrency, runGate, printResult, cliGateOptions(failFast))
  printSummary(results, performance.now() - startedAt)
  return results.some(result => result.gate.allowFailure !== true && (result.status === 'failed' || result.status === 'skipped'))
    ? 1
    : 0
}

function parseMode(raw: string | undefined): Mode {
  switch (raw) {
    case 'ci-primary':
    case 'ci-linux-primary':
    case 'ci-static':
    case 'ci-lint-contracts-ready':
    case 'ci-coverage':
    case 'ci-bench':
    case 'ci-snapshot':
    case 'ci-artifacts':
    case 'ci-consumers':
    case 'ci-windows-blocking':
    case 'ci-windows-complete':
    case 'ci-windows-observational-ready':
    case 'node-compat':
    case 'check-all':
    case 'hygiene':
    case 'doc-sync':
    case 'doc-quick':
      return raw
    default:
      throw new Error(
        `run-gates: expected mode ci-primary | ci-linux-primary | ci-static | ci-lint-contracts-ready | ci-coverage | ci-bench | ci-snapshot | ci-artifacts | ci-consumers | ci-windows-blocking | ci-windows-complete | ci-windows-observational-ready | node-compat | check-all | hygiene | doc-sync | doc-quick, got ${JSON.stringify(raw)}.`,
      )
  }
}

/**
 * The options the CLI entrypoint hands to the scheduler. Host signal
 * forwarding always follows fail-fast: children are detached only then, so
 * without it the forwarding would have no tree to drain.
 * @param failFast - whether `DSH_GATE_FAIL_FAST` is enabled.
 * @returns the scheduler options for the entrypoint.
 */
export function cliGateOptions(failFast: boolean): RunGatesOptions {
  return { failFast, forwardProcessSignals: failFast }
}

/**
 * Format every independently observed failure fact for the aggregate summary.
 * @param result - unsuccessful gate result.
 * @returns error, exit, and signal facts without allowing one to hide another.
 */
export function formatGateResultReason(result: GateResult): string {
  const facts: string[] = []
  if (result.error !== undefined) facts.push(result.error)
  if (result.exitCode !== null) facts.push(`exit ${result.exitCode}`)
  if (result.signalCode !== null) facts.push(`signal ${result.signalCode}`)
  return facts.length === 0 ? 'no exit code or signal' : facts.join(', ')
}

function printResult(result: GateResult): void {
  const verbose = process.env.DSH_GATE_VERBOSE === '1'
  const seconds = (result.durationMs / 1000).toFixed(2)
  if (result.status === 'passed' && !verbose) {
    console.log(`run-gates: PASS ${result.gate.label} (${seconds}s)`)
    return
  }

  const heading = `${result.status.toUpperCase()} ${result.gate.label} (${seconds}s)`
  const writeHeading = result.status === 'passed' ? console.log : console.error
  writeHeading(`\n== ${heading} ==`)
  if (result.status !== 'passed') {
    console.error(`command: ${result.gate.displayCommand}`)
    console.error(`outcome: ${formatGateResultReason(result)}`)
  }
  if (result.gate.streamOutput !== true) printOutput(result.output)
}

function printSummary(results: GateResult[], durationMs: number): void {
  const passed = results.filter(result => result.status === 'passed').length
  const failed = results.filter(result => result.status === 'failed').length
  const skipped = results.filter(result => result.status === 'skipped').length
  const seconds = (durationMs / 1000).toFixed(2)
  console.log(`\nrun-gates: ${passed} passed, ${failed} failed, ${skipped} skipped in ${seconds}s.`)

  const unsuccessful = results.filter(result => result.status === 'failed' || result.status === 'skipped')
  if (unsuccessful.length === 0) return

  console.error('run-gates: unsuccessful gates:')
  for (const result of unsuccessful) {
    const duration = (result.durationMs / 1000).toFixed(2)
    const reason = formatGateResultReason(result)
    const disposition = result.gate.allowFailure === true ? 'NON-BLOCKING ' : ''
    console.error(`  - ${disposition}${result.status.toUpperCase()} ${result.gate.label} (${duration}s, ${reason})`)
    console.error(`    ${result.gate.displayCommand}`)
  }
}

function printOutput(output: GateOutputChunk[]): void {
  for (const chunk of output) {
    if (chunk.stream === 'stdout') process.stdout.write(chunk.text)
    else process.stderr.write(chunk.text)
  }
}
