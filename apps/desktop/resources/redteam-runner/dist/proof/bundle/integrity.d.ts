/**
 * Bundle provenance — an integrity digest the runner records when it
 * builds a PoC bundle, verified before reverify replays anything.
 *
 * Reverify executes the bundle's stored ssh/winrm/msf commands with
 * FRESH environment credentials. Without provenance, anyone who can
 * place a crafted `poc/*.json` (or get one committed/shared) and have an
 * operator run `reverify --execute` gets arbitrary commands run on the
 * in-scope hosts. So every runner-built bundle carries a sha256 digest
 * over its canonical form, and `reverifyBundle` refuses — before firing
 * a single step — when the digest is missing or does not match.
 *
 * Honest scope: there is no signing/secret facility in this codebase to
 * key the digest with, so this proves INTEGRITY (the bundle is bit-for-bit
 * what the runner recorded; any one-byte edit is detected), not
 * authenticity against an author who recomputes the digest after
 * rewriting the bundle. That residual is accepted deliberately (audit
 * T10): the bar is tamper detection, not HMAC ceremony.
 */
import type { PocBundle } from './bundle.js';
export interface BundleIntegrity {
    algorithm: 'sha256';
    /** sha256 (hex) over the canonical bundle JSON, this field excluded. */
    digest: string;
}
/** sha256 (hex) of the bundle's canonical form, integrity field excluded. */
export declare function computeBundleDigest(bundle: PocBundle): string;
/** Record the digest on a bundle the runner just built. Mutates; returns the bundle. */
export declare function stampBundleIntegrity(bundle: PocBundle): PocBundle;
/**
 * null when the bundle is bit-for-bit what the runner recorded; otherwise
 * the refusal reason. FAIL CLOSED: no digest = no provenance = no replay.
 */
export declare function verifyBundleIntegrity(bundle: PocBundle): string | null;
