/**
 * Native TLS probe — the SecScan engine's own TLS evidence.
 *
 * Built for Q-SSLLABS (spec: ssllabs-parseladder-spec-2026-10-31.md §1.4).
 * Before this module the engine collected NO TLS facts: its "grade" was an
 * unconditional letter (scanner.ts's old `isHttps ? "A"` stub) and the only
 * real assessment code, the Qualys SSL Labs client (ssllabs.ts), was wired
 * to nothing. TLS posture is now graded from facts this probe measures
 * itself; an external grade is never an input.
 *
 * What it measures, per target: one default handshake (negotiated protocol,
 * cipher, peer certificate — validity window, subject, issuer, SANs — and
 * the platform's own trust verdict for that certificate), plus two
 * pinned-version handshakes that test whether the server still accepts
 * TLSv1 / TLSv1.1. Refusal of a pinned handshake is recorded as
 * not-accepted (a pass), never as an error.
 *
 * Trust discipline: observation handshakes run with
 * `rejectUnauthorized: false` BY DESIGN — the probe exists to inspect
 * certificates a client must not trust (expired, mismatched, self-signed),
 * and a verifying handshake would abort before those facts could be read.
 * The probe sends no application data and trusts nothing from the
 * connection; trust is decided afterwards, from the recorded facts
 * (`authorized`, `authorizationError`, `checkServerIdentity`, the validity
 * window) by tlsCertProblems()/deriveTlsGrade().
 *
 * Scope discipline: probeTargetTls() is the only entry the scanner uses.
 * It runs the target through the engine's target guard
 * (parseTargetUrl + assertPublicResolution) and connects to a validated
 * address with servername set to the target hostname — the same discipline
 * as validatedFetch, and no new egress destination.
 */

import tls from 'node:tls'
import { assertPublicResolution, parseTargetUrl, TargetValidationError, type TargetGuardOptions } from './targetGuard'
import type { ScanVulnerability } from './scanner'

/** Legacy protocol versions whose acceptance the probe tests explicitly. */
export type LegacyTlsVersion = 'TLSv1' | 'TLSv1.1'

export const LEGACY_TLS_VERSIONS: readonly LegacyTlsVersion[] = ['TLSv1', 'TLSv1.1']

/**
 * Facts measured by the probe for one HTTPS target. Field names
 * checked/reachable/protocol/validFromMs/validToMs/subject/issuer fill the
 * TlsObservation contract the Seclayer side declares (scanTypes.ts);
 * cipher, subjectAltName, authorized, authorizationError, hostnameMatches
 * and legacyProtocolsAccepted are the spec §1.4 additions.
 */
export interface TlsObservation {
  /** Whether a probe was attempted at all (HTTPS targets only). */
  checked: boolean
  /** Whether the default handshake completed. */
  reachable: boolean
  /** Negotiated protocol on the default handshake, e.g. "TLSv1.3". */
  protocol?: string
  /** Negotiated cipher suite (OpenSSL name) on the default handshake. */
  cipher?: string
  /** Certificate notBefore, ms epoch. */
  validFromMs?: number
  /** Certificate notAfter, ms epoch. */
  validToMs?: number
  /** Certificate subject CN. */
  subject?: string
  /** Certificate issuer CN. */
  issuer?: string
  /** Certificate subjectAltName string as presented, when present. */
  subjectAltName?: string
  /** Node's chain-validation verdict for the presented certificate. */
  authorized?: boolean
  /** Validation failure code (e.g. "CERT_HAS_EXPIRED") when not authorized. */
  authorizationError?: string
  /** Whether the certificate is valid for the target hostname. */
  hostnameMatches?: boolean
  /** Legacy versions the server ACCEPTED under a pinned handshake. */
  legacyProtocolsAccepted: LegacyTlsVersion[]
}

/** Certificate defects the probe can prove from its own observations. */
export type TlsCertProblem = 'expired' | 'not-yet-valid' | 'hostname-mismatch' | 'untrusted'

/**
 * Classify the certificate defects proven by an observation. A defect that
 * fully explains a failed validation (expired, not-yet-valid, mismatch)
 * suppresses the generic "untrusted" — the specific fact is the finding.
 */
