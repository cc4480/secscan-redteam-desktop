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

import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir as fsMkdir } from 'node:fs/promises'
import { resolveTxt } from 'node:dns/promises'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'

import {
  extractDomain,
  isDomainVerified,
  SERVER_CHALLENGE_PREFIX,
  SERVER_TOKEN_PREFIX,
} from './verify.js'

/**
 * The shape persisted in the local verification store.
 *
 * `verified` holds normalized domains the app has confirmed. `pending` maps
 * a normalized domain to the challenge token awaiting publication/check.
 */
export interface VerificationRecord {
  verified: string[]
  pending: { [domain: string]: string }
}

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

/** An empty verification record. */
export function emptyRecord(): VerificationRecord {
  return { verified: [], pending: {} }
}

/**
 * Record `token` as pending for `domain`.
 * @param rec - the current record.
 * @param domain - normalized domain (callers normalize via `extractDomain`).
 * @param token - the challenge token issued for the domain.
 * @returns a new record with the pending entry set.
 */
export function withPending(rec: VerificationRecord, domain: string, token: string): VerificationRecord {
  return {
    verified: rec.verified,
    pending: { ...rec.pending, [domain]: token },
  }
}

/**
 * Move `domain` from pending to verified.
 * @param rec - the current record.
 * @param domain - normalized domain.
 * @returns a new record with the domain verified and its pending entry removed.
 */
export function withVerified(rec: VerificationRecord, domain: string): VerificationRecord {
  const pending = { ...rec.pending }
  delete pending[domain]
  const verified = rec.verified.includes(domain) ? rec.verified : [...rec.verified, domain]
  return { verified, pending }
}

/**
 * True iff `domain` is in the record's verified set (exact membership,
 * after normalization — the same rule as `isDomainVerified`).
 * @param rec - the current record.
 * @param domain - the domain to test.
 * @returns whether the domain is verified.
 */
export function recordIsVerified(rec: VerificationRecord, domain: string): boolean {
  return isDomainVerified(domain, rec.verified)
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
    const resolved =
      storePath ??
      process.env['REDTEAM_VERIFIED_DOMAINS_FILE'] ??
      path.join(homedir(), '.secscan-redteam', 'verified-domains.json')
    return new LocalDomainVerifier({
      storePath: resolved,
      readFile: (p) => fsReadFile(p, 'utf8'),
      writeFile: (p, data) => fsWriteFile(p, data, 'utf8'),
      mkdir: async (p) => {
        await fsMkdir(p, { recursive: true })
      },
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
      const token = rec.pending[normalized]
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
      if (rec.pending[normalized]) return await this.checkVerification(normalized)
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
      return emptyRecord() // no store yet — nothing is verified
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return emptyRecord()
      const obj = parsed as Partial<VerificationRecord>
      const verified = Array.isArray(obj.verified)
        ? obj.verified.filter((d): d is string => typeof d === 'string')
        : []
      const pending: { [domain: string]: string } = {}
      if (obj.pending && typeof obj.pending === 'object') {
        for (const [k, v] of Object.entries(obj.pending)) {
          if (typeof v === 'string') pending[k] = v
        }
      }
      return { verified, pending }
    } catch {
      return emptyRecord() // corrupt store — fail closed, verify nothing
    }
  }

  private async save(rec: VerificationRecord): Promise<void> {
    await this.deps.mkdir(path.dirname(this.deps.storePath))
    await this.deps.writeFile(this.deps.storePath, JSON.stringify(rec, null, 2))
  }
}
