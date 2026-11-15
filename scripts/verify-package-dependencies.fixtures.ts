import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { PackageDependencyPolicy } from './package-dependency-policy.ts'
import {
  readPackageDependencyFacts,
  type PackageDependencyFacts,
  type PackageDependencyManifest,
  type PackageDependencyRole,
  type WorkspacePackageManifest,
} from './verify-package-dependencies.ts'

export const CORDIS = '@deepseek-ai/cordis'
export const roots: string[] = []

export function cleanupRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

export function pkg(
  name: string,
  manifestPath: string,
  manifest: Partial<PackageDependencyManifest> = {},
): WorkspacePackageManifest {
  return {
    name,
    manifestPath,
    dir: dirname(manifestPath),
    manifest: { name, ...manifest },
  }
}

export function policy(fields: Partial<PackageDependencyPolicy> = {}): PackageDependencyPolicy {
  return {
    clientFaceInclude: [],
    clientFaceExclude: [],
    hostPackages: [],
    configurationOnlyDevDependencies: {},
    safeHostDependencyExports: {},
    peerRequiredHostExports: {},
    ...fields,
  }
}

export function facts(manifest: PackageDependencyManifest): PackageDependencyFacts {
  return {
    manifestPath: 'packages/core/probe/package.json',
    role: 'configured-host',
    manifest,
    workspaceNames: new Set([
      CORDIS,
      '@deepseek-ai/dsh-runtime',
      '@deepseek-ai/dsh-types',
      '@deepseek-ai/dsh-stale',
      '@deepseek-ai/schemastery',
    ]),
    allSourceUses: new Map([
      ['@deepseek-ai/dsh-runtime', ['packages/core/probe/src/index.ts']],
      ['@deepseek-ai/dsh-types', ['packages/core/probe/src/types.ts']],
    ]),
    hostRuntimeSourceUses: new Map([
      ['@deepseek-ai/dsh-runtime', ['packages/core/probe/src/index.ts']],
    ]),
    hostRuntimeExportUses: [{
      packageName: '@deepseek-ai/dsh-runtime',
      specifier: '@deepseek-ai/dsh-runtime',
      exportName: 'runtimeValue',
      sourcePath: 'packages/core/probe/src/index.ts',
      line: 1,
      column: 10,
      sourceLine: "import { runtimeValue } from '@deepseek-ai/dsh-runtime'",
    }],
    peerRequiredHostDependencies: new Set(),
    configurationOnlyDevDependencies: new Set(),
    clientInject: new Set(),
  }
}

export function sourceFacts(
  files: Readonly<Record<string, string>>,
  manifest: Partial<PackageDependencyManifest> = {},
  role: PackageDependencyRole = 'client-host',
): PackageDependencyFacts {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dependency-source-'))
  roots.push(root)
  const subject = pkg('@f/probe', 'packages/g/probe/package.json', manifest)
  for (const [path, source] of Object.entries(files)) {
    const absolute = join(root, subject.dir, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, source)
  }
  return readPackageDependencyFacts(root, subject, role, new Set([CORDIS, subject.name]), policy())
}

export function generatedHostFixture(mode: 'schema' | 'object'): { root: string; manifestPath: string; source: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-generated-host-dependencies-'))
  roots.push(root)
  const manifestPath = 'packages/client/probe/package.json'
  const source = `/** @typert ${mode} */\nexport interface Payload { value: string }\n`
  const manifest = {
    name: '@fixture/generated',
    type: 'module',
    dsh: { client: {} },
    exports: {
      '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
      './typert': { types: './lib/typert.host.d.ts', default: './lib/typert.host.js' },
    },
    files: ['lib/typert.host.js', 'lib/typert.host.d.ts'],
    dependencies: { zod: '^4.0.0' },
    devDependencies: { [CORDIS]: 'workspace:~' },
    peerDependencies: { [CORDIS]: 'workspace:~' },
  }
  const files = {
    'tsconfig.base.json': JSON.stringify({
      compilerOptions: {
        target: 'ES2024', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
        composite: true, noEmit: true, types: [], skipLibCheck: true,
      },
    }),
    'tsconfig.host.json': JSON.stringify({
      extends: './tsconfig.base.json', files: [], references: [{ path: './packages/client/probe' }],
    }),
    'packages/client/probe/tsconfig.json': JSON.stringify({
      extends: '../../../tsconfig.base.json', compilerOptions: { rootDir: 'src' }, include: ['src'],
    }),
    [manifestPath]: JSON.stringify(manifest),
    'packages/client/probe/src/index.ts': source,
  }
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return { root, manifestPath, source }
}

export function hostRuntimeFixture(): {
  provider: WorkspacePackageManifest
  workspaceNames: Set<string>
  consumerFacts: PackageDependencyFacts
} {
  const consumer = pkg('@f/consumer', 'packages/core/consumer/package.json')
  const provider = pkg('@f/provider', 'packages/core/provider/package.json')
  const sourcePath = 'packages/core/consumer/src/index.ts'
  const specifier = `${provider.name}/api`
  const workspaceNames = new Set([CORDIS, consumer.name, provider.name])
  const consumerFacts: PackageDependencyFacts = {
    manifestPath: consumer.manifestPath,
    role: 'configured-host',
    manifest: consumer.manifest,
    workspaceNames,
    allSourceUses: new Map(),
    hostRuntimeSourceUses: new Map([[provider.name, [sourcePath]]]),
    hostRuntimeExportUses: [{
      packageName: provider.name,
      specifier,
      exportName: 'safeValue',
      sourcePath,
      line: 1,
      column: 10,
      sourceLine: `import { safeValue } from '${specifier}'`,
    }],
    peerRequiredHostDependencies: new Set(),
    configurationOnlyDevDependencies: new Set(),
    clientInject: new Set(),
  }
  return { provider, workspaceNames, consumerFacts }
}
