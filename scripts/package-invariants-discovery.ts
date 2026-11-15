/** Package-tree discovery for the package-invariant gate. */

import { existsSync, globSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { readManifest } from './package-invariants-model.ts'
import type { PackageInvariantOwner } from './package-invariants-model.ts'

/** Discover packages that own an invariant companion. */
export function packageInvariantOwners(root: string): PackageInvariantOwner[] {
  return packageInvariantPackages(root)
    .filter(owner => existsSync(resolve(root, owner.sourcePath)))
}

/**
 * Discover every package under the repository package tree.
 * @param root - Repository root.
 * @returns every package with its candidate companion paths.
 */
export function packageInvariantPackages(root: string): PackageInvariantOwner[] {
  return globSync('packages/*/*/package.json', { cwd: root })
    .map(path => path.split(sep).join('/'))
    .sort()
    .map((manifestPath) => {
      const manifest = readManifest(resolve(root, manifestPath))
      if (manifest.name === undefined || manifest.name === '') {
        throw new Error(`${manifestPath}: package invariant owner must declare a package name`)
      }
      const dir = dirname(manifestPath)
      return {
        dir,
        manifestPath,
        sourcePath: `${dir}/src/invariant.ts`,
        packageName: manifest.name,
      }
    })
}
