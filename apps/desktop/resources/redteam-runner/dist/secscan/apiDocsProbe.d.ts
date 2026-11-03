/**
 * API documentation exposure probe.
 *
 * Checks for publicly accessible Swagger UI, OpenAPI specs, and Redoc instances.
 * Exposed API docs enumerate all endpoints, request shapes, and auth schemes —
 * giving attackers a ready-made attack surface map without any guesswork.
 */
import type { ScanVulnerability } from "./scanner.js";
import { type TargetGuardOptions } from "./targetGuard.js";
export declare function runApiDocsProbe(baseUrl: string, guard?: TargetGuardOptions): Promise<ScanVulnerability[]>;
