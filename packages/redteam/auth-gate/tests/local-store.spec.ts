/** coerceStore: validation and legacy-array migration of the verified-domain store. */

import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import {
  VerificationStore,
  writeFileAtomic,
  coerceStore,
  defaultVerificationStoreFile,
  emptyStore,
  tokenMatches,
} from '../src/local-store.ts'

describe('coerceStore legacy migration', () => {
  it('migrates a legacy verified array into dns-txt records', () => {
    const before = Date.now()
    const doc = coerceStore({ verified: ['Acme.Example', 'https://b.example/x', 42, ''], pending: {} })
    expect(Object.keys(doc.verified).sort()).toEqual(['acme.example'])
    const rec = doc.verified['acme.example']!
    expect(rec.token).toBe('(migrated)')
    expect(rec.method).toBe('dns-txt')
    expect(Date.parse(rec.verifiedAt)).toBeGreaterThanOrEqual(before - 1)
  })

  it('drops legacy elements that only normalize to a domain', () => {
    const doc = coerceStore({
      verified: ['x@victim.example', 'victim.example/foo', 'acme.example.', ' Acme2.Example '],
      pending: {},
    })
    expect(Object.keys(doc.verified).sort()).toEqual(['acme.example', 'acme2.example'])
    expect(doc.verified['victim.example']).toBeUndefined()
  })

  it('migrated apex does not authorize a subdomain key', () => {
    const doc = coerceStore({ verified: ['acme.example'], pending: {} })
    expect(Object.hasOwn(doc.verified, 'api.acme.example')).toBe(false)
  })

  it('a __proto__ key in verified authorizes nothing', () => {
    const doc = coerceStore(JSON.parse('{"verified":{"__proto__":{"token":"t","verifiedAt":"x"}},"pending":{}}'))
    expect(Object.keys(doc.verified)).toEqual([])
    expect(Object.hasOwn(doc.verified, 'constructor')).toBe(false)
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
      if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
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

describe('writeFileAtomic', () => {
  it('removes its temp file and rethrows when the rename fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-spec-'))
    try {
      // A non-empty directory at the destination makes rename fail for real.
      const dest = join(dir, 'store.json')
      mkdirSync(dest)
      writeFileSync(join(dest, 'keep'), 'x')
      await expect(writeFileAtomic(dest, 'data')).rejects.toThrow()
      expect(readdirSync(dir).filter(n => n.endsWith('.tmp'))).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
