/**
 * Injection variant libraries (v0.20.0) Ã¢â‚¬â€ SQLi, XSS, command injection,
 * SSTI, XXE. Curated, reviewed payload lists. Every payload is a DETECTION
 * probe: read-only or benign-canary. Destructive SQL (DROP/DELETE/UPDATE/
 * INSERT/ALTER), destructive commands, and XXE billion-laughs shapes are
 * excluded by policy Ã¢â‚¬â€ they don't exist in these lists.
 */
import type { VariantPayload } from "./types.js";
/** SQL injection Ã¢â‚¬â€ tautologies, unions, time-based, stacked, encodings. */
export declare const SQLI_VARIANTS: VariantPayload[];
/** Cross-site scripting Ã¢â‚¬â€ contexts, event handlers, encoding bypasses. */
export declare const XSS_VARIANTS: VariantPayload[];
/**
 * OS command injection Ã¢â‚¬â€ benign commands only (id/echo/sleep). The agent
 * substitutes its canary marker for VARIANT where a marker echo proves
 * execution. No destructive commands exist in this list.
 */
export declare const CMDI_VARIANTS: VariantPayload[];
/** Server-side template injection Ã¢â‚¬â€ detection markers only, no sandbox escapes. */
export declare const SSTI_VARIANTS: VariantPayload[];
/**
 * XXE Ã¢â‚¬â€ detection shapes only. `{{CANARY}}` = operator canary host
 * placeholder (agent substitutes). No billion-laughs / quadratic-blowup
 * shapes Ã¢â‚¬â€ those are DoS and excluded by policy.
 */
export declare const XXE_VARIANTS: VariantPayload[];
