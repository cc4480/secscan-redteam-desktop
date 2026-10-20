/**
 * RE-VERIFY — the mechanical retest loop (v0.14.0).
 *
 * Takes a PoC bundle and re-executes its steps against the target to confirm
 * the finding still reproduces. Verdicts:
 *   - "reproduced"     — every replayable step re-ran and its validation
 *                         signal re-observed (fresh marker echoed / evidence
 *                         output returned).
 *   - "not-reproduced" — steps ran but the validation signal did not come
 *                         back (fixed, or the finding never reproduced this way).
 *   - "target-changed"  — a step failed on connectivity (unreachable,
 *                         refused, DNS, timeout): the environment moved, not
 *                         the vulnerability. Retest, don't celebrate.
 *
 * Only steps with structured replay parameters are re-executed
 * (ssh_exec / winrm_exec / msf_exec — the execution tools). Read-only
 * observation steps are reported as skipped: re-reading fresh enumeration
 * output is a human retest, and the report says so plainly.
 *
 * Credentials are NEVER in the bundle. Reverify resolves them fresh from
 * the environment at re-execution time — exactly like the original run.
 * A FRESH canary marker is generated per reverify run; the old marker is
 * never replayed (its echo would prove nothing about the present).
 */
import { type PocBundle, type PocStep } from './bundle.js'
export interface StepRunResult {
  ok: boolean
  output: string
  note?: string
}
/**
 * Executes one bundle step. Injected — the CLI wires the real replayer,
 * tests wire fakes. Receives a FRESH marker to use for this reverify run.
 */
export type StepRunner = (step: PocStep, freshMarker: string) => Promise<StepRunResult>
export type ReverifyVerdict = 'reproduced' | 'not-reproduced' | 'target-changed'
export interface ReverifyStepReport {
  seq: number
  tool: string
  replayed: boolean
  ok: boolean
  validationObserved: boolean
  note: string
}
export interface ReverifyReport {
  bundleId: string
  findingId: string
  engagementId: string
  reverifiedAt: string
  verdict: ReverifyVerdict
  steps: ReverifyStepReport[]
  summary: string
  /** What the operator should do with this result (registry before/after). */
  registryNote: string
}
/**
 * Re-execute a bundle's steps. Pure orchestration over an injected
 * StepRunner — the verdict logic is fully testable without a network.
 */
export declare function reverifyBundle(bundle: PocBundle, runner: StepRunner, opts?: {
  perStepTimeoutMs?: number
}): Promise<ReverifyReport>
export interface ReplayerOptions {
  /** Exact in-scope hosts. The executors enforce this mechanically. */
  scope: string[]
  env?: NodeJS.ProcessEnv
  killSwitch?: {
    aborted: boolean
  }
  perStepTimeoutMs?: number
}
/**
 * Production StepRunner: replays bundle steps through the real executors.
 * Scope is enforced by the executors themselves (fail closed); credentials
 * resolve fresh from env; the kill switch aborts via SIGINT wiring in the CLI.
 */
export declare function createReplayer(opts: ReplayerOptions): StepRunner
