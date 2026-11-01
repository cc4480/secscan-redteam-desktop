/**
 * BaaS open-data probes for PocketBase and Appwrite.
 *
 * Supabase and Firebase are handled by vibeStackProbes.ts (deeper coverage).
 * This module covers the other two common vibe-coding BaaS platforms.
 *
 * PocketBase — self-hosted Go backend popular with Lovable/Bolt/v0 projects.
 *   Checks: admin UI exposure, unauthenticated collections list, public rules.
 *
 * Appwrite — self-hosted BaaS with React SDK support.
 *   Checks: console exposure, unauthenticated project enumeration.
 */
import type { ScanVulnerability } from "./scanner.js";
export declare function runBaasProbes(baseUrl: string, html: string): Promise<ScanVulnerability[]>;
