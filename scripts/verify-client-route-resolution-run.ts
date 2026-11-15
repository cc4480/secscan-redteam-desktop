/** Gate run: scan the discovered browser surface and the reference producers. */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  GATE,
  HINT,
  REFERENCE_PRODUCERS,
  repositoryRoot,
  type RouteGateFace,
  type RouteResolutionViolation,
} from './verify-client-route-resolution-rules.ts'
import { findRouteResolutionViolations } from './verify-client-route-resolution-scan.ts'
import { browserFaceSources } from './verify-client-route-resolution-sources.ts'

/** Scan one file for one face; a producer that disappeared must fail loud. */
function scan(file: string, face: RouteGateFace): RouteResolutionViolation[] {
  const path = resolve(repositoryRoot, file)
  if (face === 'reference-producer' && !existsSync(path)) {
    throw new Error(`${GATE}: browser-reference producer ${file} is gone; discovery is broken.`)
  }
  return findRouteResolutionViolations(file, readFileSync(path, 'utf8'), face)
}

/**
 * Run the browser-route gate over every discovered face.
 * Prints each violation with its repair hint and sets the exit code on failure.
 */
export function runRouteGate(): void {
  const files = browserFaceSources()
  const violations = [
    ...files.flatMap(file => scan(file, 'browser')),
    ...REFERENCE_PRODUCERS.flatMap(file => scan(file, 'reference-producer')),
  ]
  if (violations.length > 0) {
    console.error(`${GATE}: ${violations.length} app-owned route(s) that are not document-relative:`)
    for (const violation of violations) {
      console.error(
        `  ${violation.file}:${violation.line}:${violation.column} ${violation.pattern} — ${HINT[violation.rule]}`,
      )
    }
    process.exitCode = 1
    return
  }
  console.log(
    `${GATE}: ${files.length} browser source file(s) and ${REFERENCE_PRODUCERS.length} browser-reference producer(s) keep app-owned routes document-relative.`,
  )
}