export function tlsCertProblems(observation: TlsObservation, nowMs: number = Date.now()): TlsCertProblem[] {
  const problems: TlsCertProblem[] = []
  if (!observation.checked || !observation.reachable) return problems
  if (observation.validToMs !== undefined && nowMs > observation.validToMs) problems.push('expired')
  if (observation.validFromMs !== undefined && nowMs < observation.validFromMs) problems.push('not-yet-valid')
  if (observation.hostnameMatches === false) problems.push('hostname-mismatch')
  if (observation.authorized === false && problems.length === 0) problems.push('untrusted')
  return problems
}

/**
 * The engine's TLS letter, derived ONLY from probe facts:
 *   unmeasured (not checked / unreachable / no protocol) → null ("n/a")
 *   any certificate problem                              → "F"
 *   TLSv1 accepted                                       → capped at "C"
 *   TLSv1.1 accepted                                     → capped at "B"
 *   otherwise (TLS 1.2+ only, valid cert)                → "A"
 * The cipher is recorded in the observation and quoted in finding evidence
 * but is deliberately NOT a grade input: the tree has no weak-cipher
 * convention to grade against, and inventing one would be an unmeasured
 * claim. The letter is never emitted without a completed handshake.
 */
export function deriveTlsGrade(observation: TlsObservation, nowMs: number = Date.now()): string | null {
  if (!observation.checked || !observation.reachable || !observation.protocol) return null
  if (tlsCertProblems(observation, nowMs).length > 0) return 'F'
  if (observation.legacyProtocolsAccepted.includes('TLSv1')) return 'C'
  if (observation.legacyProtocolsAccepted.includes('TLSv1.1')) return 'B'
  return 'A'
}

export interface TlsProbeOptions {
  /** SNI / certificate identity name. Defaults to the connect host. */
  servername?: string
  /** Extra trust roots (private-CA targets; tests). Defaults to system roots. */
  ca?: tls.ConnectionOptions['ca']
  /** Default-handshake timeout. Bounded so a probe can never stall a scan. */
  defaultTimeoutMs?: number
  /** Per-attempt timeout for the pinned legacy handshakes. */
  legacyTimeoutMs?: number
  /** The verified engagement record's per-host verdict (targetGuard allowance). */
  attestedHost?: TargetGuardOptions['attestedHost']
}

interface HandshakeOutcome {
  connected: boolean
  protocol?: string
  cipher?: string
  cert?: tls.PeerCertificate
  authorized?: boolean
  authorizationError?: string
}

/**
 * Legacy attempts must be able to OFFER TLSv1/1.1 at all: the stock client
 * security level refuses locally (ERR_SSL_NO_PROTOCOLS_AVAILABLE) before
 * any server is consulted. The permissive set is safe here — these
 * connections test acceptance only, carry no application data, and their
 * results are never trusted.
 */
const LEGACY_ATTEMPT_CIPHERS = 'ALL:@SECLEVEL=0'

function attemptHandshake(options: tls.ConnectionOptions, timeoutMs: number): Promise<HandshakeOutcome> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (outcome: HandshakeOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }
    const socket = tls.connect({ ...options, rejectUnauthorized: false })
    const timer = setTimeout(() => {
      socket.destroy()
      finish({ connected: false })
    }, timeoutMs)
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate()
      const outcome: HandshakeOutcome = {
        connected: true,
        protocol: socket.getProtocol() ?? undefined,
        cipher: socket.getCipher()?.name,
        cert: cert && Object.keys(cert).length > 0 ? cert : undefined,
        authorized: socket.authorized,
        authorizationError: authorizationErrorText(socket.authorizationError),
      }
      socket.end()
      finish(outcome)
    })
    socket.once('error', () => finish({ connected: false }))
  })
}

/**
 * TLSSocket.authorizationError is typed as Error, but Node hands back the
 * bare verify-code string on current runtimes (e.g. "CERT_HAS_EXPIRED" —
 * no .code, no .message). Normalize either form to the code text.
 */
function authorizationErrorText(error: Error | string | null): string | undefined {
  if (!error) return undefined
  if (typeof error === 'string') return error.length > 0 ? error : undefined
  const code = (error as NodeJS.ErrnoException).code
  return code ?? (error.message || undefined)
}

/** PeerCertificate CN fields are typed string | string[]; take the first. */
function cnOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function parseCertDateMs(value: string | undefined): number | undefined {
  if (!value) return undefined
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? undefined : ms
}

