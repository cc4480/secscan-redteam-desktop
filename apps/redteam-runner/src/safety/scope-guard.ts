/**
 * Scope guard — mechanical allow/deny target enforcement at dispatch.
 *
 * TypeScript port of the ZimZilla scope pair's guard semantics
 * (zimzilla/scope.py, staged 2026-10-23), adapted to the runner's ROE model.
 * The port is split by concern: scope-ip.ts (address parsing),
 * scope-hostset.ts (the HostSet matching rules), scope-extract.ts
 * (the command-text target scan), and this module (the decision):
 *
 *  - Two sets, one job each. The ALLOW set is the engagement scope the
 *    AUTHORIZE phase attested (ctx.verifiedScope — the raw ROE scope
 *    entries whose hosts passed authorization, stamped on the engagement
 *    record beside the verification proof): the hosts the operator is
 *    authorized to touch. Until authorize stamps that record (tests,
 *    partial contexts), the declared ROE scope (--scope / roe.scope)
 *    stands in for it. The DENY set is the operator's out-of-scope list
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
import { HostSet, LOCAL_HOSTS, type HostMembership } from "./scope-hostset.js";
import { extractTargets, commandUsesNetworkTool, stripSubstitutions, SUBSTITUTION_RE } from "./scope-extract.js";
import { scopeGuardSetsFromEntries, scopeGuardSetsFromVerifiedRecord } from "./scope-record.js";

export { HostSet, classifyScopeEntry, LOCAL_HOSTS } from "./scope-hostset.js";
export type { HostMembership } from "./scope-hostset.js";
export {
  extractTargets,
  commandUsesNetworkTool,
  stripSubstitutions,
  NETWORK_TOOLS,
  NEVER_FILE_EXT_TLDS,
} from "./scope-extract.js";
export { parseIp, parseIPv4, parseIPv6, parseNetwork } from "./scope-ip.js";
export type { ParsedNetwork } from "./scope-ip.js";

// ---------------------------------------------------------------------------
// ScopeGuard — the allow/deny decision the dispatcher enforces
// ---------------------------------------------------------------------------

/** One deny-list violation found in a target or a command. */
export interface ScopeViolation {
  target: string;
  reason: string;
}

/** The guard's verdict for one host. */
export interface ScopeVerdict {
  allowed: boolean;
  /** Which list decided: "deny" (deny-listed), "allow" (not in scope), or "" when allowed. */
  kind: "deny" | "allow" | "";
  /** The violating target (the host itself, or the target inside a command). */
  target: string;
  /** Human-readable reason, naming the rule that decided. */
  reason: string;
}

/** Construction inputs for {@link ScopeGuard.fromRoe}. */
export interface ScopeGuardSets {
  allow: HostSet;
  deny: HostSet;
  /** Raw allow entries, kept for the literal-listing local-host rule. */
  allowEntries: readonly string[];
  /** True when an allow list was declared at all (roe.scope is non-empty). */
  allowLoaded: boolean;
  /** True when an out-of-scope list was declared (roe.outOfScope present). */
  denyLoaded: boolean;
  /** Entries from either list that could not be classified and were skipped. */
  skipped: string[];
}

/**
 * The engagement's scope guard: an allow set (the ROE scope) and a deny set
 * (the ROE out-of-scope list), with deny-beats-allow precedence.
 */
export class ScopeGuard {
  private readonly sets: ScopeGuardSets;

