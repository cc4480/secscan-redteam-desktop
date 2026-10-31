/**
 * Seam type shim — NOT a vendored copy.
 *
 * scanTypes.ts type-imports ChallengeVerdict from
 * "./challengePage.js". The challenge-page detector itself is
 * skip-set passive-engine machinery; only the verdict contract is
 * needed for the vendored types to compile, declared here from the
 * source interface.
 */
export interface ChallengeVerdict {
  /** True only when a vendor fingerprint matched. */
  isChallenge: boolean;
  vendor: string | null;
  /** What matched, for the evidence line in the report. */
  signal: string | null;
  /** Which kind of evidence decided it. Absent when nothing matched. */
  rule?: "header" | "title" | "body" | "bare-status";
  /** HTTP status the response carried. */
  status?: number;
  /** Length of the response body, in characters. */
  bodyLength?: number;
  /** The document's <title>, when it has one. */
  title?: string | null;
}
