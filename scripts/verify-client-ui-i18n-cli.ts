/**
 * Command-line pass over every discovered Client UI source.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { findUiI18nViolations } from './verify-client-ui-i18n-detect.ts'
import { clientUiRoot, sourceFiles } from './verify-client-ui-i18n-tree.ts'

const MINIMUM_CLIENT_UI_SOURCES = 450

/**
 * Report hard-coded product copy, setting a failing exit code on any violation.
 */
export function runClientUiI18nCheck(): void {
  const files = sourceFiles()
  if (files.length < MINIMUM_CLIENT_UI_SOURCES) {
    throw new Error(
      `verify-client-ui-i18n: discovery narrowed to ${files.length} source file(s); expected at least ${MINIMUM_CLIENT_UI_SOURCES}.`,
    )
  }
  const violations = files.flatMap(file =>
    findUiI18nViolations(file, readFileSync(resolve(clientUiRoot, file), 'utf8')))
  if (violations.length > 0) {
    console.error(`verify-client-ui-i18n: ${violations.length} hard-coded UI string(s):`)
    for (const violation of violations) {
      console.error(
        `  ${violation.file}:${violation.line}:${violation.column} ${violation.reason}: ${JSON.stringify(violation.text)}`,
      )
    }
    process.exitCode = 1
    return
  }
  console.log(`verify-client-ui-i18n: ${files.length} Client UI source file(s) use locale-owned copy.`)
}
