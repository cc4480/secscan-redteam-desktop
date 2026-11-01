/**
 * Supabase security probes for vibeStackProbes.ts.
 * Detects exposed Supabase backends, missing RLS policies, and service_role key exposure.
 * Extracted from vibeStackProbes.ts to reduce its size.
 */
import type { ScanVulnerability } from "./scanner.js";
export declare function runSupabaseProbes(content: string, tier: string, findings: ScanVulnerability[]): Promise<void>;
