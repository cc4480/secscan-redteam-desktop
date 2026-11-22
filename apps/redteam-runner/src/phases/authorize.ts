/**
 * Authorization phase (v0.19.0 refactor — extracted from phases.ts).
 */
import { type Ctx } from '../context.js'
import { type GateVerdict, checkAuthorization, checkScopeAuthorization, scopeHosts } from '../gate.js'
import { isPrivateOrLoopbackHost } from '../prober.js'
import { scopeGuardFor } from '../safety/scope-guard.js'

/**
 * Explicit operator attestation recorded on the engagement when a caller
 * intentionally bypasses local DNS verification (e.g. injected verifier/tests).
 * Normal runs require in-app DNS TXT verification and do not use this path.
 */
function operatorAttestation(ctx: Ctx): string {
  const operator = ctx.input.operatorName ?? ctx.input.client ?? 'the engagement operator'
  return (
    `Operator-attested ownership: ${operator} attests on the engagement record that they own ` +
    `${ctx.domain} and every host in the declared scope, or are authorized to test them. ` +
    'Verification taken from the engagement record; local DNS challenge was not consulted.'
  )
}

/**
 * The verification proof recorded in TEST MODE (REDTEAM_TEST_MODE=1,
 * operator order): an honest self-attestation that names the bypass.
 * It is deliberately NOT shaped like a DNS proof - anything reading the
 * record can tell no ownership verification happened.
 */
export const TEST_MODE_ATTESTATION =
  'TEST MODE: operator self-attested - ownership verification bypassed by operator order (REDTEAM_TEST_MODE)'

/**
 * Stamp the attestation output onto the engagement record: the raw ROE
 * scope entries whose hosts this phase authorized. From here on the
 * scope guard's allow set derives from this record (scopeGuardFor
 * prefers it over the launch request's ROE), so every dispatch consumer
 * inherits the attested scope. Called on both success paths — the
 * normal path after every scope host passed authorization, and the
 * test-mode path where the record is the operator's self-attestation —
 * always before appendScopeGuardEvent, so the audit event describes
 * the record-derived guard that will actually be enforced.
 *
 * Only entries this phase actually checked are stamped. The checked
 * set is represented by ctx.hosts: run.ts builds it with scopeHosts
 * over the same ROE, checkAuthorization verified ctx.domain from it,
 * and checkScopeAuthorization was called over exactly it (and, on the
 * normal path, allowed only when every one of those hosts passed).
 * A raw ROE entry whose parsed host is not in ctx.hosts was therefore
 * never checked — scopeHosts could not parse it into a host at all
 * (an operator typo, a product name, a malformed address), or it was
 * never part of the checked host list — and copying it into the
 * record would let the guard treat as attested a host authorization
 * never saw. Such entries are dropped from the stamp; the kept
 * entries stay in their raw ROE form (case, scheme, port, CIDR
 * notation) so the guard's normalisation sees exactly what the
 * operator declared for the hosts that were checked.
 */
function stampVerifiedScope(ctx: Ctx): void {
  const checked = new Set(ctx.hosts.map(h => h.trim().toLowerCase().replace(/\.+$/, '')))
  ctx.verifiedScope = ctx.input.roe.scope.filter((entry) => {
    const parsed = scopeHosts({ scope: [entry] })
    const first = parsed[0]
    return first !== undefined && checked.has(first.replace(/\.+$/, ''))
  })
}

/** The scope-guard audit event, appended on every authorize path. */
function appendScopeGuardEvent(ctx: Ctx): void {
  const guard = scopeGuardFor(ctx)
  ctx.events.append({
    phase: 'authorize',
    actor: 'runner',
    action: 'scope_guard',
    target: ctx.domain,
    result:
      `Scope guard armed: ${guard.describe()}` +
      (guard.skippedEntries.length > 0
        ? `. SKIPPED unclassifiable entries (not enforced, fix the ROE): ${guard.skippedEntries.join(', ')}`
        : ''),
  })
}

/**
 * Whether TEST MODE may lift ownership verification for this engagement.
 * Only a private/loopback engagement qualifies: the target domain and every
 * in-scope host must be private or loopback, and the scope must be non-empty
 * (`[].every` is true, so an empty scope would otherwise fail open). Any
 * public target or host runs the normal verification path.
 *
 * @param ctx - Engagement context; reads `config.testMode`, `domain` and `hosts`.
 * @returns True when test mode is on and the whole engagement is private/loopback.
 */
function testModeBypassApplies(ctx: Ctx): boolean {
  return (
    ctx.config.testMode &&
    ctx.hosts.length > 0 &&
    ctx.hosts.every(h => isPrivateOrLoopbackHost(h)) &&
    isPrivateOrLoopbackHost(ctx.domain)
  )
}

/**
 * Runs the authorization phase: test-mode attestation for a private/loopback
 * engagement, otherwise ownership and scope verification.
 *
 * @param ctx - Engagement context.
 * @returns The gate verdict; `allowed: false` blocks the engagement.
 */
