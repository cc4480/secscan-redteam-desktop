/**
 * Template→battery mapping for dedupe (v0.21.0).
 *
 * A finding confirmed by BOTH a battery item and a Nuclei template is ONE
 * finding with two evidence sources — never two findings. This module maps
 * Nuclei template metadata (CVE, tags, template id) to battery item ids so
 * the reporter agent records overlaps honestly.
 *
 * Templates with no battery overlap become runtime instances under the
 * methodology items WS-108 (Windows) / LX-110 (Linux) — the same pattern
 * the Metasploit bridge uses (WS-105…107 → per-CVE instances).
 */
import type { NucleiFinding } from "./runner.js";
/** Methodology items that own template-only runtime instances. */
export declare const NUCLEI_METHODOLOGY_ITEMS: {
    readonly windows: "WS-108";
    readonly linux: "LX-110";
};
export interface TemplateOverlap {
    /** Battery item ids this template finding overlaps (dedupe: record once). */
    batteryItems: string[];
    /** True when the template has no battery overlap → runtime instance. */
    templateOnly: boolean;
    /** Suggested methodology item for template-only instances. */
    methodologyItem?: string;
}
/**
 * Map a Nuclei finding to overlapping battery items. CVE match is the
 * strongest signal; tag hints are secondary. Unknown → templateOnly.
 */
export declare function mapTemplateToBattery(finding: NucleiFinding, targetProfile: "windows" | "linux", knownCves?: Set<string>): TemplateOverlap;
/** One-line overlap hint for the agent result string. */
export declare function overlapHint(overlap: TemplateOverlap): string;
