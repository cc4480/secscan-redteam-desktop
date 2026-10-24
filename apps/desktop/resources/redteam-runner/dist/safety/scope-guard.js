/**
 * Scope guard — mechanical allow/deny target enforcement at dispatch.
 *
 * TypeScript port of the ZimZilla scope pair's guard semantics
 * (zimzilla/scope.py, staged 2026-10-23), adapted to the runner's ROE model.
 * The port is split by concern: scope-ip.ts (address parsing),
 * scope-hostset.ts (the HostSet matching rules), scope-extract.ts
 * (the command-text target scan), and this module (the decision):
 *
 *  - Two sets, one job each. The ALLOW set is the engagement's declared ROE
 *    scope (--scope / roe.scope): the hosts the operator is authorized to
 *    touch. The DENY set is the operator's out-of-scope list
 *    (--out-of-scope / roe.outOfScope): hosts that must never be touched,
 *    even when they fall inside the allow set. Deny always beats allow.
 *  - Matching (HostSet.contains): a hostname matches a listed domain exactly
 *    or as a subdomain of it; an IP matches a listed IP exactly or any CIDR
 *    that contains it (address family must match). Ports are extracted from
 *    targets but never matched — membership is per-host, as in the source.
 *  - Loopback/localhost is infrastructure, not a target: it is never a
 *    member of either set, so the deny list can never block it and the allow
 *    set never implicitly covers it. The runner's one deviation from the
 *    source: because --scope is an enforced authorization list here (in
 *    ZimZilla the allow file only arms the session), a local host is in
 *    scope only when the operator listed it literally — the same exact-match
 *    rule the prober and host-exec already apply to loopback, and the
 *    local-sandbox gate separately decides when private targets may be
 *    engaged at all.
 *  - Command scan (checkCommand): host-exec commands run ON an in-scope
 *    host but can themselves reach OUT to other hosts. The scan tokenises
 *    the command and checks every extracted target against the DENY set
 *    only (the Python guard's exact role for command text). Extraction is a
 *    static text scan, not a sandbox: URLs, host:port pairs, IPs/CIDRs,
 *    impacket `domain/user@host` targets, and UNC paths are always targets;
 *    bare dotted hostnames count only when the command runs a known network
 *    tool or ends in a TLD that is never a file extension. A network-tool
 *    command whose only targets are built by shell substitution is
 *    unresolvable and fails closed.
 *
 * The guard is pure and synchronous: no DNS, no I/O, no state beyond the
 * two parsed sets. It is built once per engagement and consulted by the
 * dispatcher before any handler runs.
 */
import { HostSet, LOCAL_HOSTS } from "./scope-hostset.js";
import { extractTargets, commandUsesNetworkTool, stripSubstitutions, SUBSTITUTION_RE } from "./scope-extract.js";
export { HostSet, classifyScopeEntry, LOCAL_HOSTS } from "./scope-hostset.js";
export { extractTargets, commandUsesNetworkTool, stripSubstitutions, NETWORK_TOOLS, NEVER_FILE_EXT_TLDS, } from "./scope-extract.js";
export { parseIp, parseIPv4, parseIPv6, parseNetwork } from "./scope-ip.js";
/**
 * The engagement's scope guard: an allow set (the ROE scope) and a deny set
 * (the ROE out-of-scope list), with deny-beats-allow precedence.
 */
