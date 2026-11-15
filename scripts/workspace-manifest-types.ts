/** Manifest types shared by the workspace constraint checks. */

import type { DshBundleManifest } from '../packages/util/package-manifest/src/types.ts'

/** The subset of package.json fields this constraint check cares about. */
export interface PackageManifest {
  name?: string
  version?: string
  private?: boolean
  type?: string
  main?: string
  types?: string
  bin?: string | Record<string, string>
  exports?: Record<
    string,
    | string
    | {
      types?: string
      default?: string
    }
    | null
    | undefined
  >
  files?: string[]
  icon?: string
  publishConfig?: { access?: string }
  repository?: { type?: string; url?: string; directory?: string }
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  dsh?: {
    bundle?: DshBundleManifest
  }
}

/** One workspace manifest and its repo-relative path. */
export interface WorkspaceManifest {
  dir: string
  manifest: PackageManifest
}
