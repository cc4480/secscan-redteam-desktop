/**
 * Credential-attempt lockout interlock (Q-LOCKOUT) — the "how hard" brake
 * beside scope's "where" and the rate limiter's "how fast".
 *
 * Ported mechanism (ZimZilla AttemptBudget, re-implemented as original
 * TypeScript like turn-integrity.ts): an operator who declares the target
 * locks accounts at N bad passwords can afford N−1 failed validations; the
 * Nth is refused BEFORE it runs. Default threshold 5 — the most conservative
 * value in common use: being wrong on the low side costs a re-run, being
 * wrong on the high side costs a locked-out workforce.
 *
 * What is enforced here (spec: lockout-spec-2026-10-31.md):
 *  - Per-(host, protocolClass) FAILED-validation budget of
 *    `lockoutThreshold − 1`. Class A calls are exactly one validation of the
 *    single engagement test account (credentials come from the environment,
 *    never from tool args), and a successful validation resets the target's
 *    bad-password counter — so successes reset the key, only failures count.
 *  - Spend-before-run: admission reserves an in-flight slot; a call is
 *    refused when `failures + inFlight + 1 > limit`, so parallel calls
 *    cannot collectively overshoot the limit either.
 *  - Campaign backstop: `totalFailureCeiling` (default 25) total failed
 *    validations across all keys trips credential testing engagement-wide —
 *    the honest form of the donor's campaign-wide counter, for when the
 *    declared threshold is wrong on some host.
 *  - Class B (attempts happen INSIDE one call — msf login scanners, nmap
 *    auth/brute scripts) cannot be counted per attempt from the choke
 *    point, so it draws a per-host call budget (default 1) instead, and its
 *    summary is signal-watched. Anyone claiming per-attempt coverage for
 *    these paths is claiming something the architecture cannot produce.
 *  - A lockout SIGNAL in any classified result (STATUS_ACCOUNT_LOCKED_OUT,
 *    KDC_ERR_CLIENT_REVOKED, LDAP data 775, pam_faillock, the shared
 *    LOCKOUT_TEXT_PATTERN 429/locked phrasings) trips the WHOLE host: AD's
 *    bad-password counter is per-account across protocols, so one class's
 *    signal refuses them all. Other hosts and all non-credential work
 *    continue.
 *  - Resume is a recorded operator decision (who + rationale) or nothing.
 *    There is no agent path, no tool, no timer. The attempt ledger is
 *    never erased by a reset.
 *
 * Honest limits: reservations resolve when dispatch records the outcome; a
 * later gate's denial (variant cap, policy) strands the reservation, which
 * fails SAFE (later refusals, never extra attempts). Reads never count —
 * a null session, an anonymous bind, a probe are not credential attempts,
 * or the breaker would trip on reconnaissance.
 */


import { CredentialAttemptGuard } from './lockout-guard.js'

// Public surface unchanged by the split: the original path still exports
// every name (classification in lockout-classify.ts, the guard in
// lockout-guard.ts).
export {
  LOCKOUT_TEXT_PATTERN,
  DEFAULT_LOCKOUT_CONFIG,
  LOCKOUT_LEDGER_CAP,
  LOCKOUT_ACCOUNT_LABEL,
  classifyCredentialAttempt,
  classifyAuthOutcome,
} from './lockout-classify.js'
export type {
  ProtocolClass,
  CredentialClassKind,
  CredentialClassification,
  AuthOutcome,
  LockoutConfig,
  AttemptLedgerEntry,
  LockoutCheckVerdict,
  LockoutOutcomeInfo,
  LockoutManifestData,
} from './lockout-classify.js'
export { CredentialAttemptGuard } from './lockout-guard.js'

/**
 * Resolve the engagement's guard from a context (the scopeGuardFor
 * precedent): phases/run.ts constructs it from the resolved config; a
 * context assembled without one (tests, partial contexts) gets a
 * default-configured guard built from whatever config the context
 * carries, cached on the context so every dispatch shares one guard.
 */
export function lockoutGuardFor(ctx: {
  safety: { lockout?: CredentialAttemptGuard };
  config?: { lockoutThreshold?: number; lockoutTotalFailures?: number; lockoutOpaqueRuns?: number };
}): CredentialAttemptGuard {
  ctx.safety.lockout ??= new CredentialAttemptGuard({
    lockoutThreshold: ctx.config?.lockoutThreshold,
    totalFailureCeiling: ctx.config?.lockoutTotalFailures,
    opaqueRunsPerHost: ctx.config?.lockoutOpaqueRuns,
  });
  return ctx.safety.lockout;
}
