import type { HarnessComponentId } from "./contract.js";
/** The exact section-6 marker that forbids proposals against a file. */
export declare const PINNED_MARKER: "PINNED - DO NOT PROPOSE CHANGES";
/** Labels of the pinned guardrail paths; any touch of these is a security event. */
export declare const PINNED_PATH_LABELS: readonly ["src/safety", "src/policy", "src/gate.ts", "src/accountability", "auth-gate"];
/** Lowercase and normalize separators so `SRC\SAFETY` cannot slip past the pin. */
export declare function normalizeForPin(text: string): string;
/** Pinned guardrail path labels the text touches; empty means clean. */
export declare function findPinnedTouch(text: string): readonly string[];
/** True when a repo-relative path belongs to the pinned guardrail component. */
export declare function isPinnedPath(path: string): boolean;
export interface ComponentSource {
    /** Repo-relative path (forward slashes). */
    readonly path: string;
    /** file = verbatim source; dir = verbatim file set; index = path list only. */
    readonly kind: "file" | "dir" | "index";
}
/** One editable file (or directory index) shipped verbatim in section 2. */
export interface ComponentFile {
    readonly component: HarnessComponentId;
    /** Repo-relative path (forward slashes). */
    readonly path: string;
    /** sha256 hex of the bytes shipped. */
    readonly sha256: string;
    /** Full text, never summarised. */
    readonly body: string;
}
/** One pinned guardrail: path + hash + marker. The contents are never shipped. */
export interface GuardrailFile {
    readonly path: string;
    readonly sha256: string;
    readonly marker: typeof PINNED_MARKER;
}
/** Documented component-path map (repo-relative). Guardrails are excluded. */
export declare const COMPONENT_FILE_MAP: Readonly<Partial<Record<HarnessComponentId, readonly ComponentSource[]>>>;
/** Repo-relative pinned guardrail roots; contents are hashed, never shipped. */
export declare const PINNED_GUARDRAIL_SOURCES: readonly ComponentSource[];
/** Repo root (holds apps/redteam-runner + packages/redteam); dist-only payloads fall back. */
export declare function findRepoRoot(startDir?: string): string;
/** Read the current editable component files verbatim (with sha256); pins never included. */
export declare function readComponentFiles(repoRoot: string): ComponentFile[];
/**
 * Read the pinned guardrails as path + content hash + marker only. This is the
 * one place guardrail files are opened: their bytes are hashed and then
 * dropped, so a package can prove a proposal targets the pinned version without
 * ever shipping an editable copy of it.
 */
export declare function readPinnedGuardrails(repoRoot: string): GuardrailFile[];
