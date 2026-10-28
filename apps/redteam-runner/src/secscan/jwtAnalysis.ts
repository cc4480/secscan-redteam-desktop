/**
 * JWT (JSON Web Token) analysis — passive, no extra HTTP requests.
 *
 * Extracts JWTs from response headers and HTML/JavaScript content,
 * then analyses their structure for:
 *   - alg:none (signature bypass)
 *   - Missing / far-future expiry
 *   - Sensitive data stored in the (readable) payload
 *   - Empty signature segment despite a non-none algorithm
 *   - HS256 without expiry (brute-force risk)
 */

import { randomUUID } from "node:crypto";
import type { ScanVulnerability } from "./scanner";

function vuln(partial: Omit<ScanVulnerability, "id">): ScanVulnerability {
  return { id: randomUUID(), ...partial };
}

// ─── JWT Extraction ───────────────────────────────────────────────────────────

const JWT_PATTERN = /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]*/g;

function extractJwts(sources: string[]): string[] {
  const seen = new Set<string>();
  for (const src of sources) {
    const rx = new RegExp(JWT_PATTERN.source, "g");
    let m: RegExpExecArray | null;
    while ((m = rx.exec(src)) !== null) seen.add(m[0]);
  }
  return [...seen];
}

// ─── JWT Decode ───────────────────────────────────────────────────────────────

interface JwtHeader {
  alg?: string;
  typ?: string;
  [k: string]: unknown;
}

interface JwtPayload {
  exp?: number;
  iat?: number;
  sub?: string;
  iss?: string;
  [k: string]: unknown;
}

function b64Decode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, "=");
  try {
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function decodeJwt(token: string): {
  header: JwtHeader;
  payload: JwtPayload;
  hasSignature: boolean;
} | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64Decode(parts[0]!)) as JwtHeader;
    const payload = JSON.parse(b64Decode(parts[1]!)) as JwtPayload;
    const hasSignature = (parts[2]?.length ?? 0) > 0;
    return { header, payload, hasSignature };
  } catch {
    return null;
  }
}

// ─── Sensitive payload key names ──────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  "password", "passwd", "pwd", "secret", "api_key", "apikey",
  "access_token", "refresh_token", "credit_card", "ssn", "dob",
  "private_key", "token", "auth_token",
]);

// ─── Main export ──────────────────────────────────────────────────────────────

