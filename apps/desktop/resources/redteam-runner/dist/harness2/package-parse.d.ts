import type { PackageChecklist, ProposalPackageDocument } from "./package.js";
/** Current package format. */
export declare const PACKAGE_FORMAT_VERSION = "6.0";
/** Versions this code can still read (structurally validated only when current). */
export declare const READABLE_FORMAT_VERSIONS: readonly string[];
/** Valid header.mode values. */
export declare const PACKAGE_MODES: readonly ["REPAIR", "HARDEN", "REPAIR-FOUNDATION"];
/** Section order and names; index n-1 holds section n; a complete package has all of them. */
export declare const SECTION_NAMES: readonly string[];
export declare const SECTION_COUNT: number;
/** A package header key without which the document is not a package. */
export declare const HEADER_KEYS: readonly string[];
/** Raised when a document is not a readable package at all. */
export declare class PackageFormatError extends Error {
    constructor(message: string);
}
/** Raised when a package exists but is structurally incomplete. */
export declare class PackageCompletenessError extends Error {
    readonly problems: readonly string[];
    constructor(problems: readonly string[]);
}
export declare function sectionBegin(index: number, name: string): string;
export declare function sectionEnd(index: number, name: string): string;
/** Any "@@... BEGIN@@" / "@@... END@@" delimiter line. */
export declare const DELIMITER_LINE: RegExp;
export interface DelimiterCount {
    readonly begin: number;
    readonly end: number;
    readonly balanced: boolean;
}
/** Count BEGIN/END delimiter lines; balanced means one of each for every marker. */
export declare function countDelimiters(text: string): DelimiterCount;
export interface SectionSplit {
    readonly sections: Readonly<Record<number, string>>;
    readonly order: readonly number[];
    readonly begin: number;
    readonly end: number;
    readonly balanced: boolean;
}
/** Split the top-level sections; nested delimiters stay inside their section body. */
export declare function splitSections(text: string): SectionSplit;
/**
 * Build the section-7 checklist from the document plus the rendered section 1-6
 * text (delimiter balance can only be checked against the text).
 */
export declare function buildChecklist(doc: ProposalPackageDocument, renderedSections: string): PackageChecklist;
/** Parsed view of a package text; `complete` is true only for a valid current package. */
export interface ParsedPackageDocument {
    readonly formatVersion: string;
    readonly legacy: boolean;
    readonly header: Readonly<Record<string, string>>;
    readonly sections: Readonly<Record<number, string>>;
    readonly checklist: PackageChecklist | null;
    readonly complete: boolean;
    readonly problems: readonly string[];
}
/**
 * Parse a package document, re-deriving completeness from the text. Legacy
 * versions return their raw sections with legacy=true instead of throwing.
 */
export declare function parsePackageDocument(text: string): ParsedPackageDocument;
/** Throw when a parsed package is structurally incomplete (section-10 partial rejection). */
export declare function assertPackageComplete(parsed: ParsedPackageDocument): void;
/** True when the package names the pinned guardrail component at all. */
export declare function mentionsGuardrailComponent(text: string): boolean;
