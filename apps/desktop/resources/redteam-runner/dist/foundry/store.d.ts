/**
 * App-data Foundry store: the live-case registry scans feed.
 *
 * Layout under <engagementsRoot>/../foundry-store/:
 *   registry.json          append-only index of every registered case
 *   bundles/<case-id>/case.json   the case record itself
 *   sanitizer-notes.jsonl  counts/reasons for dropped cases (never content)
 *   loop-state.json        Gold Loop cycle state (written by loop.ts)
 *
 * Registration is idempotent: a case id is derived deterministically from
 * the source engagement id + the case content hash, and re-registering the
 * same (engagement, content) pair adds nothing. Registry entries are never
 * mutated or removed by the pipeline — new entries append.
 */
/** Vuln families the Foundry classifies into; anything else is unclassified. */
export type FoundryFamily = 'sqli' | 'ssrf' | 'traversal' | 'xss' | 'unclassified';
/** Case tiers. GOLD is never assigned by this pipeline (editor-adjudicated). */
export type FoundryTier = 'BRONZE' | 'SILVER' | 'GOLD';
/**
 * One sanitized live case. Pattern fields only: endpoint shapes, payload
 * class, proof type, stack fingerprints. Raw evidence never enters a case.
 */
export interface FoundryCase {
    id: string;
    kind: 'live-case';
    origin: 'scan' | 'loop-mutant';
    family: FoundryFamily;
    vulnClass: string;
    cwe: string | null;
    severity: string;
    endpointShape: string[];
    methodMix: string[];
    payloadClass: string;
    proofType: string;
    mechanisms: string[];
    techFingerprints: string[];
    tier: FoundryTier;
    sourceEngagementId: string | null;
    lineage: {
        seedCaseId?: string;
        seedSlug?: string;
        operator?: string;
        cycle?: number;
    } | null;
    createdAt: string;
    contentHash: string;
}
/** One append-only registry row. */
export interface RegistryEntry {
    id: string;
    kind: string;
    origin: string;
    family: string;
    tier: string;
    sourceEngagementId: string | null;
    createdAt: string;
    contentHash: string;
    lineage: FoundryCase['lineage'];
}
/** The registry file. */
export interface FoundryRegistry {
    version: 1;
    entries: RegistryEntry[];
}
/** The pattern fields a content hash commits to (no ids, no timestamps). */
export interface CasePattern {
    family: string;
    vulnClass: string;
    cwe: string | null;
    severity: string;
    endpointShape: string[];
    methodMix: string[];
    payloadClass: string;
    proofType: string;
    techFingerprints: string[];
}
/**
 * The store directory for a console engagements root.
 *
 * @param engagementsRoot - the directory holding engagement directories
 * @returns the sibling foundry-store directory
 */
export declare function foundryStoreDir(engagementsRoot: string): string;
/**
 * The store directory for one engagement directory.
 *
 * @param engagementDir - a single engagement's directory
 * @returns the foundry-store directory two levels up (sibling of the root)
 */
export declare function storeDirForEngagement(engagementDir: string): string;
/**
 * Content hash of a case pattern: sha256 of its canonical JSON.
 *
 * @param pattern - the pattern fields
 * @returns the lowercase hex digest
 */
export declare function caseContentHash(pattern: CasePattern): string;
/**
 * Deterministic case id for a scan-derived case.
 *
 * @param engagementId - the source engagement id
 * @param contentHash - the case content hash
 * @returns the case id
 */
export declare function caseIdFor(engagementId: string, contentHash: string): string;
/** Write a file atomically (tmp + rename; unlink first on Windows). */
export declare function atomicWriteFile(path: string, body: string): void;
/**
 * Load the registry; an absent registry reads as empty. A registry that
 * exists but cannot be read, parsed, or recognized fails loud instead:
 * reading it as empty lets the next registerCase rewrite the file with
 * only its own entry, silently dropping every registered case from the
 * index (the bundle files stay on disk, orphaned).
 *
 * @param storeDir - the foundry store directory
 * @returns the registry (empty when the file is absent)
 */
export declare function loadRegistry(storeDir: string): FoundryRegistry;
/**
 * Register one case: write its bundle file and append its registry entry.
 * Idempotent on (id) and on (sourceEngagementId + contentHash).
 *
 * @param storeDir - the foundry store directory
 * @param foundryCase - the case to register
 * @returns true when the case was newly added, false when already present
 */
export declare function registerCase(storeDir: string, foundryCase: FoundryCase): boolean;
/**
 * Read one registered case record by id.
 *
 * @param storeDir - the foundry store directory
 * @param id - the case id
 * @returns the case, or null when absent/unparseable
 */
export declare function readCase(storeDir: string, id: string): FoundryCase | null;
/**
 * Every registered case record, in registry order.
 *
 * @param storeDir - the foundry store directory
 * @returns the case records (entries whose files vanished are skipped)
 */
export declare function listCases(storeDir: string): FoundryCase[];
/**
 * Record a sanitizer drop: counts and reasons only, never case content.
 *
 * @param storeDir - the foundry store directory
 * @param note - the drop note (family guess, reasons, engagement id)
 * @returns nothing
 */
export declare function appendSanitizerNote(storeDir: string, note: {
    engagementId: string;
    reasons: string[];
    at: string;
}): void;
/**
 * The most recent sanitizer notes.
 *
 * @param storeDir - the foundry store directory
 * @param limit - maximum notes to return
 * @returns the notes, newest last; [] when none
 */
export declare function readSanitizerNotes(storeDir: string, limit: number): Array<{
    engagementId: string;
    reasons: string[];
    at: string;
}>;
/** Directory-name safety for case ids used as path segments. */
export declare function isCaseId(id: string): boolean;
