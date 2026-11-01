import { type Ctx } from "../context.js";
/** The package file name. Also declared in the report contract
 * (workflows/protocol.ts, REPORT_CONTRACT.formats) — the package suite
 * pins the two against each other so they cannot drift apart. */
export declare const REPORT_PACKAGE_NAME = "report-package.zip";
/** The deliverables every package must carry, in package order. These
 * are the first entries of REPORT_CONTRACT.formats, in the same order. */
export declare const PACKAGE_DELIVERABLES: readonly ["report.html", "report.md", "report.json", "report.txt", "findings.csv", "report.docx"];
/** The zip entries for an engagement directory: the six deliverables
 * read back verbatim, then every poc/*.json bundle in sorted order.
 * Throws naming the first missing deliverable. */
export declare function collectPackageEntries(dir: string): Record<string, Uint8Array>;
/** Assemble the package zip bytes from the engagement directory. */
export declare function buildReportPackage(dir: string): Uint8Array;
/** Write report-package.zip into the engagement directory. Its own
 * failure domain, mirroring the CSV/DOCX emitters: a package problem is
 * recorded as an event, never a lost report. */
export declare function emitReportPackage(ctx: Ctx): void;
