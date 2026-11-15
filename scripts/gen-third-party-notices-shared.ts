/**
 * Shared vocabulary for the third-party-notice generator: the repository root,
 * the declaration-kind and package-identity policy, and the metadata tables the
 * readers resolve against.
 */

import { resolve } from 'node:path'

/** Repository root, derived from this module's directory under `scripts/`. */
export const root = resolve(import.meta.dirname, '..')

/** The generated artifact, repository-relative. */
export const OUT = 'THIRD_PARTY_NOTICES.md'

/** Dependency-declaration kinds a consumer resolves at runtime. */
export const RUNTIME_KINDS = ['dependencies', 'optionalDependencies'] as const
/** All manifest sections that name an external package this file must disclose. */
export const ALL_KINDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const

/** Official SDK identity covered by the project's narrow owner authorization. */
export const CLAUDE_AGENT_SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk'
export const CLAUDE_PLATFORM_PACKAGE_PREFIX = `${CLAUDE_AGENT_SDK_PACKAGE}-`
export const CLAUDE_PLATFORM_DECLARED_LICENSE = 'SEE LICENSE IN LICENSE.md'
export const LIBREOFFICE_KIT_PACKAGE = '@deepseek-ai/libreoffice-kit'
export const LIBREOFFICE_PACKAGES = new Set([
  LIBREOFFICE_KIT_PACKAGE,
  '@deepseek-ai/libreoffice-kit-wasm',
  '@deepseek-ai/libreoffice-kit-darwin-arm64',
  '@deepseek-ai/libreoffice-kit-darwin-x64',
  '@deepseek-ai/libreoffice-kit-win32-arm64',
  '@deepseek-ai/libreoffice-kit-win32-x64',
])

/**
 * Whether a non-permissive runtime declaration has an identity-scoped owner
 * authorization. This does not reclassify its terms as permissive.
 * @param name - exact npm package identity.
 * @returns true only for the official Claude Agent SDK package.
 */
export function isOwnerAuthorizedRuntime(name: string): boolean {
  return name === CLAUDE_AGENT_SDK_PACKAGE
}

/**
 * Metadata overrides where the installed manifest is wrong or unreachable.
 * Each entry documents why the store cannot answer.
 */
export const OVERRIDES: Record<string, { license?: string; repo?: string }> = {
  // Rust workspaces publishing npm bins without `license` in package.json.
  'oxlint': { license: 'MIT', repo: 'https://github.com/oxc-project/oxc' },
  'oxlint-tsgolint': { license: 'MIT', repo: 'https://github.com/oxc-project/tsgolint' },
  // `license: SEE LICENSE IN LICENSE`: the servers repo is mid MIT→Apache-2.0
  // relicensing, so the effective terms are per-contribution.
  '@modelcontextprotocol/server-everything': { license: 'MIT / Apache-2.0', repo: 'https://github.com/modelcontextprotocol/servers' },
  '@modelcontextprotocol/server-filesystem': { license: 'MIT / Apache-2.0', repo: 'https://github.com/modelcontextprotocol/servers' },
  // No repository field in the published manifest.
  'node-addon-require-builtin': { repo: 'https://www.npmjs.com/package/node-addon-require-builtin' },
  // No `license` field in the published manifest; the tarball's LICENSE.txt is the MIT text.
  'ssh2': { license: 'MIT', repo: 'https://github.com/mscdex/ssh2' },
}

/**
 * Python metadata is recorded from the distributions' license and project
 * fields; generation does not require installing their wheels. Both Python
 * manifests and the shared runtime lock reject names absent from this map.
 */
export const PYTHON_METADATA: Record<string, { license: string; repo: string; role?: string }> = {
  pydantic: { license: 'MIT', repo: 'https://github.com/pydantic/pydantic', role: 'runtime dependency of `deepseek-harness-sdk`' },
  hatchling: { license: 'MIT', repo: 'https://github.com/pypa/hatch', role: 'build backend' },
  'et-xmlfile': { license: 'MIT', repo: 'https://foss.heptapod.net/openpyxl/et_xmlfile' },
  lxml: { license: 'BSD-3-Clause', repo: 'https://github.com/lxml/lxml' },
  numpy: { license: 'BSD-3-Clause', repo: 'https://github.com/numpy/numpy' },
  openpyxl: { license: 'MIT', repo: 'https://foss.heptapod.net/openpyxl/openpyxl' },
  pandas: { license: 'BSD-3-Clause', repo: 'https://github.com/pandas-dev/pandas' },
  pillow: { license: 'MIT-CMU', repo: 'https://github.com/python-pillow/Pillow' },
  'python-dateutil': { license: 'Apache-2.0 OR BSD-3-Clause', repo: 'https://github.com/dateutil/dateutil' },
  'python-docx': { license: 'MIT', repo: 'https://github.com/python-openxml/python-docx' },
  'python-pptx': { license: 'MIT', repo: 'https://github.com/scanny/python-pptx' },
  pytest: { license: 'MIT', repo: 'https://github.com/pytest-dev/pytest', role: 'test-only' },
  six: { license: 'MIT', repo: 'https://github.com/benjaminp/six' },
  'typing-extensions': { license: 'PSF-2.0', repo: 'https://github.com/python/typing_extensions' },
  tzdata: { license: 'Apache-2.0', repo: 'https://github.com/python/tzdata' },
  xlsxwriter: { license: 'BSD-2-Clause', repo: 'https://github.com/jmcnamara/XlsxWriter' },
}

/** Disclosure metadata for one Python distribution. */
export type PythonMetadata = typeof PYTHON_METADATA

/** The `package.json` fields this generator reads. */
export interface Manifest {
  name?: string
  version?: string
  private?: boolean
  license?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}
