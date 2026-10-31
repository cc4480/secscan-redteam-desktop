/**
 * Tool-output spill (Q-SPILL): an oversized tool result is written in full
 * to the engagement's spill dir and the model receives a head + tail
 * preview with a read-back notice — never a silent truncation.
 *
 * The full result is already durable in steps.jsonl; spill adds MODEL
 * reachability: the bytes sit in `<engagementDir>/spill/`, indexed by
 * `manifest.jsonl` (sha256 per file), and the `read_spill` bookkeeping
 * tool pages them back. The spilled string is the exact post-redaction
 * string the model was entitled to see, byte for byte — read-back
 * identity is the feature, and the manifest hash makes it checkable.
 *
 * Pure module: no Ctx dependency. The observation seam (agents.ts) and
 * the read_spill handler (dispatch/bookkeeping.ts) are the only callers.
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

/** Results at or under this many chars reach the model verbatim (today's ceiling, unchanged). */
export const SPILL_THRESHOLD_CHARS = 4000;
/** Head preview length in the model-visible spilled observation. */
export const PREVIEW_HEAD_CHARS = 2400;
/** Tail preview length in the model-visible spilled observation. */
export const PREVIEW_TAIL_CHARS = 800;
/** read_spill page size: default and hard max, in chars. */
export const READ_SPILL_DEFAULT_CHARS = 4000;
export const READ_SPILL_MAX_CHARS = 8000;

export const SPILL_DIR_NAME = "spill";
export const SPILL_MANIFEST_NAME = "manifest.jsonl";

export interface SpillRecord {
  seq: number;
  ts: string;
  tool: string;
  attackId: string | null;
  target: string | null;
  /** Engagement-relative path, e.g. "spill/0007-http_probe.txt". */
  file: string;
  chars: number;
  /** UTF-8 byte length of the spilled text (differs from chars on multibyte input). */
  bytes: number;
  sha256: string;
  headChars: number;
  tailChars: number;
}

export interface SpillOutcome {
  /** The model-bound observation content (the caller appends the state digest). */
  content: string;
  /** The manifest record when a spill happened; null otherwise. */
  record: SpillRecord | null;
  /** Error class when a spill was attempted and failed (caller audits it); the content is then the plain ceiling slice. */
  failed?: string;
}

/** One safe path segment from a tool name: letters, digits, dot, dash, underscore only. */
export function sanitizeToolSegment(tool: string): string {
  const clean = tool.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "");
  return (clean || "tool").slice(0, 64);
}

/** Next spill sequence for a dir: one past the highest existing `<seq>-*.txt`, seeded from disk so a resumed process never overwrites. */
export function nextSpillSeq(spillDir: string): number {
  let max = 0;
  try {
    for (const name of readdirSync(spillDir)) {
      const m = /^(\d+)-.*\.txt$/.exec(name);
      if (m) max = Math.max(max, Number(m[1]));
    }
  } catch {
    // Dir absent/unreadable: start at 1; the write path surfaces real errors.
  }
  return max + 1;
}

/** The pinned model-visible omission notice. Text is stable — tests pin it verbatim. */
export function spillNotice(omitted: number, total: number, tool: string, relFile: string): string {
  return `[spill: ${omitted} chars omitted — full ${total}-char output of ${tool} saved at ${relFile}; call read_spill with path "${relFile}" and offsetChars to read it back]`;
}

/**
 * Apply the spill policy to one tool result at the observation seam.
 *
 * - `text.length <= SPILL_THRESHOLD_CHARS` → verbatim, no file, no record.
 * - Over threshold with no engagement dir → the ceiling slice (partial test
 *   contexts keep today's behavior; no throw).
 * - Over threshold with a dir → full text to `<dir>/spill/<seq>-<tool>.txt`,
 *   one manifest line, and head + notice + tail as the content.
 * - Any write/manifest failure → the ceiling slice + `failed` set. A spill
 *   failure never fails the tool call and never references a file that
 *   does not exist.
 */
