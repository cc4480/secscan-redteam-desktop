import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

type BuildPhase = 'all' | 'vendor' | 'workspace'

function resolveBuildPhase(value: unknown): BuildPhase {
  if (value === undefined || value === 'all') return 'all'
  if (value === 'vendor' || value === 'workspace') return value
  throw new Error(`tsdown: --env.DSH_BUILD_PHASE must be vendor, workspace, or all, received ${String(value)}`)
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project and runs Typert. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact.
 *
 * `DSH_BUILD_PHASE` selects the vendor packages (`vendor`), the remaining
 * workspace (`workspace`), or both in one pass (`all`, the default). The
 * `build:lib` scripts run the vendor phase first: tsdown builds every
 * workspace config concurrently, and consumers that bundle a vendored
 * package (it is declared only in their `devDependencies`) read that
 * package's `lib/` output while the vendored package's own build rewrites
 * the same files in place. Building the vendor packages to completion
 * before any consumer starts removes that read-while-rewrite race.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  const phase = resolveBuildPhase(env?.DSH_BUILD_PHASE)
  const everyPackage: string[] = client
    ? ['vendor/*', 'packages/*/*', 'apps/cli']
    : ['vendor/*', 'packages/*/*', 'apps/cli', 'apps/desktop', 'apps/desktop-host']
  const include = phase === 'vendor'
    ? ['vendor/*']
    : phase === 'workspace'
      ? everyPackage.filter((pattern) => pattern !== 'vendor/*')
      : everyPackage
  return {
    workspace: {
      include,
      exclude: [
        // tsdown's built-in defaults, restated: supplying `exclude`
        // replaces them (tsdown resolveWorkspace).
        '**/node_modules/**',
        '**/dist/**',
        '**/test?(s)/**',
        '**/t?(e)mp/**',
        // Not a package: shared helper scripts for packages/redteam/*
        // (dist-hash.mjs). It has no package.json and must not be
        // swept into the workspace as a phantom member.
        'packages/redteam/scripts',
      ],
    },
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
