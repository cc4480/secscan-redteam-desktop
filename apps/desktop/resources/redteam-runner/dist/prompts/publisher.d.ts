import type { PromptContext } from './shared.js';
/**
 * The publisher seat — the SCRIBE (Carlos's order, 2026-11-01): the
 * dedicated report-writing seat. Report authorship lives here, not with
 * the Architect: the Scribe writes the client report document, authors
 * the HTML presenting artifact itself, reviews its own finished set, and
 * signs it — or rejects it and rewrites. Its completion routing is the
 * report-phase model (the llm-router's reporter route); the fleet seat
 * assembled here is what makes the seat the Scribe.
 *
 * @param ctx - the prompt context for the engagement
 * @returns the assembled publisher system prompt
 */
export declare function publisherPrompt(ctx: PromptContext): string;
