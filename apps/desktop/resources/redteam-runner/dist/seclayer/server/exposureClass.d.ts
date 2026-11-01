export type ExposureClass = "sensitive" | "public" | "unclassified";
export declare function classifyExposure(table: string, rows: unknown[]): ExposureClass;
/** Top-level column names of the first returned row, for evidence lines. */
export declare function rowColumns(rows: unknown[]): string;