/**
 * Probe one host:port directly. Performs NO target-guard validation —
 * callers scanning engagement targets must use probeTargetTls(); this
 * entry exists for the guard wrapper and for fixture tests. Never throws:
 * every failure mode is a recorded fact on the returned observation.
 */
export async function probeTls(host: string, port: number, options: TlsProbeOptions = {}): Promise<TlsObservation> {
  const servername = options.servername ?? host
  const base: tls.ConnectionOptions = {
    host,
    port,
    servername,
    ca: options.ca,
  }
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 6_000
  const legacyTimeoutMs = options.legacyTimeoutMs ?? 5_000

  const [def, ...legacy] = await Promise.all([
    attemptHandshake(base, defaultTimeoutMs),
    ...LEGACY_TLS_VERSIONS.map(version =>
      attemptHandshake(
        { ...base, minVersion: version, maxVersion: version, ciphers: LEGACY_ATTEMPT_CIPHERS },
        legacyTimeoutMs,
      ),
    ),
  ])

  const legacyProtocolsAccepted = LEGACY_TLS_VERSIONS.filter((_, i) => legacy[i]?.connected)
  if (!def || !def.connected) {
    return { checked: true, reachable: false, legacyProtocolsAccepted }
  }

  const cert = def.cert
  let hostnameMatches: boolean | undefined
  if (cert) {
    try {
      hostnameMatches = tls.checkServerIdentity(servername, cert) === undefined
    } catch {
      hostnameMatches = false
    }
  }

  return {
    checked: true,
    reachable: true,
    protocol: def.protocol,
    cipher: def.cipher,
    validFromMs: parseCertDateMs(cert?.valid_from),
    validToMs: parseCertDateMs(cert?.valid_to),
    subject: cnOf(cert?.subject?.CN),
    issuer: cnOf(cert?.issuer?.CN),
    subjectAltName: cert?.subjectaltname,
    authorized: def.authorized,
    authorizationError: def.authorizationError,
    hostnameMatches,
    legacyProtocolsAccepted,
  }
}

/**
 * Probe the TLS posture of a scan target URL under the engine's target
 * guard. Non-HTTPS targets return an unchecked observation. Guard
 * violations throw TargetValidationError (the scanner treats any probe
 * failure as "unmeasured" and the grade stays null).
 */
export async function probeTargetTls(targetUrl: string, options: TlsProbeOptions = {}): Promise<TlsObservation> {
  const { url, hostname } = parseTargetUrl(targetUrl)
  if (url.protocol !== 'https:') {
    return { checked: false, reachable: false, legacyProtocolsAccepted: [] }
  }
  const port = url.port ? Number(url.port) : 443
  const addresses = await assertPublicResolution(hostname, { attestedHost: options.attestedHost })
  const connectHost = addresses[0]
  if (connectHost === undefined) {
    // assertPublicResolution already throws on an empty result; this is the
    // type-level guard for the same fact, kept assertion-free for lint.
    throw new TargetValidationError(
      'dns_failed',
      `Could not resolve ${hostname}; refusing to scan an unresolvable target.`,
    )
  }
  return probeTls(connectHost, port, { ...options, servername: hostname })
}

/**
 * Findings derived from an observation — facts only, every evidence string
 * quotes values the probe itself observed. Returns finding bodies without
 * ids; scanner.ts wraps them through its vuln() path. An unreachable or
 * clean observation yields no TLS findings (absence of measurement is not
 * a finding).
 */
