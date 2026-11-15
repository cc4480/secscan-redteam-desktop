/** npm package-lock resolution against the benchmark's local registry. */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { close, listen, runNpm } from './benchmark-npm-resolution-install.ts'
import { latestVersion, type RegistryIndex } from './benchmark-npm-resolution-registry.ts'

/** Package installed by the resolution benchmark. */
export const TARGET_PACKAGE = '@deepseek-ai/dsh'

/** One measured npm resolution. */
export interface BenchmarkRun {
  readonly durationMs: number
  readonly registryRequests: number
  readonly archiveRequests: number
  readonly unknownPackages: readonly string[]
}

/** Published-package fields retained in npm's package-lock layout. */
export interface NpmLockPackage {
  readonly name?: string
  readonly version?: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>
}

/** The installed paths selected by npm without materializing package archives. */
export interface NpmPackageLock {
  readonly lockfileVersion: number
  readonly packages: Readonly<Record<string, NpmLockPackage>>
}

/** npm resolution observations together with its computed install layout. */
export interface NpmPackageLockResolution extends BenchmarkRun {
  readonly packageLock: NpmPackageLock
}

function readNpmPackageLock(path: string): NpmPackageLock {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('npm produced an invalid package-lock.json')
  }
  const { lockfileVersion, packages } = parsed as Record<string, unknown>
  if (!Number.isSafeInteger(lockfileVersion) || packages === null
    || typeof packages !== 'object' || Array.isArray(packages)) {
    throw new Error('npm produced an invalid package-lock.json')
  }
  return parsed as NpmPackageLock
}

/**
 * Ask npm to compute an install layout without downloading package archives.
 * @param index - Package metadata exposed through the local registry.
 * @param dependencies - Root dependencies whose install layout npm computes.
 * @param timeoutMs - Hard wall-clock limit for the npm child process.
 * @returns The package lock plus timing and registry-request observations.
 */
export async function resolveNpmPackageLock(
  index: RegistryIndex,
  dependencies: Readonly<Record<string, string>>,
  timeoutMs: number,
): Promise<NpmPackageLockResolution> {
  let registryRequests = 0
  let archiveRequests = 0
  const unknownPackages = new Set<string>()
  let registry = ''
  const server = createServer((request, response) => {
    registryRequests++
    const pathname = new URL(request.url ?? '/', registry).pathname
    if (pathname.startsWith('/tarballs/')) {
      archiveRequests++
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'package-lock-only benchmark requested an archive' }))
      return
    }
    const name = decodeURIComponent(pathname.slice(1))
    const versions = index.get(name)
    if (versions === undefined) {
      unknownPackages.add(name)
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'not_found' }))
      return
    }
    const materialized = Object.fromEntries([...versions].map(([version, manifest]) => [version, {
      ...manifest,
      dist: { tarball: `${registry}tarballs/${encodeURIComponent(name)}-${version}.tgz` },
    }]))
    const body = JSON.stringify({
      name,
      'dist-tags': { latest: latestVersion(versions) },
      versions: materialized,
    })
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    })
    response.end(body)
  })
  const port = await listen(server)
  registry = `http://127.0.0.1:${String(port)}/`
  const consumer = mkdtempSync(join(tmpdir(), 'dsh-npm-resolution-'))
  try {
    writeFileSync(join(consumer, 'package.json'), `${JSON.stringify({
      name: 'dsh-npm-resolution-benchmark',
      version: '0.0.0',
      private: true,
      dependencies,
    }, null, 2)}\n`)
    const result = await runNpm(consumer, registry, timeoutMs)
    if (result.timedOut) throw new Error(`npm resolution exceeded ${String(timeoutMs)} ms`)
    return {
      durationMs: result.durationMs,
      registryRequests,
      archiveRequests,
      unknownPackages: [...unknownPackages].sort(),
      packageLock: readNpmPackageLock(join(consumer, 'package-lock.json')),
    }
  } finally {
    server.closeAllConnections()
    await close(server)
    rmSync(consumer, { recursive: true, force: true })
  }
}

/**
 * Resolve the CLI install graph once without downloading package archives.
 * @param index - Package metadata exposed through the local registry.
 * @param targetVersion - Version of `@deepseek-ai/dsh` to install.
 * @param timeoutMs - Hard wall-clock limit for the npm child process.
 * @returns Timing and registry-request observations.
 */
export async function benchmarkNpmResolution(
  index: RegistryIndex,
  targetVersion: string,
  timeoutMs: number,
): Promise<BenchmarkRun> {
  const result = await resolveNpmPackageLock(index, { [TARGET_PACKAGE]: targetVersion }, timeoutMs)
  return {
    durationMs: result.durationMs,
    registryRequests: result.registryRequests,
    archiveRequests: result.archiveRequests,
    unknownPackages: result.unknownPackages,
  }
}
