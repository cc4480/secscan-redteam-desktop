/**
 * HostSet — one parsed set of domains, IPs and CIDRs, with the matching
 * rules of zimzilla/scope.py's HostSet: a hostname matches a listed
 * domain exactly or as a subdomain of it; an IP matches a listed IP
 * exactly or any CIDR that contains it (address family must match).
 * Membership is polarity-neutral — the caller decides what a match
 * means for its list, which is what stops the allow and deny lists from
 * silently inverting each other. Loopback/localhost is infrastructure,
 * never a target: it is never a member of any set.
 */
import { type ParsedNetwork } from "./scope-ip.js";
/** Hosts that are always infrastructure, never targets (Python: reason "local"). */
export declare const LOCAL_HOSTS: ReadonlySet<string>;
/** Membership verdict: whether the host is in the set, and why. */
export interface HostMembership {
    member: boolean;
    reason: string;
}
/**
 * Classify one raw scope entry the way the Python scope-validator's
 * `_classify` does: URLs classify by their host; anything that is not a
 * domain, wildcard, IP or CIDR is "other" and never enters a set.
 *
 * @param asset - The raw entry as written by the operator.
 * @returns "domain" | "wildcard" | "ip" | "cidr" | "other".
 */
export declare function classifyScopeEntry(asset: string): "domain" | "wildcard" | "ip" | "cidr" | "other";
/** A parsed set of domains, IPs and CIDRs, with the Python matching rules. */
export declare class HostSet {
    readonly domains: Set<string>;
    readonly ips: Set<string>;
    readonly cidrs: ParsedNetwork[];
    /**
     * Build a set from a mapping with the Python key spellings (domain(s)/
     * in_scope, ip(s)/hosts, cidr(s)/networks). Mirrors
     * `HostSet.from_mapping`: ip-key entries that look like CIDRs become
     * networks, IPv4-shaped entries become IPs, anything else is normalised
     * as a domain.
     *
     * @param data - The parsed scope-file mapping.
     * @returns The populated set (empty for a non-mapping input).
     */
    static fromMapping(data: Record<string, unknown>): HostSet;
    /**
     * Build a set from the runner's flat entry lists (--scope /
     * --out-of-scope values, ROE JSON arrays). Each entry is classified with
     * {@link classifyScopeEntry}; "other" entries are skipped and reported.
     *
     * @param entries - Raw entries as written by the operator.
     * @returns The populated set plus the entries that could not be placed.
     */
    static fromEntries(entries: readonly string[]): {
        set: HostSet;
        skipped: string[];
    };
    /**
     * Normalise one entry to a bare hostname (Python `_normalise_host`):
     * strip scheme, path, port, wildcard prefix and surrounding dots.
     *
     * @param entry - The raw entry.
     * @returns The normalised hostname, or "" when nothing remains.
     */
    static normaliseHost(entry: string): string;
    /** True when the set holds no domains, IPs or CIDRs. */
    get empty(): boolean;
    /** Total entry count across domains, IPs and CIDRs. */
    get size(): number;
    /**
     * Membership test, polarity-neutral (Python `HostSet.contains`): the
     * caller decides what a match means for its list. Loopback/localhost is
     * never a member of any set. Hostnames match exactly or as a subdomain
     * of a listed domain; IPs match exactly or by CIDR containment.
     *
     * @param host - The host or IP to test (case-insensitive; trailing root
     *   dot and IPv6 brackets are stripped).
     * @returns Whether the host is a member, with the matching rule as reason.
     */
    contains(host: string): HostMembership;
    /**
     * One-line description of the set (Python `HostSet.describe`).
     *
     * @returns "empty", or a count summary like "5 entries (3d/1i/1n)".
     */
    describe(): string;
}
