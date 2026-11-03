/**
 * View primitives — extracted from views.ts to keep the views module under the
 * 300-line budget: the generator version/budgets, the atomic write, the
 * views index, and the unit view hash. Pure filesystem + hashing; no store.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { MemoryError } from "./errors.js";
import { hashRecord } from "./schema.js";
import type { MemoryPaths } from "./paths.js";
import type { DirectoryFreshness, MemoryUnit } from "./types.js";

export const VIEW_GENERATOR_VERSION = "deterministic-v1";
export const L0_BUDGET = 256;
export const L1_BUDGET = 4000;

/** Write a tmp file then rename (unlink-then-rename fallback on Windows) — the trajectory-write.ts pattern. */
export function atomicWriteText(path: string, body: string): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    writeFileSync(tmp, body);
    try {
      renameSync(tmp, path);
    } catch {
      rmSync(path, { force: true });
      renameSync(tmp, path);
    }
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { force: true });
  }
}

// ---------------------------------------------------------------------------
// views.json — the freshness index (§5.3)
// ---------------------------------------------------------------------------

/** The `views.json` file: directory freshness entries by directory key. */
export interface ViewsIndexFile {
  version: 1;
  dirs: Record<string, DirectoryFreshness>;
}

/** An empty freshness index (a freshly bootstrapped store). */
export function emptyViewsIndex(): ViewsIndexFile {
  return { version: 1, dirs: {} };
}

/**
 * Read `views.json`. A missing file reads as an empty index here; whether
 * missing is an error is the caller's decision (store open treats it as
 * `STORE_INDEX_MISMATCH`, §8 row 4). A malformed file is always that error.
 *
 * @param paths - The store paths.
 * @returns The parsed index.
 */
export function readViewsIndex(paths: MemoryPaths): ViewsIndexFile {
  if (!existsSync(paths.viewsIndexPath)) return emptyViewsIndex();
  try {
    const raw = JSON.parse(readFileSync(paths.viewsIndexPath, "utf8")) as ViewsIndexFile;
    if (!raw || raw.version !== 1 || typeof raw.dirs !== "object" || raw.dirs === null) {
      throw new Error("views.json is not a version-1 index");
    }
    return raw;
  } catch (err) {
    throw new MemoryError("STORE_INDEX_MISMATCH", `${paths.viewsIndexPath}: unreadable views index`, { cause: err });
  }
}

/** Persist the freshness index atomically. */
export function writeViewsIndex(paths: MemoryPaths, index: ViewsIndexFile): void {
  mkdirSync(paths.root, { recursive: true });
  atomicWriteText(paths.viewsIndexPath, `${JSON.stringify(index, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Unit views — deterministic generation (§5.1)
// ---------------------------------------------------------------------------

/**
 * The hash a unit's views are bound to: sha256 over the canonical record
 * excluding the `views` and `hash` fields. A mismatch at recall means the
 * stored views do not describe the current version (§8 row 9).
 *
 * @param unit - The unit (any views/hash values are ignored).
 * @returns The source hash for view generation.
 */
export function unitViewSourceHash(unit: Omit<MemoryUnit, "hash">): string {
  const { views: _views, ...rest } = unit;
  return hashRecord(rest);
}

export function truncateAtWord(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const cut = text.slice(0, budget - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`;
}

/**
 * Generate the L0/L1 pair for a unit from its structured fields only.
 * L0 is one compressed sentence built from the claim; L1 is the fixed
 * Claim/Scope/Proof/Corroboration/Applicability/Caveats structure.
 * Target-derived units are prefixed `UNTRUSTED:` in L0 and carry the
 * caveat in L1 — a target's claim is never presented as fleet knowledge.
 *
 * @param unit - The unit's content fields (views/hash are not read).
 * @param status - The unit's current status, for the Caveats section.
 * @returns The generated `l0` and `l1` strings.
 */
