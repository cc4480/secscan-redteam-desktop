/**
 * PoC bundle builder: derives a structured, re-verifiable proof bundle
 * from the audit log for one confirmed finding. Returns null (with
 * reason) when the validation bar is not met — never fabricated.
 */
import type { EngagementEvent, Finding } from "../../types.js";
import type { PocStep } from "./steps.js";
export type ValidationTier = "execution" | "observation";
export interface PocBundle {
    version: 1;
    bundleId: string;
    engagementId: string;
    findingId: string;
    batteryItemId?: string;
    attackIds: string[];
    cve?: string;
    severity: string;
    title: string;
    target: string;
    operator: string;
    generatedAt: string;
    steps: PocStep[];
    markerSent?: string;
    markerObserved?: string;
    validationTier: ValidationTier;
    /** Exactly what the bundle proves — the specific executed/observed action. */
    proves: string;
    /** What it does NOT prove — no impact overclaim, stated explicitly. */
    doesNotProve: string;
    reverifyCommand: string;
}
export interface BundleBuildInput {
    finding: Finding;
    batteryItemId?: string;
    cve?: string;
    events: EngagementEvent[];
    engagement: {
        engagementId: string;
        target: string;
        operator: string;
    };
    secrets: string[];
}
export interface BundleBuildResult {
    bundle: PocBundle | null;
    /** Why no bundle was built (honest absence). */
    reason?: string;
}
export declare function buildPocBundle(input: BundleBuildInput): BundleBuildResult;
/** A killed hypothesis with its decisive audit evidence attached (negative proof). */
