/** coerceStore: validation and legacy-array migration of the verified-domain store. */

import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import {
  VerificationStore,
  coerceStore,
  defaultVerificationStoreFile,
  emptyStore,
  tokenMatches,
} from '../src/local-store.ts'

describe('coerceStore legacy migration', () => {
  it('migrates a legacy verified array into dns-txt records', () => {
    const before = Date.now()
    const doc = coerceStore({ verified: ['Acme.Example', 'https://b.example/x', 42, ''], pending: {} })
    expect(Object.keys(doc.verified).sort()).toEqual(['acme.example', 'b.example'])
    const rec = doc.verified['acme.example']!
    expect(rec.token).toBe('(migrated)')
    expect(rec.method).toBe('dns-txt')
    expect(Date.parse(rec.verifiedAt)).toBeGreaterThanOrEqual(before - 1)
  })

  it('keeps well-formed record entries and drops malformed ones', () => {
    const doc = coerceStore({
      verified: { 'a.example': { token: 't', verifiedAt: '2026-01-01T00:00:00.000Z' }, 'b.example': { token: '' } },
      pending: { 'c.example': { token: 't', createdAt: '2026-01-01T00:00:00.000Z' }, 'd.example': {} },
    })
    expect(Object.keys(doc.verified)).toEqual(['a.example'])
    expect(Object.keys(doc.pending)).toEqual(['c.example'])
  })

  it('drops a record whose token is not a string', () => {
    const doc = coerceStore({
      verified: { 'b.example': { token: 5, verifiedAt: '2026-01-01T00:00:00.000Z' } },
      pending: { 'a.example': { token: 5, createdAt: '2026-01-01T00:00:00.000Z' } },
    })
    expect(doc.pending).toEqual({})
    expect(doc.verified).toEqual({})
  })

  it('treats non-objects as an empty store', () => {
    expect(coerceStore(null).verified).toEqual({})
    expect(coerceStore('x').verified).toEqual({})
  })
})

describe('coerceStore legacy pending', () => {
  it('turns a legacy pending token string into a record', () => {
    const doc = coerceStore({ verified: [], pending: { 'A.example': 'tok', 'b.example': '' } })
    expect(doc.pending['a.example']?.token).toBe('tok')
    expect(doc.pending['a.example']?.createdAt).toBeTruthy()
    expect(doc.pending['b.example']).toBeUndefined()
  })
})

describe('defaultVerificationStoreFile', () => {
  it('uses the env path, treating blank as unset', () => {
    expect(defaultVerificationStoreFile({ REDTEAM_VERIFIED_DOMAINS_FILE: ' /x/v.json ' })).toBe('/x/v.json')
    expect(defaultVerificationStoreFile({ REDTEAM_VERIFIED_DOMAINS_FILE: '  ' })).toBe(
      join(homedir(), '.secscan-redteam', 'verified-domains.json'),
    )
    expect(defaultVerificationStoreFile({})).toBe(join(homedir(), '.secscan-redteam', 'verified-domains.json'))
    expect(defaultVerificationStoreFile().length).toBeGreaterThan(0)
  })
})

describe('tokenMatches', () => {
  it('compares equal tokens only', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true)
    expect(tokenMatches('abc', 'abcd')).toBe(false)
  })
})

describe('VerificationStore', () => {
  it('loads empty for a missing or blank file, saves atomically at 0600, and rethrows other errors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'store-spec-'))
    try {
      const file = join(dir, 'nested', 'v.json')
      const store = new VerificationStore(file)
      expect(store.path).toBe(file)
      expect(await store.load()).toEqual(emptyStore())
      const doc = emptyStore()
      doc.verified['a.example'] = { token: 't', verifiedAt: '2026-01-01T00:00:00.000Z', method: 'dns-txt' }
      await store.save(doc)
      expect(statSync(file).mode & 0o777).toBe(0o600)
      expect(readFileSync(file, 'utf8').endsWith('\n')).toBe(true)
      expect(await store.load()).toEqual(doc)
      writeFileSync(file, '  \n')
      expect(await store.load()).toEqual(emptyStore())
      await expect(new VerificationStore(dir).load()).rejects.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
