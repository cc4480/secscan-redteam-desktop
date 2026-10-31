/**
 * Attestation letter template (v0.12.0) — the one-page letter a client
 * hands to their auditors alongside the evidence pack.
 *
 * HONESTY IS MECHANICAL HERE, not just a prompt instruction:
 *  - The letter states WHAT was tested, WHEN, the SCOPE, the METHODOLOGY,
 *    the EXCLUSIONS, and the VALIDATION STANDARD.
 *  - It NEVER claims the client is "compliant", "certified", or "passing".
 *  - It NEVER claims WE (the testing organization / tool vendor) hold
 *    SOC 2, ISO 27001, or any other certification.
 *  - The test suite asserts the absence of certification/compliance claims.
 *
 * Rendered to attestation.md next to report.md in the engagement directory.
 * The operator's name and the issuing organization are fill-ins — the
 * letter is a template until a human signs it.
 */
import type { AutonomyTier } from "../accountability/index.js";
export interface AttestationInput {
    engagementId: string;
    client?: string;
    /** Named human operator accountable for the engagement. */
    operator?: string;
    /** Autonomy tier the operator approved (v0.17.0). */
    tier?: AutonomyTier;
    /** Issuing organization (the pentest provider). Defaults to a fill-in. */
    issuedBy?: string;
    target: string;
    mode: "red" | "black";
    objective: string;
    scope: string[];
    testStart: string;
    testEnd: string;
    findingCounts: {
        critical: number;
        high: number;
        medium: number;
        low: number;
        info: number;
    };
    exclusions: string[];
    issuedAt?: string;
}
export declare function renderAttestationLetter(input: AttestationInput): string;
