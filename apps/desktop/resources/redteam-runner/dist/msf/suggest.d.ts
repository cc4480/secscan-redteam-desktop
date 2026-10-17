/**
 * Recon → module mapping: detected service/version → candidate Metasploit
 * modules.
 *
 * The mapping is deliberately thin: msfrpcd's own `module.search` does the
 * real matching (it knows all ~2,000 exploits). This module builds honest
 * search queries from recon evidence and ranks/filters the results —
 * dropping policy-denied modules BEFORE the agent ever sees them, so a
 * denied module can never be proposed, let alone run.
 *
 * Pure functions (query building, ranking) are unit-tested; the search
 * itself goes through MsfClient.
 */
import type { MsfClient, MsfModule } from "./client.js";
export declare const CVE_RE: RegExp;
/** Extract CVE identifiers from arbitrary recon text (banner, version string). */
export declare function extractCves(text: string): string[];
export interface SuggestInput {
    /** Service name from the banner, e.g. "smb", "http", "ssh", "rdp", "ftp". */
    service?: string;
    /** Version string from the banner, e.g. "Samba 4.3.11", "OpenSSH 7.2p2". */
    version?: string;
    /** Explicit CVE when recon already identified one. */
    cve?: string;
    /** "windows" | "linux" — narrows platform. */
    platform?: string;
}
/**
 * Build msf search queries, most-specific first. A CVE query is exact;
 * a service query is a candidate list the coordinator triages.
 */
export declare function buildModuleQueries(input: SuggestInput): string[];
export interface RankedModule extends MsfModule {
    weight: number;
    /** Why this module was dropped (policy) — present only on dropped entries. */
    dropped?: string;
}
/**
 * Filter (policy first) and rank modules. Denied modules are returned with
 * `dropped` set so the agent sees they were considered and refused — never
 * silently hidden, never runnable.
 */
export declare function filterAndRank(modules: MsfModule[]): RankedModule[];
/** Run the query chain and return ranked candidates (cap 25 — triage, not dump). */
export declare function suggestModules(client: MsfClient, input: SuggestInput): Promise<RankedModule[]>;
