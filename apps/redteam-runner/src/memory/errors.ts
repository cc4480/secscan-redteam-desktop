/**
 * Memory-layer errors. Every fail-loud throw in `src/memory/` is a
 * `MemoryError` carrying a stable `code` from the brief §8 matrix, so
 * callers and tests match on the code, never on message text.
 */

export type MemoryErrorCode =
  | "REGISTRY_UNREADABLE"
  | "STORE_CORRUPT"
  | "STORE_INDEX_MISMATCH"
  | "STORE_LOCKED"
  | "MEMORY_SCOPE_UNVERIFIED"
  | "CANDIDATE_INVALID"
  | "VIEW_BUDGET_EXCEEDED"
  | "TRUST_OVERCLAIM"
  | "SCHEMA_INVALID"
  | "SCOPE_TOO_BROAD"
  | "MISSING_PROVENANCE"
  | "ARCHIVE_FAILED"
  | "EXTRACTOR_SCHEMA_BREAK";

/** The one error type the memory module throws. */
export class MemoryError extends Error {
  readonly code: MemoryErrorCode;

  constructor(code: MemoryErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MemoryError";
    this.code = code;
  }
}

/**
 * Phase-1 archive failure (brief §7.2/§8 row 10). The single memory error
 * allowed to replace an engagement's return value: losing the raw record
 * silently is worse than failing the run.
 */
export class MemoryArchiveError extends MemoryError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("ARCHIVE_FAILED", message, options);
    this.name = "MemoryArchiveError";
  }
}
