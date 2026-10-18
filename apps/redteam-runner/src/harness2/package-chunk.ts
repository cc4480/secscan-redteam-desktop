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
export const PACKAGE_PART_LIMIT = 15_000;
/** Message an operator/editor sends to get one part re-sent. */
export const RESEND_PATTERN = /^RESEND\s+PKG\s+(\S+)\s+PART\s+(\d+)\s*$/i;

/** Raised for any chunking/parsing defect; `code` is stable for callers. */
export class PackageChunkError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`package chunking failed: ${message}`);
    this.name = "PackageChunkError";
    this.code = code;
  }
}

/** Raised when a package is assembled from fewer/duplicated parts than declared. */
export class PartialPackageError extends PackageChunkError {
  readonly packageId: string;
  readonly missing: readonly number[];
  readonly duplicates: readonly number[];

  constructor(packageId: string, missing: readonly number[], duplicates: readonly number[], message: string) {
    super("partial-package", message);
    this.name = "PartialPackageError";
    this.packageId = packageId;
    this.missing = missing;
    this.duplicates = duplicates;
  }
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

function beginLine(packageId: string, index: number, total: number, chars: number): string {
  return `@@PKG ${packageId} PART ${index} OF ${total} CHARS ${chars} BEGIN@@`;
}

function endLine(packageId: string, index: number, total: number, chars: number): string {
  return `@@PKG ${packageId} PART ${index} OF ${total} CHARS ${chars} END@@`;
}

function makePart(packageId: string, index: number, total: number, body: string): PackagePart {
  return { packageId, index, total, chars: body.length, body, text: `${beginLine(packageId, index, total, body.length)}\n${body}\n${endLine(packageId, index, total, body.length)}` };
}

/** Split text on line boundaries into parts no longer than PACKAGE_PART_LIMIT. */
export function splitPackage(text: string, packageId: string): PackagePart[] {
  if (typeof text !== "string") throw new PackageChunkError("bad-input", "package text must be a string");
  if (packageId === "" || /\s/.test(packageId)) throw new PackageChunkError("bad-input", `package id "${packageId}" must be non-empty and contain no whitespace`);
  if (text === "") return [makePart(packageId, 1, 1, "")];
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const bodies: string[] = [];
  let current = "";
  lines.forEach((line, lineIndex) => {
    if (line.length > PACKAGE_PART_LIMIT) {
      throw new PackageChunkError("oversized-line", `line ${lineIndex + 1} is ${line.length} chars, over the ${PACKAGE_PART_LIMIT}-char part limit; a line is never split`);
    }
    if (current.length + line.length > PACKAGE_PART_LIMIT) {
      bodies.push(current);
      current = "";
    }
    current += line;
  });
  if (current !== "" || bodies.length === 0) bodies.push(current);
  const total = bodies.length;
  const parts = bodies.map((body, index) => makePart(packageId, index + 1, total, body));
  const rebuilt = parts.map((part) => part.body).join("");
  if (rebuilt !== text) throw new PackageChunkError("roundtrip", "chunk bodies do not reassemble the serialized package");
  return parts;
}

const PART_PATTERN = /^@@PKG (\S+) PART (\d+) OF (\d+) CHARS (\d+) BEGIN@@\n([\s\S]*)\n@@PKG \1 PART \2 OF \3 CHARS \4 END@@$/;

/** Parse one delimited part; malformed delimiters or a wrong char count throw. */
export function parsePart(text: string): PackagePart {
  const match = PART_PATTERN.exec(text);
  if (match === null) throw new PackageChunkError("malformed-part", "part delimiters are missing or malformed");
  const packageId = match[1]!;
  const index = Number(match[2]);
  const total = Number(match[3]);
  const chars = Number(match[4]);
  const body = match[5] ?? "";
  if (body.length !== chars) throw new PackageChunkError("bad-char-count", `part ${index} declares ${chars} chars but its body has ${body.length}`);
  if (index < 1 || index > total) throw new PackageChunkError("bad-index", `part index ${index} is outside 1..${total}`);
  return { packageId, index, total, chars, body, text };
}

/** Render parts in relay order (each part already carries its delimiters). */
export function renderParts(parts: readonly PackagePart[]): string {
  return [...parts].sort((a, b) => a.index - b.index).map((part) => part.text).join("\n");
}

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
export function assemblePackage(received: readonly (string | PackagePart)[]): AssembledPackage {
  if (received.length === 0) throw new PartialPackageError("", [], [], "no package parts were received");
  const parsed = received.map((entry) => (typeof entry === "string" ? parsePart(entry) : entry));
  const first = parsed[0]!;
  const packageId = first.packageId;
  const total = first.total;
  const byIndex = new Map<number, PackagePart>();
  const duplicates: number[] = [];
  for (const part of parsed) {
    if (part.packageId !== packageId) throw new PackageChunkError("package-mismatch", `part ${part.index} belongs to ${part.packageId}, not ${packageId}`);
    if (part.total !== total) throw new PackageChunkError("total-mismatch", `part ${part.index} declares total ${part.total}, expected ${total}`);
    if (byIndex.has(part.index)) duplicates.push(part.index);
    else byIndex.set(part.index, part);
  }
  const missing: number[] = [];
  for (let index = 1; index <= total; index++) if (!byIndex.has(index)) missing.push(index);
  if (missing.length > 0 || duplicates.length > 0) {
    const detail = [missing.length > 0 ? `missing part(s) ${missing.join(", ")}` : "", duplicates.length > 0 ? `duplicated part(s) ${duplicates.join(", ")}` : ""].filter((entry) => entry !== "");
    throw new PartialPackageError(packageId, missing, duplicates, `package ${packageId} is incomplete: ${detail.join("; ")} of ${total}`);
  }
  const parts = [...byIndex.values()].sort((a, b) => a.index - b.index);
  return { packageId, text: parts.map((part) => part.body).join(""), parts };
}

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
export function createPackageRelay(parts: readonly PackagePart[]): PackageRelay {
  const packageId = parts[0]?.packageId ?? "";
  const ordered = [...parts].sort((a, b) => a.index - b.index);
  return {
    packageId,
    parts: ordered,
    emitAll: () => ordered,
    handle(message: string): RelayAction {
      const match = RESEND_PATTERN.exec(message.trim());
      if (match === null) return { kind: "ignored", parts: [], reason: "not a RESEND PKG <id> PART <i> request" };
      const requestedId = match[1]!;
      const requestedIndex = Number(match[2]);
      if (requestedId !== packageId) return { kind: "ignored", parts: [], reason: `RESEND names package ${requestedId}; this relay owns ${packageId}` };
      const part = ordered.find((entry) => entry.index === requestedIndex);
      if (part === undefined) return { kind: "ignored", parts: [], reason: `part ${requestedIndex} is outside 1..${ordered.length}` };
      return { kind: "resend", parts: [part], reason: `re-sending only part ${requestedIndex} of ${ordered.length}` };
    },
  };
}
