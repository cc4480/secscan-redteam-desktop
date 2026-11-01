import { checkAuthorization, checkScopeAuthorization } from "../gate.js";
import { scopeGuardFor } from "../safety/scope-guard.js";
/**
 * The engagement record's ownership attestation: the named operator (or
 * client of record) attests they own the target and every host in the
 * declared scope, or are authorized to test them. This text becomes the
 * engagement's verificationProof — the record the verification-gated
 * tools check — so it names its basis plainly: an attestation, not a
 * server lookup.
 */
function operatorAttestation(ctx) {
    const operator = ctx.input.operatorName ?? ctx.input.client ?? "the engagement operator";
    return (`Operator-attested ownership: ${operator} attests on the engagement record that they own ` +
        `${ctx.domain} and every host in the declared scope, or are authorized to test them. ` +
        `Verification taken from the engagement record; no external service was consulted.`);
}
/**
 * The verification proof recorded in TEST MODE (REDTEAM_TEST_MODE=1,
 * operator order): an honest self-attestation that names the bypass.
 * It is deliberately NOT shaped like a DNS/service proof — anything
 * reading the record can tell no ownership verification happened.
 */
export const TEST_MODE_ATTESTATION = "TEST MODE: operator self-attested — ownership verification bypassed by operator order (REDTEAM_TEST_MODE)";
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
 */
function stampVerifiedScope(ctx) {
    ctx.verifiedScope = [...ctx.input.roe.scope];
}
/** The scope-guard audit event, appended on every authorize path. */
function appendScopeGuardEvent(ctx) {
    const guard = scopeGuardFor(ctx);
    ctx.events.append({
        phase: "authorize",
        actor: "runner",
        action: "scope_guard",
        target: ctx.domain,
        result: `Scope guard armed: ${guard.describe()}` +
            (guard.skippedEntries.length > 0
                ? `. SKIPPED unclassifiable entries (not enforced, fix the ROE): ${guard.skippedEntries.join(", ")}`
                : ""),
    });
}
export async function authorizePhase(ctx) {
    // TEST MODE (operator order, REDTEAM_TEST_MODE=1): the authorization
    // gates are bypassed for testing and the bypass is the first thing in
    // the engagement log — the test_mode_active event names every gate it
    // lifts, and the recorded proof is the honest self-attestation above,
    // never a fabricated verification. The scope guard still arms (the
    // out-of-scope deny list stays in force).
    if (ctx.config.testMode) {
        ctx.events.append({
            phase: "authorize",
            actor: "runner",
            action: "test_mode_active",
            target: ctx.domain,
            result: "TEST MODE ACTIVE (REDTEAM_TEST_MODE=1, operator order): ownership verification and scope " +
                "authorization are bypassed for this engagement, and with them the mechanical restraints that " +
                "key off them — autonomy-tier enforcement, credential lockout interlock, per-host rate limiting, " +
                "variant cap, always/mode technique exclusions, host-exec destructive-command denylist, and msf " +
                "module/payload policy. The verification proof on record is the operator's self-attestation, " +
                "not a DNS or service proof. The out-of-scope deny list remains in force.",
        });
        stampVerifiedScope(ctx);
        appendScopeGuardEvent(ctx);
        ctx.verifiedAt = new Date().toISOString();
        ctx.verificationProof = TEST_MODE_ATTESTATION;
        ctx.events.append({
            phase: "authorize",
            actor: "coordinator",
            action: "authorization_basis",
            target: ctx.domain,
            result: `${ctx.verificationProof} Mode: ${ctx.input.mode.toUpperCase()}. Objective: ${ctx.input.objective}. Scope: ${ctx.hosts.join(", ")}.`,
        });
        ctx.events.updateState({
            status: "running",
            verified: true,
            verificationTs: ctx.verifiedAt,
            verificationProof: ctx.verificationProof,
        });
        return { allowed: true };
    }
    // Verification basis: an explicitly injected verifier (tests, embedded
    // callers) or the REDTEAM_VERIFY_VIA_SERVICE=1 opt-in uses the SecScan
    // service check. Otherwise — the default — verification comes from the
    // engagement record and the service is never consulted.
    const viaService = ctx.deps.verify !== undefined || ctx.config.verifyViaService;
    const attestedProof = viaService ? undefined : operatorAttestation(ctx);
    const verdict = await checkAuthorization(ctx.domain, { mcpEndpoint: ctx.config.mcpEndpoint, mcpToken: ctx.config.mcpToken }, ctx.deps.verify, { allowLocalSandbox: ctx.config.localSandbox, attestedProof });
    if (!verdict.allowed) {
        ctx.events.append({ phase: "authorize", actor: "coordinator", action: "authorization_denied", target: ctx.domain, result: verdict.reason ?? "denied" });
        ctx.events.updateState({ status: "blocked", phase: "blocked", blockedReason: verdict.reason });
        return verdict;
    }
    // The target being verified says nothing about the OTHER hosts the engagement may
    // touch: scope membership is an operator claim, not proof of ownership. Every host
    // in scope is checked here, before any agent runs, so a verified target cannot be
    // used as a foothold to probe unrelated public hosts.
    const scopeVerdict = await checkScopeAuthorization(ctx.hosts, { mcpEndpoint: ctx.config.mcpEndpoint, mcpToken: ctx.config.mcpToken }, ctx.deps.verify, { allowLocalSandbox: ctx.config.localSandbox, verifiedTarget: ctx.domain, attestedProof });
    if (!scopeVerdict.allowed) {
        ctx.events.append({
            phase: "authorize",
            actor: "coordinator",
            action: "scope_authorization_denied",
            target: ctx.domain,
            result: scopeVerdict.reason ?? "denied",
        });
        ctx.events.updateState({ status: "blocked", phase: "blocked", blockedReason: scopeVerdict.reason });
        return scopeVerdict;
    }
    // Scope guard state lands in the audit log before any agent acts: the
    // parsed allow/deny sets, and any scope entries that could not be
    // classified (an operator typo must be visible, never a silent
    // narrowing of scope). The guard is stamped from the attestation
    // output first (stampVerifiedScope), so the sets the event describes
    // are the record-derived sets the dispatch scope gate will enforce.
    // Building it here also caches it on the context for that gate.
    stampVerifiedScope(ctx);
    appendScopeGuardEvent(ctx);
    ctx.verifiedAt = new Date().toISOString();
    ctx.verificationProof = verdict.reason
        ? `${verdict.reason} (${ctx.verifiedAt})`
        : `SecScan server lists ${ctx.domain} as ownership-verified (${ctx.verifiedAt}).`;
    ctx.events.append({
        phase: "authorize",
        actor: "coordinator",
        action: "authorization_basis",
        target: ctx.domain,
        result: `${ctx.verificationProof} Mode: ${ctx.input.mode.toUpperCase()}. Objective: ${ctx.input.objective}. Scope: ${ctx.hosts.join(", ")}.`,
    });
    ctx.events.updateState({
        status: "running",
        verified: true,
        verificationTs: ctx.verifiedAt,
        verificationProof: ctx.verificationProof,
    });
    return verdict;
}
//# sourceMappingURL=authorize.js.map