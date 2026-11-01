/**
 * Firebase security probes for vibeStackProbes.ts.
 * Detects open Firestore collections and Realtime Database access.
 * Extracted from vibeStackProbes.ts to reduce its size.
 */
import type { ScanVulnerability } from "./scanner.js";
export declare function runFirebaseProbes(content: string, findings: ScanVulnerability[]): Promise<void>;
