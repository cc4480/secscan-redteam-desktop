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
import tls from 'node:tls';
import { type TargetGuardOptions } from './targetGuard.js';
import type { ScanVulnerability } from './scanner.js';
/** Legacy protocol versions whose acceptance the probe tests explicitly. */
export type LegacyTlsVersion = 'TLSv1' | 'TLSv1.1';
export declare const LEGACY_TLS_VERSIONS: readonly LegacyTlsVersion[];
/**
 * Facts measured by the probe for one HTTPS target. Field names
 * checked/reachable/protocol/validFromMs/validToMs/subject/issuer fill the
 * TlsObservation contract the Seclayer side declares (scanTypes.ts);
 * cipher, subjectAltName, authorized, authorizationError, hostnameMatches
 * and legacyProtocolsAccepted are the spec §1.4 additions.
 */
export interface TlsObservation {
    /** Whether a probe was attempted at all (HTTPS targets only). */
    checked: boolean;
    /** Whether the default handshake completed. */
    reachable: boolean;
    /** Negotiated protocol on the default handshake, e.g. "TLSv1.3". */
    protocol?: string;
    /** Negotiated cipher suite (OpenSSL name) on the default handshake. */
    cipher?: string;
    /** Certificate notBefore, ms epoch. */
    validFromMs?: number;
    /** Certificate notAfter, ms epoch. */
    validToMs?: number;
    /** Certificate subject CN. */
    subject?: string;
    /** Certificate issuer CN. */
    issuer?: string;
    /** Certificate subjectAltName string as presented, when present. */
    subjectAltName?: string;
    /** Node's chain-validation verdict for the presented certificate. */
    authorized?: boolean;
    /** Validation failure code (e.g. "CERT_HAS_EXPIRED") when not authorized. */
    authorizationError?: string;
    /** Whether the certificate is valid for the target hostname. */
    hostnameMatches?: boolean;
    /** Legacy versions the server ACCEPTED under a pinned handshake. */
    legacyProtocolsAccepted: LegacyTlsVersion[];
}
/** Certificate defects the probe can prove from its own observations. */
export type TlsCertProblem = 'expired' | 'not-yet-valid' | 'hostname-mismatch' | 'untrusted';
/**
 * Classify the certificate defects proven by an observation. A defect that
 * fully explains a failed validation (expired, not-yet-valid, mismatch)
 * suppresses the generic "untrusted" — the specific fact is the finding.
 */
export declare function tlsCertProblems(observation: TlsObservation, nowMs?: number): TlsCertProblem[];
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
export declare function deriveTlsGrade(observation: TlsObservation, nowMs?: number): string | null;
export interface TlsProbeOptions {
    /** SNI / certificate identity name. Defaults to the connect host. */
    servername?: string;
    /** Extra trust roots (private-CA targets; tests). Defaults to system roots. */
    ca?: tls.ConnectionOptions['ca'];
    /** Default-handshake timeout. Bounded so a probe can never stall a scan. */
    defaultTimeoutMs?: number;
    /** Per-attempt timeout for the pinned legacy handshakes. */
    legacyTimeoutMs?: number;
    /** The verified engagement record's per-host verdict (targetGuard allowance). */
    attestedHost?: TargetGuardOptions['attestedHost'];
}
/**
 * Probe one host:port directly. Performs NO target-guard validation —
 * callers scanning engagement targets must use probeTargetTls(); this
 * entry exists for the guard wrapper and for fixture tests. Never throws:
 * every failure mode is a recorded fact on the returned observation.
 */
export declare function probeTls(host: string, port: number, options?: TlsProbeOptions): Promise<TlsObservation>;
/**
 * Probe the TLS posture of a scan target URL under the engine's target
 * guard. Non-HTTPS targets return an unchecked observation. Guard
 * violations throw TargetValidationError (the scanner treats any probe
 * failure as "unmeasured" and the grade stays null).
 */
export declare function probeTargetTls(targetUrl: string, options?: TlsProbeOptions): Promise<TlsObservation>;
/**
 * Findings derived from an observation — facts only, every evidence string
 * quotes values the probe itself observed. Returns finding bodies without
 * ids; scanner.ts wraps them through its vuln() path. An unreachable or
 * clean observation yields no TLS findings (absence of measurement is not
 * a finding).
 */
export declare function buildTlsFindings(observation: TlsObservation, targetUrl: string): Array<Omit<ScanVulnerability, 'id'>>;
