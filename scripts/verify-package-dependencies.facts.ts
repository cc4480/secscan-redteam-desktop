/** Source-derived dependency facts for every package covered by the policy. */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PACKAGE_DEPENDENCY_POLICY,
  type PackageDependencyPolicy,
} from './package-dependency-policy.ts'
import { collectRuntimeSourcePackageUses, collectSourcePackageUses } from './verify-client-packages.ts'
import { generatedHostSources, readHostRuntimeUses } from './verify-package-dependencies.host-sources.ts'
import {
  discoverPackageDependencyScope,
  readWorkspacePackageManifests,
} from './verify-package-dependencies.manifests.ts'
import {
  NAMESPACE_RUNTIME_EXPORT,
  SIDE_EFFECT_RUNTIME_EXPORT,
} from './verify-package-dependencies.runtime-exports.ts'
import { declaredSections } from './verify-package-dependencies.sections.ts'
import {
  addUse,
  CORDIS,
  duplicates,
  normalizePath,
  packageNameOf,
} from './verify-package-dependencies.shared.ts'
import type {
  PackageDependencyFacts,
  PackageDependencyRole,
  PackageDependencyState,
  WorkspacePackageManifest,
} from './verify-package-dependencies.types.ts'

function readAllSourceUses(root: string, pkg: WorkspacePackageManifest): Map<string, string[]> {
  const uses = new Map<string, string[]>()
  for (const sourcePath of globSync('src/**/*.{ts,tsx,mts,cts}', { cwd: resolve(root, pkg.dir) }).sort()) {
    const source = readFileSync(resolve(root, pkg.dir, sourcePath), 'utf8')
    const displayPath = `${pkg.dir}/${normalizePath(sourcePath)}`
    let runtimeUses: Set<string> | undefined
    for (const specifier of collectSourcePackageUses(sourcePath, source)) {
      const name = packageNameOf(specifier)
      if (name === undefined) continue
      const typesName = `@types/${name.replace(/^@/, '').replace('/', '__')}`
      if (declaredSections(pkg.manifest, name).length === 0 && declaredSections(pkg.manifest, typesName).length > 0) {
        runtimeUses ??= collectRuntimeSourcePackageUses(sourcePath, source)
        if (!runtimeUses.has(name)) {
          addUse(uses, typesName, displayPath)
          continue
        }
      }
      addUse(uses, name, displayPath)
    }
  }
  return uses
}

/**
 * Read authored and generated source usage for one already-classified package.
 * @param root - Repository containing source files and face tsconfigs.
 * @param pkg - Package manifest and directory.
 * @param role - Selected dependency policy role.
 * @param workspaceNames - Workspace package identities.
 * @param policy - Reviewed Host export and configuration-only classifications.
 * @param generatedHostSource - Host module already emitted in memory by a batched Typert pass.
 * @returns Source-derived dependency facts without writing build artifacts.
 */
export function readPackageDependencyFacts(
  root: string,
  pkg: WorkspacePackageManifest,
  role: PackageDependencyRole,
  workspaceNames: ReadonlySet<string>,
  policy: PackageDependencyPolicy = PACKAGE_DEPENDENCY_POLICY,
  generatedHostSource?: string,
): PackageDependencyFacts {
  const inject = pkg.manifest.dsh?.client?.inject ?? []
  const hostRuntime = role === 'client-only'
    ? { packageUses: new Map<string, string[]>(), exportUses: [] }
    : readHostRuntimeUses(root, pkg, generatedHostSource)
  return {
    manifestPath: pkg.manifestPath,
    role,
    manifest: pkg.manifest,
    workspaceNames,
    allSourceUses: readAllSourceUses(root, pkg),
    hostRuntimeSourceUses: hostRuntime.packageUses,
    hostRuntimeExportUses: hostRuntime.exportUses,
    peerRequiredHostDependencies: new Set(hostRuntime.exportUses
      .filter(use => policy.peerRequiredHostExports[use.specifier]?.includes(use.exportName) === true)
      .map(use => use.packageName)),
    configurationOnlyDevDependencies: new Set(
      policy.configurationOnlyDevDependencies[pkg.manifest.name ?? ''] ?? [],
    ),
    clientInject: new Set(inject.map(packageNameOf).filter(name => name !== undefined)),
  }
}

