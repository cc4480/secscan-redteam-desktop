/**
 * Default-product isolation check: follow the default installation's manifests, runtime sources, and
 * shipped compositions, and report every experimental package they reach.
 */

import { existsSync, globSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyEntryPatches, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { loadOverlayPatches } from '../packages/boot/app-boot/src/index.ts'
import { bundlePatchPaths, composeEntries } from '../packages/boot/app-boot/src/profile.ts'
import { isAgentPresetEntry, isCordisGroupEntry, loadCordisYaml } from './cordis-yaml.ts'
import { collectRuntimeSourceSpecifiers } from './verify-client-packages.ts'
import { loadProductGraph } from './verify-default-product-isolation-graph.ts'
import {
  barePackageName,
  displayPath,
  isRecord,
  resolveSource,
  runtimeLocalSpecifiers,
} from './verify-default-product-isolation-specifiers.ts'
import {
  EXPERIMENTAL_PREFIX,
  EXTERNAL_KIT_PACKAGES,
  PRESET_PATTERN,
  PROFILE_SOURCE,
  RUNTIME_SECTIONS,
  type Package,
  type ProductIsolationResult,
} from './verify-default-product-isolation-types.ts'
import { scanWebModuleEntries } from './verify-default-product-isolation-web-entry.ts'

/**
 * Check default app installations and their authored runtime/configuration inputs.
 * Experimental opt-in packages and separate Web preview entries are outside these roots.
 * @param root - repository root; no build outputs or installed workspace links are read.
 * @returns violations and the sizes of the checked package, source, and configuration sets.
 */
export function verifyDefaultProductIsolation(root: string): ProductIsolationResult {
  const failures: string[] = []
  const graph = loadProductGraph(root)
  failures.push(...graph.failures)
  const { packages, directories, cli, selection, optionalBundles, profilePath } = graph
  const display = (path: string): string => displayPath(root, path)

  const queue: Package[] = []
  const visited = new Set<string>()
  const sources = new Set<string>()
  const configs = new Set<string>()
  let webPluginCount = 0
  const isExperimental = (pkg: Package): boolean => pkg.manifest.name.startsWith(EXPERIMENTAL_PREFIX)
    || display(pkg.directory).startsWith('packages/experimental/')
  const add = (pkg: Package, origin: string): void => {
    if (isExperimental(pkg)) {
      failures.push(`${origin} -> ${pkg.manifest.name}: default product must not include experimental packages`)
    } else if (!visited.has(pkg.directory)) {
      visited.add(pkg.directory)
      queue.push(pkg)
    }
  }
  const ownerOf = (path: string): Package | undefined => {
    let directory = dirname(path)
    for (;;) {
      const pkg = directories.get(directory)
      if (pkg !== undefined) return pkg
      const parent = dirname(directory)
      if (parent === directory) return undefined
      directory = parent
    }
  }
  const reference = (name: string, origin: string, owner?: Package): void => {
    if (name.startsWith('.') || name.startsWith('/') || /^(?:file|link):/.test(name)) {
      const target = name.startsWith('file://') ? fileURLToPath(name)
        : resolve(owner?.directory ?? root, name.replace(/^(?:file|link):/, ''))
      const pkg = directories.get(target) ?? ownerOf(target)
      if (pkg !== undefined) add(pkg, origin)
      return
    }
    const packageName = barePackageName(name)
    if (packageName.startsWith(EXPERIMENTAL_PREFIX)) {
      failures.push(`${origin} -> ${name}: default product must not include experimental packages`)
      return
    }
    const pkg = packages.get(packageName)
    if (pkg !== undefined) add(pkg, origin)
    else if (EXTERNAL_KIT_PACKAGES.has(packageName)) return
    else if (packageName.startsWith('@deepseek-ai/')) failures.push(`${origin}: unknown workspace package ${name}`)
  }
  const dependency = (name: string, range: string, owner: Package, origin: string): void => {
    reference(name, origin, owner)
    if (/^(?:file:|link:|workspace:\.)/.test(range)) {
      reference(range.replace(/^workspace:/, ''), origin, owner)
    } else if (/^(?:npm:|workspace:)(?:@|[a-zA-Z])/.test(range)) {
      reference(range.replace(/^(?:npm:|workspace:)/, ''), origin, owner)
    }
  }
  const sourceReference = (specifier: string, path: string): void => {
    const owner = ownerOf(path)
    if (owner === undefined) return
    reference(specifier, display(path), owner)
    const name = barePackageName(specifier)
    const range = [...RUNTIME_SECTIONS, 'devDependencies' as const]
      .map(section => owner.manifest[section]?.[name]).find(value => value !== undefined)
    if (range !== undefined) dependency(name, range, owner, display(path))
  }
  const scanSource = (path: string, followLocal = false, inlineSource?: string): void => {
    if (sources.has(path)) return
    sources.add(path)
    const source = inlineSource ?? readFileSync(path, 'utf8')
    for (const specifier of collectRuntimeSourceSpecifiers(path, source)) sourceReference(specifier, path)
    for (const specifier of runtimeLocalSpecifiers(path, source)) {
      const local = followLocal && specifier.startsWith('/')
        ? resolve(root, 'apps/web', `.${specifier.replace(/[?#].*$/, '')}`)
        : resolve(dirname(path), specifier.replace(/[?#].*$/, ''))
      const target = resolveSource(local)
      const resolved = target ?? local
      const owner = directories.get(resolved) ?? ownerOf(resolved)
      if (owner !== undefined && isExperimental(owner)) add(owner, display(path))
      if (/cordis[^/]*\.ya?ml$/.test(basename(resolved))) scanConfig(resolved)
      if (followLocal && target !== undefined) scanSource(target, true)
    }
  }
  const scanEntries = (
    document: unknown[], path: string, composedWeb = false, includeStack: ReadonlySet<string> = new Set(),
  ): void => {
    const visit = (entry: unknown): void => {
      if (!isRecord(entry)) return
      if (typeof entry.name === 'string') {
        if (composedWeb) webPluginCount += 1
        const owner = ownerOf(path)
        if (entry.name.startsWith('.')) {
          const target = resolve(dirname(path), entry.name)
          const targetOwner = ownerOf(target)
          if (targetOwner !== undefined) add(targetOwner, display(path))
        } else reference(entry.name, display(path), owner)
      }
      if (isCordisGroupEntry(entry) || entry.name === 'cordis:group' && Array.isArray(entry.config)) {
        (entry.config as unknown[]).forEach(visit)
      }
      if (isAgentPresetEntry(entry)) entry.config.plugins.forEach(visit)
      if (Array.isArray(entry.insert)) entry.insert.forEach(visit)
      if ((entry.name === '@deepseek-ai/cordis-plugin-include' || entry.name === 'cordis:include') && isRecord(entry.config)) {
        if (!composedWeb && Array.isArray(entry.config.patches)) entry.config.patches.forEach(visit)
        const included = entry.config.path
        if (typeof included !== 'string') return
        const filename = included.startsWith('file:') ? fileURLToPath(included) : resolve(dirname(path), included)
        if (includeStack.has(filename)) {
          failures.push(`${display(path)}: cyclic Include path ${display(filename)}`)
          return
        }
        const nestedStack = new Set([...includeStack, filename])
        const initial = Array.isArray(entry.config.initial) ? entry.config.initial : undefined
        if (initial !== undefined) scanEntries(initial, filename, false, nestedStack)
        if (!composedWeb) {
          if (existsSync(filename) || initial === undefined) scanConfig(filename)
          return
        }
        const content = existsSync(filename) ? loadCordisYaml(readFileSync(filename, 'utf8')) : initial
        if (!Array.isArray(content)) {
          failures.push(`${display(filename)}: included composition must contain an entry array`)
          return
        }
        const entries = applyEntryPatches(content as EntryOptions[], entry.config.patches as PatchOptions[] | undefined, () => {})
        scanEntries(entries, filename, true, nestedStack)
      }
    }
    document.forEach(visit)
  }
  const scanConfig = (path: string): void => {
    if (configs.has(path)) return
    configs.add(path)
    const document = loadCordisYaml(readFileSync(path, 'utf8'))
    if (!Array.isArray(document)) {
      failures.push(`${display(path)}: shipped composition must contain an entry array`)
      return
    }
    scanEntries(document, path)
  }

  for (const pkg of packages.values()) {
    const path = display(pkg.directory)
    if (path.startsWith('apps/') || path === 'python/sdk-runtime') add(pkg, path)
  }
  if (selection !== undefined) {
    for (const name of selection.packages) {
      reference(name, PROFILE_SOURCE)
      if (packages.get(name)?.manifest.dsh?.bundle?.patch === undefined) {
        failures.push(`${PROFILE_SOURCE}: default bundle ${name} must declare dsh.bundle.patch`)
      }
      if (optionalBundles.has(name)) failures.push(`${PROFILE_SOURCE}: optional bundle ${name} must not be a default bundle`)
    }
    const webLayers = selection.webBundles.flatMap((name) => {
      const pkg = packages.get(name)
      const bundle = pkg?.manifest.dsh?.bundle
      if (pkg === undefined || bundle === undefined) return []
      return [bundlePatchPaths(pkg.directory, bundle).flatMap(file => loadOverlayPatches('verify-default-product-isolation', file))]
    })
    if (webLayers.length !== selection.webBundles.length) {
      failures.push(`${PROFILE_SOURCE}: default Web bundle layers are incomplete`)
    } else {
      const entries = composeEntries(webLayers)
      scanEntries(entries, profilePath, true)
      if (webPluginCount === 0) failures.push(`${PROFILE_SOURCE}: composed Web profile contains no plugins`)
    }
  } else failures.push(`missing default profile source ${PROFILE_SOURCE}`)
  const presets = globSync(PRESET_PATTERN, { cwd: root }).sort()
  if (presets.length === 0) failures.push(`no shipped presets matched ${PRESET_PATTERN}`)
  for (const path of presets) scanConfig(resolve(root, path))

  scanWebModuleEntries({ root, failures, scanSource })

  for (const pkg of queue) {
    const { manifest } = pkg
    for (const section of RUNTIME_SECTIONS) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        if (pkg === cli && section === 'dependencies' && optionalBundles.has(name)) continue
        dependency(name, range, pkg, `${manifest.name} ${section}`)
      }
    }
    for (const file of manifest.dsh?.bundle === undefined ? [] : bundlePatchPaths(pkg.directory, manifest.dsh.bundle)) scanConfig(file)
    for (const tree of manifest.dsh?.configTrees ?? []) {
      const treePath = resolve(pkg.directory, tree.path)
      const files = existsSync(treePath) && statSync(treePath).isDirectory()
        ? globSync('**/*.{yml,yaml}', { cwd: treePath, exclude: ['**/*.i18n.yaml', '**/preset.yml'] }) : []
      if (files.length === 0) failures.push(`${display(treePath)}: declared config tree has no composition files`)
      for (const path of files) scanConfig(resolve(treePath, path))
    }
    if (display(pkg.directory) === 'apps/web') continue
    const files = globSync('src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}', { cwd: pkg.directory,
      exclude: ['**/*.spec.*', '**/*.test.*', '**/*.d.ts', '**/tests/**', '**/__tests__/**', '**/node_modules/**'] })
    if (display(pkg.directory) === 'apps/cli' && files.length === 0) failures.push('apps/cli: no default runtime sources')
    for (const path of files) {
      const sourcePath = resolve(pkg.directory, path)
      if (statSync(sourcePath).isFile()) scanSource(sourcePath)
    }
  }
  return { failures: [...new Set(failures)], packageCount: visited.size,
    sourceCount: sources.size, configCount: configs.size, webPluginCount }
}
