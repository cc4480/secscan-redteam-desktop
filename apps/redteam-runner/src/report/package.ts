/**
 * Q-RP-5 — the deliverable package: ONE zip carrying the engagement's
 * full client deliverable set — report.html, report.md, findings.csv,
 * report.docx — plus the proof bundles the report cites (poc/*.json),
 * so a client receives a single downloadable file instead of a loose
 * directory. It is emitted after the individual artifacts and packages
 * their bytes read back from the engagement directory: the package
 * reconciles with the loose deliverables byte-for-byte and never
 * re-renders anything.
 *
 * The four named artifacts are the package contract. If one is missing
 * — its own writer already recorded that failure — the package fails
 * loudly rather than shipping a partial set under the full-set name.
 * Proof bundles are evidence attachments: the poc/*.json files present
 * are included in sorted order; an engagement with no bundles carries
 * none, which is not a failure.
 *
 * Deterministic, on the DOCX writer's convention: fixed entry order and
 * a fixed 1980-01-01 mtime, so the same engagement output packages to
 * byte-identical zips.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { type Ctx } from "../context.js";

/** The package file name. Also declared in the report contract
 * (workflows/protocol.ts, REPORT_CONTRACT.formats) — the package suite
 * pins the two against each other so they cannot drift apart. */
export const REPORT_PACKAGE_NAME = "report-package.zip";

/** The deliverables every package must carry, in package order. These
 * are the first entries of REPORT_CONTRACT.formats, in the same order. */
export const PACKAGE_DELIVERABLES = [
  "report.html",
  "report.md",
  "findings.csv",
  "report.docx",
] as const;

const PACKAGE_MTIME = new Date("1980-01-01T00:00:00.000Z");

/** The zip entries for an engagement directory: the four deliverables
 * read back verbatim, then every poc/*.json bundle in sorted order.
 * Throws naming the first missing deliverable. */
export function collectPackageEntries(dir: string): Record<string, Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  for (const name of PACKAGE_DELIVERABLES) {
    const path = join(dir, name);
    if (!existsSync(path)) {
      throw new Error(`deliverable missing from the engagement directory: ${name}`);
    }
    entries[name] = readFileSync(path);
  }
  const pocDir = join(dir, "poc");
  if (existsSync(pocDir)) {
    for (const name of readdirSync(pocDir).filter((n) => n.endsWith(".json")).sort()) {
      entries[`poc/${name}`] = readFileSync(join(pocDir, name));
    }
  }
  return entries;
}

function zipEntries(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(entries, { level: 6, mtime: PACKAGE_MTIME });
}

/** Assemble the package zip bytes from the engagement directory. */
export function buildReportPackage(dir: string): Uint8Array {
  return zipEntries(collectPackageEntries(dir));
}

/** Write report-package.zip into the engagement directory. Its own
 * failure domain, mirroring the CSV/DOCX emitters: a package problem is
 * recorded as an event, never a lost report. */
export function emitReportPackage(ctx: Ctx): void {
  try {
    const entries = collectPackageEntries(ctx.events.dir);
    writeFileSync(join(ctx.events.dir, REPORT_PACKAGE_NAME), zipEntries(entries));
    ctx.events.append({
      phase: "report",
      actor: "runner",
      action: "report_package_written",
      result: `${REPORT_PACKAGE_NAME} written (${Object.keys(entries).length} entries: deliverables + proof bundles).`,
    });
  } catch (err) {
    ctx.events.append({
      phase: "report",
      actor: "runner",
      action: "report_package_failed",
      result: `Deliverable package failed (report artifacts unaffected): ${(err as Error).message}`,
    });
  }
}