export async function analyzeJwts(
  headers: Record<string, string>,
  html: string,
): Promise<ScanVulnerability[]> {
  const sources: string[] = [html, ...Object.values(headers)];
  const tokens = extractJwts(sources);
  if (tokens.length === 0) return [];

  const vulns: ScanVulnerability[] = [];
  const reported = new Set<string>();

  function report(key: string, v: ScanVulnerability) {
    if (reported.has(key)) return;
    reported.add(key);
    vulns.push(v);
  }

  for (const token of tokens.slice(0, 10)) {
    const decoded = decodeJwt(token);
    if (!decoded) continue;

    const { header, payload, hasSignature } = decoded;
    const alg = (header.alg ?? "").toLowerCase();
    const short = `${token.slice(0, 20)}…${token.slice(-8)}`;

    // 1. alg:none — signature completely bypassed
    if (alg === "none" || alg === "") {
      report("alg-none", vuln({
        name: "JWT Using alg:none — Signature Verification Bypass",
        severity: "critical",
        category: "Session Management",
        description:
          "A JWT was found using algorithm 'none', meaning no cryptographic signature is required. Any server that trusts the token's own 'alg' claim will accept a forged token with an arbitrary payload. This completely breaks authentication.",
        evidence: `Token (truncated): ${short}\nHeader: ${JSON.stringify(header)}\nalg:none means the signature is not verified`,
        solution:
          "Never use alg:none in production. Enforce a specific algorithm server-side and reject any token whose 'alg' header does not match. Use a library that rejects 'none' by default (e.g. jsonwebtoken with algorithms: ['RS256']).",
        cweId: "CWE-347",
        cvssScore: 9.8,
        wstgId: "WSTG-SESS-10",
      }));
    }

    // 2. Empty signature segment despite a real algorithm
    if (!hasSignature && alg !== "none") {
      report("empty-sig", vuln({
        name: "JWT Has Empty Signature — Possible Verification Bypass",
        severity: "critical",
        category: "Session Management",
        description:
          "A JWT was found with an empty signature segment while the header declares a non-none algorithm. If the server accepts this token, it is not verifying signatures at all — an attacker can forge any payload.",
        evidence: `Token (truncated): ${short}\nalg: ${header.alg}\nSignature segment: (empty string)`,
        solution:
          "Verify your JWT library rejects tokens with empty signatures. Audit all endpoints that accept tokens for consistent signature verification.",
        cweId: "CWE-347",
        cvssScore: 9.8,
        wstgId: "WSTG-SESS-10",
      }));
    }

    // 3. Missing expiry
    if (payload.exp === undefined) {
      report("no-exp", vuln({
        name: "JWT Token Has No Expiry (exp Claim Missing)",
        severity: "high",
        category: "Session Management",
        description:
          "A JWT in this application has no 'exp' (expiration) claim. Tokens without expiry are valid indefinitely — if stolen, an attacker can use them forever with no way to invalidate them short of rotating the signing secret, which logs out all users.",
        evidence: `Token (truncated): ${short}\nPayload claims: ${Object.keys(payload).join(", ") || "(none)"}\n(exp claim absent — token never expires)`,
        solution:
          "Always include 'exp'. Access tokens: 15 min–1 hour. Refresh tokens: 7–30 days. Implement token rotation and a revocation store for high-value sessions.",
        cweId: "CWE-613",
        cvssScore: 7.5,
        wstgId: "WSTG-SESS-10",
      }));
    }

    // 4. Extremely long-lived token
    if (
      payload.exp !== undefined &&
      payload.iat !== undefined &&
      payload.exp - payload.iat > 365 * 24 * 3600
    ) {
      const days = Math.round((payload.exp - payload.iat) / 86400);
      report("long-lived", vuln({
        name: `JWT Token Lifetime Is ${days} Days — Excessive`,
        severity: "medium",
        category: "Session Management",
        description: `A JWT was found with a lifetime of ${days} days. Stolen long-lived tokens give attackers an extended exploitation window. They also prevent effective session revocation after a breach.`,
        evidence: `Token (truncated): ${short}\niat: ${payload.iat}, exp: ${payload.exp}\nLifetime: ${days} days (recommended max: 1 day for access tokens)`,
        solution:
          "Reduce token lifetime. Use short-lived access tokens (15 min–1 hour) paired with refresh tokens. Implement silent token rotation on each refresh.",
        cweId: "CWE-613",
        cvssScore: 5.3,
        wstgId: "WSTG-SESS-10",
      }));
    }

    // 5. HS256 without expiry (offline brute-force + infinite lifetime)
    if (alg === "hs256" && payload.exp === undefined) {
      report("hs256-no-exp", vuln({
        name: "JWT Uses HS256 Without Expiry — Offline Brute-Force Risk",
        severity: "high",
        category: "Session Management",
        description:
          "A JWT signed with HS256 (HMAC-SHA256) has no expiry. HS256 tokens are vulnerable to offline brute-force attacks if the secret is weak or leaked. Without expiry, a cracked token grants indefinite access.",
        evidence: `Token (truncated): ${short}\nalg: HS256\nexp: (absent — token is permanent)`,
        solution:
          "Prefer RS256 or ES256 (asymmetric algorithms — the private key cannot be brute-forced from the token alone). If staying with HS256, use a cryptographically random secret of at least 256 bits and always set 'exp'.",
        cweId: "CWE-327",
        cvssScore: 7.5,
        wstgId: "WSTG-SESS-10",
      }));
    }

    // 6. Sensitive data in payload (JWT is base64, not encrypted — anyone can read it)
    const sensitiveFound = Object.keys(payload).filter((k) =>
      SENSITIVE_KEYS.has(k.toLowerCase()),
    );
    if (sensitiveFound.length > 0) {
      report("sensitive-payload", vuln({
        name: "Sensitive Data Stored in JWT Payload",
        severity: "medium",
        category: "Session Management",
        description: `The JWT payload contains sensitive-looking fields: ${sensitiveFound.join(", ")}. JWT payloads are Base64-encoded — not encrypted — so anyone who intercepts or logs the token can read these values in plain text.`,
        evidence: `Token (truncated): ${short}\nSensitive keys found in payload: ${sensitiveFound.join(", ")}\n(JWT payload is base64-encoded, not encrypted)`,
        solution:
          "Store only opaque identifiers (user ID, session ID) in JWT payloads. If sensitive claims are required, use JWE (JSON Web Encryption) to encrypt the payload.",
        cweId: "CWE-312",
        cvssScore: 5.3,
        wstgId: "WSTG-SESS-10",
      }));
    }
  }

  return vulns;
}
