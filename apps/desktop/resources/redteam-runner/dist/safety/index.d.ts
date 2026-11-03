/**
 * Safety module barrel (v0.13.0) — the production safety case.
 *
 * Mechanical, runner-enforced protections a buyer's security team can verify:
 * per-target rate limiting, PII redaction, staging→production graduation,
 * the credential-attempt lockout interlock, the machine-readable safety
 * manifest, and the zero-disruption record derived from the audit log.
 *
 * The stop-signal class (ESTOP, abort.json, auto-halt, the distress
 * breaker) was removed on the operator's order (2026-11-01): nothing in
 * this module can halt or refuse a tool call or a run via a stop signal.
 */
export { TargetRateLimiter, resolveEffectiveRps, DEFAULT_STAGING_RPS, DEFAULT_PRODUCTION_RPS, PRODUCTION_RPS_CAP, } from './ratelimit.js';
export type { RateLimitConfig } from './ratelimit.js';
export { redactPii, piiPatternLabels, likelyContainsPii } from './pii.js';
export { parseEnvironment, productionConfirmed, requireGraduation, describeEnvironment, PROD_CONFIRM_ENV, ENV_SELECT_ENV, } from './graduation.js';
export type { TestEnvironment } from './graduation.js';
export { CredentialAttemptGuard, classifyCredentialAttempt, classifyAuthOutcome, lockoutGuardFor, LOCKOUT_TEXT_PATTERN, DEFAULT_LOCKOUT_CONFIG, LOCKOUT_LEDGER_CAP, LOCKOUT_ACCOUNT_LABEL, } from './lockout.js';
export type { ProtocolClass, CredentialClassKind, CredentialClassification, AuthOutcome, LockoutConfig, AttemptLedgerEntry, LockoutCheckVerdict, LockoutOutcomeInfo, LockoutManifestData, } from './lockout.js';
export { buildZeroDisruptionRecord, disruptionVerdict, } from './disruption.js';
export type { ZeroDisruptionRecord } from './disruption.js';
export { buildSafetyManifest, renderSafetyManifestMarkdown, PROTECTIONS_IN_FORCE, RESIDUAL_RISKS, SAFETY_MANIFEST_VERSION, } from './manifest.js';
export type { SafetyManifest, ManifestInputs } from './manifest.js';
export { LOG_ROTATION_VERSION, DEFAULT_LOG_MAX_BYTES, DEFAULT_LOG_MAX_ARCHIVES, LOG_MAX_BYTES_ENV, LOG_MAX_ARCHIVES_ENV, resolveLogRotationConfig, maybeRotateLog, } from './rotation.js';
export type { LogRotationConfig, RotationOutcome, SeqRange } from './rotation.js';
export { assertDistFresh, distIsFresh, findWorkspaceRoot, hashSrcDir } from './distfresh.js';
export type { FreshnessResult } from './distfresh.js';
export { ScopeGuard, scopeGuardFor, HostSet, classifyScopeEntry, extractTargets, commandUsesNetworkTool, stripSubstitutions, parseIp, parseIPv4, parseIPv6, parseNetwork, LOCAL_HOSTS, NETWORK_TOOLS, NEVER_FILE_EXT_TLDS, } from './scope-guard.js';
export type { HostMembership, ScopeVerdict, ScopeViolation, ScopeGuardSets } from './scope-guard.js';
export { attestedHostAllowed } from './attested-host.js';
