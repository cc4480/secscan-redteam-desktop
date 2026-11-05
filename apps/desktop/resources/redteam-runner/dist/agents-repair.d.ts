/**
 * Tool-call repair (RC Item 6) — the bounded repair exchange for one
 * malformed tool call.
 *
 * Extracted from agents.ts in a structural split (no file under src/ may
 * exceed 300 lines). The body is the original closure, moved verbatim: one
 * side-channel completion sees the call and its result, the model answers
 * with one corrected call, and the corrected call re-runs through
 * dispatchTool — every gate — with the corrected result becoming the
 * effective result. The only edits are that the per-loop counters
 * (spent / cap / closed) now travel in the budget object and are read
 * through it; every decision, event string and prompt is unchanged.
 */
import { type AgentRole, type ChatMessage, type ChatResult, type JsonSchemaTool, type ToolCallRequest } from '@secscan/redteam-llm-router';
import { type Ctx } from './context.js';
import { type EngagementPhase } from './types.js';
import { type StepJournal } from './harness2/steps.js';
import { type DispatchResult } from './dispatch/types.js';
/** One repair exchange: called with the refused call and its result. */
export type RepairAttempt = (call: ToolCallRequest, d: DispatchResult) => Promise<DispatchResult>;
/** The per-invocation repair budget and its live state. */
export interface RepairBudget {
    /** The most repair exchanges this loop invocation may spend. */
    readonly cap: number;
    /** Exchanges spent so far. */
    spent: number;
    /** Set when the model answered a repair prompt with no tool call. */
    closed: boolean;
}
export interface RepairDeps {
    ctx: Ctx;
    role: AgentRole;
    phase: EngagementPhase;
    system: string;
    tools: JsonSchemaTool[];
    complete: (role: AgentRole, messages: ChatMessage[], opts?: {
        tools: JsonSchemaTool[];
    }) => Promise<ChatResult>;
    steps: StepJournal;
    budget: RepairBudget;
}
export declare function createRepairExchange(deps: RepairDeps): RepairAttempt;
