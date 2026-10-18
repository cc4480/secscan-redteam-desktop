/**
 * Harness2 EXPERIENCE.md section-7 record format + read side (H2-P3).
 *
 * One ASCII markdown file per target class under paths.experience, append-only.
 * Canonical record (the exact section-7 format):
 *   ## <YYYY-MM-DD> - <layer-id> - <cycle-id>
 *   - Target class:
 *   - Changed (layer/file):
 *   - Why (motivating run_ids):
 *   - Measured effect (metric deltas + sample size):
 *   - Status: active | superseded (-> <layer-id>) | reverted (<reason>, <date>)
 *
 * Read side: the em-dash heading form the spec also writes
 * ("<date> - <layer-id> - <cycle-id>") is accepted; ASCII is always written.
 * Prose between records is tolerated and never rewritten, and a malformed
 * record is skipped and counted, never thrown on.
 *
 * This module owns the FORMAT and the read side. The append/status writers and
 * the approval-gated adoption path live in ./experience.ts, which re-exports
 * every symbol here so callers import from one place.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Harness2Paths, TargetClass } from "./contract.js";

/** Canonical section-7 markdown format, restated wherever a file is explained. */
export const EXPERIENCE_FORMAT_DOC = [
  "EXPERIENCE.md canonical format (ASCII, LF, one file per target class):",
  "# EXPERIENCE - <target-class>",
  "## <YYYY-MM-DD> - <layer-id> - <cycle-id>",
  "- Target class: <target class of this ledger>",
  "- Changed (layer/file): <what changed in the harness>",
  "- Why (motivating run_ids): <run ids that motivated the change>",
  "- Measured effect (metric deltas + sample size): <e.g. +2.1 mean vulns, n=12, FPs flat>",
  "- Status: active | superseded (-> <layer-id>) | reverted (<reason>, <date>)",
  "One entry per tuning cycle; entries are appended, never reordered or deleted;",
  "the only in-place edit is flipping ONE entry's Status line (see experience.ts);",
  "prose outside entries is tolerated on read and preserved by the next append.",
].join("\n");

/** Lifecycle status of one section-7 record. */
export type ExperienceStatus =
  | { readonly kind: "active" }
  | { readonly kind: "superseded"; readonly by: string }
  | { readonly kind: "reverted"; readonly reason: string; readonly date: string };

/** One section-7 EXPERIENCE.md entry. */
export interface ExperienceRecord {
  /** ISO date, e.g. 2026-10-18. */
  readonly date: string;
  /** Target class the ledger belongs to (one file per class). */
  readonly targetClass: TargetClass;
  /** Layer this record is about; undefined renders the heading token `general`. */
  readonly layerId?: string;
  /** Tuning cycle this record belongs to. */
  readonly cycleId: string;
  /** `- Changed (layer/file):` what changed in the harness. */
  readonly changed: string;
  /** `- Why (motivating run_ids):` the measured runs that motivated it. */
  readonly why: string;
  /** `- Measured effect (...):` metric deltas plus sample size, never an estimate. */
  readonly measuredEffect: string;
  /** `- Status:` current lifecycle status. */
  readonly status: ExperienceStatus;
}

/** Parsed form of one EXPERIENCE.md body. */
export interface ExperienceParseResult { readonly entries: readonly ExperienceRecord[]; readonly skipped: number }
/** One class's parsed file plus where it lives. */
export interface ExperienceReport extends ExperienceParseResult { readonly targetClass: TargetClass; readonly path: string; readonly exists: boolean }
/** Compact one-line summary for `experience list`. */
export interface ExperienceFileInfo { readonly targetClass: TargetClass; readonly path: string; readonly entries: number; readonly skipped: number }
/** One scanned level-2 block: line range for surgical edits, record null when malformed. */
export interface ExperienceBlock { readonly startLine: number; readonly statusLine: number; readonly record: ExperienceRecord | null }
/** A scanned file: raw lines plus every level-2 block in order. */
export interface ExperienceScan { readonly lines: readonly string[]; readonly blocks: readonly ExperienceBlock[] }

const HEADING = /^##\s+(\d{4}-\d{2}-\d{2})\s+[-\u2013\u2014]\s+(.+?)\s+[-\u2013\u2014]\s+(.+?)\s*$/;
const LEVEL_TWO = /^##(\s|$)/;
const BULLET = /^-\s+([^:]+?)\s*:\s*(.*?)\s*$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SUPERSEDED = /^superseded\s*\(\s*(?:->|=>|\u2192)\s*([^()\s]+)\s*\)$/i;
const REVERTED = /^reverted\s*\(\s*(.+)\s*,\s*(\d{4}-\d{2}-\d{2})\s*\)$/i;

