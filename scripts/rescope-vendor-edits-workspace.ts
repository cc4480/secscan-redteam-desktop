/**
 * Exact edits at the vendored-import, gate-script, release-config,
 * root-contract, and client-build sites.
 */

import type { ExactEdit } from './rescope-vendor-types.ts'

export const WORKSPACE_EDITS: readonly ExactEdit[] = [
  {
    id: 'loader-diff-schemastery-import',
    file: 'vendor/loader/src/config/diff.ts',
    find: "import type Schema from 'schemastery'",
    replace: "import type Schema from '@deepseek-ai/schemastery'",
    expect: 1,
  },
  {
    id: 'cordis-walk-merge-head',
    file: 'scripts/cordis-walk.ts',
    find: 'const MERGE_HEAD = /declare module [\'"](?:cordis|\\.\\/context\\.ts)[\'"]/',
    replace: 'const MERGE_HEAD = /declare module [\'"](?:@deepseek-ai\\/cordis|\\.\\/context\\.ts)[\'"]/',
    expect: 1,
  },
  {
    id: 'constraints-manifest-lookup',
    file: 'scripts/workspace-release-checks.ts',
    find: `    const peer = manifest.peerDependencies?.cordis
    const dev = manifest.devDependencies?.cordis

    if (!peer) errors.push(\`\${label}: cordis must be a peerDependency\`)
    if (!dev) errors.push(\`\${label}: cordis must also be a devDependency\`)
    if (peer && dev && peer !== dev) {
      errors.push(\`\${label}: cordis peer (\${peer}) and dev (\${dev}) ranges must match\`)`,
    replace: `    const peer = manifest.peerDependencies?.['@deepseek-ai/cordis']
    const dev = manifest.devDependencies?.['@deepseek-ai/cordis']

    if (!peer) errors.push(\`\${label}: @deepseek-ai/cordis must be a peerDependency\`)
    if (!dev) errors.push(\`\${label}: @deepseek-ai/cordis must also be a devDependency\`)
    if (peer && dev && peer !== dev) {
      errors.push(\`\${label}: @deepseek-ai/cordis peer (\${peer}) and dev (\${dev}) ranges must match\`)`,
    expect: 1,
  },
  {
    // Rescoped packages are never fetched from a registry, so the exclusion is dead config.
    id: 'pnpm-release-age',
    file: 'pnpm-workspace.yaml',
    find: `minimumReleaseAgeExclude:
  # Cordis release candidates are source-vendored and pinned in vendor/README.md
  # during the same-day sync that updates package manifests and the lockfile.
  - '@cordisjs/plugin-loader@1.0.0-rc.5'
  - cordis@4.0.0-rc.7
`,
    replace: 'minimumReleaseAgeExclude:\n',
    expect: 1,
  },
  {
    id: 'publication-set-scope-assertion',
    file: 'scripts/publish-npm-baseline-workspace.ts',
    find: '      if (!isVendored && !name.startsWith(\'@deepseek-ai/\')) {',
    replace: `      // Vendored packages are rescoped too (vendor/README.md), so publication
      // never carries an upstream name that would squat it on the registry.
      if (!name.startsWith('@deepseek-ai/')) {`,
    expect: 1,
  },
  {
    id: 'vendor-readme-preamble',
    file: 'vendor/README.md',
    find: 'All vendored packages keep their **original npm names** (they are resolved through pnpm workspaces) and are marked `private: true` — they are never published from this repo.',
    replace: 'All vendored packages use the **`@deepseek-ai` scope** (`cordis` → `@deepseek-ai/cordis`, `@cordisjs/plugin-<x>` → `@deepseek-ai/cordis-plugin-<x>`). The manifest table records upstream versions and source commits; each package manifest carries its Harness release version and publication metadata. References to vendored packages use `workspace:~`, so local builds resolve the workspace packages and published ranges permit patch updates within the same minor version.',
    expect: 1,
  },
  {
    id: 'vendor-readme-table-head',
    file: 'vendor/README.md',
    find: '| Directory | npm name | Version | Upstream repo | Commit |\n|---|---|---|---|---|',
    replace: '| Directory | npm name | Upstream name | Version | Upstream repo | Commit |\n|---|---|---|---|---|---|',
    expect: 1,
  },
  {
    // The root contract claimed vendored packages keep their upstream names.
    id: 'root-agents-vendored-name-contract',
    file: 'AGENTS.md',
    find: 'vendored packages keep upstream names and are `private: true`. `cordis` is a peerDependency (+ dev) of every harness package.',
    replace: 'vendor is [rescoped](docs/rescope.md) and `private: true`. Harness packages declare `@deepseek-ai/cordis` in `peerDependencies`/`devDependencies`.',
    expect: 1,
  },
  {
    // The client purity gate reads `@deepseek-ai/` as "another plugin package".
    // The rescope moves the vendored framework and its libraries into that
    // namespace, where the gate would reject the library imports client
    // bundles have always inlined, so it needs their names.
    id: 'client-purity-vendored-libraries',
    file: 'packages/client/tsdown.client.ts',
    find: '/** Generated descriptor/codec contribution with no shared runtime identity. */',
    replace: `/**
 * Vendored framework libraries: rescoped into @deepseek-ai, so the gate below
 * would read them as plugin packages. They carry no cross-plugin runtime
 * identity to share — the framework itself is a requested module-table row
 * (external), while these are ordinary libraries a browser bundle inlines.
 */
const VENDORED_LIBRARY = /^@deepseek-ai\\/(cosmokit|schemastery)(\\/|$)/

/** Generated descriptor/codec contribution with no shared runtime identity. */`,
    expect: 1,
  },
  {
    id: 'client-purity-vendored-libraries-predicate',
    file: 'packages/client/tsdown.client.ts',
    find: '        if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null // wire contribution: inline is the point',
    replace: `        if (VENDORED_LIBRARY.test(source)) return null // vendored library: inline, no shared identity
        if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null // wire contribution: inline is the point`,
    expect: 1,
  },
]
