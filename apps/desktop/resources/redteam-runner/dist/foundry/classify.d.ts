/**
 * Finding classification into Foundry families.
 *
 * Signals, in trust order: an explicit CWE, the runner's own vulnClass,
 * then class keywords in the finding title. A finding that matches nothing
 * lands in the explicit "unclassified" bucket — a fit is never forced.
 */
import type { FoundryFamily } from './store.js';
/** Canonical CWE per family, used when the class signal is unambiguous. */
export declare const FAMILY_CWE: Record<Exclude<FoundryFamily, 'unclassified'>, string>;
/** The classification outcome: family plus the CWE to record (null when none is earned). */
export interface Classification {
    family: FoundryFamily;
    cwe: string | null;
    via: 'cwe' | 'vuln-class' | 'title' | 'none';
}
/**
 * Extract the first CWE id mentioned in a text.
 *
 * @param text - the text to scan
 * @returns the CWE id (e.g. "CWE-89"), or null
 */
export declare function cweIn(text: string): string | null;
/**
 * Classify one finding.
 *
 * @param input - the finding's vulnClass (when the runner recorded one),
 *   title, and any CWE the caller already extracted
 * @returns the family, the CWE to record, and which signal decided it
 */
export declare function classifyFinding(input: {
    vulnClass?: string;
    title: string;
    cwe?: string | null;
}): Classification;
