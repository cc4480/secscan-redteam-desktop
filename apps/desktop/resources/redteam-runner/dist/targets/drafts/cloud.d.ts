/**
 * Cloud family (CL-*) â€” cloud control-plane and data-plane flaws.
 *
 * Opt-in like `webapp`: selected with --targets cloud. The surface is the
 * customer's cloud account as seen from the application: storage policies, the
 * instance metadata service, IAM on the workload identity, logging, snapshots
 * and serverless configuration. Read-only checks unless a benign canary write is
 * explicitly authorized, and never against another tenant's resources.
 */
import type { DraftTargetProfile } from "./types.js";
export declare const CLOUD_PROFILE: DraftTargetProfile;
