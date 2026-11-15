/**
 * Exact edits at the cookbook, preset-import, license-notice, packed-install,
 * and vendored-manifest-row sites.
 */

import { RENAMES } from './rescope-vendor-renames.ts'
import type { ExactEdit } from './rescope-vendor-types.ts'

export const RECORD_EDITS: readonly ExactEdit[] = [
  {
    // The step-1 file tree told the reader to keep the upstream name, one
    // paragraph above the invariant that says to rescope it.
    id: 'vendoring-cookbook-tree-comment',
    file: 'docs/cookbook/adding-a-vendored-package.md',
    find: '  package.json     # from upstream; set "private": true, keep name/exports/type',
    replace: '  package.json     # from upstream; rescope the name, keep exports/type (publishable release member, no private flag)',
    expect: 1,
  },
  {
    id: 'vendoring-cookbook-tree-comment-zh',
    file: 'docs/cookbook/adding-a-vendored-package.zh.md',
    find: '  package.json     # from upstream; set "private": true, keep name/exports/type',
    replace: '  package.json     # from upstream; rescope the name, keep exports/type (publishable release member, no private flag)',
    expect: 1,
  },
  {
    // The checklist told the next vendoring to keep upstream's name.
    id: 'vendoring-cookbook-name-invariant',
    file: 'docs/cookbook/adding-a-vendored-package.md',
    find: "keep upstream's `name`/`version`/`exports`/`type`",
    replace: "rescope the `name` ([mapping](../rescope.md)) while keeping upstream's `exports`/`type`",
    expect: 1,
  },
  {
    id: 'vendoring-cookbook-name-invariant-zh',
    file: 'docs/cookbook/adding-a-vendored-package.zh.md',
    find: '保留上游的 `name`/`version`/`exports`/`type`',
    replace: '改写 `name` 的 scope（[映射](../rescope.zh.md)），保留上游的 `exports`/`type`',
    expect: 1,
  },
  {
    // The real package references in files whose other `cordis` strings are preset ids.
    id: 'agent-preset-spec-framework-import',
    file: 'packages/client/ui-agent-preset/tests/apply.client.spec.ts',
    find: "import { Context } from 'cordis'",
    replace: "import { Context } from '@deepseek-ai/cordis'",
    expect: 1,
  },
  {
    id: 'web-agent-presets-e2e-framework-import',
    file: 'apps/cli/tests/web-agent-presets.e2e.ts',
    find: "import { Context } from 'cordis'",
    replace: "import { Context } from '@deepseek-ai/cordis'",
    expect: 1,
  },
  {
    id: 'notices-vendored-row-type',
    file: 'scripts/gen-third-party-notices-vendored.ts',
    find: `export interface VendoredRow {
  npmName: string
  upstream: string
}`,
    replace: `export interface VendoredRow {
  npmName: string
  /** The name this package carries upstream; MIT attribution names the fork's origin, not our scope. */
  upstreamName: string
  upstream: string
}`,
    expect: 1,
  },
  {
    id: 'notices-vendored-row-parse',
    file: 'scripts/gen-third-party-notices-vendored.ts',
    find: `    const match = /^\\| \\x60\\S+\\/\\x60 \\| \\x60([^\\x60]+)\\x60 \\| \\S+ \\| (https:\\/\\/\\S+?)(?: \\([^)]*\\))? \\| \\x60[0-9a-f]+\\x60 \\|$/.exec(line)
    if (match === null) continue
    const [, npmName, upstream] = match
    if (npmName === undefined || upstream === undefined) continue
    rows.push({ npmName, upstream })`,
    replace: `    const match = new RegExp(String.raw\`^\\| \\x60\\S+\\/\\x60 \\| \\x60([^\\x60]+)\\x60 \\| \\x60([^\\x60]+)\\x60 \\| \\S+ \\| \`
      + String.raw\`(https:\\/\\/\\S+?)(?: \\([^)]*\\))? \\| \\x60[0-9a-f]+\\x60 \\|$\`).exec(line)
    if (match === null) continue
    const [, npmName, upstreamName, upstream] = match
    if (npmName === undefined || upstreamName === undefined || upstream === undefined) continue
    rows.push({ npmName, upstreamName, upstream })`,
    expect: 1,
  },
  {
    id: 'notices-vendored-section',
    file: 'scripts/gen-third-party-notices-render.ts',
    find: 'The Cordis framework and its foundation libraries are source-vendored into this repository rather than consumed from npm. All are MIT-licensed',
    replace: 'The Cordis framework and its foundation libraries are source-vendored into this repository rather than consumed from npm, and republished under the \\`@deepseek-ai\\` scope. All are MIT-licensed',
    expect: 1,
  },
  {
    id: 'notices-vendored-table',
    file: 'scripts/gen-third-party-notices-render.ts',
    find: `| Package | Upstream | License |
| --- | --- | --- |
\${vendored.map(row => \`| \\\`\${row.npmName}\\\` | [\${row.upstream.replace('https://', '')}](\${row.upstream}) | MIT |\`).join('\\n')}`,
    replace: `| Package | Upstream name | Source | License |
| --- | --- | --- | --- |
\${vendored.map(row => \`| \\\`\${row.npmName}\\\` | \\\`\${row.upstreamName}\\\` | [\${row.sourceDirectory}](\${row.sourceDirectory}/) | MIT |\`).join('\\n')}`,
    expect: 1,
  },
  {
    id: 'notices-spec-row-fixture',
    file: 'scripts/gen-third-party-notices.spec.ts',
    find: '    expect(rows).toContainEqual({ npmName: \'cordis\', upstream: \'https://github.com/cordiverse/cordis\' })',
    replace: `    expect(rows).toContainEqual({
      npmName: '@deepseek-ai/cordis',
      upstreamName: 'cordis',
      upstream: 'https://github.com/cordiverse/cordis',
    })`,
    expect: 1,
  },
  {
    id: 'notices-spec-shape-fixture',
    file: 'scripts/gen-third-party-notices.spec.ts',
    find: 'parseVendoredRows(\'| `cordis/` | cordis | 4.0.0 | https://example.com | `abc123` |\\n\')',
    replace: 'parseVendoredRows(\'| `cordis/` | `@deepseek-ai/cordis` | cordis | 4.0.0 | https://example.com | `abc123` |\\n\')',
    expect: 1,
  },
  {
    id: 'packed-install-registry-spec',
    file: 'packages/sandbox/sandbox-local/tests/packed-install.e2e.ts',
    find: `    // Peer ranges resolve to the tarballs; Cordis is pinned to their peer range. Do not omit optional
    // dependencies because the launcher selects its OS/CPU package through one.
    writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({ name: 'dsh-packed-consumer', private: true, type: 'module' }))
    const install = spawnSync('npm', ['install', '--no-audit', '--no-fund', ...tarballs, 'cordis@4.0.0-rc.7'], {`,
    replace: `    // Peer ranges resolve to the tarballs, the framework peer included. Do not omit optional
    // dependencies because the launcher selects its OS/CPU package through one.
    writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({ name: 'dsh-packed-consumer', private: true, type: 'module' }))
    const install = spawnSync('npm', ['install', '--no-audit', '--no-fund', ...tarballs], {`,
    expect: 1,
  },
  {
    id: 'packed-install-module-doc',
    file: 'packages/sandbox/sandbox-local/tests/packed-install.e2e.ts',
    find: ` * Keyless publish-path rehearsal. It packs the provider, its workspace peers, and the current
 * repository's Landlock entry/platform packages, then installs those exact tarballs in an external
 * plain-Node consumer. The host launcher comes from the exact local tarballs, so no registry copy,
 * tsx, path mapping, or workspace resolution can hide missing files, dependency errors, or lost
 * executable modes.`,
    replace: ` * Keyless publish-path rehearsal. It packs the provider, its workspace peers, the vendored framework
 * peer, and the current repository's Landlock entry/platform packages, then installs those exact
 * tarballs in an external plain-Node consumer. The host launcher comes from the exact local tarballs,
 * so no registry copy, tsx, path mapping, or workspace resolution can hide missing files, dependency
 * errors, or lost executable modes.`,
    expect: 1,
  },
  // The manifest table's name column plus the new upstream-name column, one edit per row.
  ...RENAMES.map(rename => ({
    id: `vendor-readme-row-${rename.directory}`,
    file: 'vendor/README.md',
    find: `| \`${rename.directory}/\` | \`${rename.upstream}\` | `,
    replace: `| \`${rename.directory}/\` | \`${rename.scoped}\` | \`${rename.upstream}\` | `,
    expect: 1,
  })),
]
