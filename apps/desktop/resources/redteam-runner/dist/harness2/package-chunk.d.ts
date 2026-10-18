/**
 * Harness2 section-10 chunking, delimiters, relay and partial-package rejection
 * (H2-P2 spec section 10).
 *
 * A serialized package can be larger than one chat message, so it is split into
 * parts of at most PACKAGE_PART_LIMIT (15000) characters. Two invariants make
 * the split safe and verifiable:
 *
 *  - SPLIT ON LINE BOUNDARIES ONLY. A part ends between two lines, never inside
 *    one, so a line is never cut and a multi-byte character is never split (a
 *    line that alone exceeds the limit is an error, not silently chopped).
 *  - EXACT BODY CHAR COUNT. Every part is wrapped by
 *      @@PKG <id> PART <i> OF <n> CHARS <c> BEGIN@@
 *      <body>
 *      @@PKG <id> PART <i> OF <n> CHARS <c> END@@
 *    where c is body.length (JavaScript UTF-16 code units, so the receiver can
 *    reproduce it exactly). charCount is on BOTH delimiters, so a corrupted part
 *    fails to parse instead of being reassembled wrong.
 *
 * assemblePackage() refuses a partial package: missing, duplicated or
 * inconsistent parts raise PartialPackageError (it never returns a truncated
 * text). createPackageRelay() emits parts in order and honours a
 * "RESEND PKG <id> PART <i>" request by re-sending exactly that part.
 */
/** Maximum characters of one part body. */
export declare const PACKAGE_PART_LIMIT = 15000;
/** Message an operator/editor sends to get one part re-sent. */
export declare const RESEND_PATTERN: RegExp;
/** Raised for any chunking/parsing defect; `code` is stable for callers. */
export declare class PackageChunkError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** Raised when a package is assembled from fewer/duplicated parts than declared. */
export declare class PartialPackageError extends PackageChunkError {
    readonly packageId: string;
    readonly missing: readonly number[];
    readonly duplicates: readonly number[];
    constructor(packageId: string, missing: readonly number[], duplicates: readonly number[], message: string);
}
/** One delimited package part. `text` is exactly what is sent on the wire. */
export interface PackagePart {
    readonly packageId: string;
    /** 1-based part index. */
    readonly index: number;
    readonly total: number;
    /** Exact body length in JavaScript UTF-16 code units. */
    readonly chars: number;
    readonly body: string;
    readonly text: string;
}
/** Split text on line boundaries into parts no longer than PACKAGE_PART_LIMIT. */
export declare function splitPackage(text: string, packageId: string): PackagePart[];
/** Parse one delimited part; malformed delimiters or a wrong char count throw. */
export declare function parsePart(text: string): PackagePart;
/** Render parts in relay order (each part already carries its delimiters). */
export declare function renderParts(parts: readonly PackagePart[]): string;
/** A fully reassembled package. */
export interface AssembledPackage {
    readonly packageId: string;
    readonly text: string;
    readonly parts: readonly PackagePart[];
}
/**
 * Reassemble a package from its parts. Order in the input does not matter;
 * completeness does: a missing or duplicated part is a PartialPackageError.
 */
export declare function assemblePackage(received: readonly (string | PackagePart)[]): AssembledPackage;
/** Result of feeding one message to a relay: only the requested part is re-sent. */
export interface RelayAction {
    readonly kind: "resend" | "ignored";
    readonly parts: readonly PackagePart[];
    readonly reason: string;
}
/** The relay side of section 10: ordered emission plus targeted re-sends. */
export interface PackageRelay {
    readonly packageId: string;
    readonly parts: readonly PackagePart[];
    /** Every part, in order (the initial transmission). */
    emitAll(): readonly PackagePart[];
    /** Handle a "RESEND PKG <id> PART <i>" request; anything else is ignored. */
    handle(message: string): RelayAction;
}
/** Build the relay for a chunked package. */
export declare function createPackageRelay(parts: readonly PackagePart[]): PackageRelay;
