/**
 * Memory scope (brief §4.2): derivation from a verified engagement, the
 * scopeKey identity (§3.2), and `scopeEligible` — the read/write gate
 * every recall gather passes through. Deny beats allow, mirroring
 * `safety/scope-guard.ts`. Memory never binds to an unverified scope.
 */
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { MemoryError } from "./errors.js";
/** Lowercase, trim, strip a trailing dot and any port — scopeHosts semantics. */
export function normalizeHost(raw) {
    let host = raw.trim().toLowerCase();
    if (host.startsWith("[")) {
        const end = host.indexOf("]");
        if (end > 0)
            return host.slice(1, end);
    }
    const colon = host.lastIndexOf(":");
    if (colon > 0 && /^\d+$/.test(host.slice(colon + 1)) && isIP(host.slice(0, colon)) !== 0) {
        host = host.slice(0, colon);
    }
    else if (colon > 0 && host.indexOf(":") === colon && /^\d+$/.test(host.slice(colon + 1))) {
        host = host.slice(0, colon);
    }
    if (host.endsWith("."))
        host = host.slice(0, -1);
    return host;
}
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
}
function scopeKey(slugSource, canonical) {
    const digest = createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
    const slug = slugify(slugSource) || "scope";
    return `${slug}-${digest}`;
}
/** Identity for an engagement-target scope: slug of the primary host + host-set hash. */
export function scopeKeyForHosts(hosts) {
    const normalized = [...new Set(hosts.map(normalizeHost))].sort();
    return scopeKey(normalized[0] ?? "", `hosts:${normalized.join(",")}`);
}
/** Identity for a target-class scope. */
export function scopeKeyForClass(targetClass) {
    return scopeKey(targetClass, `class:${targetClass.trim().toLowerCase()}`);
}
/** The one global-procedural scope key. */
export const GLOBAL_SCOPE_KEY = "global";
/**
 * Derive the running engagement's memory scope. Call ONLY after
 * authorization succeeded (§7.1 Moment 2): absent proof/`verifiedAt` or
 * zero hosts throws MEMORY_SCOPE_UNVERIFIED before planning (§8 row 5).
 */
export function deriveMemoryScope(input) {
    const hosts = [...new Set(input.hosts.map(normalizeHost).filter((h) => h.length > 0))].sort();
    if (!input.verificationProof || !input.verifiedAt || hosts.length === 0) {
        throw new MemoryError("MEMORY_SCOPE_UNVERIFIED", `cannot derive memory scope for engagement ${input.engagementId}: ` +
            `verificationProof ${input.verificationProof ? "present" : "ABSENT"}, ` +
            `verifiedAt ${input.verifiedAt ? "present" : "ABSENT"}, hosts ${hosts.length}`);
    }
    return {
        kind: "engagement-target",
        scopeKey: scopeKeyForHosts(hosts),
        hosts,
        stack: [],
        originEngagementIds: [input.engagementId],
    };
}
/**
 * Host membership per the scope guard: exact match, or `host` is a
 * subdomain of `domain`. IP literals match exactly only — subdomain
 * arithmetic on addresses is meaningless and fails closed.
 */
export function hostMatchesScope(host, domain) {
    const h = normalizeHost(host);
    const d = normalizeHost(domain);
    if (h === d)
        return true;
    if (isIP(h) !== 0 || isIP(d) !== 0)
        return false;
    return h.endsWith(`.${d}`);
}
/**
 * The read gate (§4.2 rule 4). No other path into recall exists.
 * - engagement-target unit: some unit host matches the engagement scope
 *   AND no unit host is out-of-scope.
 * - target-class unit: class equality (refresh) or stack/appType match.
 * - global-procedural unit: always eligible.
 */
export function scopeEligible(unit, engagementScope, ctx = {}) {
    const unitScope = unit.scope;
    if (unitScope.kind === "global-procedural")
        return true;
    if (unitScope.kind === "engagement-target") {
        const out = ctx.outOfScopeHosts ?? [];
        for (const host of unitScope.hosts) {
            if (out.some((o) => hostMatchesScope(host, o)))
                return false;
        }
        return unitScope.hosts.some((host) => engagementScope.hosts.some((scopeHost) => hostMatchesScope(host, scopeHost)));
    }
    // target-class
    if (ctx.targetClass && unitScope.targetClass && unitScope.targetClass === ctx.targetClass) {
        return true;
    }
    if (ctx.stack && ctx.stack.length > 0 && unitScope.stack.length > 0) {
        const wanted = new Set(ctx.stack.map((s) => s.toLowerCase()));
        if (unitScope.stack.some((s) => wanted.has(s.toLowerCase())))
            return true;
    }
    if (ctx.appType && unitScope.appType) {
        return unitScope.appType.toLowerCase() === ctx.appType.toLowerCase();
    }
    return false;
}
const URL_PATTERN = /https?:\/\/[^\s)]+/i;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const HOSTNAME_PATTERN = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|us|info|dev|app|ai|co|gov|edu|test|local|internal|example)\b/i;
/**
 * The write-time binding rules (§4.2 rules 2–3, content half). Structural
 * scope requirements are `validateUnit`'s (schema.ts); this enforces what
 * may LIVE under a scope kind:
 *
 * - A `target-derived-claim` (or any `target-content` unit) is
 *   engagement-target scoped only — never class, never global.
 * - A class-scoped unit must not assert host-specific values (URLs, IPs,
 *   hostnames) in claim or body — those belong under engagement-target.
 *   The detector is mechanical (URL / IP / hostname patterns), so a hit is
 *   a loud rejection the operator can re-scope, never a silent drop.
 * - `global-procedural` carries only operator/experience procedural
 *   lessons — never target facts or findings.
 *
 * @param unit - The unit about to be written or proposed.
 */
export function assertScopeBinding(unit) {
    const scope = unit.scope;
    if (unit.kind === "target-derived-claim" || unit.provenance.sourceClass === "target-content") {
        if (scope.kind !== "engagement-target") {
            throw new MemoryError("SCOPE_TOO_BROAD", `target-derived content must be engagement-target scoped, not ${scope.kind}`);
        }
    }
    if (scope.kind === "target-class") {
        const text = `${unit.claim}\n${unit.body}`;
        if (URL_PATTERN.test(text) || IPV4_PATTERN.test(text) || HOSTNAME_PATTERN.test(text)) {
            throw new MemoryError("SCOPE_TOO_BROAD", "class-scoped unit asserts a host-specific value (URL, IP, or hostname); it belongs under engagement-target scope");
        }
    }
    if (scope.kind === "global-procedural") {
        const sourceClass = unit.provenance.sourceClass;
        if (sourceClass !== "operator" && sourceClass !== "experience") {
            throw new MemoryError("SCOPE_TOO_BROAD", `global-procedural scope carries operator/experience lessons only, not ${sourceClass}`);
        }
        if (unit.kind === "target-derived-claim" || unit.kind === "target-fact" || unit.kind === "finding") {
            throw new MemoryError("SCOPE_TOO_BROAD", `global-procedural scope cannot carry a ${unit.kind} unit`);
        }
    }
}
//# sourceMappingURL=scope.js.map