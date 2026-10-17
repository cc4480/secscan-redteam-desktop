/**
 * Compliance control catalog (v0.12.0) — the compliance evidence pack's
 * authority list.
 *
 * These are the real controls, as written in the standards:
 *  - PCI DSS v4.0.1 Requirement 11.4 (penetration testing) + 11.4.1–11.4.7
 *  - SOC 2 Trust Services Criteria CC6.1, CC6.6, CC7.1
 *  - ISO/IEC 27001:2022 Annex A control A.8.8
 *
 * Every control id used anywhere in the compliance module must exist here —
 * the test suite enforces that (no invented control IDs).
 *
 * Honesty note: this catalog describes what EVIDENCE each control needs. The
 * runner produces evidence supporting a requirement; it never declares a
 * client "compliant" or "certified" — that judgment belongs to the client's
 * QSA/auditor, and the attestation letter says so explicitly.
 */
export type ComplianceFramework = "PCI DSS v4.0.1" | "SOC 2" | "ISO 27001:2022";
export interface ComplianceControl {
    /** Stable id used in mappings and reports, e.g. "PCI-11.4.1". */
    id: string;
    framework: ComplianceFramework;
    /** The control's requirement, as written in the standard (paraphrased tightly). */
    title: string;
    /** What an auditor/QSA looks for as evidence. */
    evidenceNeeds: string;
}
export declare const COMPLIANCE_CONTROLS: ComplianceControl[];
export declare function lookupControl(id: string): ComplianceControl | undefined;
