/**
 * The default installation's declared package graph: workspace manifests, the CLI entry, and the
 * package lists the installation-owned profile source declares.
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { PROFILE_SOURCE, type Package } from './verify-default-product-isolation-types.ts'

/** Package lists read from the installation-owned profile source. */
export interface DefaultProfileSelection {
  packages: string[]
  webBundles: string[]
  optionalBundles: string[]
}

/** Declared default installation inputs: manifests, the CLI entry, and the profile package lists. */
export interface ProductGraph {
  packages: Map<string, Package>
  directories: Map<string, Package>
  cli: Package | undefined
  profilePath: string
  selection: DefaultProfileSelection | undefined
  optionalBundles: Set<string>
  failures: string[]
}

/**
 * Read every workspace manifest and the default profile source's declared package lists.
 * @param root - repository root.
 * @returns the declared graph, its violations, and the optional bundles the launcher ships switched off.
 */
export function loadProductGraph(root: string): ProductGraph {
  const failures: string[] = []
  const packages = new Map<string, Package>()
  const directories = new Map<string, Package>()
  for (const path of globSync([
    'apps/*/package.json', 'packages/*/*/package.json', 'vendor/*/package.json',
    'native/system/packages/*/package.json', 'python/sdk-runtime/package.json',
  ], { cwd: root }).sort()) {
    const manifest = JSON.parse(readFileSync(resolve(root, path), 'utf8')) as Package['manifest']
    if (typeof manifest.name !== 'string' || manifest.name === '') throw new Error(`${path}: missing package name`)
    if (packages.has(manifest.name)) throw new Error(`${path}: duplicate package name ${manifest.name}`)
    const pkg = { directory: dirname(resolve(root, path)), manifest }
    packages.set(manifest.name, pkg)
    directories.set(pkg.directory, pkg)
  }
  for (const path of ['apps/cli/package.json', 'apps/web/package.json', 'python/sdk-runtime/package.json']) {
    if (!existsSync(resolve(root, path))) failures.push(`missing default product root ${path}`)
  }
  const cli = directories.get(resolve(root, 'apps/cli'))
  if (cli?.manifest.name !== '@deepseek-ai/dsh') {
    failures.push('apps/cli/package.json must identify @deepseek-ai/dsh')
  }
  // The bundles the launcher ships switched off: each a runtime dependency of the installation that is a bundle, none a default.
  const profilePath = resolve(root, PROFILE_SOURCE)
  const selection = existsSync(profilePath) ? profilePackages(readFileSync(profilePath, 'utf8')) : undefined
  const optionalBundles = new Set(selection?.optionalBundles ?? [])
  for (const name of optionalBundles) {
    if (cli?.manifest.dependencies?.[name] === undefined) {
      failures.push(`${PROFILE_SOURCE}: optional bundle ${name} must be a runtime dependency of apps/cli`)
    }
    if (packages.get(name)?.manifest.dsh?.bundle?.patch === undefined) {
      failures.push(`${PROFILE_SOURCE}: optional bundle ${name} must declare dsh.bundle.patch`)
    }
  }
  return { packages, directories, cli, profilePath, selection, optionalBundles, failures }
}

/**
 * Read the literal package lists that define installation-owned profile defaults and the optional bundles it ships.
 * @param source - text of the profile source module.
 * @returns the default bundles, the composed Web bundle layers, and the optional bundles.
 */
export function profilePackages(source: string): DefaultProfileSelection {
  const file = ts.createSourceFile(PROFILE_SOURCE, source, ts.ScriptTarget.Latest, true)
  const required = new Set(['PROFILE_TEMPLATES', 'DEFAULT_PROFILE_BUNDLES'])
  const found = new Set<string>()
  const packages: string[] = []
  const webBundles: string[] = []
  const optionalBundles: string[] = []
  const literals = (node: ts.Node, path: string[]): void => {
    if (ts.isStringLiteralLike(node)) {
      if (path[0] === 'OPTIONAL_BUNDLES') optionalBundles.push(node.text)
      else if (node.text.startsWith('@')) packages.push(node.text)
      if (path.join('.') === 'PROFILE_TEMPLATES.web.bundles') webBundles.push(node.text)
    } else if (ts.isArrayLiteralExpression(node)) node.elements.forEach((child) => { literals(child, path) })
    else if (ts.isObjectLiteralExpression(node)) node.properties.forEach((child) => { literals(child, path) })
    else if (ts.isPropertyAssignment(node)) {
      if (!ts.isIdentifier(node.name) && !ts.isStringLiteralLike(node.name)) {
        throw new Error(`${PROFILE_SOURCE}: default profile keys must be literal names`)
      }
      literals(node.initializer, [...path, node.name.text])
    }
    else if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
      literals(node.expression, path)
    } else throw new Error(`${PROFILE_SOURCE}: default profile packages must use static literal lists`)
  }
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)
        || !required.has(declaration.name.text) && declaration.name.text !== 'INSTALLATION_OWNED_PROFILE_TUPLES'
        && declaration.name.text !== 'OPTIONAL_BUNDLES') continue
      if (declaration.initializer === undefined) continue
      if (required.has(declaration.name.text)) found.add(declaration.name.text)
      const before = packages.length
      literals(declaration.initializer, [declaration.name.text])
      if (declaration.name.text !== 'OPTIONAL_BUNDLES' && packages.length === before) {
        throw new Error(`${PROFILE_SOURCE}: ${declaration.name.text} has no default bundles`)
      }
    }
  }
  if (found.size !== required.size) throw new Error(`${PROFILE_SOURCE}: missing default profile declarations`)
  if (webBundles.length === 0) throw new Error(`${PROFILE_SOURCE}: missing default Web bundle list`)
  return { packages, webBundles, optionalBundles }
}
