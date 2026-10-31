/**
 * Minimal safe markdown → HTML renderer (v0.22.0).
 *
 * Report content comes from our own runner, but findings can embed
 * target-derived text — so ALL raw HTML is escaped first and only a safe
 * subset of markdown constructs is rendered. Links are restricted to
 * http(s); everything else renders as plain text.
 */
/** Render markdown to sanitized HTML. Never throws — falls back to <pre>. */
export declare function renderMarkdown(md: string): string;
