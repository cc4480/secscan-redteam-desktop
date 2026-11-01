/**
 * Memory-layer errors. Every fail-loud throw in `src/memory/` is a
 * `MemoryError` carrying a stable `code` from the brief §8 matrix, so
 * callers and tests match on the code, never on message text.
 */
/** The one error type the memory module throws. */
export class MemoryError extends Error {
    code;
    constructor(code, message, options) {
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
    constructor(message, options) {
        super("ARCHIVE_FAILED", message, options);
        this.name = "MemoryArchiveError";
    }
}
//# sourceMappingURL=errors.js.map