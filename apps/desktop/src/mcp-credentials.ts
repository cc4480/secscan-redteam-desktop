/** First-run MCP credentials owned by one desktop installation. */

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  MCP_ENVIRONMENT_NAMES,
  MCP_TOKEN_NAMES,
  type McpCredentialDraftInput,
  type McpEnvironmentName,
  type McpTokenName,
} from './mcp-credential-contract.ts'

export {
  DEFAULT_REDTEAM_MCP_URL,
  MCP_ENVIRONMENT_NAMES,
  MCP_TOKEN_NAMES,
  REDTEAM_CONSOLE_ENVIRONMENT_NAMES,
  type McpCredentialDraftInput,
  type McpEnvironmentName,
  type McpTokenName,
} from './mcp-credential-contract.ts'

/** Basename of the installation-owned credential document inside the app's `userData` directory. */
export const MCP_CREDENTIAL_FILENAME = 'engagement-credentials.json'

/**
 * How stored token values are protected at rest. The mode is recorded in the
 * document so a reader that cannot open a value detects the mismatch instead of
 * feeding ciphertext into an `Authorization` header.
 */
export type McpStoreProtection = 'safeStorage' | 'plain'

/** Symmetric at-rest protection for stored token values. */
export interface McpSecretProtector {
  /** How this protector writes values; recorded in the document. */
  readonly kind: McpStoreProtection
  /** @param value - credential value. @returns an opaque string safe to persist. */
  protect(value: string): string
  /** @param value - string a {@link McpSecretProtector.protect} call returned. @returns the credential value. */
  unprotect(value: string): string
}

/**
 * Environment variable through which an operator explicitly accepts storing token
 * values unencrypted. `1` is the only value that opts in, and nothing in a stored
 * document or a setup request can imply it.
 */
export const MCP_PLAINTEXT_OPT_IN_ENV = 'DSH_MCP_ALLOW_PLAINTEXT'

/**
 * Refusal to persist a credential document whose token values would sit on disk
 * with nothing but file permission bits on a host where those bits are not an
 * access-control boundary. A caller catches this to explain the opt-in; every
 * other write failure keeps returning `false` instead of throwing.
 */
export class McpPlaintextRefusedError extends Error {
  /** Stable discriminator a caller can check without relying on class identity across bundles. */
  readonly code = 'MCP_PLAINTEXT_REFUSED'
  /** Environment variable whose value `1` accepts the risk. */
  readonly optIn = MCP_PLAINTEXT_OPT_IN_ENV

  constructor() {
    super(
      'desktop mcp credentials: refusing to store token values unencrypted on Windows without an OS credential store; '
      + 'owner-only file permissions do not restrict other processes of this account. '
      + `Set ${MCP_PLAINTEXT_OPT_IN_ENV}=1 to accept that the credential document stays readable by this account.`,
    )
    this.name = 'McpPlaintextRefusedError'
  }
}

/**
 * Identity protector for a host without an OS credential store; owner-only file
 * permission bits are then the whole protection, which is also what the
 * Harness's own `.credentials.yaml` relies on. Those bits do not restrain another
 * Windows account process, so {@link writeStoredMcpCredentials} refuses to write
 * this protector's documents on win32 unless {@link MCP_PLAINTEXT_OPT_IN_ENV} is `1`.
 */
export const plainMcpSecretProtector: McpSecretProtector = {
  kind: 'plain',
  protect: value => value,
  unprotect: value => value,
}

/**
 * Refuse a write when the fallback's only protection does not apply on this host.
 * Reads the opt-in at call time and only from the environment: neither the stored
 * document nor a setup request may grant it.
 * @param protector - at-rest protection this host writes with.
 * @throws {McpPlaintextRefusedError} when the identity protector would persist on win32 without the opt-in.
 */
function refuseUnprotectedPlaintextPersistence(protector: McpSecretProtector): void {
  if (protector.kind !== 'plain' || process.platform !== 'win32') return
  if (process.env[MCP_PLAINTEXT_OPT_IN_ENV] === '1') return
  throw new McpPlaintextRefusedError()
}

/** Accepted draft; `null` means the stored entry is left untouched. */
export interface McpCredentialDraft {
  readonly secscan: string | null
  readonly seclayer: string | null
  readonly runner: string | null
  readonly endpoint: string | null
}

/** One protected token entry, with the mask that keeps the document auditable. */
interface StoredTokenEntry {
  readonly value: string
  /** Display mask; absent on a document this build did not write. */
  readonly fingerprint?: string
}

