/**
 * AI / LLM application family (AI-*) â€” the assistant itself as attack surface.
 *
 * Opt-in like `webapp`: selected with --targets ai. This is the family most
 * products lack and the one this product must hold itself to: prompt injection,
 * tool-call hijacking, policy leakage, retrieval poisoning, output-rendering
 * injection and cross-agent trust. Read-only unless a benign canary document is
 * planted with the operator's approval; never exfiltrate real user data.
 */
import type { DraftTargetProfile } from "./types.js";
export declare const AI_PROFILE: DraftTargetProfile;
