/**
 * promptCtx — the prompt-assembly input every role's system prompt is
 * built from.
 *
 * Extracted verbatim from agents.ts in a structural split (no file under
 * src/ may exceed 300 lines). Pure: it reads the context (mode, objective,
 * target, scope, ROE, battery, memory start pack, stamped verification
 * record) and shapes the PromptContext; it holds no state and calls no
 * target. agents.ts re-exports the name, so importers are unaffected.
 */
import { type Ctx } from './context.js';
import { type PromptContext } from './prompts.js';
export declare function promptCtx(ctx: Ctx): PromptContext;
