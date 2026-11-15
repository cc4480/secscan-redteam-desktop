/**
 * Manifests, result records, and fixed inputs shared by the default-product isolation check and its
 * scan modules.
 */

import type { DshBundleManifest } from '../packages/util/package-manifest/src/types.ts'

/** Name prefix and directory that mark a workspace package as experimental. */
export const EXPERIMENTAL_PREFIX = '@deepseek-ai/dsh-experimental-'
// The independently published entry package owns platform-engine dependencies.
export const EXTERNAL_KIT_PACKAGES = new Set(['@deepseek-ai/libreoffice-kit'])
/** Repository-relative module that declares the installation-owned profile package lists. */
export const PROFILE_SOURCE = 'packages/boot/app-boot/src/profile.ts'
/** Shipped Web presets a default installation must reach. */
export const PRESET_PATTERN = 'packages/bundle/web-app/presets/*.patch.yml'
/** Manifest sections whose entries are part of the default product's runtime graph. */
export const RUNTIME_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const

/** One workspace package manifest, read from its `package.json`. */
export interface Manifest {
  name: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  dsh?: { bundle?: DshBundleManifest; configTrees?: Array<{ path: string }> }
}

/** A manifest paired with the directory that owns it. */
export interface Package {
  directory: string
  manifest: Manifest
}

/** Counts and violations from the default product's source and configuration inputs. */
export interface ProductIsolationResult {
  failures: string[]
  packageCount: number
  sourceCount: number
  configCount: number
  webPluginCount: number
}
