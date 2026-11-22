/**
 * Local domain-ownership verifier.
 *
 * The app itself is the verification authority: it issues the challenge
 * token, the operator publishes it as a DNS TXT record at
 * `_secscan-challenge.<domain>`, the app checks DNS itself, and it records
 * the verified domain in a local JSON file. No external service is
 * consulted — this replaces the former server-authoritative check against
 * the SecScan MCP endpoint.
 *
 * Fail closed everywhere: any error in a verification path yields `false`,
 * never `true`.
 */

import { readFile as fsReadFile } from 'node:fs/promises'
import { resolveTxt } from 'node:dns/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

import { coerceStore, defaultVerificationStoreFile, emptyStore, writeFileAtomic, type StoreDoc } from './local-store.js'
import {
  extractDomain,
  normalizeDomain,
  SERVER_CHALLENGE_PREFIX,
  SERVER_TOKEN_PREFIX,
} from './verify.js'

/**
 * The document persisted in the local verification store: the same
 * {@link StoreDoc} that `VerificationStore` and the launch gate read.
 */
export type VerificationRecord = StoreDoc

/** IO surface for {@link LocalDomainVerifier}, injectable so tests need no network or disk. */
export interface LocalVerifierDeps {
  storePath: string
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, data: string) => Promise<void>
  mkdir: (path: string) => Promise<void>
  resolveTxt: (name: string) => Promise<string[][]>
  newToken: () => string
}

/**
 * Fully-qualified DNS name of the ownership-challenge TXT record.
 * @param domain - a normalized hostname (lowercase, no trailing dot).
 * @returns the TXT record name to publish/check.
 */
export function challengeRecordName(domain: string): string {
  const normalized = domain.trim().toLowerCase().replace(/\.$/, '')
  return `${SERVER_CHALLENGE_PREFIX}.${normalized}`
}

/**
 * True iff any DNS TXT answer's joined, trimmed chunks equal `token`.
 * @param records - the arrays-of-chunks answer from `dns.resolveTxt`.
 * @param token - the challenge token to look for.
 * @returns whether the token is published.
 */
export function txtRecordsContainToken(records: string[][], token: string): boolean {
  const want = token.trim()
  for (const chunks of records) {
    if (chunks.join('').trim() === want) return true
  }
  return false
}

/**
 * An empty verification record.
 * @returns a store with nothing pending or verified.
 */
export function emptyRecord(): VerificationRecord {
  return emptyStore()
}

/**
 * Record `token` as pending for `domain`.
 * @param rec - the current record.
 * @param domain - normalized domain (callers normalize via `extractDomain`).
 * @param token - the challenge token issued for the domain.
 * @param now - ISO creation time; defaults to the current time.
 * @returns a new record with the pending entry set.
 */
export function withPending(
  rec: VerificationRecord,
  domain: string,
  token: string,
  now: string = new Date().toISOString(),
): VerificationRecord {
  return { ...rec, pending: { ...rec.pending, [domain]: { token, createdAt: now } } }
}

/**
 * Move `domain` from pending to verified, keeping the pending token as proof.
 * @param rec - the current record.
 * @param domain - normalized domain.
 * @param now - ISO verification time; defaults to the current time.
 * @returns a new record with the domain verified (method `dns-txt`) and its pending entry removed,
 * or `rec` unchanged when no challenge is pending for the domain.
 */
export function withVerified(
  rec: VerificationRecord,
  domain: string,
  now: string = new Date().toISOString(),
): VerificationRecord {
  const token = rec.pending[domain]?.token
  if (token === undefined) return rec // no pending proof: never create an approval
  const pending = Object.fromEntries(Object.entries(rec.pending).filter(([key]) => key !== domain))
  return { ...rec, pending, verified: { ...rec.verified, [domain]: { token, verifiedAt: now, method: 'dns-txt' } } }
}

/**
 * True iff `domain`, after normalization, is a key of the record's verified map.
 * @param rec - the current record.
 * @param domain - the domain to test.
 * @returns whether the domain is verified.
 */
