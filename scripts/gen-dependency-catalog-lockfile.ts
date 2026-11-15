/** Read npm's recorded lockfile as production dependency rows for the catalog. */

import { ENTRY, PACKAGE, REGISTRY } from './gen-dependency-catalog-paths.ts'

/** npm lockfile fields used to describe an installed package or optional candidate. */
interface PackageEntry {
  name?: string
  version: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  dev?: boolean
  optional?: boolean
  peer?: boolean
  os?: string[]
  cpu?: string[]
  libc?: string[]
}

/** One package location in npm's resolved tree; duplicate versions retain their locations. */
export interface DependencyRow {
  readonly location: string
  readonly name: string
  readonly version: string
  readonly direct: boolean
  readonly optional: boolean
  readonly peer: boolean
  readonly os?: readonly string[]
  readonly cpu?: readonly string[]
  readonly libc?: readonly string[]
}

/**
 * Read a JSON object field.
 * @param value - Candidate JSON value.
 * @param label - Failure label naming the field being read.
 * @returns The value as an object map.
 */
export function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`dependency-catalog: ${label} must be an object`)
  }
  return value as Record<string, unknown>
}

/**
 * Read a nonempty single-line JSON string field.
 * @param value - Candidate JSON value.
 * @param label - Failure label naming the field being read.
 * @returns The value as a string.
 */
export function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || /[\r\n]/.test(value)) {
    throw new Error(`dependency-catalog: ${label} must be a nonempty single-line value`)
  }
  return value
}

function parseEntry(value: unknown, location: string): PackageEntry {
  const raw = record(value, location)
  const entry: PackageEntry = { version: string(raw['version'], `${location} version`) }
  if (raw['name'] !== undefined) entry.name = string(raw['name'], `${location} name`)
  if (raw['link'] === true) throw new Error(`dependency-catalog: ${location} is a local link`)
  const source = new URL(string(raw['resolved'], `${location} resolved`))
  if (source.origin !== new URL(REGISTRY).origin || source.username !== '' || source.password !== '') {
    throw new Error(`dependency-catalog: ${location} is not resolved from the public npm registry`)
  }
  for (const key of ['dev', 'optional', 'peer'] as const) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'boolean') throw new Error(`dependency-catalog: ${location} ${key} must be boolean`)
    entry[key] = raw[key]
  }
  for (const key of ['dependencies', 'optionalDependencies'] as const) {
    if (raw[key] === undefined) continue
    entry[key] = Object.fromEntries(Object.entries(record(raw[key], `${location} ${key}`))
      .map(([name, spec]) => [string(name, 'dependency name'), string(spec, `${location} ${name}`)]))
  }
  for (const key of ['os', 'cpu', 'libc'] as const) {
    const values = raw[key]
    if (values === undefined) continue
    if (!Array.isArray(values)) throw new Error(`dependency-catalog: ${location} ${key} must be an array`)
    entry[key] = values.map(value => string(value, `${location} ${key}`))
  }
  return entry
}

/**
 * Read npm's resolved production tree without substituting workspace or development dependencies.
 * @param input - Parsed npm lockfile v3 from a consumer with only dsh as its dependency.
 * @returns The CLI version and sorted package locations, excluding the synthetic consumer and CLI itself.
 */
export function collectDependencies(input: unknown): { version: string; rows: DependencyRow[] } {
  const lock = record(input, 'lockfile')
  if (lock['lockfileVersion'] !== 3) throw new Error('dependency-catalog: expected npm lockfileVersion 3')
  const packages = record(lock['packages'], 'packages')
  const consumer = record(packages[''], 'consumer')
  const requested = record(consumer['dependencies'], 'consumer dependencies')
  if (Object.keys(requested).length !== 1 || requested[PACKAGE] !== 'latest') {
    throw new Error(`dependency-catalog: consumer must request only ${PACKAGE}@latest`)
  }
  const entries = new Map(Object.entries(packages).filter(([location]) => location !== '')
    .map(([location, entry]) => [location, parseEntry(entry, location)]))
  const cli = entries.get(ENTRY)
  if (cli === undefined || cli.dev) throw new Error(`dependency-catalog: missing production ${PACKAGE}`)
  const direct = new Set<string>()
  for (const name of Object.keys({ ...cli.dependencies, ...cli.optionalDependencies })) {
    const location = [`${ENTRY}/node_modules/${name}`, `node_modules/${name}`]
      .find(candidate => entries.has(candidate))
    if (location === undefined) {
      if (cli.optionalDependencies?.[name] !== undefined) continue
      throw new Error(`dependency-catalog: missing direct dependency ${name}`)
    }
    direct.add(location)
  }
  const rows: DependencyRow[] = []
  for (const [location, entry] of entries) {
    if (location === ENTRY || entry.dev) continue
    const name = location.split('node_modules/').at(-1)
    if (name === undefined || !/^(@[^/]+\/)?[^/]+$/.test(name)) {
      throw new Error(`dependency-catalog: invalid npm package location ${location}`)
    }
    rows.push({
      location,
      name: entry.name ?? name,
      version: entry.version,
      direct: direct.has(location),
      optional: entry.optional === true,
      peer: entry.peer === true,
      ...(entry.os === undefined ? {} : { os: entry.os }),
      ...(entry.cpu === undefined ? {} : { cpu: entry.cpu }),
      ...(entry.libc === undefined ? {} : { libc: entry.libc }),
    })
  }
  if (rows.length === 0) throw new Error('dependency-catalog: empty dependency tree')
  rows.sort((a, b) => a.name.localeCompare(b.name, 'en')
    || a.version.localeCompare(b.version, 'en') || a.location.localeCompare(b.location, 'en'))
  return { version: cli.version, rows }
}

/**
 * Combine identical package versions while retaining each installation's npm flags and platform constraints.
 * @param rows - Resolved package locations, excluding the consumer and CLI.
 * @returns One sorted record per package name and version, with sorted installation locations.
 */
export function deduplicateDependencies(rows: readonly DependencyRow[]): {
  name: string
  version: string
  installations: Omit<DependencyRow, 'name' | 'version'>[]
}[] {
  const packages = new Map<string, {
    name: string
    version: string
    installations: Omit<DependencyRow, 'name' | 'version'>[]
  }>()
  for (const { name, version, ...installation } of rows) {
    const key = JSON.stringify([name, version])
    const dependency = packages.get(key) ?? { name, version, installations: [] }
    dependency.installations.push(installation)
    packages.set(key, dependency)
  }
  const sorted = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name, 'en')
    || a.version.localeCompare(b.version, 'en'))
  for (const dependency of sorted) {
    dependency.installations.sort((a, b) => a.location.localeCompare(b.location, 'en'))
  }
  return sorted
}
