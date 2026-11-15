/** The immutable local release bundle consumed by publish and verify. */

import { readdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, normalize, resolve } from 'node:path'
import type { CommandRunner } from './publish-npm-baseline-command.ts'
import { expectString, normalizeRegistry, readObject } from './publish-npm-baseline-json.ts'
import type { PackedPackage } from './publish-npm-baseline-tarball.ts'
import {
  containsWorkspaceProtocol,
  inspectTarball,
  packedPackage,
  parsePackedPackage,
  validateInternalDependencyPins,
} from './publish-npm-baseline-tarball.ts'
import type { PackageTarget } from './publish-npm-baseline-workspace.ts'
import { validateTarballPayload } from './publication-payload.ts'

/** File name of the manifest that records one release bundle. */
export const RELEASE_MANIFEST_NAME = 'manifest.json'

/** Identity and contents of one local release bundle. */
export interface ReleaseManifest {
  schemaVersion: 1
  commit: string
  version: string
  distTag: string
  registry: string
  packages: PackedPackage[]
}

/** Immutable local release bundle consumed by publish and verify. */
export class ReleaseBundle {
  private constructor(
    readonly directory: string,
    readonly manifest: ReleaseManifest,
  ) {}

  /**
   * Record and verify the tarballs a pack run produced.
   * @param directory - directory holding the packed tarballs.
   * @param expectedPackages - the packages the baseline selected.
   * @param commit - the commit the bundle was packed from.
   * @param version - the release version every package carries.
   * @param distTag - the dist-tag the release publishes under.
   * @param registry - the registry the release publishes to.
   * @param runner - runner used for the `tar` reads.
   * @returns the written bundle.
   */
  static create(
    directory: string,
    expectedPackages: PackageTarget[],
    commit: string,
    version: string,
    distTag: string,
    registry: string,
    runner: CommandRunner,
  ): ReleaseBundle {
    const internalNames = new Set(expectedPackages.map(pkg => pkg.name))
    const expectedByName = new Map(expectedPackages.map(pkg => [pkg.name, pkg]))
    const missingNames = new Set(internalNames)
    const packages = readdirSync(directory)
      .filter(name => name.endsWith('.tgz'))
      .sort()
      .map((tarball) => {
        const artifact = inspectTarball(resolve(directory, tarball), runner)
        const expected = expectedByName.get(artifact.name)
        if (expected === undefined || !missingNames.delete(artifact.name)) {
          throw new Error(`unexpected or duplicate packed package: ${artifact.name}`)
        }
        if (expected.origin === 'harness') {
          validateTarballPayload(artifact.files, tarball)
        }
        if (artifact.version !== version) {
          throw new Error(`${tarball} has version ${artifact.version}; expected ${version}`)
        }
        if (artifact.private === true) throw new Error(`${tarball} is still private`)
        if (containsWorkspaceProtocol(artifact.manifest)) {
          throw new Error(`${tarball} still contains a workspace: dependency`)
        }
        validateInternalDependencyPins(artifact.manifest, internalNames, version, tarball)
        return packedPackage(artifact.name, resolve(directory, tarball), expected.origin)
      })
      .sort((left, right) => left.name.localeCompare(right.name))

    if (missingNames.size !== 0) {
      throw new Error(`missing tarballs for: ${[...missingNames].sort().join(', ')}`)
    }
    const manifest: ReleaseManifest = {
      schemaVersion: 1,
      commit,
      version,
      distTag,
      registry,
      packages,
    }
    writeFileSync(resolve(directory, RELEASE_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`)
    writeFileSync(
      resolve(directory, 'SHA256SUMS'),
      `${packages.map(pkg => `${pkg.sha256}  ${pkg.tarball}`).join('\n')}\n`,
    )
    return new ReleaseBundle(directory, manifest)
  }

  /**
   * Load one recorded bundle and verify it against its own tarballs.
   * @param manifestPath - path of the release manifest.
   * @param runner - runner used for the `tar` reads.
   * @returns the verified bundle.
   */
  static load(manifestPath: string, runner: CommandRunner): ReleaseBundle {
    const absoluteManifestPath = resolve(manifestPath)
    const raw = readObject(absoluteManifestPath)
    if (raw.schemaVersion !== 1) {
      throw new Error(`unsupported release manifest schema: ${String(raw.schemaVersion)}`)
    }
    const directory = dirname(absoluteManifestPath)
    const packageValues = raw.packages
    if (!Array.isArray(packageValues) || packageValues.length === 0) {
      throw new Error('release manifest contains no packages')
    }
    const packages = packageValues.map((value, index) => parsePackedPackage(value, index))
    const names = new Set<string>()
    for (const pkg of packages) {
      if (names.has(pkg.name)) throw new Error(`duplicate package in release manifest: ${pkg.name}`)
      names.add(pkg.name)
    }
    const manifest: ReleaseManifest = {
      schemaVersion: 1,
      commit: expectString(raw, 'commit', RELEASE_MANIFEST_NAME),
      version: expectString(raw, 'version', RELEASE_MANIFEST_NAME),
      distTag: expectString(raw, 'distTag', RELEASE_MANIFEST_NAME),
      registry: normalizeRegistry(expectString(raw, 'registry', RELEASE_MANIFEST_NAME)),
      packages,
    }
    const bundle = new ReleaseBundle(directory, manifest)
    bundle.verifyLocal(runner)
    return bundle
  }

  private verifyLocal(runner: CommandRunner): void {
    const internalNames = new Set(this.manifest.packages.map(pkg => pkg.name))
    for (const pkg of this.manifest.packages) {
      if (isAbsolute(pkg.tarball) || dirname(pkg.tarball) !== '.' || normalize(pkg.tarball) !== pkg.tarball) {
        throw new Error(`invalid tarball path for ${pkg.name}: ${pkg.tarball}`)
      }
      const path = resolve(this.directory, pkg.tarball)
      const actual = packedPackage(pkg.name, path, pkg.origin)
      if (actual.sha256 !== pkg.sha256 || actual.integrity !== pkg.integrity) {
        throw new Error(`tarball checksum mismatch: ${pkg.tarball}`)
      }
      const artifact = inspectTarball(path, runner)
      if (pkg.origin === 'harness') {
        validateTarballPayload(artifact.files, pkg.tarball)
      }
      if (artifact.name !== pkg.name || artifact.version !== this.manifest.version) {
        throw new Error(`tarball identity mismatch: ${pkg.tarball}`)
      }
      if (artifact.private === true) throw new Error(`${pkg.tarball} is still private`)
      if (containsWorkspaceProtocol(artifact.manifest)) {
        throw new Error(`${pkg.tarball} still contains a workspace: dependency`)
      }
      validateInternalDependencyPins(
        artifact.manifest,
        internalNames,
        this.manifest.version,
        pkg.tarball,
      )
    }
  }

  /**
   * Resolve one recorded tarball against the bundle directory.
   * @param pkg - the recorded package.
   * @returns the absolute tarball path.
   */
  tarballPath(pkg: PackedPackage): string {
    return resolve(this.directory, pkg.tarball)
  }
}
