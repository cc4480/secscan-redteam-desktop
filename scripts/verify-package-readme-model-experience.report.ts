/** Final summary and exit status for the package README Model Experience gate. */

import { relative, resolve } from 'node:path'
import type { Counters, Failure } from './verify-package-readme-model-experience.types.ts'

/**
 * Print the gate's summary or its failures and end the process.
 * @param failures - every failure the walk recorded.
 * @param root - repository root the failure paths resolve against.
 * @param readmeCount - number of READMEs the walk inspected.
 * @param counters - the tallies the summary reports.
 */
export function reportGate(failures: readonly Failure[], root: string, readmeCount: number, counters: Counters): void {
  if (failures.length === 0) {
    console.log(`verify-package-readme-model-experience: ${readmeCount} README(s) checked (${counters.omittedSectionCount} audited omissions, ${counters.structuredCount} structured, ${counters.modelContextEntryCount} model-context entries, ${counters.kvCacheEffectCount} KV-cache fields, ${counters.systemPromptEntryCount} fenced system-prompt entries, ${counters.toolSchemaEntryCount} catalog-linked tool-schema entries, ${counters.explainedNoneCount} explained none, ${counters.indirectCount} indirect, ${counters.verbatimBlockCount} verbatim markdown blocks), all conform.`)
    process.exit(0)
  }

  console.error('verify-package-readme-model-experience failed:')
  for (const failure of failures) {
    console.error(`  ${relative(root, resolve(root, failure.path))}: ${failure.message}`)
  }
  process.exit(1)
}
