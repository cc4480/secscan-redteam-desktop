/** Manifest, package, and dependency-state types shared by the package dependency gate. */

export type PackageDependencyRole = 'client-only' | 'client-host' | 'configured-host'

/** Manifest fields read and repaired by the package dependency policy. */
export interface PackageDependencyManifest {
  name?: string
  version?: string
  exports?: unknown
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, unknown>
  dsh?: { client?: { inject?: string[] } }
}

/** One workspace package and its source location. */
export interface WorkspacePackageManifest {
  readonly dir: string
  readonly manifestPath: string
  readonly manifest: PackageDependencyManifest
  readonly name: string
}

/** Source and manifest facts for one package covered by the policy. */
export interface PackageDependencyFacts {
  readonly manifestPath: string
  readonly role: PackageDependencyRole
  readonly manifest: PackageDependencyManifest
  readonly workspaceNames: ReadonlySet<string>
  readonly allSourceUses: ReadonlyMap<string, readonly string[]>
  readonly hostRuntimeSourceUses: ReadonlyMap<string, readonly string[]>
  readonly hostRuntimeExportUses: readonly HostRuntimeExportUse[]
  readonly peerRequiredHostDependencies: ReadonlySet<string>
  readonly configurationOnlyDevDependencies: ReadonlySet<string>
  readonly clientInject: ReadonlySet<string>
}

/** One runtime export used by an authored or generated Host module. */
export interface HostRuntimeExportUse {
  readonly packageName: string
  readonly specifier: string
  readonly exportName: string
  readonly sourcePath: string
  readonly line: number
  readonly column: number
  readonly sourceLine: string
}

/** Complete policy input read from the repository. */
export interface PackageDependencyState {
  readonly facts: readonly PackageDependencyFacts[]
  readonly packages: readonly WorkspacePackageManifest[]
  readonly policyViolations: readonly string[]
  readonly workspaceNames: ReadonlySet<string>
}

export interface ExpectedPackageDependency {
  readonly section: 'dependencies' | 'devDependencies' | 'peer-dev'
  readonly origins: readonly string[]
}
