/**
 * Traversal / SSRF / open-redirect variant libraries (v0.20.0).
 *
 * Honesty rule inherited from the battery's SSRF items: these are SHAPES
 * for testing a guard's verdict (does it refuse the landing?), never live
 * internal fetches. `{{CANARY}}` = operator canary host placeholder.
 * The agent substitutes canary infrastructure it controls.
 */
import type { VariantPayload } from "./types.js";
/** Path traversal — separators, encodings, bypass shapes. Read-only targets. */
export declare const TRAVERSAL_VARIANTS: VariantPayload[];
/**
 * SSRF — guard-verdict shapes. Every "internal-looking" value below is a
 * canary-shaped probe: the question is whether the GUARD refuses it, not
 * whether a fetch succeeds. Never a real internal address.
 */
export declare const SSRF_VARIANTS: VariantPayload[];
/** Open redirect — landing-control shapes. */
export declare const REDIRECT_VARIANTS: VariantPayload[];
