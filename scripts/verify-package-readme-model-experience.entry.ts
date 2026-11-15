/** Command entry point: scan every package README and report the gate result. */

import { globSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { checkAllowlists } from './verify-package-readme-model-experience.allowlists.ts'
import { loadToolCatalogFragments } from './verify-package-readme-model-experience.fields.ts'
import { checkPackage } from './verify-package-readme-model-experience.package.ts'
import { reportGate } from './verify-package-readme-model-experience.report.ts'
import type { Counters, Failure } from './verify-package-readme-model-experience.types.ts'

/**
 * Run the Model Experience gate over the repository that contains this script.
 * @returns Nothing; the process exits non-zero when any README fails.
 */
export function runModelExperienceGate(): void {
  const root = resolve(import.meta.dirname, '..')
  const failures: Failure[] = []
  const packageJsons = globSync('packages/*/*/package.json', { cwd: root }).map(path => path.split(sep).join('/')).sort()
  const scannedPackages = new Set(packageJsons.map(path => path.slice(0, -'/package.json'.length)))
  const counters: Counters = {
    structuredCount: 0,
    modelContextEntryCount: 0,
    omittedSectionCount: 0,
    explainedNoneCount: 0,
    indirectCount: 0,
    verbatimBlockCount: 0,
    systemPromptEntryCount: 0,
    toolSchemaEntryCount: 0,
    kvCacheEffectCount: 0,
  }

  checkAllowlists(scannedPackages, failures)
  const toolCatalogFragments = loadToolCatalogFragments(root)
  for (const packageJson of packageJsons) {
    checkPackage(packageJson, root, toolCatalogFragments, counters, failures)
  }
  reportGate(failures, root, packageJsons.length, counters)
}
