/**
 * Q-SSLLABS spec §1.6 test points T1–T3 for the native TLS probe
 * (src/secscan/tlsProbe.ts), plus pure tests of the grade mapping and the
 * certificate-problem classification.
 *
 * T1 (probe facts): local TLS fixture servers — a TLS 1.3-only server
 * yields protocol "TLSv1.3", an empty legacy list, no TLS finding and the
 * uncapped letter; a legacy-accepting server yields the legacy finding
 * with the observed protocols quoted in its evidence and a capped letter.
 * T2 (cert facts): expired / not-yet-valid / hostname-mismatch fixtures
 * produce cert findings quoting the fixtures' actual dates and names; a
 * refused handshake yields reachable:false and a null grade — never a
 * letter. Self-signed yields exactly the "untrusted" problem.
 * T3 (the stub is dead): scanner.ts contains no `isHttps ? "A"` derivation
 * and wires the probe instead; the legacy fixture never receives the top
 * letter (asserted in T1).
 *
 * Fixtures are throwaway certificates under test/fixtures/tls/ (see the
 * README there): a test CA and CA-signed certs, so trust is genuinely
 * evaluated by passing the CA — never disabled. The probe's own design
 * (rejectUnauthorized:false for observation, trust decided from recorded
 * facts) is what these tests exercise.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as tls from 'node:tls'
import {
  buildTlsFindings,
  deriveTlsGrade,
  probeTargetTls,
  probeTls,
  tlsCertProblems,
  type TlsObservation,
} from '#secscan/tlsProbe.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '..', '..', 'test', 'fixtures', 'tls')
const RUNNER_ROOT = join(HERE, '..', '..')
const fx = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')
const TEST_CA = fx('ca.crt')

interface RunningServer {
  server: tls.Server
  port: number
}

function startServer(options: tls.TlsOptions): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const server = tls.createServer(options, socket => socket.end())
    // Expected noise: pinned legacy attempts and probe aborts against
    // fixtures that refuse them.
    server.on('tlsClientError', () => {})
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('fixture server has no port'))
        return
      }
      resolve({ server, port: address.port })
    })
  })
}

function closeServer(running: RunningServer): Promise<void> {
  return new Promise(resolve => running.server.close(() => resolve()))
}

const probeFixture = (port: number) =>
  probeTls('127.0.0.1', port, { servername: 'localhost', ca: TEST_CA })

describe('Q-SSLLABS native TLS probe (spec T1–T3)', () => {
  let tls13Only: RunningServer
  let legacy: RunningServer
  let expired: RunningServer
  let notYet: RunningServer
  let wrongHost: RunningServer
  let selfSigned: RunningServer

  before(async () => {
    tls13Only = await startServer({ key: fx('good.key'), cert: fx('good.crt'), minVersion: 'TLSv1.3' })
    legacy = await startServer({
      key: fx('good.key'),
      cert: fx('good.crt'),
      minVersion: 'TLSv1',
      ciphers: 'ALL:@SECLEVEL=0',
    })
    expired = await startServer({ key: fx('expired.key'), cert: fx('expired.crt') })
    notYet = await startServer({ key: fx('notyet.key'), cert: fx('notyet.crt') })
    wrongHost = await startServer({ key: fx('wronghost.key'), cert: fx('wronghost.crt') })
    selfSigned = await startServer({ key: fx('selfsigned.key'), cert: fx('selfsigned.crt') })
  })

  after(async () => {
    for (const s of [tls13Only, legacy, expired, notYet, wrongHost, selfSigned]) {
      await closeServer(s)
    }
  })

  describe('T1 — probe facts', () => {
    it('TLS 1.3-only fixture: measured facts, no legacy, no finding, uncapped grade', { timeout: 20_000 }, async () => {
      const obs = await probeFixture(tls13Only.port)
      assert.equal(obs.checked, true)
      assert.equal(obs.reachable, true)
      assert.equal(obs.protocol, 'TLSv1.3')
      assert.ok(obs.cipher && obs.cipher.length > 0, 'cipher recorded')
      assert.deepEqual(obs.legacyProtocolsAccepted, [])
      assert.equal(obs.authorized, true)
      assert.equal(obs.subject, 'localhost')
      assert.equal(obs.issuer, 'SecScan Test CA')
      assert.ok(obs.validToMs !== undefined && obs.validToMs > Date.now(), 'cert currently valid')
      assert.deepEqual(tlsCertProblems(obs), [])
      assert.equal(deriveTlsGrade(obs), 'A')
      assert.deepEqual(buildTlsFindings(obs, 'https://localhost/'), [])
    })

    it('legacy-accepting fixture: legacy finding quotes the observed protocols; grade capped', { timeout: 20_000 }, async () => {
      const obs = await probeFixture(legacy.port)
      assert.equal(obs.reachable, true)
      assert.equal(obs.protocol, 'TLSv1.3', 'default handshake still negotiates the modern protocol')
      assert.deepEqual(obs.legacyProtocolsAccepted, ['TLSv1', 'TLSv1.1'])
      const findings = buildTlsFindings(obs, 'https://localhost/')
      assert.equal(findings.length, 1)
      assert.equal(findings[0]!.name, 'Weak TLS — Legacy Protocol Accepted')
      assert.ok(findings[0]!.evidence!.includes('TLSv1'), 'evidence quotes the accepted legacy protocol')
      assert.ok(findings[0]!.evidence!.includes('TLSv1.3'), 'evidence quotes the negotiated protocol')
      // T3's behavioural half: legacy acceptance never earns the top letter.
      assert.equal(deriveTlsGrade(obs), 'C')
      assert.notEqual(deriveTlsGrade(obs), 'A')
    })
  })

  describe('T2 — certificate facts', () => {
    it("expired fixture: expired problem, finding quotes the fixture's actual notAfter, grade F (never A)", { timeout: 20_000 }, async () => {
      const obs = await probeFixture(expired.port)
      assert.equal(obs.reachable, true)
      assert.equal(obs.authorizationError, 'CERT_HAS_EXPIRED')
      // The fixture cert's real window: 2020-01-01 → 2021-01-01 UTC.
      assert.equal(obs.validFromMs, Date.parse('2020-01-01T00:00:00.000Z'))
      assert.equal(obs.validToMs, Date.parse('2021-01-01T00:00:00.000Z'))
      assert.deepEqual(tlsCertProblems(obs), ['expired'])
      assert.equal(deriveTlsGrade(obs), 'F')
      assert.notEqual(deriveTlsGrade(obs), 'A')
      const findings = buildTlsFindings(obs, 'https://localhost/')
      assert.equal(findings.length, 1)
      assert.equal(findings[0]!.name, 'Expired TLS Certificate')
      assert.ok(
        findings[0]!.evidence!.includes('2021-01-01T00:00:00.000Z'),
        "evidence quotes the fixture's actual notAfter",
      )
    })

    it('not-yet-valid fixture: not-yet-valid problem and finding quoting the actual notBefore', { timeout: 20_000 }, async () => {
      const obs = await probeFixture(notYet.port)
      assert.deepEqual(tlsCertProblems(obs), ['not-yet-valid'])
      assert.equal(deriveTlsGrade(obs), 'F')
      const findings = buildTlsFindings(obs, 'https://localhost/')
      assert.equal(findings.length, 1)
      assert.equal(findings[0]!.name, 'TLS Certificate Not Yet Valid')
      assert.ok(findings[0]!.evidence!.includes('2030-01-01T00:00:00.000Z'))
    })

    it('hostname-mismatch fixture: mismatch problem and finding naming both names', { timeout: 20_000 }, async () => {
      const obs = await probeFixture(wrongHost.port)
      assert.equal(obs.hostnameMatches, false)
      assert.deepEqual(tlsCertProblems(obs), ['hostname-mismatch'])
      assert.equal(deriveTlsGrade(obs), 'F')
      const findings = buildTlsFindings(obs, 'https://localhost/')
      assert.equal(findings.length, 1)
      assert.equal(findings[0]!.name, 'TLS Certificate Hostname Mismatch')
      assert.ok(findings[0]!.evidence!.includes('other.example'), 'evidence quotes the presented name')
      assert.ok(findings[0]!.evidence!.includes('localhost'), 'evidence quotes the expected hostname')
    })

    it('self-signed fixture: exactly the untrusted problem; finding quotes the validation error', { timeout: 20_000 }, async () => {
      // No ca passed: the fixture chains to nothing the system roots trust.
      const obs = await probeTls('127.0.0.1', selfSigned.port, { servername: 'localhost' })
      assert.equal(obs.reachable, true)
      assert.equal(obs.authorized, false)
      assert.ok(obs.authorizationError && obs.authorizationError.length > 0, 'validation error recorded')
      assert.deepEqual(tlsCertProblems(obs), ['untrusted'])
      assert.equal(deriveTlsGrade(obs), 'F')
      const findings = buildTlsFindings(obs, 'https://localhost/')
      assert.equal(findings.length, 1)
      assert.equal(findings[0]!.name, 'Untrusted TLS Certificate')
      assert.ok(findings[0]!.evidence!.includes(obs.authorizationError!), 'evidence quotes the observed error')
    })

    it('refused handshake: reachable:false, grade null, no findings', { timeout: 20_000 }, async () => {
      const gone = await startServer({ key: fx('good.key'), cert: fx('good.crt') })
      const port = gone.port
      await closeServer(gone)
      const obs = await probeTls('127.0.0.1', port, { servername: 'localhost', ca: TEST_CA })
      assert.equal(obs.checked, true)
      assert.equal(obs.reachable, false)
      assert.equal(deriveTlsGrade(obs), null)
      assert.deepEqual(buildTlsFindings(obs, 'https://localhost/'), [])
    })
  })

  describe('T3 — the stub is dead (static assertions)', () => {
    it('scanner.ts derives no letter from isHttps and wires the probe', () => {
      const source = readFileSync(join(RUNNER_ROOT, 'src', 'secscan', 'scanner.ts'), 'utf8')
      assert.ok(!source.includes('isHttps ? "A"'), 'the unconditional-A stub is gone')
      assert.ok(source.includes('probeTargetTls(finalUrl, { attestedHost: guard.attestedHost })'), 'scanner runs the guarded probe, wired with the engagement allowance')
      assert.ok(source.includes('deriveTlsGrade(observation)'), 'grade derives from the observation')
      assert.ok(source.includes('buildTlsFindings(observation, finalUrl)'), 'findings derive from the observation')
    })

    it("dispatch label names the probe as the grade's basis", () => {
      const source = readFileSync(join(RUNNER_ROOT, 'src', 'dispatch', 'secscan.ts'), 'utf8')
      assert.ok(source.includes('TLS (own probe):'), 'label names the basis')
      assert.ok(!source.includes('TLS grade (engine-local)'), 'the stub-era label is gone')
    })
  })
})

describe('grade mapping and problem classification (pure)', () => {
  const base: TlsObservation = {
    checked: true,
    reachable: true,
    protocol: 'TLSv1.2',
    cipher: 'ECDHE-RSA-AES128-GCM-SHA256',
    authorized: true,
    hostnameMatches: true,
    validFromMs: Date.parse('2020-01-01T00:00:00.000Z'),
    validToMs: Date.parse('2030-01-01T00:00:00.000Z'),
    legacyProtocolsAccepted: [],
  }

  it('unmeasured observations grade null', () => {
    assert.equal(deriveTlsGrade({ checked: false, reachable: false, legacyProtocolsAccepted: [] }), null)
    assert.equal(deriveTlsGrade({ checked: true, reachable: false, legacyProtocolsAccepted: [] }), null)
    assert.equal(deriveTlsGrade({ ...base, protocol: undefined }), null)
  })

  it('clean TLS 1.2 grades A; TLSv1.1 acceptance caps at B; TLSv1 at C', () => {
    assert.equal(deriveTlsGrade(base), 'A')
    assert.equal(deriveTlsGrade({ ...base, legacyProtocolsAccepted: ['TLSv1.1'] }), 'B')
    assert.equal(deriveTlsGrade({ ...base, legacyProtocolsAccepted: ['TLSv1', 'TLSv1.1'] }), 'C')
  })

  it('a specific cert defect suppresses the generic untrusted classification', () => {
    const expiredObs: TlsObservation = {
      ...base,
      authorized: false,
      authorizationError: 'CERT_HAS_EXPIRED',
      validToMs: Date.parse('2021-01-01T00:00:00.000Z'),
    }
    assert.deepEqual(tlsCertProblems(expiredObs), ['expired'])
    assert.deepEqual(tlsCertProblems({ ...base, authorized: false, hostnameMatches: false }), ['hostname-mismatch'])
    assert.deepEqual(tlsCertProblems({ ...base, authorized: false }), ['untrusted'])
    assert.equal(deriveTlsGrade(expiredObs), 'F')
  })

  it('probeTargetTls returns an unchecked observation for plain HTTP', async () => {
    const obs = await probeTargetTls('http://localhost/')
    assert.equal(obs.checked, false)
    assert.equal(obs.reachable, false)
    assert.deepEqual(obs.legacyProtocolsAccepted, [])
  })
})
