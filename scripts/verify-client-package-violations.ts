/** Package-mode and browser-module request policy checks. */

import { CORDIS, PARSER_PRELOAD_SOURCE, PLATFORM_SOURCE } from './verify-client-package-context.ts'
import { collectModuleCycles, type ModuleEdge } from './verify-client-package-cycles.ts'
import {
  rowNames,
  rowPackageOf,
  stripClientSuffix,
  type ClientDeclaration,
} from './verify-client-package-declarations.ts'
import { packageNameOf } from './verify-client-package-source-uses.ts'

/** One package directly under packages/client. */
export interface ClientPackage extends ClientDeclaration {
  readonly staticLinked: boolean
  readonly sourceUses: Readonly<Record<string, readonly string[]>>
  readonly dependencies: Readonly<Record<string, string>>
  readonly peerDependencies: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
}

/** Complete source-plane input to the client package verifier. */
export interface ClientPackageFacts {
  readonly packages: readonly ClientPackage[]
  readonly declarations: readonly ClientDeclaration[]
  readonly staticLinkedPackages: ReadonlySet<string>
  readonly platformModules: readonly string[]
  readonly preloadedExternals: readonly string[]
  readonly parserPreloadIds: readonly string[]
  readonly malformed: readonly string[]
}

/**
 * Return every client package policy violation.
 * @param facts - Package modes, manifests, source uses, and platform module lists.
 * @returns Stable self-contained diagnostics.
 */
export function collectClientPackageViolations(facts: ClientPackageFacts): string[] {
  return [
    ...facts.malformed,
    ...collectModeViolations(facts),
    ...collectModuleViolations(facts),
  ].sort((left, right) => left.localeCompare(right))
}

function collectModeViolations(facts: ClientPackageFacts): string[] {
  const violations: string[] = []
  for (const pkg of facts.packages) {
    if (pkg.dynamic && pkg.staticLinked) {
      violations.push(
        pkg.manifest + ': ' + pkg.name + ' declares dsh.client and uses the staticLinked preset;'
        + ' a client package must be dynamic or statically linked, not both',
      )
    } else if (!pkg.dynamic && !pkg.staticLinked) {
      violations.push(
        pkg.manifest + ': ' + pkg.name + ' has no supported client package mode;'
        + ' declare dsh.client or use the staticLinked preset',
      )
    }
  }

  const workspaceNames = new Set(facts.declarations.map(entry => entry.name))
  for (const specifier of facts.platformModules) {
    const owner = packageNameOf(specifier)
    if (!workspaceNames.has(owner) || owner === CORDIS || facts.staticLinkedPackages.has(owner)) continue
    violations.push(
      PLATFORM_SOURCE + ': seeded workspace module ' + JSON.stringify(specifier)
      + ' belongs to ' + owner + ', whose build does not use the staticLinked preset',
    )
  }

  const rows = rowNames(facts.declarations)
  for (const specifier of facts.preloadedExternals) {
    if (rowPackageOf(specifier, rows) === undefined) {
      violations.push(
        PLATFORM_SOURCE + ': parser-preloaded external ' + JSON.stringify(specifier)
        + ' has no dynamic dsh.client row',
      )
    }
    if (!facts.parserPreloadIds.includes(stripClientSuffix(specifier))) {
      violations.push(
        PLATFORM_SOURCE + ': parser-preloaded external ' + JSON.stringify(specifier)
        + ' has no matching PARSER_PRELOAD_IDS row in ' + PARSER_PRELOAD_SOURCE,
      )
    }
  }
  return violations
}

function collectModuleViolations(facts: ClientPackageFacts): string[] {
  const violations: string[] = []
  const baseline = new Set([...facts.platformModules, ...facts.preloadedExternals])
  const rows = rowNames(facts.declarations)
  const byName = new Map(facts.declarations.map(entry => [entry.name, entry]))
  const edges: ModuleEdge[] = []

  for (const pkg of facts.declarations.filter(entry => entry.dynamic)) {
    for (const field of ['external', 'inject'] as const) {
      const seen = new Set<string>()
      for (const value of pkg[field]) {
        if (value === '') violations.push(pkg.manifest + ': dsh.client.' + field + ' contains an empty value')
        else if (seen.has(value)) {
          violations.push(pkg.manifest + ': dsh.client.' + field + ' lists ' + JSON.stringify(value) + ' twice')
        }
        seen.add(value)
      }
    }

    for (const specifier of new Set(pkg.external)) {
      if (specifier === '') continue
      if (baseline.has(specifier)) {
        violations.push(
          pkg.manifest + ': dsh.client.external repeats baseline module ' + JSON.stringify(specifier)
          + '; remove the explicit declaration',
        )
        continue
      }
      const supplier = rowPackageOf(specifier, rows)
      if (supplier === pkg.name) {
        violations.push(pkg.manifest + ': dsh.client.external names its own row ' + JSON.stringify(specifier))
      } else if (supplier !== undefined) {
        if (pkg.manifest.startsWith('packages/client/')) {
          violations.push(
            pkg.manifest + ': client feature package requests runtime external ' + JSON.stringify(specifier)
            + '; import shared types only or call an injected Cordis service',
          )
          continue
        }
        if (pkg.runtimeSourceSpecifiers[specifier] === undefined) {
          violations.push(
            pkg.manifest + ': dsh.client.external ' + JSON.stringify(specifier)
            + ' has no runtime import or re-export in production source; remove the stale declaration',
          )
          continue
        }
        edges.push({ from: pkg.name, to: supplier, specifier })
      } else {
        const owner = stripClientSuffix(specifier)
        violations.push(
          pkg.manifest + ': dsh.client.external ' + JSON.stringify(specifier) + ' has no supplier;'
          + (byName.has(owner)
            ? ' workspace package ' + owner
              + ' declares no dynamic dsh.client row and the shell does not seed this specifier'
            : ' no dynamic row or PLATFORM_MODULES entry answers it'),
        )
      }
    }
  }

  violations.push(...collectModuleCycles(edges, byName))
  return violations
}