export function buildTlsFindings(observation: TlsObservation, targetUrl: string): Array<Omit<ScanVulnerability, 'id'>> {
  const findings: Array<Omit<ScanVulnerability, 'id'>> = []
  if (!observation.checked) return findings

  let hostname = targetUrl
  try {
    hostname = new URL(targetUrl).hostname
  } catch { /* keep the raw target string for evidence */ }

  if (observation.legacyProtocolsAccepted.length > 0) {
    const list = observation.legacyProtocolsAccepted.join(', ')
    findings.push({
      name: 'Weak TLS — Legacy Protocol Accepted',
      severity: 'medium',
      category: 'Transport Security',
      description: `The server accepts TLS connections using legacy protocol versions (${list}). TLS 1.0 and 1.1 were formally deprecated by RFC 8996: they lack modern cipher enforcement and are exposed to protocol-downgrade and cipher attacks (BEAST, POODLE class). A server that still accepts them lets an attacker force weaker transport security on any client old enough to offer them.`,
      evidence: `Pinned-version handshakes accepted by ${hostname}: ${list}. Default handshake negotiated: ${observation.protocol ?? '(none)'}${observation.cipher ? `, cipher ${observation.cipher}` : ''}. (All values observed by the engine's own TLS probe.)`,
      solution: 'Disable TLS 1.0 and TLS 1.1 on the server. Require TLS 1.2 or higher (TLS 1.3 preferred) with strong cipher suites.',
      cweId: 'CWE-327',
      cvssScore: 5.3,
      wstgId: 'WSTG-CRYP-01',
    })
  }

  const certEvidence = (extra: string) =>
    `Certificate subject: CN=${observation.subject ?? '(none presented)'}; issuer: CN=${observation.issuer ?? '(unknown)'}; ` +
    `valid ${observation.validFromMs !== undefined ? new Date(observation.validFromMs).toISOString() : '(unknown)'} → ` +
    `${observation.validToMs !== undefined ? new Date(observation.validToMs).toISOString() : '(unknown)'}. ${extra} (Observed by the engine's own TLS probe.)`

  for (const problem of tlsCertProblems(observation)) {
    if (problem === 'expired') {
      findings.push({
        name: 'Expired TLS Certificate',
        severity: 'high',
        category: 'Transport Security',
        description: `The TLS certificate presented by ${hostname} has expired. Clients that validate certificates refuse the connection or show a security warning, and users trained to click through expiry warnings are exposed to man-in-the-middle attacks.`,
        evidence: certEvidence(`The certificate expired on ${observation.validToMs !== undefined ? new Date(observation.validToMs).toISOString() : '(unknown date)'}${observation.authorizationError ? `; validation error: ${observation.authorizationError}` : ''}.`),
        solution: "Renew the TLS certificate (free from Let's Encrypt) and automate renewal so it cannot lapse again.",
        cweId: 'CWE-298',
        cvssScore: 7.4,
        wstgId: 'WSTG-CRYP-01',
      })
    } else if (problem === 'not-yet-valid') {
      findings.push({
        name: 'TLS Certificate Not Yet Valid',
        severity: 'high',
        category: 'Transport Security',
        description: `The TLS certificate presented by ${hostname} is not yet valid — its validity window starts in the future. Clients that validate certificates refuse the connection or show a security warning.`,
        evidence: certEvidence(`The certificate becomes valid on ${observation.validFromMs !== undefined ? new Date(observation.validFromMs).toISOString() : '(unknown date)'}${observation.authorizationError ? `; validation error: ${observation.authorizationError}` : ''}.`),
        solution: 'Replace the certificate with one whose validity window covers the present (or correct the server clock if it is wrong).',
        cweId: 'CWE-298',
        cvssScore: 7.4,
        wstgId: 'WSTG-CRYP-01',
      })
    } else if (problem === 'hostname-mismatch') {
      findings.push({
        name: 'TLS Certificate Hostname Mismatch',
        severity: 'high',
        category: 'Transport Security',
        description: `The TLS certificate presented by the server is not valid for ${hostname}. Clients that validate certificates refuse the connection or show a security warning; the certificate was issued for a different name.`,
        evidence: certEvidence(`Expected hostname: ${hostname}; presented names: ${observation.subjectAltName ?? `CN=${observation.subject ?? '(none)'}`}.`),
        solution: `Issue a certificate whose subjectAltName includes ${hostname} and deploy it on this endpoint.`,
        cweId: 'CWE-297',
        cvssScore: 7.4,
        wstgId: 'WSTG-CRYP-01',
      })
    } else {
      findings.push({
        name: 'Untrusted TLS Certificate',
        severity: 'high',
        category: 'Transport Security',
        description: `The TLS certificate presented by ${hostname} does not chain to a trust root clients accept (self-signed or an untrusted private CA). Browsers and API clients refuse the connection or show a security warning.`,
        evidence: certEvidence(`Chain validation failed: ${observation.authorizationError ?? '(no reason reported)'}.`),
        solution: "Deploy a certificate issued by a publicly trusted CA (free from Let's Encrypt), including the full intermediate chain.",
        cweId: 'CWE-295',
        cvssScore: 7.4,
        wstgId: 'WSTG-CRYP-01',
      })
    }
  }

  return findings
}
