/** The gate run: every config file's entries plus every resolution check, then the report. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cordisConfigFiles } from './cordis-config-files.ts'
import { loadCordisYaml } from './cordis-yaml.ts'
import { validateAppResolution } from './verify-cordis-config-bundles.ts'
import { validateEntry } from './verify-cordis-config-entries.ts'
import { packageTestFixtureDependencyErrors, validatePackageTestResolution } from './verify-cordis-config-package-tests.ts'
import { validateClientHalvesDeclared, validatePresetPlaneSeparation } from './verify-cordis-config-presets.ts'
import { errors, isUnknownArray, root } from './verify-cordis-config-shared.ts'
import { validateSourcePlaneResolution } from './verify-cordis-config-source-plane.ts'

/** Run every Loader metadata and plugin resolution check, reporting one line each. */
export function runVerification(): void {
  const files = cordisConfigFiles(root)

  for (const file of files) {
    const document = loadCordisYaml(readFileSync(resolve(root, file), 'utf8'))
    if (!isUnknownArray(document)) {
      errors.push(`${file}: root must be a Loader entry array`)
      continue
    }
    for (let index = 0; index < document.length; index++) {
      validateEntry(document[index], file, `[${index}]`)
    }
  }

  errors.push(...validateAppResolution())
  errors.push(...validatePackageTestResolution())
  errors.push(...packageTestFixtureDependencyErrors())
  errors.push(...validateSourcePlaneResolution())
  errors.push(...validatePresetPlaneSeparation())
  errors.push(...validateClientHalvesDeclared())

  if (errors.length > 0) {
    console.error('verify-cordis-config: invalid Loader metadata or plugin package resolution:')
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
  } else {
    console.log(`verify-cordis-config: ${files.length} config files passed.`)
  }
}