/** Persisted document; `version` gates every field read from it. */
interface McpCredentialDocument {
  readonly version: 1
  readonly updatedAt: string
  readonly protection: McpStoreProtection
  /** Set when the operator dismissed first-run setup without storing a token. */
  readonly declinedAt?: string
  /** Console endpoint stored for the runner row; absent means the row's own default applies. */
  readonly endpoint?: string
  /** Token entries by environment name; each entry is validated where it is read. */
  readonly credentials: Readonly<Record<string, unknown>>
}

/** Stored credentials as the setup window and the first-run gate need them. */
export interface StoredMcpCredentials {
  /** Values safe to place in the Host environment. */
  readonly values: Partial<Record<McpEnvironmentName, string>>
  /** Masked form of every stored token; never a credential value. */
  readonly fingerprints: Partial<Record<McpTokenName, string>>
  /** Whether the document exists, which is also what removal deletes. */
  readonly exists: boolean
  /** Whether the operator already declined first-run setup. */
  readonly declined: boolean
}

/**
 * Resolve the credential document inside the application's own profile
 * directory. It is per installation rather than shared through the Harness home
 * because a token belongs to one installation, and `userData` is the directory
 * this application already owns.
 * @param userData - absolute `app.getPath('userData')` of this installation.
 * @returns absolute path of the credential document.
 */
export function mcpCredentialFile(userData: string): string {
  return join(userData, MCP_CREDENTIAL_FILENAME)
}

/**
 * Mask a credential for display. Four leading and four trailing characters are
 * enough to tell two tokens of the same account apart, which is what an operator
 * checks before replacing one; the remainder never leaves the shell process.
 * @param value - credential value.
 * @returns a short display form such as `ssk_…9f3c`.
 */
export function maskMcpCredential(value: string): string {
  const trimmed = value.trim()
  return trimmed.length < 12 ? '••••' : `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`
}

/**
 * Validate a pasted token. The shape check rejects the two ways a token arrives
 * wrong - a whole `NAME=value` line copied out of a shell profile, and a value
 * pasted with its quotes - without guessing the token's own format: SecScan
 * issues `ssk_` tokens today and the runner console issues its own, so no prefix
 * is required.
 * @param value - raw form field value.
 * @returns whether the value can be stored as a token.
 */
export function isMcpTokenValue(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 8 || trimmed.length > 512) return false
  if (!/^[\x21-\x7e]+$/.test(trimmed)) return false
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(trimmed)) return false
  return !((trimmed.startsWith('"') || trimmed.startsWith('\'') || trimmed.startsWith('`')) && trimmed.at(-1) === trimmed[0])
}

/**
 * Validate a console endpoint. The token for this row belongs to a loopback
 * engine that drives live pentest tooling, so plain HTTP is accepted only for a
 * loopback host; anything else has to be HTTPS. This mirrors the Host's own
 * Platform-session origin check rather than inventing a second policy.
 * @param value - raw form field value.
 * @returns whether the value may be stored as the runner endpoint.
 */
export function isMcpEndpoint(value: string): boolean {
  try {
    const url = new URL(value.trim())
    if (url.username !== '' || url.password !== '') return false
    return url.protocol === 'https:'
      || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  } catch {
    return false
  }
}

/**
 * Accept the setup form's field values.
 * @param input - raw field values; an empty string keeps the stored value.
 * @returns the normalized draft, or undefined when a supplied value is not acceptable.
 */
export function normalizeMcpCredentialDraft(input: McpCredentialDraftInput): McpCredentialDraft | undefined {
  const token = (value: string): string | null | undefined => {
    if (value.trim() === '') return null
    return isMcpTokenValue(value) ? value.trim() : undefined
  }
  const secscan = token(input.secscan)
  const seclayer = token(input.seclayer)
  const runner = token(input.runner)
  if (secscan === undefined || seclayer === undefined || runner === undefined) return undefined
  const endpoint = input.endpoint.trim()
  if (endpoint === '') return { secscan, seclayer, runner, endpoint: null }
  if (!isMcpEndpoint(endpoint)) return undefined
  return { secscan, seclayer, runner, endpoint }
}

/**
 * Read the values the first-run gate and the setup window need.
 * Never throws and never reports a value: a document this build cannot open, or
 * one another host wrote, is reported as metadata only, so the setup step can be
 * offered again instead of failing the launch.
 * @param file - absolute credential document path.
 * @param protector - at-rest protection used by this host.
 * @returns stored values, their masks, and how the document was found.
 */
