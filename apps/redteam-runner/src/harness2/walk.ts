/**
 * Harness2 ingest walker (H2-P1b): ingestRoot over an engagement tree.
 *
 * The tree can be laid out two ways: a repo root containing engagements/live
 * and engagements/archive, or a directory that already is engagements/ (so it
 * has live/ and archive/ directly). Both are walked. A run is re-ingested only
 * when its directory's newest source mtime is newer than the mtime recorded
 * with the stored run, so a repeat call is cheap and idempotent.
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { Harness2Store } from "./store-model.js";
import { hasAnySource, ingestEngagementDir, sourceMtime } from "./ingest.js";
import type { IngestResult } from "./ingest.js";

export interface IngestOptions {
  /** Re-ingest even when the stored source mtime says the directory is unchanged. */
  readonly force?: boolean;
}

export interface IngestSummary {
  readonly scanned: number;
  readonly ingested: number;
  readonly skipped: number;
  readonly failed: number;
  readonly results: readonly IngestResult[];
}

/** The stored run for a directory, if it was ingested before. */
function existingRun(store: Harness2Store, dir: string): ReturnType<Harness2Store["getRunBySourcePath"]> {
  return store.getRunBySourcePath(dir);
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

/** Walk an engagement tree, ingesting every run that is new or changed since the last ingest. */
export function ingestRoot(store: Harness2Store, root: string, options: IngestOptions = {}): IngestSummary {
  const dirs = engagementDirs(root);
  const results: IngestResult[] = [];
  let skipped = 0;
  let failed = 0;
  for (const dir of dirs) {
    if (options.force !== true) {
      const existing = existingRun(store, dir);
      if (existing !== null && existing.sourceMtimeMs !== undefined && existing.sourceMtimeMs >= sourceMtime(dir)) {
        skipped++;
        continue;
      }
    }
    try {
      const result = ingestEngagementDir(store, dir);
      results.push(result);
      if (!result.ingested) failed++;
    } catch (err) {
      failed++;
      results.push({
        runId: basename(dir),
        source: "none",
        ingested: false,
        events: 0,
        warnings: [`ingest failed: ${(err as Error).message}`],
      });
    }
  }
  return {
    scanned: dirs.length,
    ingested: results.filter((result) => result.ingested).length,
    skipped,
    failed,
    results,
  };
}
