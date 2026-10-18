/**
 * WEBAPP battery - part 6 of 7 (block 20, WA-121..WA-132).
 * Request-surface and transport gaps: HTTP method surface, NoSQL and host-header
 * injection, server-side prototype pollution, plaintext HTTP and redirect-chain
 * enforcement, rate limiting, API over-sharing, Supabase Storage and signup
 * confirmation, runtime edge-function auth, and GitHub Actions secrets/permissions.
 * Sources: SecScan probesHttp.ts, baasDepth.ts, repoCheckCi.ts, M16 apiProbeFindings;
 * Seclayer aggressive/nosql.ts, hostHeaderInjection.ts, prototypePollutionProbe.ts,
 * edgeFunctionProbe.ts. Assembled by the webapp profile; pure data, no side effects.
 */
import type { TargetBatteryItem } from "./types.js";
export declare const WEBAPP_PART_6: TargetBatteryItem[];
