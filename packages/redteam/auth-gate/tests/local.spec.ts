/**
 * Local domain verifier: the app issues the challenge token, checks the
 * `_secscan-challenge` TXT record itself, and records verified domains in a
 * local JSON store. All IO is faked — no network, no disk. The pinned
 * behavior is fail-closed: errors and missing proof never verify.
 */

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
    let rec = withPending(emptyRecord(), 'example.com', 'tok')
    expect(recordIsVerified(rec, 'example.com')).toBe(false)
    rec = withVerified(rec, 'example.com')
    expect(recordIsVerified(rec, 'example.com')).toBe(true)
    expect(recordIsVerified(rec, 'api.example.com')).toBe(false)
    expect(rec.pending['example.com']).toBeUndefined()
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
    expect(JSON.parse(readStore()!).verified).toEqual(['example.com'])
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
})