export async function authorizePhase(ctx: Ctx): Promise<GateVerdict> {
  // TEST MODE (operator order, REDTEAM_TEST_MODE=1): the authorization
  // gates are bypassed for testing and the bypass is the first thing in
  // the engagement log — the test_mode_active event names every gate it
  // lifts, and the recorded proof is the honest self-attestation above,
  // never a fabricated verification. The scope guard still arms (the
  // out-of-scope deny list stays in force). The bypass applies only to a
  // private/loopback engagement (testModeBypassApplies); a public target
  // falls through to the normal verification below.
  if (testModeBypassApplies(ctx)) {
    ctx.events.append({
      phase: 'authorize',
      actor: 'runner',
      action: 'test_mode_active',
      target: ctx.domain,
      result:
        'TEST MODE ACTIVE (REDTEAM_TEST_MODE=1, operator order): ownership verification and scope ' +
        'authorization are bypassed for this engagement, and with them the mechanical restraints that ' +
        'key off them — autonomy-tier enforcement, credential lockout interlock, per-host rate limiting, ' +
        'variant cap, always/mode technique exclusions, host-exec destructive-command denylist, and msf ' +
        "module/payload policy. The verification proof on record is the operator's self-attestation, " +
        'not a DNS or service proof. The out-of-scope deny list remains in force.',
    })
    stampVerifiedScope(ctx)
    appendScopeGuardEvent(ctx)
    ctx.verifiedAt = new Date().toISOString()
    ctx.verificationProof = TEST_MODE_ATTESTATION
    ctx.events.append({
      phase: 'authorize',
      actor: 'coordinator',
      action: 'authorization_basis',
      target: ctx.domain,
      result: `${ctx.verificationProof} Mode: ${ctx.input.mode.toUpperCase()}. Objective: ${ctx.input.objective}. Scope: ${ctx.hosts.join(', ')}.`,
    })
    ctx.events.updateState({
      status: 'running',
      verified: true,
      verificationTs: ctx.verifiedAt,
      verificationProof: ctx.verificationProof,
      verifiedScope: ctx.verifiedScope,
    })
    return { allowed: true }
  }
  // Test mode on but fenced out: the log records that ownership is still
  // enforced and which restraints test mode lifts regardless of the fence.
  if (ctx.config.testMode) {
    ctx.events.append({
      phase: 'authorize',
      actor: 'runner',
      action: 'test_mode_ownership_enforced',
      target: ctx.domain,
      result:
        'REDTEAM_TEST_MODE is on, but this engagement includes a public host or domain: ownership verification is still required. ' +
        'Test mode still lifts these restraints for this run: the ROE test window, production graduation confirmation, ' +
        'Tier 2 production approval, the production named-operator requirement, the prober private-address rejection for ' +
        'in-scope hosts, the host-exec and msf destructive-command denylist, msf module/payload policy, per-host rate ' +
        'limiting, autonomy-tier enforcement, the credential lockout interlock, the variant cap, and always/mode technique exclusions.',
    })
  }
  // Verification basis: local in-app DNS TXT challenge store by default.
  // An injected verifier (tests/embedded callers) may supply an explicit
  // attestation path; no external service is consulted.
  const attestedProof = ctx.deps.verify !== undefined ? operatorAttestation(ctx) : undefined
  const verdict = await checkAuthorization(ctx.domain, {
    allowLocalSandbox: ctx.config.localSandbox,
    attestedProof,
  })
  if (!verdict.allowed) {
    ctx.events.append({ phase: 'authorize', actor: 'coordinator', action: 'authorization_denied', target: ctx.domain, result: verdict.reason ?? 'denied' })
    ctx.events.updateState({ status: 'blocked', phase: 'blocked', blockedReason: verdict.reason })
    return verdict
  }
  // The target being verified says nothing about the OTHER hosts the engagement may
  // touch: scope membership is an operator claim, not proof of ownership. Every host
  // in scope is checked here, before any agent runs, so a verified target cannot be
  // used as a foothold to probe unrelated public hosts.
  const scopeVerdict = await checkScopeAuthorization(ctx.hosts, {
    allowLocalSandbox: ctx.config.localSandbox,
    verifiedTarget: ctx.domain,
    attestedProof,
  })
  if (!scopeVerdict.allowed) {
    ctx.events.append({
      phase: 'authorize',
      actor: 'coordinator',
      action: 'scope_authorization_denied',
      target: ctx.domain,
      result: scopeVerdict.reason ?? 'denied',
    })
    ctx.events.updateState({ status: 'blocked', phase: 'blocked', blockedReason: scopeVerdict.reason })
    return scopeVerdict
  }
  // Scope guard state lands in the audit log before any agent acts: the
  // parsed allow/deny sets, and any scope entries that could not be
  // classified (an operator typo must be visible, never a silent
  // narrowing of scope). The guard is stamped from the attestation
  // output first (stampVerifiedScope), so the sets the event describes
  // are the record-derived sets the dispatch scope gate will enforce.
  // Building it here also caches it on the context for that gate.
  stampVerifiedScope(ctx)
  appendScopeGuardEvent(ctx)
  ctx.verifiedAt = new Date().toISOString()
  ctx.verificationProof = verdict.reason
    ? `${verdict.reason} (${ctx.verifiedAt})`
    : `${ctx.domain} is ownership-verified in the local app store (${ctx.verifiedAt}).`
  ctx.events.append({
    phase: 'authorize',
    actor: 'coordinator',
    action: 'authorization_basis',
    target: ctx.domain,
    result: `${ctx.verificationProof} Mode: ${ctx.input.mode.toUpperCase()}. Objective: ${ctx.input.objective}. Scope: ${ctx.hosts.join(', ')}.`,
  })
  ctx.events.updateState({
    status: 'running',
    verified: true,
    verificationTs: ctx.verifiedAt,
    verificationProof: ctx.verificationProof,
    verifiedScope: ctx.verifiedScope,
  })
  return verdict
}

