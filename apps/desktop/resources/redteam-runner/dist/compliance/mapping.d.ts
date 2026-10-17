/**
 * ATT&CK technique → compliance control mapping (v0.12.0).
 *
 * Every ATT&CK technique ID used across the 418-item battery maps to ≥1
 * control. The mapping goes through ATT&CK deliberately: the runner already
 * tags every finding with ATT&CK IDs, so the compliance evidence pack gets
 * its control coverage mechanically instead of by hand-waving.
 *
 * Honesty rules (enforced by tests + review):
 *  - Every `controls` id must exist in the control catalog (no invented IDs).
 *  - Every mapping carries a `rationale` a QSA could read without laughing.
 *  - If a technique genuinely maps nowhere, OMIT it and let the
 *    completeness test fail loudly — never force a mapping.
 *
 * Note on T1499: the battery uses T1499 for rate-limiter SHAPE MAPPING
 * (a handful of probes to observe limiter keying) — never for actual
 * denial of service, which the runner refuses mechanically. The mapping
 * below reflects that: validating abuse protections, not causing outages.
 */
export interface TechniqueControlMapping {
    attackId: string;
    /** Control ids — all must exist in COMPLIANCE_CONTROLS. */
    controls: string[];
    /** Why this technique is evidence for these controls. */
    rationale: string;
}
export declare const TECHNIQUE_CONTROL_MAP: TechniqueControlMapping[];
/** Control ids for one technique. Empty array = honestly unmapped (let the test fail loudly). */
export declare function controlsForTechnique(attackId: string): string[];
/** Technique ids from the battery with no control mapping — must always be []. */
export declare function unmappedBatteryTechniques(): string[];
/** Every mapped control id must exist in the catalog — returns the offenders. */
export declare function invalidMappedControlIds(): string[];
