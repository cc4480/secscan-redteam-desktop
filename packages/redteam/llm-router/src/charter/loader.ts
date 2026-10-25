import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROLE_ADDENDA, type CharterRole } from './addenda.js'

export { CHARTER_ROLES, ROLE_ADDENDA, type CharterRole } from './addenda.js'

/**
 * The engagement fields the charter requires. Every field maps to one
 * placeholder in the charter asset and must be present and non-empty:
 * no charter, no run.
 */
export interface CharterEngagement {
  /** Fills {{ENGAGEMENT_ID}}. */
  engagementId: string
  /** Fills {{OWNER}}: the client or target owner on the engagement record. */
  owner: string
  /** Fills {{PROOF_METHOD}}: how target ownership was verified. */
  proofMethod: string
  /** Fills {{IN_SCOPE}}: the in-scope targets for the engagement. */
  inScope: string
}

/** A charter asset, engagement record, or role is unusable. Always fatal. */
export class CharterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CharterError'
  }
}

const PLACEHOLDER_FIELDS: ReadonlyArray<readonly [placeholder: string, field: keyof CharterEngagement]> = [
  ['ENGAGEMENT_ID', 'engagementId'],
  ['OWNER', 'owner'],
  ['PROOF_METHOD', 'proofMethod'],
  ['IN_SCOPE', 'inScope'],
]

/**
 * Candidate locations of the charter asset, in resolution order. The first
 * candidate serves runs from the source tree (the module sits beside the
 * asset); the second serves compiled output, which lives three levels below
 * the package root (lib/types/charter or dist-test/src/charter) while the
 * asset stays at src/charter/charter.md.
 *
 * @returns the candidate asset paths
 */
export function charterAssetCandidates(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  return [
    join(moduleDir, 'charter.md'),
    join(moduleDir, '..', '..', '..', 'src', 'charter', 'charter.md'),
  ]
}

/**
 * Resolve the bundled charter asset path.
 *
 * @returns the first candidate path that exists
 * @throws CharterError when no candidate exists
 */
export function defaultCharterPath(): string {
  const candidates = charterAssetCandidates()
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new CharterError(`charter asset not found; searched: ${candidates.join(', ')}`)
}

/**
 * Read the charter asset text.
 *
 * @param path - the asset path; defaults to {@link defaultCharterPath}
 * @returns the asset text, trimmed
 * @throws CharterError when the asset is unreadable or empty
 */
export function loadCharterText(path: string = defaultCharterPath()): string {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    throw new CharterError(
      `charter asset unreadable: ${path} (${err instanceof Error ? err.message : String(err)})`,
    )
  }
  const text = raw.trim()
  if (text.length === 0) throw new CharterError(`charter asset is empty: ${path}`)
  return text
}

let cachedCharterText: string | undefined

/**
 * The bundled charter asset text, loaded once per process.
 *
 * @returns the charter asset text
 * @throws CharterError when the asset cannot be resolved or read
 */
export function defaultCharterText(): string {
  cachedCharterText ??= loadCharterText()
  return cachedCharterText
}

/**
 * Fill the charter's engagement placeholders from an engagement record.
 * Fails loud: a missing or empty field throws instead of reaching a model
 * as a blank authorization.
 *
 * @param charterText - the charter asset text
 * @param engagement - the engagement record supplying the field values
 * @returns the charter text with every placeholder substituted
 * @throws CharterError when a field is missing or empty, or when the asset
 * carries a placeholder with no matching field
 */
export function fillCharter(charterText: string, engagement: CharterEngagement): string {
  const record = engagement as Partial<CharterEngagement> | null | undefined
  let filled = charterText
  for (const [placeholder, field] of PLACEHOLDER_FIELDS) {
    const value = record?.[field]
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new CharterError(
        `charter engagement field missing or empty: ${field} ({{${placeholder}}})`,
      )
    }
    filled = filled.replaceAll(`{{${placeholder}}}`, value)
  }
  const leftover = filled.match(/\{\{[A-Z_]+\}\}/)
  if (leftover !== null) {
    throw new CharterError(`charter asset carries an unfilled placeholder: ${leftover[0]}`)
  }
  return filled
}

/**
 * Look up the charter addendum for a role.
 *
 * @param role - the charter role key
 * @returns the role's addendum text
 * @throws CharterError when the role is not a known charter role
 */
export function roleAddendum(role: string): string {
  const addendum = (ROLE_ADDENDA as Record<string, string>)[role]
  if (addendum === undefined) {
    throw new CharterError(
      `unknown charter role: ${JSON.stringify(role)} (expected one of: ${Object.keys(ROLE_ADDENDA).join(', ')})`,
    )
  }
  return addendum
}

/**
 * Assemble the system prompt for one agent call: the filled charter first,
 * the role addendum after it. The charter is never omitted or defaulted —
 * any failure to build it throws.
 *
 * @param engagement - the engagement record supplying the charter fields
 * @param role - the agent's charter role
 * @param charterText - the charter asset text; defaults to the bundled asset
 * @returns the assembled system prompt
 * @throws CharterError when a field is missing or empty, or the role is unknown
 */
export function buildSystemPrompt(
  engagement: CharterEngagement,
  role: CharterRole,
  charterText: string = defaultCharterText(),
): string {
  return `${fillCharter(charterText, engagement)}\n\n${roleAddendum(role)}`
}
