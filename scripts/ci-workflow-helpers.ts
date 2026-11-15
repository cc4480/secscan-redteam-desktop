import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import * as yaml from 'js-yaml'

/**
 * Evaluate a GitHub Actions `runs-on` selector expression.
 * @param selector - Raw selector expression, including its `${{ }}` wrapper.
 * @param context - Expression variables such as `vars`, `inputs`, `matrix`, and `github`.
 * @returns the value the selector evaluates to.
 */
export function evaluateRunsOn(selector: unknown, context: Record<string, unknown>): unknown {
  if (typeof selector !== 'string') throw new TypeError('Runner selector must be a string')
  return runInNewContext(selector.trim().slice(3, -2), context, { timeout: 1000 })
}

/** Repository root, one level above this module. */
export const root = resolve(import.meta.dirname, '..')

/** Destination that keeps the pnpm action setup private to one runner and one run. */
export const runnerPrivatePnpmDestination =
  /^\$\{\{ runner\.temp \}\}\/setup-pnpm-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}$/

/** Windows-native pnpm destination that also isolates concurrent jobs on one runner. */
export const nativeWindowsPnpmDestination = '${{ runner.temp }}/setup-pnpm-js-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}'

/**
 * Parse a workflow file from the repository.
 * @param path - Repository-relative path of the workflow file.
 * @returns the parsed workflow document.
 */
export function loadWorkflow(path: string): Record<string, unknown> {
  const workflow: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
  if (!isRecord(workflow)) throw new TypeError(`${path} must define a workflow`)
  return workflow
}

/**
 * Read one event of a workflow trigger map.
 * @param workflow - Parsed workflow document.
 * @param event - Event name to read.
 * @returns the event configuration.
 */
export function workflowEvent(workflow: Record<string, unknown>, event: string): Record<string, unknown> {
  if (!isRecord(workflow.on) || !isRecord(workflow.on[event])) {
    throw new TypeError(`workflow must define the ${event} event`)
  }
  return workflow.on[event]
}

/**
 * Read one job of a workflow.
 * @param workflow - Parsed workflow document.
 * @param job - Job id to read.
 * @returns the job definition.
 */
export function workflowJob(workflow: Record<string, unknown>, job: string): Record<string, unknown> {
  if (!isRecord(workflow.jobs) || !isRecord(workflow.jobs[job])) {
    throw new TypeError(`workflow must define the ${job} job`)
  }
  return workflow.jobs[job]
}

/**
 * Narrow a parsed YAML value to a plain object.
 * @param value - Value to test.
 * @returns whether the value is a non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
