/**
 * HostSet — one parsed set of domains, IPs and CIDRs, with the matching
 * rules of zimzilla/scope.py's HostSet: a hostname matches a listed
 * domain exactly or as a subdomain of it; an IP matches a listed IP
 * exactly or any CIDR that contains it (address family must match).
 * One runner-side narrowing: a bare hostname attested through
 * HostSet.fromAttestedEntries matches exactly only (see exactHosts).
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
    /**
     * Domains that match EXACTLY only — never as a parent of a subdomain.
     * Populated only by {@link HostSet.fromAttestedEntries} for attested
     * BARE hostnames (one dotless label, e.g. a machine name): attesting
     * `cho-zen1` attests that machine, not every `x.cho-zen1` beneath it.
     * Such hosts also stay in {@link HostSet.domains} (their placement set,
     * as dd7e084a established); this set is the kind flag {@link HostSet.contains}
     * consults to withhold subdomain matching from them. Entries placed as
     * domains by any other path (declared ROE/file domains, wildcards,
     * dotted attested entries) are absent here and keep subdomain matching.
     */
    readonly exactHosts: Set<string>;
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
     * Build a set from the AUTHORIZE phase's attested entries (the
     * verified record): raw scope entries whose hosts already passed
     * authorization one host at a time (gate.ts checkScopeAuthorization,
     * over hosts extracted from the same entries). Placement starts from
     * the same classification as {@link HostSet.fromEntries}; an entry
     * classification cannot place but that is a valid bare hostname —
     * one dotless label, the form a machine's own name takes (a Windows
     * workstation, a LAN host) — is then placed as a domain through the
     * same normaliser, the way fromMapping's hosts key places non-IP
     * entries. Attested entries are authorization output, not scope-file
     * lines: the dot the file classification requires would drop the
     * exact hosts authorize vetted, leaving the allow set empty for
     * every local-host engagement. Entries that are neither classifiable
     * nor valid hostnames stay skipped and reported.
     *
     * A placed BARE hostname (no dot) is also recorded in
     * {@link HostSet.exactHosts}: it was attested as one machine's name,
     * so it matches exactly only — `x.<host>` is a different host the
     * attestation never named, and subdomain matching for it would widen
     * the attestation. A dotted entry placed by this fallback keeps plain
     * domain placement (subdomain matching), as do all entries
     * {@link HostSet.fromEntries} classified as domains.
     *
     * @param entries - The attested entries from the engagement record.
     * @returns The populated set plus the entries that could not be placed.
     */
    static fromAttestedEntries(entries: readonly string[]): {
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
     * of a listed domain — except attested bare hostnames (exactHosts),
     * which match exactly only; IPs match exactly or by CIDR containment.
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
