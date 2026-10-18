import type { RunBundle, StepInput } from "./store-model.js";
export declare const STEP_ARTIFACT = "steps.jsonl";
export declare const RUN_ARTIFACT = "run.json";
/** Read `run.json`; null when absent or unusable (the caller falls back). */
export declare function readRunBundle(path: string, warnings: string[]): RunBundle | null;
/** steps.jsonl: one JSON object per line; corrupt lines are skipped and counted. */
export declare function readStepsJournal(path: string, warnings: string[]): StepInput[];
