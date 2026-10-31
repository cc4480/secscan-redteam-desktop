/**
 * API / auth-protocol family (AP-*) â€” the contract itself as attack surface.
 *
 * Opt-in like `webapp`: selected with --targets api. Covers GraphQL schema
 * exposure, object-level authorization, JWT/OAuth misuse and credential
 * endpoints. Read-only unless a benign canary object is created; never forge a
 * token for another principal and never brute-force a real account.
 */
import type { DraftTargetProfile } from "./types.js";

export const API_PROFILE: DraftTargetProfile = {
  id: "api",
  name: "API and auth protocols",
  baseUrl: "https://<target>/api",
  kind: "api",
  authModel: "Bearer token / OAuth 2.0 / session cookie plus per-object authorization",
  scopeNotes:
    "Authorized test accounts only. Token forgery is limited to tokens for the tester's own account; no credential stuffing, no real-user enumeration, no write operations beyond a benign canary object the tester created.",
  battery: [
    {
      id: "AP-001", category: "functionality", name: "GraphQL introspection enabled",
      brief: "Full schema dump available anonymously or to a low-privilege caller.",
      owasp: "A01:2021", attackId: "T1592",
      what: "Send the standard introspection query to /graphql. A full __schema response publicly or to a basic user documents the hidden surface (mutations, admin fields); confirm by listing the sensitive types it exposes. Introspection off for unauthenticated callers is a pass.",
    },
    {
      id: "AP-002", category: "logic", name: "GraphQL field-level authorization",
      brief: "A field or mutation resolvable without its role check (or via aliases/batching).",
      owasp: "A01:2021", attackId: "T1190",
      what: "For an object the tester owns, request a field the UI never shows (admin notes, other-user email) and the matching mutation. Confirm only when data for another principal is returned or a role-only mutation succeeds for the tester's account; a permission error is a pass.",
    },
    {
      id: "AP-003", category: "validation", name: "JWT signature not verified / alg confusion",
      brief: "alg:none or a key-confusion token accepted â€” is the parser pinning the algorithm?",
      owasp: "A02:2021", attackId: "T1550.001",
      what: "Craft tokens for the tester's OWN account with alg:none and with an asymmetric algorithm checked against the public key as HMAC secret (key confusion). Only a token that the API accepts for the tester's own subject proves the flaw; never target another identity.",
    },
    {
      id: "AP-004", category: "validation", name: "JWT kid/jku injection",
      brief: "kid path traversal or attacker-controlled jku resolved server-side.",
      owasp: "A02:2021", attackId: "T1550.001",
      what: "Set kid to a path-traversal value (../../dev/null) and jku/x5u to a canary URL the tester controls. Confirm when the server fetches the attacker-controlled key endpoint (the canary logs the request) or accepts a token signed by it â€” for the tester's own account only.",
    },
    {
      id: "AP-005", category: "logic", name: "Mass assignment / overposting",
      brief: "Extra JSON fields (role, plan, verified, credit) are bound and persisted.",
      owasp: "A03:2021", attackId: "T1190",
      what: "Create/update the tester's own profile with extra fields (role=admin, plan=enterprise, emailVerified=true). Re-read the object: a persisted field the API never offered is the finding; a 422 or ignored field is a pass. Do not escalate beyond the tester's own account.",
    },
    {
      id: "AP-006", category: "validation", name: "OAuth redirect_uri bypass",
      brief: "Prefix/suffix/path tricks let the code go to an attacker-controlled origin.",
      owasp: "A01:2021", attackId: "T1550.001",
      what: "Try redirect_uri variants: exact-prefix (https://target.evil-canary), path traversal (/../canary), appended query (#), and sub-domain confusion. Confirm when the authorization server redirects with a code to a canary origin the tester controls; register the canary host first.",
    },
    {
      id: "AP-007", category: "logic", name: "Broken object-level authorization",
      brief: "Object ids from the tester's own scope substituted for another object â€” read or write?",
      owasp: "A01:2021", attackId: "T1078",
      what: "Swap the object id in a GET and a benign PUT from the tester's object to a second object created by the tester under a different role. Confirm only on cross-tenant/cross-owner access; identical 404s for both are inconclusive rather than a pass. Never touch objects the tester did not create.",
    },
    {
      id: "AP-008", category: "functionality", name: "Auth endpoint has no rate limit",
      brief: "Credential endpoint accepts unlimited attempts (no lockout, no backoff).",
      owasp: "A07:2021", attackId: "T1110",
      what: "Send a small fixed series of failed logins for the tester's own account and observe whether a lockout, backoff or CAPTCHA appears. Report the count that triggered it; a handful of attempts with no control is the finding. Never test against a real user's account or exceed a safe fixed batch.",
    },
  ],
};


