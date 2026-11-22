/**
 * Local domain verifier: the app issues the challenge token, checks the
 * `_secscan-challenge` TXT record itself, and records verified domains in a
 * local JSON store. All IO is faked — no network, no disk. The pinned
 * behavior is fail-closed: errors and missing proof never verify.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LocalDomainVerifier,
  challengeRecordName,
  emptyRecord,
  recordIsVerified,
  txtRecordsContainToken,
  withPending,
  withVerified,
  type LocalVerifierDeps,
} from '../src/local.ts'

/** In-memory verifier deps with a scripted TXT answer. */
function fakeDeps(txt: string[][] | Error) {
  let store: string | null = null
  const deps: LocalVerifierDeps = {
    storePath: '/fake/verified-domains.json',
    readFile: async () => {
      if (store === null) throw new Error('ENOENT')
      return store
    },
    writeFile: async (_p, data) => {
      store = data
    },
    mkdir: async () => {},
    resolveTxt: async () => {
      if (txt instanceof Error) throw txt
      return txt
    },
    newToken: () => 'secscan-verify-testtoken',
  }
  return { deps, readStore: () => store }
}

describe('pure helpers', () => {
  it('builds the challenge record name', () => {
    expect(challengeRecordName('Example.COM.')).toBe('_secscan-challenge.example.com')
  })

  it('matches a token across joined TXT chunks only on equality', () => {
    expect(txtRecordsContainToken([['secscan-verify-', 'abc']], 'secscan-verify-abc')).toBe(true)
    expect(txtRecordsContainToken([['secscan-verify-abcd']], 'secscan-verify-abc')).toBe(false)
    expect(txtRecordsContainToken([], 'secscan-verify-abc')).toBe(false)
  })

  it('moves a domain from pending to verified (exact membership)', () => {
    let rec = withPending(emptyRecord(), 'example.com', 'tok', '2026-01-01T00:00:00.000Z')
    expect(rec.pending['example.com']).toEqual({ token: 'tok', createdAt: '2026-01-01T00:00:00.000Z' })
    expect(recordIsVerified(rec, 'example.com')).toBe(false)
    rec = withVerified(rec, 'example.com', '2026-01-02T00:00:00.000Z')
    expect(recordIsVerified(rec, 'example.com')).toBe(true)
    expect(recordIsVerified(rec, 'https://Example.com/x')).toBe(true)
    expect(recordIsVerified(rec, 'api.example.com')).toBe(false)
    expect(rec.pending['example.com']).toBeUndefined()
    expect(rec.verified['example.com']).toEqual({
      token: 'tok',
      verifiedAt: '2026-01-02T00:00:00.000Z',
      method: 'dns-txt',
    })
  })

  it('withVerified without a pending token records an empty-safe placeholder', () => {
    const rec = withVerified(emptyRecord(), 'example.com')
    expect(rec.verified['example.com']?.method).toBe('dns-txt')
    expect(rec.verified['example.com']?.token).toBe('(unknown)')
    expect(Number.isNaN(Date.parse(rec.verified['example.com']!.verifiedAt))).toBe(false)
    expect(withPending(emptyRecord(), 'example.com', 'tok').pending['example.com']?.createdAt).toBeTruthy()
  })
})

