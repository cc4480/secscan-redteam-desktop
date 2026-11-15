/**
 * Renders the complete `THIRD_PARTY_NOTICES.md` document from the readers in
 * the sibling generator modules.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import primaryRuntimeLock from './primary-runtime/lock.json' with { type: 'json' }
import { browserBundledExternals } from './browser-bundled-externals.ts'
import {
  CLAUDE_AGENT_SDK_PACKAGE,
  CLAUDE_PLATFORM_DECLARED_LICENSE,
  LIBREOFFICE_KIT_PACKAGE,
  LIBREOFFICE_PACKAGES,
  root,
} from './gen-third-party-notices-shared.ts'
import { collectNpmDeps, loadWorkspaceManifests, type ExternalDep } from './gen-third-party-notices-manifests.ts'
import { workspaceLinkedManifestCache } from './gen-third-party-notices-store.ts'
import { collectClaudeDistribution, type ClaudeDistribution } from './gen-third-party-notices-claude.ts'
import { collectVendored } from './gen-third-party-notices-vendored.ts'
import { collectBundledPythonDependencies, collectPython } from './gen-third-party-notices-python.ts'
import { assertRuntimeLicenses, isPermissive } from './gen-third-party-notices-licenses.ts'

/** pnpm-patched external packages, from `pnpm-workspace.yaml`. */
function collectPatched(): { spec: string; patch: string }[] {
  const workspace = yaml.load(readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')) as { patchedDependencies?: Record<string, string> }
  return Object.entries(workspace.patchedDependencies ?? {}).map(([spec, patch]) => ({ spec, patch }))
}

/**
 * Render the sentence that isolates non-permissive development tooling, or
 * nothing at all when every development dependency is permissive.
 * @param deps - development dependencies whose license is not permissive.
 * @returns the paragraph to place after the development table.
 */
function renderNonPermissiveNote(deps: ExternalDep[]): string {
  if (deps.length === 0) return ''
  const named = deps.map(dep => `\`${dep.name}\` (${dep.license})`)
  const subject = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`
  return `\n${subject} ${named.length === 1 ? 'runs' : 'run'} only as development tooling; their code is not linked into or distributed with any DeepSeek Harness artifact.\n`
}

/** Render one npm dependency table. */
function renderNpmTable(deps: ExternalDep[]): string {
  const lines = ['| Package | License |', '| --- | --- |']
  for (const dep of deps) lines.push(`| [\`${dep.name}\`](${dep.repo}) | ${dep.license} |`)
  return lines.join('\n')
}

function renderClaudeDistribution(
  distribution: ClaudeDistribution | undefined,
): string {
  if (distribution === undefined) return ''
  const rows = distribution.payloads.map(payload =>
    `| [\`${payload.name}\`](https://www.npmjs.com/package/${payload.name}) | ${payload.version} | ${CLAUDE_PLATFORM_DECLARED_LICENSE} |`,
  )
  return `
## Official Claude Code platform payloads

The project owner authorizes distribution of every version of the official \`${CLAUDE_AGENT_SDK_PACKAGE}\` package and the official Claude Code CLI/platform payloads that each version declares through \`optionalDependencies\`. This identity-scoped authorization does not classify their declared terms as permissive and does not cover any unrelated runtime package; version, declared-license, and payload-set changes still require the ordinary dependency, lockfile, compatibility, terms, and notices review.

The installed SDK ${distribution.sdkVersion} declares the following optional platform packages. Each carries the official Claude Code ${distribution.claudeCodeVersion} executable; the package identities and versions come from the SDK manifest, while the declared license field is verified against the platform payload installed for the current host.

| Optional platform package | Version | Declared license |
| --- | --- | --- |
${rows.join('\n')}
`
}

/**
 * Render the complete notices document.
 * @returns The exact bytes THIRD_PARTY_NOTICES.md must hold after resolving browser inputs.
 */
export async function render(): Promise<string> {
  const browser = await browserBundledExternals(root)
  // The linked-manifest cache is keyed by name only, so it must not outlive
  // the manifests map it was resolved from; render() owns that single load.
  workspaceLinkedManifestCache.clear()
  const { manifests, names } = loadWorkspaceManifests()
  const npm = collectNpmDeps(manifests, names, browser)
  const runtimeDeps = npm.filter(dep => dep.runtime)
  const devDeps = npm.filter(dep => !dep.runtime)
  const kitRuntime = runtimeDeps.some(dep => dep.name === LIBREOFFICE_KIT_PACKAGE)
  const vendored = collectVendored()
  const python = collectPython()
  const bundledPython = collectBundledPythonDependencies(primaryRuntimeLock.pythonPackages)
  const patched = collectPatched()
  const claudeDistribution = runtimeDeps.some(
    dep => dep.name === CLAUDE_AGENT_SDK_PACKAGE,
  )
    ? collectClaudeDistribution(manifests)
    : undefined
  const nonPermissiveDev = devDeps.filter(dep => !isPermissive(dep.license))
  assertRuntimeLicenses(runtimeDeps)
  assertRuntimeLicenses(bundledPython)
  const patchedLines = patched.map(({ spec, patch }) => `- \`${spec}\` — [\`${patch}\`](${patch})`)

  return `<!-- Generated by scripts/gen-third-party-notices.ts — do not edit by hand.
     Run \`pnpm run gen-third-party-notices\` to regenerate. -->

# Third-Party Notices

DeepSeek Harness is licensed under [MIT](LICENSE). It depends on the third-party software listed below. Each project remains under its own license; nothing in this file changes those terms.

This file lists **direct** dependencies declared by the workspace, the explicitly disclosed official Claude Code platform payload closure, and the Bundled Python distributions. It is generated by \`scripts/gen-third-party-notices.ts\`: a pre-commit hook regenerates it whenever a staged file changes one of its inputs, and \`scripts/gen-third-party-notices.spec.ts\` asserts in the test lane that the committed bytes match. Deleting a manifest runs no hook, so that case is caught by the assertion instead. Run \`pnpm run verify-third-party-notices\` for the standalone check.

The complete npm transitive closure, including the Landlock launcher workspace, is recorded with exact pinned versions in [\`pnpm-lock.yaml\`](pnpm-lock.yaml) — inspect it with \`pnpm licenses list\`. The Python SDK closure is recorded separately in [\`python/sdk/uv.lock\`](python/sdk/uv.lock).

## Vendored source (\`vendor/\`)

The Cordis framework and its foundation libraries are source-vendored into this repository rather than consumed from npm, and republished under the \`@deepseek-ai\` scope. All are MIT-licensed; each directory preserves its upstream \`LICENSE\` file. Exact upstream commits and local modifications are recorded in [\`vendor/README.md\`](vendor/README.md).

| Package | Upstream name | Source | License |
| --- | --- | --- | --- |
${vendored.map(row => `| \`${row.npmName}\` | \`${row.upstreamName}\` | [${row.sourceDirectory}](${row.sourceDirectory}/) | MIT |`).join('\n')}

