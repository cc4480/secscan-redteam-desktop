/**
 * Fixtures shared by the client-package suites: fake declarations, packages,
 * fact sets, and the temporary workspace roots a suite registers for cleanup.
 */

import { rmSync } from 'node:fs'
import type {
  ClientDeclaration,
  ClientPackage,
  ClientPackageFacts,
} from './verify-client-packages.ts'

export const CORDIS = '@deepseek-ai/cordis'
export const roots: string[] = []

/** Removes every temporary workspace root the current suite created. */
export function cleanupRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

/** Builds a client declaration row, with `manifest` and `name` derived from `short`. */
export function declaration(
  short: string,
  fields: Partial<Omit<ClientDeclaration, 'name' | 'manifest'>> = {},
): ClientDeclaration {
  return {
    name: short.startsWith('@') ? short : '@deepseek-ai/dsh-client-' + short,
    manifest: 'packages/client/' + short.replace(/^.*\//, '') + '/package.json',
    dynamic: true,
    external: [],
    inject: [],
    runtimeSourceUses: {},
    runtimeSourceSpecifiers: {},
    ...fields,
  }
}

/** Builds a client package row: a declaration plus the mode and source facts. */
export function pkg(
  short: string,
  fields: Partial<Omit<ClientPackage, 'name' | 'manifest'>> = {},
): ClientPackage {
  return {
    ...declaration(short),
    staticLinked: false,
    sourceUses: {},
    runtimeSourceUses: {},
    dependencies: {},
    peerDependencies: { [CORDIS]: 'workspace:^' },
    devDependencies: { [CORDIS]: 'workspace:^' },
    ...fields,
  }
}

/** Builds a complete fact set, defaulting every unstated section from `packages`. */
export function facts(
  packages: readonly ClientPackage[],
  options: Partial<Omit<ClientPackageFacts, 'packages'>> = {},
): ClientPackageFacts {
  return {
    packages,
    declarations: options.declarations ?? packages,
    staticLinkedPackages: options.staticLinkedPackages ?? new Set(
      packages.filter(item => item.staticLinked).map(item => item.name),
    ),
    platformModules: options.platformModules ?? [],
    preloadedExternals: options.preloadedExternals ?? [],
    parserPreloadIds: options.parserPreloadIds
      ?? (options.preloadedExternals ?? []).map(value => value.replace(/\/client$/, '')),
    malformed: options.malformed ?? [],
  }
}