describe('LocalDomainVerifier', () => {
  it('verifies end to end: start → TXT published → isVerified runs the check', async () => {
    const { deps, readStore } = fakeDeps([['secscan-verify-testtoken']])
    const v = new LocalDomainVerifier(deps)
    const { recordName, token } = await v.startVerification('https://Example.com/path')
    expect(recordName).toBe('_secscan-challenge.example.com')
    expect(token).toBe('secscan-verify-testtoken')
    expect(await v.isVerified('example.com')).toBe(true)
    const doc = JSON.parse(readStore()!)
    expect(Object.keys(doc.verified)).toEqual(['example.com'])
    expect(doc.verified['example.com']).toMatchObject({ token: 'secscan-verify-testtoken', method: 'dns-txt' })
    expect(doc.pending).toEqual({})
    // Second read is served from the record — no pending challenge remains.
    expect(await v.isVerified('example.com')).toBe(true)
  })

  it('fails closed when the TXT record lacks the token', async () => {
    const { deps } = fakeDeps([['some-other-token']])
    const v = new LocalDomainVerifier(deps)
    await v.startVerification('example.com')
    expect(await v.isVerified('example.com')).toBe(false)
    expect(await v.checkVerification('example.com')).toBe(false)
  })

  it('fails closed on DNS errors and on an empty store', async () => {
    const { deps } = fakeDeps(new Error('ENOTFOUND'))
    const v = new LocalDomainVerifier(deps)
    expect(await v.isVerified('never-started.example')).toBe(false)
    await v.startVerification('example.com')
    expect(await v.isVerified('example.com')).toBe(false)
  })

  it('fails closed on a corrupt store file', async () => {
    const { deps } = fakeDeps([['secscan-verify-testtoken']])
    deps.readFile = async () => '{not json'
    const v = new LocalDomainVerifier(deps)
    expect(await v.isVerified('example.com')).toBe(false)
  })

  it('reads a legacy array store as verified (migration)', async () => {
    const { deps } = fakeDeps([])
    deps.readFile = async () => JSON.stringify({ verified: ['example.com'], pending: {} })
    const v = new LocalDomainVerifier(deps)
    expect(await v.isVerified('example.com')).toBe(true)
  })

  it('fails closed when the store is not an object', async () => {
    const { deps } = fakeDeps([])
    deps.readFile = async () => 'null'
    expect(await new LocalDomainVerifier(deps).isVerified('example.com')).toBe(false)
  })

  it('fails closed when saving throws during check', async () => {
    const { deps } = fakeDeps([['secscan-verify-testtoken']])
    const v = new LocalDomainVerifier(deps)
    await v.startVerification('example.com')
    deps.writeFile = async () => {
      throw new Error('EROFS')
    }
    expect(await v.checkVerification('example.com')).toBe(false)
  })

  it('isVerified is false for an unparseable domain', async () => {
    const { deps } = fakeDeps([])
    expect(await new LocalDomainVerifier(deps).isVerified('')).toBe(false)
  })

  it('checkVerification is true for an already-verified domain without a DNS lookup', async () => {
    const { deps } = fakeDeps([['secscan-verify-testtoken']])
    const v = new LocalDomainVerifier(deps)
    await v.startVerification('example.com')
    expect(await v.checkVerification('example.com')).toBe(true)
    deps.resolveTxt = async () => {
      throw new Error('should not be called')
    }
    expect(await v.checkVerification('example.com')).toBe(true)
  })

  it('checkVerification is false for an unstarted or unparseable domain', async () => {
    const { deps } = fakeDeps([['secscan-verify-testtoken']])
    const v = new LocalDomainVerifier(deps)
    expect(await v.checkVerification('example.com')).toBe(false)
    expect(await v.checkVerification('')).toBe(false)
  })

  it('create() persists a record-shaped store at the given path with real fs', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'local-spec-'))
    try {
      const file = path.join(dir, 'sub', 'verified-domains.json')
      const v = LocalDomainVerifier.create(file)
      const { token } = await v.startVerification('Example.com')
      expect(token).toMatch(/^secscan-verify-[0-9a-f]{32}$/)
      const doc = JSON.parse(readFileSync(file, 'utf8'))
      expect(doc.pending['example.com'].token).toBe(token)
      expect(doc.verified).toEqual({})
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('create() defaults to the REDTEAM_VERIFIED_DOMAINS_FILE path', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'local-spec-'))
    const saved = process.env['REDTEAM_VERIFIED_DOMAINS_FILE']
    try {
      const file = path.join(dir, 'v.json')
      process.env['REDTEAM_VERIFIED_DOMAINS_FILE'] = file
      await LocalDomainVerifier.create().startVerification('example.com')
      expect(JSON.parse(readFileSync(file, 'utf8')).pending['example.com']).toBeTruthy()
      // Another instance on the same path reads the pending challenge back.
      expect(await LocalDomainVerifier.create().isVerified('unrelated.example')).toBe(false)
    } finally {
      if (saved === undefined) delete process.env['REDTEAM_VERIFIED_DOMAINS_FILE']
      else process.env['REDTEAM_VERIFIED_DOMAINS_FILE'] = saved
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
