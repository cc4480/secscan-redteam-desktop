import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleHash } from './hash.js'
import type {
  BundleFilter,
  BundleSpec,
  BundleVerification,
  ManifestEntry,
  SnapshotManifest,
} from './types.js'

/**
 * Resolve the default snapshot directory: the copy bundled with this package.
 * Compiled output lives two levels below the package root (lib/types or
 * dist-test/src), so the snapshot is two directories up from this module.
 *
 * @returns the absolute path of the bundled snapshot directory
 */
export function defaultSnapshotDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'snapshot')
}

/**
 * Load and parse a snapshot manifest.
 *
 * @param snapshotDir - the snapshot directory containing manifest.json
 * @returns the parsed manifest
 */
export function loadManifest(snapshotDir: string): SnapshotManifest {
  const raw = readFileSync(join(snapshotDir, 'manifest.json'), 'utf8')
  return JSON.parse(raw) as SnapshotManifest
}

/**
 * List manifest bundles, optionally filtered by loop tier and vuln class.
 *
 * @param manifest - the parsed snapshot manifest
 * @param filter - optional loop tier and vuln class filters
 * @returns the matching manifest entries, in manifest order
 */
export function listBundles(manifest: SnapshotManifest, filter: BundleFilter = {}): ManifestEntry[] {
  return manifest.bundles.filter(entry =>
    (filter.loopTier === undefined || entry.loop_tier === filter.loopTier) &&
    (filter.vulnClass === undefined || entry.vuln_class === filter.vulnClass))
}

/**
 * Resolve the directory of one bundle inside a snapshot.
 *
 * @param snapshotDir - the snapshot directory
 * @param slug - the bundle slug
 * @returns the bundle directory path
 */
export function bundleDir(snapshotDir: string, slug: string): string {
  return join(snapshotDir, 'bundles', slug)
}

/**
 * Load one bundle's spec.json.
 *
 * @param snapshotDir - the snapshot directory
 * @param slug - the bundle slug
 * @returns the parsed bundle spec
 */
export function loadSpec(snapshotDir: string, slug: string): BundleSpec {
  const raw = readFileSync(join(bundleDir(snapshotDir, slug), 'spec.json'), 'utf8')
  return JSON.parse(raw) as BundleSpec
}

/**
 * Recompute one bundle's hash and compare it with the manifest.
 *
 * @param snapshotDir - the snapshot directory
 * @param entry - the bundle's manifest entry
 * @returns the expected and actual hashes and whether they match
 */
export function verifyBundle(snapshotDir: string, entry: ManifestEntry): BundleVerification {
  const actual = bundleHash(bundleDir(snapshotDir, entry.slug))
  return { slug: entry.slug, expected: entry.bundle_hash, actual, ok: actual === entry.bundle_hash }
}

/**
 * Verify every bundle in a snapshot against the manifest.
 *
 * @param snapshotDir - the snapshot directory
 * @returns one verification result per manifest entry, in manifest order
 */
export function verifySnapshot(snapshotDir: string): BundleVerification[] {
  const manifest = loadManifest(snapshotDir)
  return manifest.bundles.map(entry => verifyBundle(snapshotDir, entry))
}
