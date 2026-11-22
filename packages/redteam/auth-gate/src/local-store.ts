/**
 * The verified-domain store: one JSON document, written atomically, read
 * fail-closed.
 *
 * Split out of ./local.ts so the document's persistence rules and the
 * verifier's decision logic each stay small enough to read in one sitting.
 * This module owns the file; ./local.ts owns the DNS challenge that decides
 * what goes in it.
 *
 * `verified` IS the authorization record — anyone who can write this file can
 * authorize a target — so writes are atomic (temp file + rename) at mode 0600,
 * and every read that cannot parse falls back to an empty store rather than
 * throwing an approval.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { normalizeDomain } from './verify.js'

const STORE_VERSION = 1

/** Token recorded for a domain migrated from the legacy array store, which kept no tokens. */
const LEGACY_TOKEN = '(migrated)'

/** A challenge the operator still has to publish, and the token they must publish. */
export interface PendingRecord {
  token: string
  createdAt: string
}

/** A domain that proved ownership, and when. */
export interface VerifiedRecord {
  token: string
  verifiedAt: string
  method: 'dns-txt'
}

/** The document shape on disk. */
export interface StoreDoc {
  version: number
  pending: Record<string, PendingRecord>
  verified: Record<string, VerifiedRecord>
}

/**
 * Where the verified-domain store lives: `REDTEAM_VERIFIED_DOMAINS_FILE` when
 * set to a non-blank path, otherwise `~/.secscan-redteam/verified-domains.json`.
 * A blank value is treated as unset, matching the configuration convention that
 * `.env.example` uses for "not configured".
 * @param env - environment to read; defaults to `process.env`.
 * @returns the absolute path of the JSON store.
 */
export function defaultVerificationStoreFile(env: NodeJS.ProcessEnv = process.env): string {
  const named = (env['REDTEAM_VERIFIED_DOMAINS_FILE'] ?? '').trim()
  if (named !== '') return named
  return join(homedir(), '.secscan-redteam', 'verified-domains.json')
}

/**
 * Compare two token strings without leaking where they diverge. Both sides are
 * hashed first so the comparison is over equal-length buffers regardless of
 * input length.
 * @param candidate - the value found in DNS.
 * @param expected - the value this app minted.
 * @returns true when the two are the same token.
 */
export function tokenMatches(candidate: string, expected: string): boolean {
  const a = createHash('sha256').update(candidate, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b)
}

/** A store with nothing in it. */
export function emptyStore(): StoreDoc {
  return { version: STORE_VERSION, pending: {}, verified: {} }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Rebuild the store from a parsed file, keeping only well-formed entries. The
 * file is a durable boundary, so it is validated rather than trusted. A legacy
 * `verified: string[]` is migrated to records (`token: '(migrated)'`,
 * `method: 'dns-txt'`, `verifiedAt` set to the migration time); legacy pending
 * entries (`domain -> token string`) become records created at migration time.
 * @param parsed - the JSON as parsed, of unknown shape.
 * @returns a store holding only entries that survive validation.
 */
export function coerceStore(parsed: unknown): StoreDoc {
  const root = asRecord(parsed)
  const doc = emptyStore()
  for (const [domain, raw] of Object.entries(asRecord(root['pending']))) {
    if (typeof raw === 'string') {
      // Legacy pending entry: the bare challenge token.
      const legacyKey = normalizeDomain(domain)
      if (legacyKey !== null && raw !== '') doc.pending[legacyKey] = { token: raw, createdAt: new Date().toISOString() }
      continue
    }
    const entry = asRecord(raw)
    const token = typeof entry['token'] === 'string' ? entry['token'] : ''
    const createdAt = typeof entry['createdAt'] === 'string' ? entry['createdAt'] : ''
    const key = normalizeDomain(domain)
    if (key !== null && token !== '' && createdAt !== '') doc.pending[key] = { token, createdAt }
  }
  const verifiedRoot = root['verified']
  if (Array.isArray(verifiedRoot)) {
    // Legacy `verified: string[]`: written only after a DNS TXT match, so the
    // method is accurate; the timestamp is the migration time, not the original.
    const migratedAt = new Date().toISOString()
    for (const raw of verifiedRoot) {
      const key = typeof raw === 'string' ? normalizeDomain(raw) : null
      if (key !== null) doc.verified[key] = { token: LEGACY_TOKEN, verifiedAt: migratedAt, method: 'dns-txt' }
    }
  }
  for (const [domain, raw] of Object.entries(asRecord(verifiedRoot))) {
    const entry = asRecord(raw)
    const token = typeof entry['token'] === 'string' ? entry['token'] : ''
    const verifiedAt = typeof entry['verifiedAt'] === 'string' ? entry['verifiedAt'] : ''
    const key = normalizeDomain(domain)
    if (key !== null && token !== '' && verifiedAt !== '') {
      doc.verified[key] = { token, verifiedAt, method: 'dns-txt' }
    }
  }
  return doc
}

/** One store file, with atomic writes. */
export class VerificationStore {
  private readonly file: string

  /**
   * @param file - absolute path of the JSON store.
   */
  constructor(file: string) {
    this.file = file
  }

  /** The store path this instance reads and writes. */
  get path(): string {
    return this.file
  }

  /**
   * Read and parse the store. A missing file is an empty store; anything else
   * (unreadable, unparseable) throws so the caller can decide.
   * @returns the parsed store.
   */
  async load(): Promise<StoreDoc> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore()
      throw err
    }
    if (text.trim() === '') return emptyStore()
    return coerceStore(JSON.parse(text) as unknown)
  }

  /**
   * Publish the store atomically: a torn write must never be readable as a
   * partial store, because a partial store is a partial authorization record.
   * @param doc - the store to write.
   */
  async save(doc: StoreDoc): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.${randomBytes(6).toString('hex')}.tmp`
    await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, this.file)
  }
}