export function recordIsVerified(rec: VerificationRecord, domain: string): boolean {
  const key = normalizeDomain(domain)
  return key !== null && Object.hasOwn(rec.verified, key)
}

/**
 * Issues challenge tokens, checks the DNS TXT record, and records verified
 * domains in a local JSON file. No external service is consulted.
 */
export class LocalDomainVerifier {
  private readonly deps: LocalVerifierDeps

  constructor(deps: LocalVerifierDeps) {
    this.deps = deps
  }

  /**
   * Build a verifier backed by real fs/dns/crypto. The store path defaults
   * to `$REDTEAM_VERIFIED_DOMAINS_FILE` or
   * `~/.secscan-redteam/verified-domains.json`.
   * @param storePath - explicit store path override.
   * @returns a ready verifier.
   */
  static create(storePath?: string): LocalDomainVerifier {
    const resolved = storePath ?? defaultVerificationStoreFile()
    return new LocalDomainVerifier({
      storePath: resolved,
      readFile: p => fsReadFile(p, 'utf8'),
      writeFile: writeFileAtomic,
      mkdir: async () => {}, // writeFileAtomic creates the directory at mode 0700
      resolveTxt,
      newToken: () => SERVER_TOKEN_PREFIX + randomBytes(16).toString('hex'),
    })
  }

  /**
   * Begin verification: normalize the domain, issue a challenge token, mark
   * it pending, and persist.
   * @param domain - a URL or bare hostname.
   * @returns the record name to publish at and the token to publish there.
   */
  async startVerification(domain: string): Promise<{ recordName: string; token: string }> {
    const normalized = extractDomain(domain)
    const token = this.deps.newToken()
    const rec = withPending(await this.load(), normalized, token)
    await this.save(rec)
    return { recordName: challengeRecordName(normalized), token }
  }

  /**
   * Check the DNS TXT record for the pending token; on a match, record the
   * domain as verified.
   * @param domain - a URL or bare hostname.
   * @returns true iff the domain is verified after this check.
   */
  async checkVerification(domain: string): Promise<boolean> {
    try {
      const normalized = extractDomain(domain)
      const rec = await this.load()
      if (recordIsVerified(rec, normalized)) return true
      const token = rec.pending[normalized]?.token
      if (!token) return false
      let answers: string[][]
      try {
        answers = await this.deps.resolveTxt(challengeRecordName(normalized))
      } catch {
        return false // DNS failure is "not verified", never an approval
      }
      if (!txtRecordsContainToken(answers, token)) return false
      await this.save(withVerified(rec, normalized))
      return true
    } catch {
      return false
    }
  }

  /**
   * The gate's read path. FAIL CLOSED: any error yields false. When a
   * challenge is pending for the domain, this performs the DNS check so a
   * freshly published TXT record takes effect without a separate step.
   * @param domain - a URL or bare hostname.
   * @returns true iff the domain is in the local verified record.
   */
  async isVerified(domain: string): Promise<boolean> {
    try {
      const normalized = extractDomain(domain)
      const rec = await this.load()
      if (recordIsVerified(rec, normalized)) return true
      if (Object.hasOwn(rec.pending, normalized)) return await this.checkVerification(normalized)
      return false
    } catch {
      return false
    }
  }

  private async load(): Promise<VerificationRecord> {
    let raw: string
    try {
      raw = await this.deps.readFile(this.deps.storePath)
    } catch {
      return emptyRecord() // no store yet: nothing is verified
    }
    try {
      return coerceStore(JSON.parse(raw))
    } catch {
      return emptyRecord() // corrupt store: fail closed, verify nothing
    }
  }

  private async save(rec: VerificationRecord): Promise<void> {
    await this.deps.mkdir(path.dirname(this.deps.storePath))
    await this.deps.writeFile(this.deps.storePath, JSON.stringify(rec, null, 2))
  }
}
