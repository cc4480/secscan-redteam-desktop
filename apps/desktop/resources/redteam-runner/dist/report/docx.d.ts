import { type Ctx } from '../context.js';
import { type EngagementReportInput } from './html/render.js';
/** Assemble report.docx (the OOXML zip bytes) from the report model. */
export declare function buildReportDocx(o: EngagementReportInput): Uint8Array;
/** Phase artifact writer (the writeSafetyArtifacts pattern): emit
 * report.docx beside report.html. Its own try/catch — a DOCX failure
 * is recorded as an event and never breaks the report itself. */
export declare function writeDocxArtifact(ctx: Ctx, input: EngagementReportInput): void;
