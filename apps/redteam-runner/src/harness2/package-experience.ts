/**
 * Harness2 EXPERIENCE.md reading (H2-P2a read side; canonical format owned by
 * H2-P3's experience.ts). The package parses the lessons itself so it builds
 * and tests independently of H2-P3; the format doc is embedded in the package
 * instructions. Absence and malformed entries are tolerated: a bad entry is
 * skipped, never guessed.
 *
 * Canonical location: `<paths.experience>/<sanitized-class>.md` (H2-P3
 * sanitizeTargetClass: trim, lowercase, non [a-z0-9_-] -> "-", strip leading/
 * trailing "-", max 64 chars, empty -> "general").
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExperienceEntry, TargetClass } from "./contract.js";

/** Canonical EXPERIENCE.md entry format, embedded in the package instructions. */
export const EXPERIENCE_FORMAT_DOC = [
  "# EXPERIENCE - <target-class>",
  "",
  "## 2026-10-18 - <layerId|general>",
  "- change: <single line>",
  "- reason: <single line>",
  "- measured effect: <single line, never an estimate>",
  "- tokens spent: <integer>",
].join("\n");

const EXPERIENCE_HEADING = /^##\s+(\d{4}-\d{2}-\d{2})\s+-\s+(.+?)\s*$/;
const EXPERIENCE_BULLET = /^-\s+(change|reason|measured effect|tokens spent)\s*:\s*(.+?)\s*$/i;
const LAYER_ID = /^[a-z0-9][a-z0-9._-]*$/i;

/** H2-P3's filename sanitizer, mirrored so the read side finds the same file. */
export function sanitizeTargetClass(targetClass: TargetClass): string {
  const slug = targetClass
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug === "" ? "general" : slug;
}

/** Parse dated EXPERIENCE.md entries; malformed/incomplete entries are dropped. */
export function parseExperience(text: string, targetClass: TargetClass): ExperienceEntry[] {
  const entries: ExperienceEntry[] = [];
  let draft: { date: string; layerId?: string; change?: string; reason?: string; measuredEffect?: string; tokensSpent?: number } | undefined;
  const flush = (): void => {
    if (draft === undefined) return;
    const { date, layerId, change, reason, measuredEffect, tokensSpent } = draft;
    if (change !== undefined && reason !== undefined && measuredEffect !== undefined && tokensSpent !== undefined) {
      entries.push({ date, targetClass, ...(layerId !== undefined ? { layerId } : {}), change, reason, measuredEffect, tokensSpent });
    }
    draft = undefined;
  };
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    const heading = EXPERIENCE_HEADING.exec(line);
    if (heading !== null) {
      flush();
      const scope = heading[2] ?? "";
      draft = { date: heading[1] ?? "", ...(scope.toLowerCase() !== "general" && LAYER_ID.test(scope) ? { layerId: scope } : {}) };
      continue;
    }
    if (draft === undefined) continue;
    const bullet = EXPERIENCE_BULLET.exec(line);
    if (bullet === null) continue;
    const field = (bullet[1] ?? "").toLowerCase();
    const value = bullet[2] ?? "";
    if (field === "change") draft.change = value;
    else if (field === "reason") draft.reason = value;
    else if (field === "measured effect") draft.measuredEffect = value;
    else {
      const tokens = Number(value);
      if (Number.isInteger(tokens) && tokens >= 0) draft.tokensSpent = tokens;
    }
  }
  flush();
  return entries;
}

/** Read a class's lessons; absent/unreadable file means no lessons (tolerated). */
export function readClassExperience(experienceDir: string, targetClass: TargetClass): ExperienceEntry[] {
  const path = join(experienceDir, `${sanitizeTargetClass(targetClass)}.md`);
  try {
    return existsSync(path) ? parseExperience(readFileSync(path, "utf8"), targetClass) : [];
  } catch {
    return [];
  }
}
