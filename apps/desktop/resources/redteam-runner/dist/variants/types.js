/**
 * Payload-variant expansion types (v0.20.0).
 *
 * The 418 battery items are distinct attacker INTENTS. Competitors reach
 * "tens of thousands of attacks" by executing variants of each intent.
 * This module gives us honest variant depth: curated, reviewed payload
 * libraries — mechanical, never LLM-invented at runtime — each variant a
 * genuine execution through the same tools, rate limiter, denylists, and
 * proof bundles as its parent item.
 *
 * Counting honesty (the anti-AI-washing posture): reports distinguish
 * "N attack intents" from "M variant executions" — never merged into one
 * inflated number.
 */
export const VARIANT_CLASSES = [
    "sqli",
    "xss",
    "cmdi",
    "ssti",
    "xxe",
    "traversal",
    "ssrf",
    "redirect",
    "auth",
    "headers",
];
//# sourceMappingURL=types.js.map