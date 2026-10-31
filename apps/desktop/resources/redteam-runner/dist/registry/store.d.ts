/**
 * THE REGISTRY — the product's compounding proprietary attack intelligence.
 *
 * Store: types, record/load/save, and the v0.3.x seed. Querying lives in
 * query.ts. (Module doc comment preserved on the registry.ts barrel.)
 */
export interface TargetFingerprint {
    host: string;
    /** e.g. ["react-spa", "cloudflare-edge", "bearer-rest-api"] */
    stack: string[];
    /** e.g. "security-scanner-saas", "ecommerce", "banking-portal" */
    appType: string;
    notes?: string;
}
interface RegistryEntryBase {
    id: string;
    date: string;
    engagementId: string;
    target: TargetFingerprint;
}
export interface ConfirmedFinding extends RegistryEntryBase {
    kind: "confirmed";
    vulnClass: string;
    technique: string;
    attackId?: string;
    owasp?: string;
    /** The payload/shape that proved it, generalized (no live secrets). */
    payloadPattern: string;
    /** Path to the evidence within the engagement dir. */
    evidenceRef: string;
    severity: "critical" | "high" | "medium" | "low" | "info";
}
export interface KilledHypothesis extends RegistryEntryBase {
    kind: "killed";
    hypothesis: string;
    killingObservation: string;
    attackId?: string;
    vulnClass?: string;
}
export type RegistryEntry = ConfirmedFinding | KilledHypothesis;
export interface VulnerabilityRegistry {
    version: 1;
    confirmed: ConfirmedFinding[];
    killed: KilledHypothesis[];
}
export declare function emptyRegistry(): VulnerabilityRegistry;
export interface RegistryQuery {
    vulnClass?: string;
    /** Comma-separated stack hints, e.g. "react-spa,cloudflare-edge". */
    stack?: string;
    appType?: string;
    attackId?: string;
    kind?: "confirmed" | "killed";
    limit?: number;
}
export declare function recordConfirmed(reg: VulnerabilityRegistry, entry: Omit<ConfirmedFinding, "id" | "kind" | "date"> & {
    date?: string;
}): ConfirmedFinding;
export declare function recordKilled(reg: VulnerabilityRegistry, entry: Omit<KilledHypothesis, "id" | "kind" | "date"> & {
    date?: string;
}): KilledHypothesis;
export declare function loadRegistryFile(path: string): VulnerabilityRegistry | null;
/** Persist the registry (creates parent dirs). Called after every verdict write-through and at engagement end. */
export declare function saveRegistryFile(path: string, reg: VulnerabilityRegistry): void;
/**
 * Atomic read-modify-write transaction on the registry file (v0.23.0).
 *
 * The whole transaction is synchronous start-to-finish, and synchronous code
 * in Node is never preempted — so within one process, two concurrent
 * engagements (e.g. two UI-launched runs) can never silently lose each
 * other's verdicts, the way a load-at-start / blind-save-at-verdict pattern
 * did. The mutator runs against the freshly-loaded file, so IDs and dedupe
 * checks always see current state.
 *
 * Known limitation: this guards one process. Two separate OS processes
 * writing the same registry file can still race — that remains the SQLite
 * migration trigger documented on the registry barrel.
 */
export declare function transactRegistryFile<T>(path: string, fn: (reg: VulnerabilityRegistry) => T): T;
export declare function seedRegistry(): VulnerabilityRegistry;
export {};
