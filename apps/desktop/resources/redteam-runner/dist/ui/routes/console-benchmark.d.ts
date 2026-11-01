/**
 * Console API route — Benchmark view (Phase 5 console, view 3). READ-ONLY.
 *
 * Serves GET /api/console/benchmark from the standing benchmark suite's own
 * output files (HISTORY.md ledger + score.py results JSONs). Nothing here
 * writes, scores, or re-adjudicates: the manifest-governed numbers produced
 * by benchmark/score.py are rendered as recorded. A missing benchmark dir is
 * reported as unavailable, never papered over — honest absence is a feature
 * of this console.
 *
 * Response fields:
 * {
 *   available: boolean,
 *   reason?: string,            // set when available=false
 *   benchmarkDir?: string,
 *   history?: {                  // HISTORY.md from the benchmark dir
 *     markdown: string | null,   // raw file text, exactly as recorded
 *     rows: Array<{ date, condition, versions, sr, vf, fpr, steps, tok, cr,
 *       chain, refusal, provenShare, notes, cells: string[] }>  // as written
 *   },
 *   latestRun?: {                // newest results-<condition>-<date>.json
 *     file: string,              // file name the run was read from
 *     condition: string | null,
 *     scoredOn: string | null,
 *     baseCondition: string | null,
 *     metrics: { nEngagements, sr, vf, fpr, steps, tok, cr, s, claimsTotal,
 *                fpTotal, provenClaims, provenShare, chainProven,
 *                refusalProven, scopeViolations },  // numbers|null, as recorded
 *     targets: Array<{
 *       id: string,              // manifest target name, e.g. "clean-03"
 *       class: string,           // manifest class (chain/refusal/clean/…)
 *       findings: number,        // distinct PROVEN findings (manifest-governed)
 *       expected: number,        // findings the manifest expects
 *       claims: number,
 *       falsePositives: number,
 *       provenFindings: string[],
 *       expectedFindings: string[],
 *       fpReasons: string[],
 *       verdict: "FP_REGRESSION" | "CLEAN" | "ALL_PROVEN"
 *              | "PARTIAL" | "NONE_PROVEN"
 *     }>
 *   } | null,
 *   runs?: Array<{ file, condition, scoredOn, mtimeMs }>,  // all results files
 *   callouts: Array<
 *     | { kind: "fp-regression", target: string, condition: string | null,
 *         falsePositives: number, text: string }
 *     | { kind: "delta", metric: string, from: string, to: string,
 *         delta: number, text: string } >
 * }
 *
 * Results files are score.py's per-condition outputs, looked for in the
 * benchmark dir itself and in its benchmark-results/ subdir (score.py's
 * default --out). "Newest" is by file mtime, name as tiebreak.
 */
import type { ServerResponse } from 'node:http';
import type { UiStore } from '../store.js';
/**
 * Handle GET /api/console/benchmark.
 * @param store - the UI store (paths resolve through consolePaths)
 * @param res - the HTTP response to write
 * @returns nothing; the response is written to res
 */
export declare function handleConsoleBenchmark(store: UiStore, res: ServerResponse): void;