export function spillToolResult(opts: {
  dir: string | undefined;
  tool: string;
  attackId?: string;
  target?: string;
  text: string;
}): SpillOutcome {
  const { text } = opts;
  if (text.length <= SPILL_THRESHOLD_CHARS) return { content: text, record: null };
  if (!opts.dir) return { content: text.slice(0, SPILL_THRESHOLD_CHARS), record: null };
  try {
    const spillDir = join(opts.dir, SPILL_DIR_NAME);
    mkdirSync(spillDir, { recursive: true });
    const seq = nextSpillSeq(spillDir);
    const fileName = `${String(seq).padStart(4, "0")}-${sanitizeToolSegment(opts.tool)}.txt`;
    const relFile = `${SPILL_DIR_NAME}/${fileName}`;
    // The file is exactly the input string, no additions — byte-identity on read-back depends on it.
    writeFileSync(join(spillDir, fileName), text, "utf8");
    const bytes = Buffer.byteLength(text, "utf8");
    const record: SpillRecord = {
      seq,
      ts: new Date().toISOString(),
      tool: opts.tool,
      attackId: opts.attackId ?? null,
      target: opts.target ?? null,
      file: relFile,
      chars: text.length,
      bytes,
      sha256: createHash("sha256").update(text, "utf8").digest("hex"),
      headChars: PREVIEW_HEAD_CHARS,
      tailChars: PREVIEW_TAIL_CHARS,
    };
    appendFileSync(join(spillDir, SPILL_MANIFEST_NAME), JSON.stringify(record) + "\n", "utf8");
    const head = text.slice(0, PREVIEW_HEAD_CHARS);
    const tail = text.slice(text.length - PREVIEW_TAIL_CHARS);
    const omitted = text.length - PREVIEW_HEAD_CHARS - PREVIEW_TAIL_CHARS;
    return { content: `${head}\n${spillNotice(omitted, text.length, opts.tool, relFile)}\n${tail}`, record };
  } catch (err) {
    return {
      content: text.slice(0, SPILL_THRESHOLD_CHARS),
      record: null,
      failed: err instanceof Error ? err.name : "Error",
    };
  }
}

export type ReadSpillResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * Read back one window of a spilled result. The sandbox is mechanical:
 * the reference must be exactly `spill/<name>.txt` (one segment), it is
 * resolved against THIS engagement's spill dir, and the real path must
 * remain inside it — absolute paths, `..`, extra segments, backslashes,
 * and symlinks out are refused with a plain error. This is not a general
 * file reader and must never become one.
 */
export function readSpill(opts: {
  dir: string | undefined;
  path: string;
  offsetChars?: number;
  maxChars?: number;
}): ReadSpillResult {
  const refused = (why: string): ReadSpillResult => ({
    ok: false,
    error: `read_spill: refused (${why}) — path must be a spill/<file>.txt reference from an observation notice in this engagement`,
  });
  if (!opts.dir) return { ok: false, error: "read_spill: no engagement directory in this context — spill is unavailable" };
  const raw = opts.path;
  if (typeof raw !== "string" || raw.length === 0) return refused("empty path");
  if (raw.includes("\\") || raw.includes("\0")) return refused("illegal characters");
  const m = /^spill\/([^/]+)$/.exec(raw);
  if (!m) return refused("not a spill/<file> reference");
  const name = m[1]!;
  if (name === "." || name === ".." || !name.endsWith(".txt")) return refused("not a spill file name");

  const spillDir = resolve(opts.dir, SPILL_DIR_NAME);
  const abs = resolve(spillDir, name);
  if (!abs.startsWith(spillDir + sep)) return refused("escapes the spill dir");
  if (!existsSync(abs)) return { ok: false, error: `read_spill: no such spill file: ${raw}` };
  let realDir: string;
  let realFile: string;
  try {
    realDir = realpathSync(spillDir);
    realFile = realpathSync(abs);
  } catch {
    return { ok: false, error: `read_spill: no such spill file: ${raw}` };
  }
  if (!realFile.startsWith(realDir + sep)) return refused("resolves outside the spill dir");
  if (!statSync(realFile).isFile()) return refused("not a file");

  const text = readFileSync(realFile, "utf8");
  const total = text.length;
  const from = Math.min(Math.max(Math.floor(opts.offsetChars ?? 0) || 0, 0), total);
  const max = Math.min(
    Math.max(Math.floor(opts.maxChars ?? READ_SPILL_DEFAULT_CHARS) || READ_SPILL_DEFAULT_CHARS, 1),
    READ_SPILL_MAX_CHARS,
  );
  const window = text.slice(from, from + max);
  const to = from + window.length;
  const trailer =
    to < total
      ? `[spill read: chars ${from}–${to} of ${total}; ${total - to} remain — call again with offsetChars ${to}]`
      : `[spill read: chars ${from}–${to} of ${total}; end of spill]`;
  return { ok: true, text: window.length > 0 ? `${window}\n${trailer}` : trailer };
}