## Runtime npm dependencies

External packages installed for runtime use or distributed inside the prebuilt browser artifacts. Browser inputs are resolved through the shipping tsdown and Vite configurations, independently of npm dependency sections. The tier covers every plugin a user can mount from \`cordis.yml\` — not only what the \`dsh\` CLI, Web UI, and Python SDK runtime load by default.

${renderNpmTable(runtimeDeps)}

pnpm applies local patches to the following packages at install time, so shipped artifacts carry modified copies; each patch file is the complete record of the modification:

${patchedLines.join('\n')}
${renderClaudeDistribution(claudeDistribution)}
${kitRuntime ? `
## LibreOffice conversion kit

${[...LIBREOFFICE_PACKAGES].map(name => `\`${name}\``).join(', ')} declare MPL-2.0, which remains outside the permissive-license allowlist; the notices check accepts only these package identities at those terms. The [distribution decision](.agents/notes/implemented/architecture/2026-09-14-independent-libreoffice-kit.md) records the source obligations.

The [kit repository](https://github.com/deepseek-harness/libreoffice-kit) supplies the corresponding LibreOffice source pin, modifications, build instructions, Node API, and artifact validation. Its engine packages retain their license and third-party notices; the Node API retains its MPL-2.0 declaration and NOTICE. Recipients must have access to those corresponding sources and notices.
` : ''}

## Development-only npm dependencies

External packages **directly declared** for development, tests, types, or tooling, without a runtime installation or browser-build relationship. A package here may still be pulled in transitively by a runtime dependency — \`pnpm-lock.yaml\` is the authority on that full closure.

${renderNpmTable(devDeps)}
${renderNonPermissiveNote(nonPermissiveDev)}
## Python SDK dependencies (\`python/\`)

Direct dependencies of the \`pyproject.toml\` manifests, plus \`uv\` as the development workflow tool.

| Package | License | Role |
| --- | --- | --- |
${python.map(dep => `| [\`${dep.name}\`](${dep.repo}) | ${dep.license} | ${dep.role} |`).join('\n')}
| [\`uv\`](https://github.com/astral-sh/uv) | MIT / Apache-2.0 | development workflow tool |

## Bundled Python distributions

The [shared runtime lock](scripts/primary-runtime/lock.json) records each distribution version and the wheel download hashes. The table includes every entry in \`pythonPackages\`, including transitive dependencies. Wheel extraction preserves distribution metadata and the license and notice files supplied by each archive. Project licenses below do not enumerate the separate licenses of native libraries bundled inside wheels.

| Distribution | Locked version | Project license |
| --- | --- | --- |
${bundledPython.map(dep => `| [\`${dep.name}\`](${dep.repo}) | ${dep.version} | ${dep.license} |`).join('\n')}

## First-party native packages

\`@deepseek-ai/node-addon-system\` (and its platform packages) is built and released from this repository under BSD 3-Clause. It is listed here for completeness; it is first-party, not third-party.
`
}
