/** Canonical `files` payloads of the dsh package family. */

import { hasTypertRemoteNavigation } from './publication-payload.ts'
import type { PackageManifest } from './workspace-manifest-types.ts'
import { bundlePatchFiles } from '../packages/boot/app-boot/src/profile.ts'

/** Package-specific payloads beyond the canonical runtime and declaration entries. */
const packageFileExtras: Readonly<Record<string, readonly string[]>> = {
  // Owned Worker bundles import this public bootstrap before their business entry.
  '@deepseek-ai/dsh-app-boot': ['lib/worker/profile-resolution-bootstrap.js'],
  // Statically linked client libraries keep their stylesheets next to the emitted
  // JavaScript, which imports them by relative path: the compile shell runs
  // them through its own CSS pipeline, so the sheets are published artifacts.
  // The glob covers whichever sheets a package emits; sourcemaps stay
  // unpublished, as everywhere else in the repository.
  '@deepseek-ai/dsh-client-ui-primitives': ['lib/**/*.css'],
  '@deepseek-ai/dsh-client-ui-dockkit': ['lib/**/*.css'],
  '@deepseek-ai/dsh-client-ui-sidebar-documentpreview': ['lib/client.*.js'],
  '@deepseek-ai/dsh-client-ui-sidebar-terminal': ['lib/client.*.js'],
  '@deepseek-ai/dsh-client-web': ['lib/**/*.css', 'lib/apply-injections.js'],
  '@deepseek-ai/dsh-client-ui-theme': ['lib/styles'],
  // The CPython side ships as source .py files, published as-is rather than built.
  '@deepseek-ai/dsh-experimental-ptc-runtime-python': ['py/**/*.py'],
  '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice': ['runtime/assets.json'],
  // The isolated Node bootstrap is a separately launched bundle.
  '@deepseek-ai/dsh-ptc-runtime-node': ['lib/process.js'],
  // The Host entry starts its sibling Worker by URL rather than a package export.
  '@deepseek-ai/dsh-experimental-inspector': ['lib/worker.js'],
  // Creator's composition guidance travels with the declaration package.
  '@deepseek-ai/dsh-agent-preset': ['skills'],
  // The Web Host mounts the default-off settings owner independently of each
  // Agent-scoped delegation-tool instance.
  '@deepseek-ai/dsh-tool-subagent': ['lib/model-selection-settings.js'],
  // The JSONL backend resolves its private verification Worker relative to
  // import.meta.url; it is shipped without a public package subpath.
  '@deepseek-ai/dsh-session-persistence-jsonl': ['lib/worker.cjs'],
  // The argv-prefix runner entry ships beside the lib as its own bundle;
  // sandbox-local resolves it through the package's ./runner export. tsdown
  // also shares its generated FFI code through a hashed runtime chunk.
  '@deepseek-ai/dsh-sandbox-windows-acl': ['lib/runner.js', 'lib/types-*.js'],
  '@deepseek-ai/dsh-skill-badge': ['assets'],
  '@deepseek-ai/dsh-skill-office': ['assets'],
  '@deepseek-ai/dsh-subprocess': ['lib/control.js'],
  // SSH launches a private helper and shares wire definitions and TLS setup
  // between that helper and the connection owner.
  '@deepseek-ai/dsh-ssh': [
    'lib/helper.js', 'lib/protocol.js', 'lib/schemas.js',
    'lib/protocol-*.js', 'lib/schemas-*.js', 'lib/stream-security-*.js',
  ],
  // Ordinary native containment ships a path-loaded runner and its shared
  // runner chunk beside the existing node-pty permission repair.
  '@deepseek-ai/dsh-subprocess-local': [
    'lib/runner.js',
    'lib/runner-*.js',
    'lib/output.js',
    'scripts/ensure-spawn-helper.mjs',
  ],
  // tsdown shares the repository/pack code between the lib entry and the bin
  // through a hashed chunk. The committed bin.js is the link target pnpm can
  // resolve at install time, before the build produces lib/bin.js.
  '@deepseek-ai/dsh-experimental-webworker-packer': ['bin.js', 'lib/repository-*.js'],
  // The headless entry and its startup row share the JSON projection code
  // through a hashed tsdown chunk; both import it by relative path.
  '@deepseek-ai/dsh-headless': ['lib/json-stream-*.js'],
}

/**
 * Compute canonical publication patterns, including the declared icon and exported locale JSON resources.
 * @param manifest - workspace package manifest.
 * @returns the icon and deduplicated locale targets followed by runtime and declaration payloads.
 */