export async function readStoredMcpCredentials(file: string, protector: McpSecretProtector): Promise<StoredMcpCredentials> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`desktop mcp credentials: ${file} could not be read`)
    }
    return { values: {}, fingerprints: {}, exists: false, declined: false }
  }
  const document = storedDocument(raw)
  if (document === undefined) {
    console.warn(`desktop mcp credentials: ${file} is not a version 1 credential document`)
    return { values: {}, fingerprints: {}, exists: true, declined: false }
  }
  const fingerprints: Partial<Record<McpTokenName, string>> = {}
  for (const name of MCP_TOKEN_NAMES) {
    const fingerprint = storedFingerprint(document, name)
    if (fingerprint !== undefined) fingerprints[name] = fingerprint
  }
  const declined = typeof document.declinedAt === 'string'
  const values: Partial<Record<McpEnvironmentName, string>> = {}
  // Another user's profile, or a host without the credential store that wrote the file, cannot open
  // these entries. Loading the ciphertext would send a garbage bearer token, so they stay out.
  if (document.protection !== protector.kind) {
    console.warn(`desktop mcp credentials: ${file} is ${document.protection}-protected and this host reads ${protector.kind}`)
  } else {
    for (const name of MCP_TOKEN_NAMES) {
      const protectedValue = storedValue(document, name)
      if (protectedValue === undefined) continue
      try {
        const value = protector.unprotect(protectedValue)
        if (value.trim() !== '') values[name] = value
      } catch {
        console.warn(`desktop mcp credentials: the stored ${name} could not be opened`)
      }
    }
  }
  if (typeof document.endpoint === 'string' && isMcpEndpoint(document.endpoint)) {
    values.REDTEAM_MCP_URL = document.endpoint.trim()
  }
  return { values, fingerprints, exists: true, declined }
}

/**
 * Place stored credentials in a process environment, preserving values that were
 * already there. A name this process installed from an earlier read of the same
 * document is replaced, because rotating a token has to change the environment
 * the next Host start inherits; an inherited variable is never touched, because a
 * working setup must not be switched to a file behind the operator's back.
 * @param environment - environment the Host is spawned with, usually `process.env`.
 * @param file - absolute credential document path.
 * @param protector - at-rest protection used by this host.
 * @param installed - names this process has already taken from this document; updated in place.
 * @returns what the document held, for the first-run gate and the setup window.
 */
export async function loadStoredMcpCredentials(
  environment: NodeJS.ProcessEnv,
  file: string,
  protector: McpSecretProtector,
  installed: Set<McpEnvironmentName>,
): Promise<StoredMcpCredentials> {
  const stored = await readStoredMcpCredentials(file, protector)
  for (const name of MCP_ENVIRONMENT_NAMES) {
    const value = stored.values[name]
    if (value === undefined) {
      // A removed entry leaves the environment too, but only when this process put it there.
      if (installed.has(name)) {
        Reflect.deleteProperty(environment, name)
        installed.delete(name)
      }
      continue
    }
    if (installed.has(name) || (environment[name] ?? '') === '') {
      environment[name] = value
      installed.add(name)
    }
  }
  return stored
}

/**
 * Persist a draft. Entries the draft does not mention survive, so saving one
 * token never discards the other, and the document is replaced atomically at
 * `0600` after its directory is ensured at `0700`.
 * @param file - absolute credential document path.
 * @param protector - at-rest protection used by this host.
 * @param draft - normalized field values; `null` keeps the stored entry.
 * @param declined - whether the operator dismissed first-run setup without a token.
 * @returns whether the document is now on disk.
 * @throws {McpPlaintextRefusedError} when this host would persist with the identity
 *   protector on win32 without {@link MCP_PLAINTEXT_OPT_IN_ENV} set to `1`.
 */
export async function writeStoredMcpCredentials(
  file: string,
  protector: McpSecretProtector,
  draft: McpCredentialDraft,
  declined = false,
): Promise<boolean> {
  refuseUnprotectedPlaintextPersistence(protector)
  const previous = await readDocument(file)
  // Entries another protector wrote cannot be re-protected here, so only this host's own are merged.
  const mergeable = previous?.protection === protector.kind ? previous : undefined
  const credentials: Record<string, StoredTokenEntry> = {}
  for (const name of MCP_TOKEN_NAMES) {
    const kept = storedValue(mergeable, name)
    if (kept === undefined) continue
    const fingerprint = storedFingerprint(mergeable, name)
    credentials[name] = { value: kept, ...fingerprint === undefined ? {} : { fingerprint } }
  }
  for (const [name, value] of [['SECSCAN_MCP_TOKEN', draft.secscan], ['SECLAYER_API_KEY', draft.seclayer], ['REDTEAM_UI_TOKEN', draft.runner]] as const) {
    if (value === null) continue
    credentials[name] = { value: protector.protect(value), fingerprint: maskMcpCredential(value) }
  }
  const endpoint = draft.endpoint ?? (typeof mergeable?.endpoint === 'string' ? mergeable.endpoint : undefined)
  const document: McpCredentialDocument = {
    version: 1,
    updatedAt: new Date().toISOString(),
    protection: protector.kind,
    ...declined ? { declinedAt: new Date().toISOString() } : {},
    ...endpoint === undefined ? {} : { endpoint },
    credentials,
  }
  try {
    await writeDocument(file, document)
    return true
  } catch (error) {
    // The diagnostic is a path and an errno; it must not carry the document's contents.
    console.warn(`desktop mcp credentials: ${file} could not be written (${(error as NodeJS.ErrnoException).code ?? 'unknown'})`)
    return false
  }
}

