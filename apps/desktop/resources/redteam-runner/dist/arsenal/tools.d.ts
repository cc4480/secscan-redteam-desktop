import { type ArsenalConfig } from './config.js';
/** Exec-surface tool shape (brief §2): structurally `ExecToolDef`. */
export interface ArsenalToolDef {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    run: (args: Record<string, unknown>) => Promise<string>;
}
/** The fix string every empty-index answer carries (spec §7.1). */
export declare const ARSENAL_EMPTY_FIX = "Run: redteam-runner arsenal refresh";
/**
 * Bind the config the endpoint resolved for this server (ARS-1's seam calls
 * this with `resolveArsenalServingConfig(process.env, { engagementsDir })`,
 * so the DB path follows the console's real engagements dir — brief §1.4).
 * Until bound, handlers resolve from the process env on every call.
 */
export declare function bindArsenalConfig(config: ArsenalConfig): void;
/**
 * Split caller text into literal FTS terms: NULs are mapped to U+FFFD (the
 * session-provider discipline — a NUL never reaches MATCH), whitespace is
 * normalized, and every term is double-quote-escaped and quoted so FTS
 * operators in the input (`OR`, `NEAR(`, `*`, parentheses) stay inert data.
 */
export declare function arsenalFtsTerms(raw: string): string[];
/** The search MATCH expression: every term must hit (spec §7.2, AND). */
export declare function buildArsenalFtsMatch(raw: string): string;
/** The recommend MATCH expression: any term may hit (spec §7.4, OR). */
export declare function buildArsenalFtsMatchAny(raw: string): string;
export declare const ARSENAL_TOOLS: ArsenalToolDef[];
export declare const ARSENAL_TOOLS_BY_NAME: Map<string, ArsenalToolDef>;
