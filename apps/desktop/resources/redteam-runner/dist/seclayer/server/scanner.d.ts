/**
 * Seam type shim — NOT a vendored copy.
 *
 * bola.ts type-imports DiagnosticResult from "./scanner.js". In the
 * source repo, scanner.ts is the scan orchestrator and merely
 * re-exports that type from scanTypes.ts. The orchestrator itself is
 * skip-set (its checks repeat the embedded SecScan engine and its
 * plumbing is service chassis), so the vendored unit carries this
 * declaration instead: the same re-export, with no orchestrator
 * behind it. The import is type-only in every consumer and is elided
 * from the emitted JS.
 */
export type { DiagnosticResult, ScanOptions } from "./scanTypes.js";
