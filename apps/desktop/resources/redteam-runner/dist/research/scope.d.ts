/**
 * The deep-research skill's scope law, mechanized for the research
 * tools.
 *
 * The law (fleet skill deep-research-osint): general technology
 * research — a CVE, a product, a technique — is unbounded; the
 * perimeter binds TARGETS. Target-directed research is bounded to the
 * verified engagement record, and an out-of-scope subject gets zero
 * lookups and a logged SCOPE-EXIT.
 *
 * The mechanical line this module draws (stated exactly, because the
 * handler enforces it): a research call is TARGET-DIRECTED about a
 * host when the call names that host (a fetch URL's host, or a host/IP
 * token inside a search query) AND the host is tied to the engagement
 * record — it is on the operator's out-of-scope deny list, or it
 * belongs to the target family: it equals a scope host, is a
 * sub/superdomain of one, shares a registrable domain with one, or is
 * an IP inside a scope CIDR. A target-directed call passes only when
 * the engagement's own ScopeGuard allows the host (deny beats allow,
 * the record's attested scope governs — scopeGuardFor); otherwise it
 * is denied before any lookup happens. A named host with no tie to the
 * record is general research and passes: CVE databases, vendor docs,
 * and write-ups live on hosts the record never names, and the record
 * holds hosts, not organization names — a query naming no host token
 * is general by construction. Known limit of the line: a target listed
 * by IP cannot be tied to its hostname without DNS, so the hostname
 * form is general unless the deny list or a domain entry ties it.
 *
 * One mechanism the classifier must compensate for: the shared
 * HostSet short-circuits the four local literals (localhost,
 * 127.0.0.1, ::1, 0.0.0.0) out of every set before membership is
 * consulted, so a deny entry naming one of them can never bind
 * through the guard's denyMembership. For exactly that verdict the
 * classifier re-checks the raw deny entries itself (see
 * denyEntryNamesHost) — deny still decides; the shared HostSet keeps
 * the probe semantics it is load-bearing for elsewhere.
 */
import { type ScopeGuard } from "../safety/scope-guard.js";
/** The classification of one named host for a research call. */
export type ResearchScopeVerdict = {
    kind: "general";
} | {
    kind: "in-scope";
} | {
    kind: "denied";
    reason: string;
};
/** The minimal context the classifier reads (the dispatch Ctx satisfies it). */
export interface ResearchScopeCtx {
    scopeGuard?: ScopeGuard;
    /** Cache key of the record stamp the cached guard was built from (scopeGuardFor). */
    scopeGuardRecordKey?: string;
    verifiedScope?: readonly string[];
    input?: {
        roe?: {
            scope?: readonly string[];
            outOfScope?: readonly string[];
        };
    };
}
/** Normalize a host or scope entry to a bare lowercase hostname/IP (no scheme, port, path, or wildcard marker). */
export declare function normaliseResearchHost(raw: string): string;
/** The registrable domain (eTLD+1 approximation) for a hostname; undefined for IPs and single labels. */
export declare function registrableDomain(host: string): string | undefined;
interface ScopeEntryHost {
    raw: string;
    host: string;
    kind: string;
}
/** True when two hosts belong to the same target family (see module header for the exact rule). */
export declare function hostsRelated(host: string, entry: ScopeEntryHost): boolean;
/**
 * Extract the hosts a search query names: URL hosts (bracketed-IPv6
 * ones included), IPv4 literals, dotted hostname tokens (file-name
 * lookalikes excluded), and the bare local-literal tokens — the word
 * "localhost" and IPv6 literals — that none of those forms can see.
 *
 * @param query - The raw query text.
 * @returns The distinct normalized hosts, in first-appearance order.
 */
export declare function extractQueryHosts(query: string): string[];
/**
 * Classify one named host for a research call (see module header).
 *
 * @param ctx - The engagement context (record + ROE + guard).
 * @param host - The named host (any form; normalized here).
 * @returns The verdict: general / in-scope / denied with the deciding rule.
 */
export declare function classifyResearchHost(ctx: ResearchScopeCtx, host: string): ResearchScopeVerdict;
/**
 * Classify every host a research call names; the first denial decides.
 *
 * @param ctx - The engagement context.
 * @param hosts - The hosts the call names.
 * @returns The denied host + reason, or undefined when the call may proceed.
 */
export declare function researchScopeDenial(ctx: ResearchScopeCtx, hosts: readonly string[]): {
    host: string;
    reason: string;
} | undefined;
export {};
