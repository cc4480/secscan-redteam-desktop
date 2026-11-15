/** Source-plane resolution of local workspace specifiers through the tsconfig `paths` facade. */

import { globSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import {
  packageNameFromSpecifier,
  pluginReferences,
  readManifest,
  root,
} from './verify-cordis-config-shared.ts'

/**
 * Every configured specifier of a local workspace package must resolve through
 * the tsconfig `paths` facade to a `.ts`/`.tsx` source file. The `dsh` source
 * launch (tsx) and vitest resolve in the source plane; without a `paths` match
 * they fall back to package `exports`, which reach built `lib/` — present on a
 * built dev tree, absent on a clean one — so a missing mapping boots locally
 * yet breaks every clean checkout. Anything but a `.ts`/`.tsx` hit (a `.d.ts`
 * or `.js` under built `lib/`) is that artifact-plane fallback, not source.
 */
export function validateSourcePlaneResolution(): string[] {
  const violations: string[] = []
  const localPackages = localPackageDirectories()
  const config = ts.readConfigFile(resolve(root, 'tsconfig.base.json'), path => ts.sys.readFile(path))
  if (config.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  }
  const { options, errors: optionErrors } = ts.convertCompilerOptionsFromJson(
    (config.config as { compilerOptions?: unknown }).compilerOptions,
    root,
    'tsconfig.base.json',
  )
  if (optionErrors.length > 0) {
    throw new Error(optionErrors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
  }
  // convertCompilerOptionsFromJson leaves `pathsBasePath` unset, so relative
  // `paths` targets resolve against the host's current directory; anchor it to
  // the repository root to keep the gate cwd-independent.
  const host: ts.ModuleResolutionHost = {
    fileExists: path => ts.sys.fileExists(path),
    readFile: path => ts.sys.readFile(path),
    directoryExists: path => ts.sys.directoryExists(path),
    getCurrentDirectory: () => root,
  }
  const sourceExtensions = new Set<string>([ts.Extension.Ts, ts.Extension.Tsx])
  const containingFile = resolve(root, 'scripts/verify-cordis-config.ts')
  const locationsBySpecifier = new Map<string, Set<string>>()
  for (const reference of pluginReferences) {
    const packageName = packageNameFromSpecifier(reference.name)
    if (packageName === undefined || !localPackages.has(packageName)) continue
    const locations = locationsBySpecifier.get(reference.name) ?? new Set<string>()
    locations.add(reference.file)
    locationsBySpecifier.set(reference.name, locations)
  }
  for (const [specifier, locations] of locationsBySpecifier) {
    const resolved = ts.resolveModuleName(specifier, containingFile, options, host).resolvedModule
    if (resolved !== undefined && sourceExtensions.has(resolved.extension)) continue
    violations.push(`${[...locations].join(', ')}: ${specifier} does not resolve to workspace source through tsconfig.base.json paths (add a mapping so the tsx source launch does not depend on built lib/)`)
  }
  return violations
}

function localPackageDirectories(): Map<string, string> {
  const manifests = globSync(['packages/*/*/package.json', 'vendor/*/package.json'], { cwd: root })
  const packages = new Map<string, string>()
  for (const manifestPath of manifests) {
    const manifest = readManifest(manifestPath)
    if (manifest.name !== undefined) packages.set(manifest.name, resolve(root, dirname(manifestPath)))
  }
  return packages
}
