/**
 * runToolBatch — one turn's tool-call processing.
 *
 * Extracted from agents.ts in a structural split (no file under src/ may
 * exceed 300 lines). The block is the original straight-line tail of the
 * loop body, moved verbatim and keeping its order: push the assistant
 * message carrying the tool_calls, partition the calls into sequential /
 * parallel groups, per result run the repair exchange, redact and log the
 * event, spill oversized output, push the observation with the current
 * shared-state digest, count the tallies and the denied streak, re-check
 * the safety halt, then reflect or (in exploit) commander-redirect. Only
 * the call/response locals are threaded in as deps; no condition, event
 * action string, or ordering changed.
 */
import { type AgentRole, type ChatMessage, type ToolCallRequest } from '@secscan/redteam-llm-router';
import { type Ctx } from './context.js';
import { type EngagementPhase } from './types.js';
import { type StepJournal } from './harness2/steps.js';
import { type TurnIntegrity } from './turn-integrity.js';
import { type Reflector } from './reflector.js';
import { type RepairAttempt, type RepairBudget } from './agents-repair.js';
export interface ToolBatchDeps {
    ctx: Ctx;
    role: AgentRole;
    phase: EngagementPhase;
    messages: ChatMessage[];
    integrity: TurnIntegrity;
    steps: StepJournal;
    reflector: Reflector;
    /** The response text (the assistant message content). */
    text: string;
    /** This response's non-empty tool calls. */
    toolCalls: ToolCallRequest[];
    repair: RepairBudget;
    attemptRepair: RepairAttempt;
    askReflection: (prompt: string) => Promise<string>;
    commanderRedirect: (ctx: Ctx, reason: string) => Promise<string>;
}
export declare function runToolBatch(deps: ToolBatchDeps): Promise<void>;