export function expectedDshPackageFiles(manifest: PackageManifest): readonly string[] {
  const localeFiles = new Set<string>()
  for (const resource of Object.keys(manifest.exports ?? {})) {
    if (!/^\.\/(?:.+\/)?locale\/[^/]+\.json$/u.test(resource)) continue
    const target = exportDefault(manifest, resource)
    if (target?.startsWith('./') && target.endsWith('.json')) localeFiles.add(target.slice(2))
  }
  const bundle = manifest.dsh?.bundle
  const bundleFiles = bundle === undefined ? [] : bundlePatchFiles(bundle).map(file => file.replace(/^\.\//, ''))
  const extras = [
    ...bundleFiles,
    ...(manifest.name ? packageFileExtras[manifest.name] ?? [] : []),
  ]
  return [
    ...typeof manifest.icon === 'string' ? [manifest.icon.replace(/^\.\//u, '')] : [],
    ...[...localeFiles].sort(),
    'lib/index.js',
    // Packages with an invariant export publish its runtime as a separate
    // bundle; the package-invariant gate validates the source/export pairing.
    ...manifest.exports?.['./invariant'] ? ['lib/invariant.js'] : [],
    ...manifest.bin ? ['lib/bin.js'] : [],
    // Worker-thread packages ship a CJS worker entry; the browser worker
    // bundle is an ES module a page loads with `new Worker(type: 'module')`.
    // Keyed on the artifact path, like ./client below.
    ...exportDefault(manifest, './worker') === './lib/worker.cjs' ? ['lib/worker.cjs'] : [],
    ...exportDefault(manifest, './worker') === './lib/worker.js' ? ['lib/worker.js'] : [],
    // UI plugin packages ship their browser bundle beside the node lib
    // (single-artifact ruling: dist/ retired, ./client resolves lib/client.js).
    // Keyed on the artifact path, not the subpath name: a package's ./client is
    // a browser-safe source channel, not a bundle.
    ...exportDefault(manifest, './client') === './lib/client.js' ? ['lib/client.js'] : [],
    // runtime's shell-held loader subpath ships as its own bundle beside the client half.
    ...exportDefault(manifest, './loader') === './lib/loader.js' ? ['lib/loader.js'] : [],
    // A store subpath ships its own bundle (single-entry builds; no shared chunk).
    ...exportDefault(manifest, './store') === './lib/store/index.js' ? ['lib/store/index.js'] : [],
    // A surface bundle's startup row is its own bundle: the Loader imports it
    // as a row module, so it cannot ride inside the package entry.
    ...exportDefault(manifest, './startup') === './lib/startup.js' ? ['lib/startup.js'] : [],
    ...extras,
    // Subpaths whose runtime default is the tsc-emitted tree (lib/types/*.js —
    // browser-safe source channels rehomed off src so plain Node can import
    // them without type stripping) publish the emitted JS alongside the
    // declarations.
    ...usesEmittedTreeDefaults(manifest) ? ['lib/types/**/*.js'] : [],
    'lib/types/**/*.d.ts',
    ...hasExportPair(manifest, './typert', './lib/typert.host.d.ts', './lib/typert.host.js')
      ? ['lib/typert.host.js', 'lib/typert.host.d.ts']
      : [],
    ...hasExportPair(manifest, './client/typert', './lib/typert.client.d.ts', './lib/typert.client.js')
      ? ['lib/typert.client.js', 'lib/typert.client.d.ts']
      : [],
    ...hasTypertRemoteNavigation(manifest)
      ? ['lib/typert.remote-client.js', 'lib/typert.remote-client.d.ts']
      : [],
  ]
}

/** Whether one conditional export exactly names the generated runtime and declaration pair. */
function hasExportPair(
  manifest: PackageManifest,
  subpath: string,
  types: string,
  runtime: string,
): boolean {
  const entry = manifest.exports?.[subpath]
  return typeof entry === 'object'
    && entry !== null
    && entry.types === types
    && entry.default === runtime
}

/** Runtime target of an export entry: conditional `default`, or the bare-string shorthand. */
function exportDefault(manifest: PackageManifest, subpath: string): string | undefined {
  const entry = manifest.exports?.[subpath]
  if (typeof entry === 'string') return entry
  if (typeof entry === 'object' && entry !== null) return entry.default
  return undefined
}

/** Whether any export's runtime default points into the tsc-emitted lib/types tree. */
function usesEmittedTreeDefaults(manifest: PackageManifest): boolean {
  return Object.keys(manifest.exports ?? {}).some(subpath =>
    exportDefault(manifest, subpath)?.startsWith('./lib/types/') === true)
}