export class ScopeGuard {
    sets;
    /** @param sets - The parsed allow/deny sets and their load state. */
    constructor(sets) {
        this.sets = sets;
    }
    /**
     * Build the guard from ROE fields: `scope` (allow) and `outOfScope`
     * (deny). An undefined outOfScope means no deny list was declared — the
     * command scan then has nothing to enforce, exactly as a missing
     * out-of-scope.yaml disables the Python guard's command check.
     *
     * @param roe - The rules of engagement (scope + optional outOfScope).
     * @returns The guard for this engagement.
     */
    static fromRoe(roe) {
        const allowEntries = roe.scope ?? [];
        const allowBuilt = HostSet.fromEntries(allowEntries);
        const denyDeclared = roe.outOfScope !== undefined;
        const denyBuilt = denyDeclared ? HostSet.fromEntries(roe.outOfScope ?? []) : { set: new HostSet(), skipped: [] };
        return new ScopeGuard({
            allow: allowBuilt.set,
            deny: denyBuilt.set,
            allowEntries,
            allowLoaded: allowEntries.length > 0,
            denyLoaded: denyDeclared,
            skipped: [...allowBuilt.skipped, ...denyBuilt.skipped],
        });
    }
    /** Entries from either list that classification skipped (operator typos surface here, never silently). */
    get skippedEntries() {
        return this.sets.skipped;
    }
    /** True when an out-of-scope (deny) list was declared for this engagement. */
    get denyLoaded() {
        return this.sets.denyLoaded;
    }
    /**
     * Whether `host` is on the out-of-scope list (Python `Scope.allows`,
     * inverted): deny membership is the only question, independent of allow.
     *
     * @param host - The host or IP to test.
     * @returns The deny verdict — member means blocked, with the rule as reason.
     */
    denyMembership(host) {
        if (!this.sets.denyLoaded)
            return { member: false, reason: "no out-of-scope list" };
        return this.sets.deny.contains(host);
    }
    /**
     * The dispatch decision for one target host. Order: the deny list first
     * (deny always beats allow), then the allow set. A local host is allowed
     * only when literally listed in the allow entries (see module header).
     *
     * @param host - The target host or IP (hostname form; no scheme/port).
     * @returns The verdict; `allowed: false` carries the deciding rule.
     */
    checkHost(host) {
        const denied = this.denyMembership(host);
        if (denied.member) {
            return {
                allowed: false,
                kind: "deny",
                target: host,
                reason: `out of scope: ${host} is on the engagement out-of-scope list (${denied.reason}) — deny beats allow`,
            };
        }
        if (!this.sets.allowLoaded) {
            return { allowed: true, kind: "", target: host, reason: "no scope declared" };
        }
        const h = host.trim().toLowerCase().replace(/^\[+/, "").replace(/\]+$/, "").replace(/\.+$/, "");
        if (LOCAL_HOSTS.has(h)) {
            const listed = this.sets.allowEntries.some((e) => HostSet.normaliseHost(e) === h || e.trim().toLowerCase() === h);
            return listed
                ? { allowed: true, kind: "", target: host, reason: "local host literally listed in scope" }
                : {
                    allowed: false,
                    kind: "allow",
                    target: host,
                    reason: `out of scope: ${host} is a local host and is not listed in the engagement scope`,
                };
        }
        const inAllow = this.sets.allow.contains(host);
        if (inAllow.member)
            return { allowed: true, kind: "", target: host, reason: inAllow.reason };
        return {
            allowed: false,
            kind: "allow",
            target: host,
            reason: `out of scope: ${host} is not in the engagement scope (${inAllow.reason})`,
        };
    }
    /**
     * The deny-list violations in a shell command (Python
     * `Scope.check_command`): every extracted target is checked against the
     * deny set only. Returns an empty list when no deny list was declared or
     * nothing extracted is denied. A network-tool command whose only targets
     * are built by shell substitution is unresolvable and fails closed with
     * a single synthetic violation.
     *
     * @param command - The raw command text about to execute.
     * @returns The violations found; empty means the command may proceed.
     */
    checkCommand(command) {
        if (!this.sets.denyLoaded)
            return [];
        const literal = extractTargets(stripSubstitutions(command));
        if (literal.length === 0 && SUBSTITUTION_RE.test(command) && commandUsesNetworkTool(command)) {
            return [
                {
                    target: "<command substitution>",
                    reason: "unresolvable target (command substitution)",
                },
            ];
        }
        const violations = [];
        const seen = new Set();
        for (const host of extractTargets(command)) {
            if (seen.has(host))
                continue;
            seen.add(host);
            const denied = this.sets.deny.contains(host);
            if (denied.member)
                violations.push({ target: host, reason: denied.reason });
        }
        return violations;
    }
    /**
     * One-line description of the guard (Python `Scope.describe`).
     *
     * @returns e.g. "allow: 5 entries (3d/1i/1n) · deny: 2 entries (2d/0i/0n)".
     */
    describe() {
        const allow = this.sets.allowLoaded ? this.sets.allow.describe() : "none";
        const deny = this.sets.denyLoaded ? this.sets.deny.describe() : "none";
        return `allow: ${allow} · deny: ${deny}`;
    }
}
/**
 * The engagement's scope guard, built once from the ROE and cached on
 * the context. Contexts assembled without one (tests, partial contexts)
 * get it built lazily here from their ROE; a context with no ROE at all
 * gets an empty guard that allows everything, matching the pre-gate
 * behavior for those paths.
 *
 * @param ctx - The context (or context-shaped object) to resolve for.
 * @returns The cached or newly built guard.
 */
export function scopeGuardFor(ctx) {
    if (!ctx.scopeGuard) {
        ctx.scopeGuard = ScopeGuard.fromRoe(ctx.input?.roe ?? {});
    }
    return ctx.scopeGuard;
}
//# sourceMappingURL=scope-guard.js.map