/** True for a real calendar date in YYYY-MM-DD form. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The YYYY-MM-DD part of an ISO timestamp, when it is a real date. */
export function isoDateOf(value: string | undefined): string | undefined {
  const candidate = value?.slice(0, 10);
  return candidate !== undefined && isIsoDate(candidate) ? candidate : undefined;
}

/** Collapse a value to one trimmed line so a bullet can never break the format. */
export function oneLine(value: string): string {
  return value.replace(/\s*\r?\n\s*/g, " ").trim();
}

/** True when a token can be a layer id or cycle id and survive the round-trip. */
export function isExperienceToken(value: string): boolean { return TOKEN.test(value.trim()); }

/** Sanitize a target class into a safe EXPERIENCE.md filename stem. */
export function sanitizeTargetClass(targetClass: TargetClass): string {
  return targetClass.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/g, "") || "general";
}

/** `<paths.experience>/<sanitized-target-class>.md`. */
export function resolveExperiencePath(paths: Harness2Paths, targetClass: TargetClass): string {
  return join(paths.experience, `${sanitizeTargetClass(targetClass)}.md`);
}

/** The dedupe key: (date, layerId, cycleId, changed). */
export function experienceKey(record: ExperienceRecord): string {
  return [record.date, record.layerId ?? "", record.cycleId, oneLine(record.changed)].join("\u0000");
}

/** Render the `- Status:` value exactly as the canonical format defines it. */
export function renderStatus(status: ExperienceStatus): string {
  if (status.kind === "active") return "active";
  if (status.kind === "superseded") return `superseded (-> ${status.by})`;
  return `reverted (${oneLine(status.reason)}, ${status.date})`;
}

/** Parse a `- Status:` value; null means malformed and the record is skipped. */
function parseStatus(value: string): ExperienceStatus | null {
  const text = value.trim();
  if (/^active$/i.test(text)) return { kind: "active" };
  const superseded = SUPERSEDED.exec(text);
  if (superseded !== null) {
    const by = superseded[1] ?? "";
    return TOKEN.test(by) ? { kind: "superseded", by } : null;
  }
  const reverted = REVERTED.exec(text);
  if (reverted === null) return null;
  const reason = oneLine(reverted[1] ?? "");
  const date = reverted[2] ?? "";
  return reason === "" || !isIsoDate(date) ? null : { kind: "reverted", reason, date };
}

/** Classify a bullet label: the exact names plus their parenthesised headings. */
function classifyField(label: string): "targetClass" | "changed" | "why" | "measuredEffect" | "status" | null {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "target class") return "targetClass";
  if (normalized.startsWith("changed")) return "changed";
  if (normalized.startsWith("why")) return "why";
  if (normalized.startsWith("measured effect")) return "measuredEffect";
  if (normalized === "status") return "status";
  return null;
}

interface Draft {
  readonly startLine: number;
  readonly heading: RegExpExecArray | null;
  readonly fields: Map<string, string>;
  statusLine: number;
}

/** Validate and finish one scanned block; null means it is skipped. */
function finishEntry(draft: Draft, targetClass: TargetClass): ExperienceRecord | null {
  const heading = draft.heading;
  if (heading === null) return null;
  const date = heading[1] ?? "";
  const layerToken = (heading[2] ?? "").trim();
  const cycleId = (heading[3] ?? "").trim();
  if (!isIsoDate(date) || !TOKEN.test(cycleId)) return null;
  const layerId = layerToken.toLowerCase() === "general" ? undefined : layerToken;
  if (layerId !== undefined && !TOKEN.test(layerId)) return null;
  const targetClassLabel = draft.fields.get("targetClass") ?? "";
  const changed = draft.fields.get("changed") ?? "";
  const why = draft.fields.get("why") ?? "";
  const measuredEffect = draft.fields.get("measuredEffect") ?? "";
  const status = parseStatus(draft.fields.get("status") ?? "");
  if (targetClassLabel === "" || changed === "" || why === "" || measuredEffect === "" || status === null) return null;
  return { date, targetClass, ...(layerId !== undefined ? { layerId } : {}), cycleId, changed, why, measuredEffect, status };
}

/**
 * Scan a body into level-2 blocks with their line ranges, so a status flip can
 * touch exactly one line. Everything outside a record (header, prose) is left
 * for the caller to preserve byte for byte.
 */
