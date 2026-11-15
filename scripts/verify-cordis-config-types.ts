/** Manifest and plugin-reference records shared by the verify-cordis-config checks. */

import type { DshBundleManifest } from '../packages/util/package-manifest/src/types.ts'

export interface PackageManifest {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  dsh?: { bundle?: DshBundleManifest }
}

export interface PluginReference {
  file: string
  name: string
}
