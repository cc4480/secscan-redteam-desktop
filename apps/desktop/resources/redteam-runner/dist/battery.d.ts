/**
 * The systematic attack battery — what "ruthless" means, concretely.
 *
 * Every engagement's exploiter must form hypotheses spanning ALL THREE
 * categories before the battery is considered complete:
 *
 *  1. LOGIC FLAWS (business-logic abuse) — the app used against its own rules.
 *  2. FUNCTIONALITY ABUSE — every exposed feature exercised adversarially.
 *  3. ACCURACY / VALIDATION RIGOR — the input layer tested for strictness.
 *
 * Each item carries its OWASP reference (WSTG / API Top 10) and an ATT&CK
 * technique ID where one honestly fits; business-logic abuse mostly maps to
 * T1190 (Exploit Public-Facing Application) as the ATT&CK bucket, with the
 * specific flaw class named per-event. Where no ATT&CK technique fits, the
 * OWASP reference stands alone — the mapping is advisory, never forced.
 *
 * Black-team mode runs the SAME battery, stealth-weighted: low-noise variants
 * first (see blackNote), immediate backoff on any detection signal.
 *
 * Non-destructive always: race conditions are single paired requests, never
 * floods; file uploads carry benign canary content only; no state is left
 * mutated beyond what the app's own normal flows would do.
 */
export type BatteryCategory = "logic" | "functionality" | "validation";
export declare const BATTERY_CATEGORIES: BatteryCategory[];
export declare const CATEGORY_LABELS: Record<BatteryCategory, string>;
export interface BatteryItem {
    id: string;
    category: BatteryCategory;
    name: string;
    owasp: string;
    /** ATT&CK technique ID where one honestly fits; otherwise undefined. */
    attackId?: string;
    /** What to test, concretely. */
    what: string;
    /** Stealth-weighted variant for black-team mode. */
    blackNote?: string;
}
export declare const BATTERY: BatteryItem[];
export declare function lookupBatteryItem(id: string): BatteryItem | undefined;
export declare function batteryItemsFor(category: BatteryCategory): BatteryItem[];
/** Compact checklist text for the exploiter prompt. */
export declare function batteryChecklistText(mode: "red" | "black"): string;