/** Validate reviewed Host export classifications against current source facts. */
export function collectHostDependencyExportPolicyViolations(
  facts: readonly PackageDependencyFacts[],
  workspaceNames: ReadonlySet<string>,
  policy: Pick<PackageDependencyPolicy, 'duplicateSafePackages' | 'peerRequiredHostExports' | 'safeHostDependencyExports'>,
): string[] {
  const violations: string[] = []
  const allRuntimeUses = facts.flatMap(fact => fact.hostRuntimeExportUses)
  const duplicateSafePackages = new Set(policy.duplicateSafePackages ?? [])
  for (const packageName of duplicates(policy.duplicateSafePackages ?? [])) {
    violations.push(`duplicateSafePackages lists ${packageName} more than once`)
  }
  for (const packageName of duplicateSafePackages) {
    if (!workspaceNames.has(packageName)) {
      violations.push(`duplicateSafePackages names unknown workspace package ${packageName}`)
    }
  }
  const classifications = [
    ['safeHostDependencyExports', policy.safeHostDependencyExports],
    ['peerRequiredHostExports', policy.peerRequiredHostExports],
  ] as const
  for (const [field, entries] of classifications) {
    for (const [specifier, exportNames] of Object.entries(entries)) {
      const provider = packageNameOf(specifier)
      if (provider === undefined || !workspaceNames.has(provider)) {
        violations.push(`${field} specifier ${specifier} is not a workspace package`)
      } else if (duplicateSafePackages.has(provider)) {
        violations.push(`${field} redundantly classifies duplicate-install-safe package ${specifier}`)
      }
      if (exportNames.length === 0) {
        violations.push(`${field} lists no exports for ${specifier}`)
      }
      for (const exportName of duplicates(exportNames)) {
        violations.push(`${field} lists ${specifier} export ${exportName} more than once`)
      }
      for (const exportName of exportNames) {
        if (exportName === '' || exportName === NAMESPACE_RUNTIME_EXPORT || exportName === SIDE_EFFECT_RUNTIME_EXPORT) {
          violations.push(`${field} cannot classify unbounded ${specifier} export ${exportName}`)
          continue
        }
        if (!allRuntimeUses.some(use => use.specifier === specifier && use.exportName === exportName)) {
          violations.push(`${field} lists unused ${specifier} export ${exportName}`)
        }
        if (field === 'safeHostDependencyExports'
          && policy.peerRequiredHostExports[specifier]?.includes(exportName) === true) {
          violations.push(`${specifier} export ${exportName} appears in both Host export classifications`)
        }
      }
    }
  }

  for (const fact of facts) {
    for (const use of fact.hostRuntimeExportUses) {
      if (use.packageName === fact.manifest.name || use.packageName === CORDIS) continue
      if (!workspaceNames.has(use.packageName)) continue
      if (duplicateSafePackages.has(use.packageName)) continue
      if (policy.safeHostDependencyExports[use.specifier]?.includes(use.exportName) === true) continue
      if (policy.peerRequiredHostExports[use.specifier]?.includes(use.exportName) === true) continue
      violations.push(
        `${use.sourcePath}:${String(use.line)}:${String(use.column)}: `
        + `${use.specifier}#${use.exportName} is not classified as safe or peer-required — ${use.sourceLine}`,
      )
    }
  }
  return violations.sort()
}

/** Read every package covered by the current dependency policy. */
export function readPackageDependencyState(
  root: string,
  policy: PackageDependencyPolicy = PACKAGE_DEPENDENCY_POLICY,
): PackageDependencyState {
  const packages = readWorkspacePackageManifests(root)
  const workspaceNames = new Set(packages.all.map(pkg => pkg.name))
  const discovered = discoverPackageDependencyScope(packages.release, policy)
  const generated = generatedHostSources(root, discovered.selected.filter(pkg => pkg.role !== 'client-only'))
  const facts = discovered.selected.map(pkg =>
    readPackageDependencyFacts(root, pkg, pkg.role, workspaceNames, policy, generated.get(pkg.name)))
  const selectedNames = new Set(facts.map(fact => fact.manifest.name))
  return {
    facts,
    packages: packages.release,
    policyViolations: [
      ...discovered.violations,
      ...collectHostDependencyExportPolicyViolations(facts, workspaceNames, policy),
      ...Object.keys(policy.configurationOnlyDevDependencies)
        .filter(name => !selectedNames.has(name))
        .map(name => `configurationOnlyDevDependencies names unmanaged package ${name}`),
    ].sort(),
    workspaceNames,
  }
}
