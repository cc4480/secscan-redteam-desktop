import { type ReportDocument } from "./document.js";
/** The detail block that rides inside the executive-summary segment. */
export declare function detailMd(doc: ReportDocument): string;
/** The tool-activity section, in the exact strings the runner-computed
 * MD section (report/activity.ts) has always used — now projected from
 * the document's activity input instead of a second event pass. */
export declare function activityMd(doc: ReportDocument): string;
/** The host-inventory summary: the recorded collection facts and
 * section counts; the full inventory renders in report.html. A failed
 * collection states its absence exactly as the flagship does. */
export declare function inventoryMd(doc: ReportDocument): string;
