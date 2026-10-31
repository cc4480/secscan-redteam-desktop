/**
 * Harness2 ingest walker (H2-P1): ingestRoot over an engagement tree.
 *
 * The tree can be laid out two ways: a repo root containing engagements/live
 * and engagements/archive, or a directory that already is engagements/ (so it
 * has live/ and archive/ directly). Both are walked. A run is re-ingested only
 * when its directory's newest source mtime is newer than the mtime recorded at
 * the last successful ingest, so a repeat call is cheap and idempotent.
 *
 * That per-directory bookkeeping cannot live in the section-5 schema (the three
 * tables are exact), so it is a small JSON sidecar under the harness root,
 * written atomically after the walk. A sidecar problem only costs a re-ingest,
 * never a failed walk.
 */
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Harness2Store } from "./store-model.js";
import { hasAnySource, ingestEngagementDir, sourceMtime } from "./ingest.js";
import type { IngestResult } from "./ingest.js";

/** Sidecar file (relative to the harness root) holding dir -> last ingest mtime. */
const INDEX_FILE = ".ingest-index.json";

export interface IngestOptions {
  /** Re-ingest even when the sidecar says the directory is unchanged. */
  readonly force?: boolean;
}

export interface IngestSummary {
  readonly scanned: number;
  readonly ingested: number;
  readonly skipped: number;
  readonly failed: number;
  readonly results: readonly IngestResult[];
}

function indexPath(store: Harness2Store): string {
  return join(store.paths.root, INDEX_FILE);
}

function readIndex(store: Harness2Store): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(indexPath(store), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [dir, mtime] of Object.entries(parsed)) {
      if (typeof mtime === "number" && Number.isFinite(mtime)) out[dir] = mtime;
    }
    return out;
  } catch {
    return {};
  }
}

function writeIndex(store: Harness2Store, index: Readonly<Record<string, number>>): void {
  const path = indexPath(store);
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    renameSync(temporary, path);
  } catch {
    // Bookkeeping only: the next walk re-ingests what it cannot remember.
  }
}

/** Engagement directories under a tree, in a stable order. */
function engagementDirs(root: string): string[] {
  const found = new Set<string>();
  if (hasAnySource(root)) found.add(root);
  const bases = [
    join(root, "engagements", "live"),
    join(root, "engagements", "archive"),
    join(root, "live"),
    join(root, "archive"),
  ];
  for (const base of bases) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) found.add(join(base, entry.name));
    }
  }
  return [...found].sort();
}

/** Walk an engagement tree, ingesting every run that is new or changed since the last walk. */
export function ingestRoot(store: Harness2Store, root: string, options: IngestOptions = {}): IngestSummary {
  const dirs = engagementDirs(root);
  const previous = readIndex(store);
  const next: Record<string, number> = { ...previous };
  const results: IngestResult[] = [];
  let skipped = 0;
  let failed = 0;
  for (const dir of dirs) {
    const mtime = sourceMtime(dir);
    const recorded = previous[dir];
    if (options.force !== true && recorded !== undefined && mtime > 0 && recorded >= mtime) {
      skipped++;
      continue;
    }
    try {
      const result = ingestEngagementDir(store, dir);
      results.push(result);
      if (result.ingested) next[dir] = mtime;
      else failed++;
    } catch (err) {
      failed++;
      results.push({
        runId: basename(dir),
        source: "none",
        ingested: false,
        steps: 0,
        warnings: [`ingest failed: ${(err as Error).message}`],
      });
    }
  }
  writeIndex(store, next);
  return {
    scanned: dirs.length,
    ingested: results.filter((result) => result.ingested).length,
    skipped,
    failed,
    results,
  };
}
