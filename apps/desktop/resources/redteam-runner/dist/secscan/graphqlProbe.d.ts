/**
 * GraphQL security probe.
 *
 * Checks for:
 * 1. GraphQL endpoint exposed with introspection enabled — reveals full schema.
 * 2. Batched queries allowed — enables query amplification DoS.
 * 3. Field suggestion hints leaking schema when introspection is disabled.
 *
 * Only sends POST requests with a well-known introspection query — non-destructive.
 */
import type { ScanVulnerability } from "./scanner.js";
import { type TargetGuardOptions } from "./targetGuard.js";
export declare function runGraphqlProbe(baseUrl: string, guard?: TargetGuardOptions): Promise<ScanVulnerability[]>;
