/**
 * Q-RP-5 — the deliverable package: ONE zip carrying the engagement's
 * full client deliverable set — report.html, report.md, report.json,
 * report.txt, findings.csv, report.docx — plus the proof bundles the
 * report cites (poc/*.json), so a client receives a single downloadable
 * file instead of a loose directory. It is emitted after the individual
 * artifacts and packages their bytes read back from the engagement
 * directory: the package reconciles with the loose deliverables
 * byte-for-byte and never re-renders anything.
 *
 * The six named artifacts are the package contract. If one is missing
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
/** The package file name. Also declared in the report contract
 * (workflows/protocol.ts, REPORT_CONTRACT.formats) — the package suite
 * pins the two against each other so they cannot drift apart. */
export const REPORT_PACKAGE_NAME = "report-package.zip";
/** The deliverables every package must carry, in package order. These
 * are the first entries of REPORT_CONTRACT.formats, in the same order. */
export const PACKAGE_DELIVERABLES = [
    "report.html",
    "report.md",
    "report.json",
    "report.txt",
    "findings.csv",
    "report.docx",
];
// Local components, not UTC: fflate reads the mtime's LOCAL date parts, and 1980-01-01T00:00Z is still 1979 west of UTC.
const PACKAGE_MTIME = new Date(1980, 0, 1, 0, 0, 0);
/** The zip entries for an engagement directory: the six deliverables
 * read back verbatim, then every poc/*.json bundle in sorted order.
 * Throws naming the first missing deliverable. */
export function collectPackageEntries(dir) {
    const entries = {};
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
function zipEntries(entries) {
    return zipSync(entries, { level: 6, mtime: PACKAGE_MTIME });
}
/** Assemble the package zip bytes from the engagement directory. */
export function buildReportPackage(dir) {
    return zipEntries(collectPackageEntries(dir));
}
/** Write report-package.zip into the engagement directory. Its own
 * failure domain, mirroring the CSV/DOCX emitters: a package problem is
 * recorded as an event, never a lost report. */
export function emitReportPackage(ctx) {
    try {
        const entries = collectPackageEntries(ctx.events.dir);
        writeFileSync(join(ctx.events.dir, REPORT_PACKAGE_NAME), zipEntries(entries));
        ctx.events.append({
            phase: "report",
            actor: "runner",
            action: "report_package_written",
            result: `${REPORT_PACKAGE_NAME} written (${Object.keys(entries).length} entries: deliverables + proof bundles).`,
        });
    }
    catch (err) {
        ctx.events.append({
            phase: "report",
            actor: "runner",
            action: "report_package_failed",
            result: `Deliverable package failed (report artifacts unaffected): ${err.message}`,
        });
    }
}
//# sourceMappingURL=package.js.map