/**
 * Scratch package fixtures and the teardown that removes every scratch root a
 * case creates, shared by the package-invariant gate cases.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { usesFlattenedPackageDependencies } from './package-dependency-policy.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Renders a hand-owned invariant companion the gate accepts as-is.
 *
 * @param packageName Package name the companion registers itself under.
 * @returns Source text for the fixture's `src/invariant.ts`.
 */
export function handwrittenInvariant(packageName: string): string {
  return `
export const name = 'probe-invariant'
export const inject = ['invariants']
const install = (ctx: { on(name: string, listener: (value: number) => void): void }, fail: (message: string) => never) => {
  ctx.on('probe/value', (value) => {
    if (value < 0) fail('observed values must be non-negative')
  })
}
export const apply = (ctx: { invariants: { register(name: string, install: typeof install): () => void } }) =>
  Promise.resolve(ctx.invariants.register(${JSON.stringify(packageName)}, install))
`
}

/**
 * Writes one probe package tree whose wiring the given overrides bend.
 *
 * @param options Companion, manifest, source, and build overrides to apply.
 * @returns Absolute path of the scratch root holding the package.
 */
export function fixture(options: {
  companion?: boolean
  packageName?: string
  packageDirectory?: string
  source?: string
  clientDeclaration?: boolean
  clientExport?: boolean
  invariantExport?: boolean
  invariantFile?: boolean
  invariantDependency?: boolean
  invariantRange?: string
  invariantReference?: boolean
  buildEntry?: boolean
  omissionReason?: boolean
} = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-package-invariants-'))
  roots.push(root)
  const packageDirectory = options.packageDirectory ?? 'packages/core/probe'
  const dir = join(root, packageDirectory)
  mkdirSync(join(dir, 'src'), { recursive: true })
  const packageName = options.packageName ?? '@deepseek-ai/dsh-probe'
  const companion = options.companion ?? true
  const invariantExport = options.invariantExport ?? companion
  const invariantFile = options.invariantFile ?? companion
  const invariantDependency = options.invariantDependency ?? companion
  const invariantReference = options.invariantReference ?? companion
  const buildEntry = options.buildEntry ?? companion
  const exports = {
    ...(invariantExport ? { './invariant': {
      types: './lib/types/invariant.d.ts',
      default: './lib/invariant.js',
    } } : {}),
    ...(options.clientExport === true ? {
      './client': {
        types: './lib/types/client/index.d.ts',
        default: './lib/client.js',
      },
    } : {}),
  }
  const dsh = options.clientDeclaration === true ? { client: {} } : undefined
  const developmentOnlyInvariant = usesFlattenedPackageDependencies(
    `${packageDirectory}/package.json`,
    packageName,
    dsh,
  )
  const manifest = {
    name: packageName,
    ...(dsh === undefined ? {} : { dsh }),
    exports,
    files: ['lib/index.js', ...invariantFile ? ['lib/invariant.js'] : []],
    peerDependencies: !invariantDependency || developmentOnlyInvariant ? {} : {
      '@deepseek-ai/dsh-invariants': options.invariantRange ?? 'workspace:*',
    },
    devDependencies: !invariantDependency ? {} : {
      '@deepseek-ai/dsh-invariants': options.invariantRange ?? 'workspace:*',
    },
  }
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(dir, 'tsconfig.json'), `${JSON.stringify({
    references: invariantReference ? [{ path: '../../runtime-diagnostics/invariants' }] : [],
  }, null, 2)}\n`)
  if (companion) {
    writeFileSync(join(dir, 'src/invariant.ts'), options.source ?? handwrittenInvariant(packageName))
  }
  writeFileSync(
    join(dir, 'tsdown.config.ts'),
    buildEntry ? "export default { entry: ['lib/types/index.js', 'lib/types/invariant.js'] }\n" : "export default { entry: ['lib/types/index.js'] }\n",
  )
  writeFileSync(
    join(dir, 'README.md'),
    options.omissionReason === false ? '# Probe\n' : '# Probe\n\nNo runtime invariant companion is published because this fixture owns no diverging observations.\n',
  )
  return root
}
