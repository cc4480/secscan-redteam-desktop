/**
 * Reads Python dependency declarations from the `pyproject.toml` manifests and
 * the shared runtime lock, normalizing distribution names on the way in.
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseToml, type TomlTableWithoutBigInt, type TomlValueWithoutBigInt } from 'smol-toml'
import { PYTHON_METADATA, root, type PythonMetadata } from './gen-third-party-notices-shared.ts'

/** Whether a parsed TOML value is a table rather than an array or scalar. */
function isTomlTable(value: TomlValueWithoutBigInt | undefined): value is TomlTableWithoutBigInt {
  return value !== undefined && typeof value === 'object' && !Array.isArray(value)
}

/** Parse one PEP 508 requirement string into its distribution name. */
function parsePythonRequirement(requirement: string): string {
  const name = /^\s*([a-zA-Z][a-zA-Z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(?:[<>=!~;@].*)?$/.exec(requirement)?.[1]
  if (name === undefined) {
    throw new Error(`gen-third-party-notices: cannot read a distribution name from the requirement ${JSON.stringify(requirement)}.`)
  }
  return name
}

/** Add the string requirements from one parsed TOML array. */
function collectPythonRequirementArray(
  names: string[],
  value: TomlValueWithoutBigInt | undefined,
  location: string,
  allowGroupIncludes = false,
): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    throw new Error(`gen-third-party-notices: ${location} must be an array.`)
  }
  for (const item of value) {
    if (typeof item === 'string') {
      names.push(parsePythonRequirement(item))
      continue
    }
    if (allowGroupIncludes && isTomlTable(item) && typeof item['include-group'] === 'string' && Object.keys(item).length === 1) {
      continue
    }
    throw new Error(`gen-third-party-notices: ${location} contains an unsupported requirement entry.`)
  }
}

/** Read an optional TOML table and reject a present non-table value. */
function optionalTomlTable(value: TomlValueWithoutBigInt | undefined, location: string): TomlTableWithoutBigInt | undefined {
  if (value === undefined || isTomlTable(value)) return value
  throw new Error(`gen-third-party-notices: ${location} must be a table.`)
}

/**
 * Parse a `pyproject.toml` project identity and every requirement it declares:
 * `requires` under
 * `[build-system]`, `dependencies` under `[project]`, and every key under
 * `[project.optional-dependencies]` and `[dependency-groups]`. A TOML parser
 * owns comments, quoted keys, escapes, and array boundaries; unsupported
 * requirement forms fail instead of disappearing from the notices.
 * @param text - the complete `pyproject.toml` contents.
 * @returns the local project name and declared requirement names.
 */
function parsePyproject(text: string): { projectName?: string; requirements: string[] } {
  const names: string[] = []
  const document = parseToml(text, { integersAsBigInt: false })
  const buildSystem = optionalTomlTable(document['build-system'], '[build-system]')
  const project = optionalTomlTable(document.project, '[project]')
  const projectName = project?.name
  if (projectName !== undefined && typeof projectName !== 'string') {
    throw new Error('gen-third-party-notices: [project].name must be a string.')
  }
  collectPythonRequirementArray(names, buildSystem?.requires, '[build-system].requires')
  collectPythonRequirementArray(names, project?.dependencies, '[project].dependencies')

  const optional = optionalTomlTable(project?.['optional-dependencies'], '[project.optional-dependencies]')
  for (const [group, requirements] of Object.entries(optional ?? {})) {
    collectPythonRequirementArray(names, requirements, `[project.optional-dependencies].${group}`)
  }

  const groups = optionalTomlTable(document['dependency-groups'], '[dependency-groups]')
  for (const [group, requirements] of Object.entries(groups ?? {})) {
    collectPythonRequirementArray(names, requirements, `[dependency-groups].${group}`, true)
  }
  return projectName === undefined
    ? { requirements: names }
    : { projectName, requirements: names }
}

/**
 * Read every requirement name declared by one `pyproject.toml`.
 * @param text - the complete `pyproject.toml` contents.
 * @returns each declared requirement's distribution name, in file order.
 */
export function parsePyprojectRequirements(text: string): string[] {
  return parsePyproject(text).requirements
}

/** Normalize a Python distribution name according to the packaging name rule. */
function normalizePythonDistributionName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}

/**
 * Resolve external Python dependencies after excluding local project names.
 * @param pyprojects - complete local `pyproject.toml` contents.
 * @param metadata - disclosure metadata for every external dependency.
 * @returns disclosed dependencies in normalized name order.
 */
export function collectPythonDependencies(
  pyprojects: string[],
  metadata: PythonMetadata = PYTHON_METADATA,
): { name: string; license: string; repo: string; role: string }[] {
  const parsed = pyprojects.map(parsePyproject)
  const firstParty = new Set(parsed.flatMap(({ projectName }) => (
    projectName === undefined ? [] : [normalizePythonDistributionName(projectName)]
  )))
  const found = new Set(parsed
    .flatMap(({ requirements }) => requirements.map(normalizePythonDistributionName))
    .filter(name => !firstParty.has(name)))
  return [...found].sort((a, b) => a.localeCompare(b)).map((name) => {
    const entry = metadata[name]
    if (entry === undefined) throw new Error(`gen-third-party-notices: python dependency ${name} is missing from PYTHON_METADATA.`)
    return { name, ...entry, role: entry.role ?? 'Python project dependency' }
  })
}

/** Direct Python dependencies named by the `pyproject.toml` manifests under `python/`. */
export function collectPython(): { name: string; license: string; repo: string; role: string }[] {
  const manifests = globSync('python/*/pyproject.toml', { cwd: root })
  if (manifests.length === 0) throw new Error('gen-third-party-notices: no python/*/pyproject.toml found; the Python tree moved.')
  return collectPythonDependencies(manifests.map(path => readFileSync(resolve(root, path), 'utf8')))
}

/**
 * Disclose every bundled wheel distribution using its locked version, rejecting duplicate normalized names.
 * @param packages - Distribution names and exact versions from the shared runtime lock.
 * @param metadata - License and source metadata for every locked distribution.
 * @returns Normalized, sorted distribution identities with versions and licenses.
 */
export function collectBundledPythonDependencies(
  packages: Readonly<Record<string, string>>,
  metadata: PythonMetadata = PYTHON_METADATA,
): { name: string; version: string; license: string; repo: string }[] {
  const normalized = new Map<string, string>()
  for (const [distribution, version] of Object.entries(packages)) {
    const name = normalizePythonDistributionName(distribution)
    const previous = normalized.get(name)
    if (previous !== undefined && previous !== version) {
      throw new Error(`gen-third-party-notices: bundled Python distribution ${name} has conflicting locked versions.`)
    }
    if (previous !== undefined) throw new Error(`gen-third-party-notices: bundled Python distribution ${name} has duplicate normalized names.`)
    normalized.set(name, version)
  }
  return [...normalized].sort(([a], [b]) => a.localeCompare(b)).map(([name, version]) => {
    const entry = metadata[name]
    if (entry === undefined) throw new Error(`gen-third-party-notices: bundled Python distribution ${name} is missing from PYTHON_METADATA.`)
    return { name, version, license: entry.license, repo: entry.repo }
  })
}