/**
 * Delete the stored credentials, which is the revocation path the setup window
 * offers and the one an operator can take without the application.
 * @param file - absolute credential document path.
 * @returns whether no document remains on disk.
 */
export async function clearStoredMcpCredentials(file: string): Promise<boolean> {
  try {
    await rm(file, { force: true })
    return true
  } catch (error) {
    console.warn(`desktop mcp credentials: ${file} could not be removed (${(error as NodeJS.ErrnoException).code ?? 'unknown'})`)
    return false
  }
}

/**
 * Decide whether this installation still has to ask for MCP credentials.
 * A declined step is remembered, and an environment that already carries a token
 * is a working setup that must not be interrupted by a prompt. A document that
 * exists but yields no usable token - because another host wrote it, or its
 * values cannot be opened here - asks again rather than leaving the tools
 * silently absent.
 * @param environment - process environment the Host will inherit.
 * @param stored - result of {@link readStoredMcpCredentials}.
 * @param provided - names this process supplied itself, such as the token it generated
 *   for the bundled engagement engine; they are not an operator's answer to the step.
 * @returns whether the setup step belongs in first run.
 */
export function mcpSetupRequired(
  environment: NodeJS.ProcessEnv,
  stored: StoredMcpCredentials,
  provided: ReadonlySet<McpEnvironmentName> = new Set(),
): boolean {
  if (stored.declined) return false
  if (MCP_TOKEN_NAMES.some(name => !provided.has(name) && (environment[name] ?? '') !== '')) return false
  return !MCP_TOKEN_NAMES.some(name => stored.values[name] !== undefined)
}

/** @returns the protected entry for one name, when the document carries one. */
function storedValue(document: McpCredentialDocument | undefined, name: McpTokenName): string | undefined {
  const entry = document?.credentials[name]
  if (typeof entry !== 'object' || entry === null) return undefined
  const value = (entry as { value?: unknown }).value
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** @returns the audit mask stored beside one entry, if it has one. */
function storedFingerprint(document: McpCredentialDocument | undefined, name: McpTokenName): string | undefined {
  const entry = document?.credentials[name]
  if (typeof entry !== 'object' || entry === null) return undefined
  const fingerprint = (entry as { fingerprint?: unknown }).fingerprint
  return typeof fingerprint === 'string' && fingerprint !== '' ? fingerprint : undefined
}

/**
 * Parse a document, dropping anything this build does not recognize.
 * @param raw - file contents.
 * @returns the validated document, or undefined when the file is not one.
 */
function storedDocument(raw: string): McpCredentialDocument | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const candidate = parsed as Record<string, unknown>
  if (candidate.version !== 1) return undefined
  if (candidate.protection !== 'safeStorage' && candidate.protection !== 'plain') return undefined
  const credentials = candidate.credentials
  const entries: Readonly<Record<string, unknown>> = typeof credentials === 'object' && credentials !== null && !Array.isArray(credentials)
    ? credentials as Readonly<Record<string, unknown>>
    : {}
  return {
    version: 1,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : '',
    protection: candidate.protection,
    ...typeof candidate.declinedAt === 'string' ? { declinedAt: candidate.declinedAt } : {},
    ...typeof candidate.endpoint === 'string' ? { endpoint: candidate.endpoint } : {},
    credentials: entries,
  }
}

/**
 * Read the current document without reporting why it is unusable.
 * @param file - absolute credential document path.
 * @returns the document, or undefined when there is none to merge into.
 */
async function readDocument(file: string): Promise<McpCredentialDocument | undefined> {
  try {
    return storedDocument(await readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Replace the document atomically at owner-only permissions.
 * @param file - absolute credential document path.
 * @param document - the complete next document.
 */
async function writeDocument(file: string, document: McpCredentialDocument): Promise<void> {
  const directory = dirname(file)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = `${file}.tmp`
  try {
    // 0600 before any byte lands: a credential document is never group- or world-readable.
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
    // An explicit chmod repairs a restrictive umask; Windows has no POSIX mode to set.
    await chmod(temporary, 0o600)
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}
