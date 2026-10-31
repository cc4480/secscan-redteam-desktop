import type { LlmTokenUsage } from "./trajectory-normalize.js";
/** File name inside the engagement directory. */
export declare const STEPS_FILE_NAME = "steps.jsonl";
/** The three captured roles; mirrors the section-5 `steps.role` CHECK. */
export type StepRole = "prompt" | "tool" | "observation";
/** Prefix on an observation row whose tool dispatch threw. */
export declare const TOOL_ERROR_PREFIX = "ERROR: ";
/** One section-5 `steps` row. */
export interface StepRecord {
    readonly run_id: string;
    readonly seq: number;
    readonly ts: string;
    readonly role: StepRole;
    readonly tool_name: string | null;
    readonly content: string;
    readonly tokens: number | null;
}
/** The append-only journal for one engagement. */
export interface StepJournal {
    /** Absolute path of steps.jsonl, or "" when the journal is a no-op. */
    readonly path: string;
    readonly runId: string;
    /** Records in the file (existing lines + appended this process). */
    readonly count: number;
    /** Sum of the per-response tokens recorded on prompt rows. */
    readonly tokensTotal: number;
    append(role: StepRole, toolName: string | null, content: string, tokens: number | null): StepRecord | null;
    prompt(content: string, tokens?: number | null): void;
    tool(toolName: string, content: string): void;
    observation(toolName: string, content: string, tokens?: number | null): void;
}
/** Redact PII and known secret literals before anything reaches disk. */
export declare function redactStepContent(content: string): string;
/** Path of the step journal for an engagement directory. */
export declare function stepsPath(engagementDir: string): string;
/**
 * Create the journal for one engagement directory. `dir` undefined yields a
 * no-op journal (a unit-test Ctx has no engagement dir; nothing is written).
 */
export declare function createStepJournal(options: {
    readonly dir?: string;
    readonly runId: string;
}): StepJournal;
/** The step journal for one engagement context; created on first use. */
export declare function stepJournalFor(owner: object): StepJournal;
/** Total tokens (prompt + completion) of one provider response, or null. */
export declare function responseTokens(usage: LlmTokenUsage | undefined): number | null;
/** Read back a step journal, skipping corrupt lines. Never throws. */
export declare function readSteps(engagementDir: string): StepRecord[];
/** Observations whose dispatch threw (the tool-error signal for failure_mode). */
export declare function countStepErrors(steps: readonly StepRecord[]): number;
/** Sum of the per-response tokens recorded in a step journal. */
export declare function sumStepTokens(steps: readonly StepRecord[]): number;
