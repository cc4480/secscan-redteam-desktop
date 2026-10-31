/**
 * API / auth-protocol family (AP-*) â€” the contract itself as attack surface.
 *
 * Opt-in like `webapp`: selected with --targets api. Covers GraphQL schema
 * exposure, object-level authorization, JWT/OAuth misuse and credential
 * endpoints. Read-only unless a benign canary object is created; never forge a
 * token for another principal and never brute-force a real account.
 */
import type { DraftTargetProfile } from "./types.js";
export declare const API_PROFILE: DraftTargetProfile;
