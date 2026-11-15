/**
 * Dispatch-time protocol gate (A1).
 *
 * The plan is law: every tool call is judged against the engagement's current
 * protocol step before it executes. Bookkeeping is never blocked (evidence
 * capture outranks a step boundary), and an unbound engagement — no protocol
 * state at all — takes the legacy path untouched, so this gate can never turn a
 * working run into a dead one.
 *
 * The ONE sanctioned exception (A6): a seat that sees a live vulnerability may
 * attack it. It passes `protocolException` with a reason; the exception is
 * recorded on the state, so it shows up in the transcript instead of being an
 * invisible improvisation.
 */
import { type ActorRole, type EngagementPhase } from '../types.js';
import { type Ctx } from '../context.js';
import { type ToolCallRequest } from '@secscan/redteam-llm-router';
import { type DispatchResult } from './types.js';
/**
 * Judge a call against the current protocol step.
 * @param ctx - the engagement context (carries the protocol state when bound).
 * @param phase - the current engagement phase, for the event record.
 * @param role - the acting seat, for the event record.
 * @param call - the tool call about to dispatch.
 * @returns a refusal result when the call is outside the step; undefined to proceed.
 */
export declare function checkProtocolGate(ctx: Ctx, phase: EngagementPhase, role: ActorRole, call: ToolCallRequest): DispatchResult | undefined;
