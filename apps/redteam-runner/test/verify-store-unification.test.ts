/**
 * The verifier that writes the local store, the store reader behind
 * `verify_domain_list`, and the launch gate must agree on one on-disk shape.
 * DNS is stubbed through the verifier's injectable deps; the store file is a
 * temp path selected by REDTEAM_VERIFIED_DOMAINS_FILE.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalDomainVerifier, VerificationStore } from '@secscan/redteam-auth-gate'
import { checkAuthorization } from '../src/gate.js'
import { VERIFY_TOOLS } from '../src/ui/verify-tools.js'

let dir: string
let file: string
let savedEnv: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'verify-unify-'))
  file = join(dir, 'verified-domains.json')
  savedEnv = process.env['REDTEAM_VERIFIED_DOMAINS_FILE']
  process.env['REDTEAM_VERIFIED_DOMAINS_FILE'] = file
})

afterEach(() => {
  if (savedEnv === undefined) delete process.env['REDTEAM_VERIFIED_DOMAINS_FILE']
  else process.env['REDTEAM_VERIFIED_DOMAINS_FILE'] = savedEnv
  rmSync(dir, { recursive: true, force: true })
})

/** A verifier on the temp store whose DNS publishes whatever token it was issued. */
function verifierPublishing(): LocalDomainVerifier {
  const published: string[][] = []
  return new LocalDomainVerifier({
    storePath: file,
    readFile: p => readFile(p, 'utf8'),
    writeFile: (p, data) => writeFile(p, data, 'utf8'),
    mkdir: async (p) => {
      await mkdir(p, { recursive: true })
    },
    resolveTxt: async () => published,
    newToken: () => {
      const t = 'secscan-verify-unify'
      published.push([t])
      return t
    },
  })
}

async function listedDomains(): Promise<unknown> {
  const tool = VERIFY_TOOLS.find(t => t.name === 'verify_domain_list')
  assert.ok(tool)
  const res = await tool.run(undefined as never, {})
  return (res.body as { domains: unknown }).domains
}

describe('verification store unification', () => {
  it('verified domain is readable by every reader', async () => {
    const v = verifierPublishing()
    await v.startVerification('acme.example')
    assert.equal(await v.checkVerification('acme.example'), true)
    const doc = await new VerificationStore(file).load()
    assert.deepEqual(Object.keys(doc.verified), ['acme.example'])
    assert.deepEqual(await listedDomains(), ['acme.example'])
    assert.equal((await checkAuthorization('acme.example')).allowed, true)
  })

  it('unverified domain fails closed in checkAuthorization', async () => {
    assert.equal((await checkAuthorization('acme.example')).allowed, false)
  })

  it('legacy array store migrates on read', async () => {
    writeFileSync(file, JSON.stringify({ verified: ['acme.example'], pending: {} }))
    assert.equal((await checkAuthorization('acme.example')).allowed, true)
    assert.deepEqual(await listedDomains(), ['acme.example'])
    const rec = (await new VerificationStore(file).load()).verified['acme.example']
    assert.equal(rec?.token, '(migrated)')
    assert.equal(rec?.method, 'dns-txt')
  })

  it('corrupt store is empty, not an approval', async () => {
    writeFileSync(file, '{not json')
    const verdict = await checkAuthorization('acme.example')
    assert.equal(verdict.allowed, false)
  })

  it('normalization: verify apex, read HTTPS URL form', async () => {
    const v = verifierPublishing()
    await v.startVerification('acme.example')
    await v.checkVerification('acme.example')
    assert.equal((await checkAuthorization('https://acme.example/x')).allowed, true)
  })

  it('writer persists the record shape on disk', async () => {
    const v = verifierPublishing()
    await v.startVerification('acme.example')
    await v.checkVerification('acme.example')
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as { verified: Record<string, { method: string }> }
    assert.equal(onDisk.verified['acme.example']?.method, 'dns-txt')
  })

  it('trailing-dot FQDN target is allowed when the apex is verified', async () => {
    writeFileSync(file, JSON.stringify({ verified: ['acme.example'], pending: {} }))
    assert.equal((await checkAuthorization('acme.example.')).allowed, true)
  })

  it('an inherited property name is not a verified domain', async () => {
    assert.equal((await checkAuthorization('constructor')).allowed, false)
  })

  it('a __proto__ key in verified authorizes nothing', async () => {
    writeFileSync(file, '{"verified":{"__proto__":{"token":"t","verifiedAt":"x"}},"pending":{}}')
    assert.equal((await checkAuthorization('acme.example')).allowed, false)
    assert.equal((await checkAuthorization('constructor')).allowed, false)
  })

  it('a migrated apex does not authorize its subdomain', async () => {
    writeFileSync(file, JSON.stringify({ verified: ['acme.example'], pending: {} }))
    assert.equal((await checkAuthorization('api.acme.example')).allowed, false)
  })

  it('legacy elements that merely normalize to a domain do not authorize it', async () => {
    writeFileSync(file, JSON.stringify({ verified: ['x@victim.example', 'victim.example/foo'], pending: {} }))
    assert.equal((await checkAuthorization('victim.example')).allowed, false)
  })
})