  /** @param sets - The parsed allow/deny sets and their load state. */
  constructor(sets: ScopeGuardSets) {
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
  static fromRoe(roe: { scope?: readonly string[]; outOfScope?: readonly string[] }): ScopeGuard {
    return new ScopeGuard(scopeGuardSetsFromEntries(roe.scope ?? [], roe.outOfScope));
  }

  /**
   * Build the guard from the AUTHORIZE phase's attestation output: the
   * raw ROE scope entries whose hosts passed authorization, persisted on
   * the engagement record (ctx.verifiedScope). The record wins for the
   * allow set — a launch-request scope that differs from what was
   * actually attested (or a launch object mutated after authorize) does
   * not move the guard. The deny set still comes from the ROE
   * `outOfScope`: deny always beats allow, record or not.
   *
   * @param record - The attested scope entries and the ROE deny list.
   * @returns The guard for this engagement, allow-sourced from the record.
   */
  static fromVerifiedRecord(record: {
    verifiedScope: readonly string[];
    outOfScope?: readonly string[];
  }): ScopeGuard {
    return new ScopeGuard(scopeGuardSetsFromVerifiedRecord(record));
  }

  /** Entries from either list that classification skipped (operator typos surface here, never silently). */
  get skippedEntries(): string[] {
    return this.sets.skipped;
  }

  /** True when an out-of-scope (deny) list was declared for this engagement. */
  get denyLoaded(): boolean {
    return this.sets.denyLoaded;
  }

  /**
   * Whether `host` is on the out-of-scope list (Python `Scope.allows`,
   * inverted): deny membership is the only question, independent of allow.
   *
   * @param host - The host or IP to test.
   * @returns The deny verdict — member means blocked, with the rule as reason.
   */
  denyMembership(host: string): HostMembership {
    if (!this.sets.denyLoaded) return { member: false, reason: "no out-of-scope list" };
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
  checkHost(host: string): ScopeVerdict {
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
      const listed = this.sets.allowEntries.some(
        (e) => HostSet.normaliseHost(e) === h || e.trim().toLowerCase() === h,
      );
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
    if (inAllow.member) return { allowed: true, kind: "", target: host, reason: inAllow.reason };
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
  checkCommand(command: string): ScopeViolation[] {
    if (!this.sets.denyLoaded) return [];

    const literal = extractTargets(stripSubstitutions(command));
    if (literal.length === 0 && SUBSTITUTION_RE.test(command) && commandUsesNetworkTool(command)) {
      return [
        {
          target: "<command substitution>",
          reason: "unresolvable target (command substitution)",
        },
      ];
    }

    const violations: ScopeViolation[] = [];
    const seen = new Set<string>();
    for (const host of extractTargets(command)) {
      if (seen.has(host)) continue;
      seen.add(host);
      const denied = this.sets.deny.contains(host);
      if (denied.member) violations.push({ target: host, reason: denied.reason });
    }
    return violations;
  }

  /**
   * One-line description of the guard (Python `Scope.describe`).
   *
   * @returns e.g. "allow: 5 entries (3d/1i/1n) · deny: 2 entries (2d/0i/0n)".
   */
  describe(): string {
    const allow = this.sets.allowLoaded ? this.sets.allow.describe() : "none";
    const deny = this.sets.denyLoaded ? this.sets.deny.describe() : "none";
    return `allow: ${allow} · deny: ${deny}`;
  }
}

/**
 * The engagement's scope guard, built once and cached on the context.
 * The allow set's source, in precedence order:
 *
 *  1. The AUTHORIZE phase's attestation output (ctx.verifiedScope):
 *     once authorize has stamped the record, the guard is built from
 *     it — and rebuilt when the stamp changes — so every dispatch
 *     consumer inherits the attested scope, never the launch request's.
 *  2. The launch ROE (ctx.input.roe): contexts authorize has not
 *     stamped yet (tests, partial contexts) build from the declared
 *     scope, exactly as before.
 *
 * A context with neither gets an empty guard that allows everything,
 * matching the pre-gate behavior for those paths.
 *
 * @param ctx - The context (or context-shaped object) to resolve for.
 * @returns The cached or newly built guard.
 */
export function scopeGuardFor(ctx: {
  scopeGuard?: ScopeGuard;
  /** Cache key of the record stamp {@link scopeGuardFor} built the cached guard from. */
  scopeGuardRecordKey?: string;
  verifiedScope?: readonly string[];
  input?: { roe?: { scope?: readonly string[]; outOfScope?: readonly string[] } };
}): ScopeGuard {
  const record = ctx.verifiedScope && ctx.verifiedScope.length > 0 ? ctx.verifiedScope : undefined;
  const recordKey = record ? `record:${record.join("\n")}` : undefined;
  if (ctx.scopeGuard && ctx.scopeGuardRecordKey === recordKey) {
    return ctx.scopeGuard;
  }
  ctx.scopeGuard = record
    ? ScopeGuard.fromVerifiedRecord({ verifiedScope: record, outOfScope: ctx.input?.roe?.outOfScope })
    : ScopeGuard.fromRoe(ctx.input?.roe ?? {});
  ctx.scopeGuardRecordKey = recordKey;
  return ctx.scopeGuard;
}