export function scanExperience(markdown: string, targetClass: TargetClass): ExperienceScan {
  const lines = markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  const blocks: ExperienceBlock[] = [];
  let draft: Draft | null = null;
  const flush = (): void => {
    if (draft === null) return;
    blocks.push({ startLine: draft.startLine, statusLine: draft.statusLine, record: finishEntry(draft, targetClass) });
    draft = null;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (LEVEL_TWO.test(line)) {
      flush();
      draft = { startLine: index, heading: HEADING.exec(line), fields: new Map(), statusLine: -1 };
      continue;
    }
    if (draft === null || draft.heading === null) continue;
    const bullet = BULLET.exec(line);
    if (bullet === null) continue;
    const field = classifyField(bullet[1] ?? "");
    if (field === null) continue;
    if (field === "status" && draft.statusLine < 0) draft.statusLine = index;
    if (!draft.fields.has(field)) draft.fields.set(field, bullet[2] ?? "");
  }
  flush();
  return { lines, blocks };
}

/**
 * Parse a body into section-7 records; malformed blocks are skipped (counted),
 * never thrown on, and prose outside records is tolerated and ignored.
 */
export function parseExperience(markdown: string, targetClass: TargetClass): ExperienceParseResult {
  const entries: ExperienceRecord[] = [];
  let skipped = 0;
  for (const block of scanExperience(markdown, targetClass).blocks) {
    if (block.record === null) skipped += 1;
    else entries.push(block.record);
  }
  return { entries, skipped };
}

/** Canonical markdown block for one section-7 record; the inverse of the parser. */
export function renderEntry(record: ExperienceRecord): string {
  return [
    `## ${record.date} - ${record.layerId ?? "general"} - ${record.cycleId}`,
    `- Target class: ${oneLine(record.targetClass)}`,
    `- Changed (layer/file): ${oneLine(record.changed)}`,
    `- Why (motivating run_ids): ${oneLine(record.why)}`,
    `- Measured effect (metric deltas + sample size): ${oneLine(record.measuredEffect)}`,
    `- Status: ${renderStatus(record.status)}`,
  ].join("\n");
}

/**
 * The COMPLETE canonical file text (header + every record in order), which is
 * what a proposal package ships verbatim for the class (spec section 6.5).
 */
export function renderFullText(records: readonly ExperienceRecord[], targetClass?: TargetClass): string {
  const name = sanitizeTargetClass(targetClass ?? records[0]?.targetClass ?? "general");
  const blocks = records.map(renderEntry);
  return blocks.length === 0 ? `# EXPERIENCE - ${name}\n` : `# EXPERIENCE - ${name}\n\n${blocks.join("\n\n")}\n`;
}

/** Backwards-compatible name for the canonical renderer. */
export const renderExperience = renderFullText;

/** Read one class's EXPERIENCE.md; a missing or unreadable file reads as empty. */
export function readExperienceReport(paths: Harness2Paths, targetClass: TargetClass): ExperienceReport {
  const path = resolveExperiencePath(paths, targetClass);
  if (!existsSync(path)) return { targetClass, path, exists: false, entries: [], skipped: 0 };
  try {
    const parsed = parseExperience(readFileSync(path, "utf8"), targetClass);
    return { targetClass, path, exists: true, entries: parsed.entries, skipped: parsed.skipped };
  } catch {
    return { targetClass, path, exists: false, entries: [], skipped: 0 };
  }
}

/** The class's records; absence/unreadability means no records (never throws). */
export function readExperience(paths: Harness2Paths, targetClass: TargetClass): ExperienceRecord[] { return [...readExperienceReport(paths, targetClass).entries]; }

/** The class's EXPERIENCE.md full text verbatim; absent means canonical empty text. */
export function readExperienceFullText(paths: Harness2Paths, targetClass: TargetClass): string {
  const report = readExperienceReport(paths, targetClass);
  if (!report.exists) return renderFullText([], targetClass);
  try {
    return readFileSync(report.path, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return renderFullText([], targetClass);
  }
}

/** Every per-class EXPERIENCE.md on disk, with entry/skip counts (never throws). */
export function listExperience(paths: Harness2Paths): ExperienceFileInfo[] {
  let names: string[];
  try {
    names = readdirSync(paths.experience).filter((name) => name.toLowerCase().endsWith(".md")).sort();
  } catch {
    return [];
  }
  return names.map((name) => {
    const targetClass = name.slice(0, -3);
    const report = readExperienceReport(paths, targetClass);
    return { targetClass, path: report.path, entries: report.entries.length, skipped: report.skipped };
  });
}

/** One class's records plus the file's full markdown text (CLI `experience show`). */
export function showExperience(paths: Harness2Paths, targetClass: TargetClass): ExperienceReport & { readonly markdown: string } {
  return { ...readExperienceReport(paths, targetClass), markdown: readExperienceFullText(paths, targetClass) };
}
