/**
 * Firebase security probes for vibeStackProbes.ts.
 * Detects open Firestore collections and Realtime Database access.
 * Extracted from vibeStackProbes.ts to reduce its size.
 */

import { randomUUID } from "node:crypto";
import type { ScanVulnerability } from "./scanner";

const TIMEOUT_MS = 10_000;
const MAX_TABLES_TO_TEST = 12;

function vuln(partial: Omit<ScanVulnerability, "id">): ScanVulnerability {
  return { id: randomUUID(), ...partial };
}

interface FetchResult {
  status: number;
  body: string;
  headers: Record<string, string>;
}

async function safeFetch(
  url: string,
  options: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
): Promise<FetchResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const body = await res.text().catch(() => "");
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    return { status: res.status, body, headers };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

interface FirebaseConfig {
  apiKey: string;
  projectId: string;
  databaseURL?: string;
}

function extractFirebaseConfig(content: string): FirebaseConfig | null {
  const apiKeyPatterns = [
    /apiKey\s*:\s*["'](AIza[0-9A-Za-z\-_]{35})["']/,
    /(?:VITE_FIREBASE_API_KEY|REACT_APP_FIREBASE_API_KEY|NEXT_PUBLIC_FIREBASE_API_KEY)\s*[:=]\s*["'](AIza[0-9A-Za-z\-_]{35})["']/i,
  ];
  const projectIdPatterns = [
    /projectId\s*:\s*["']([a-z0-9][a-z0-9-]{3,28}[a-z0-9])["']/,
    /(?:VITE_FIREBASE_PROJECT_ID|REACT_APP_FIREBASE_PROJECT_ID|NEXT_PUBLIC_FIREBASE_PROJECT_ID)\s*[:=]\s*["']([a-z0-9-]+)["']/i,
  ];
  const dbUrlPattern = /databaseURL\s*:\s*["'](https?:\/\/[a-z0-9-]+\.firebaseio\.com)["']/;

  let apiKey: string | null = null;
  let projectId: string | null = null;
  let databaseURL: string | undefined;

  for (const p of apiKeyPatterns) {
    const m = p.exec(content);
    if (m?.[1]) { apiKey = m[1]; break; }
  }
  for (const p of projectIdPatterns) {
    const m = p.exec(content);
    if (m?.[1]) { projectId = m[1]; break; }
  }
  const dbMatch = dbUrlPattern.exec(content);
  if (dbMatch?.[1]) databaseURL = dbMatch[1];

  if (!apiKey || !projectId) return null;
  return { apiKey, projectId, databaseURL };
}

// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE LIVE API PROBES
// ─────────────────────────────────────────────────────────────────────────────

const COMMON_COLLECTIONS = [
  "users", "profiles", "accounts", "customers", "members",
  "posts", "messages", "chats", "orders", "products",
  "transactions", "payments", "config", "settings", "data",
  "records", "entries", "events", "logs", "tasks",
];

async function probeFirestoreCollection(
  projectId: string,
  apiKey: string,
  collection: string,
): Promise<boolean> {
  const url =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/databases/(default)/documents/${encodeURIComponent(collection)}` +
    `?key=${encodeURIComponent(apiKey)}&pageSize=1`;

  const result = await safeFetch(url, { headers: { Accept: "application/json" } }, 8_000);
  if (!result || result.status !== 200) return false;

  try {
    const body = JSON.parse(result.body) as { documents?: unknown[] };
    // Empty collection returns {} or { documents: [] } — not a finding
    return Array.isArray(body.documents) && body.documents.length > 0;
  } catch {
    return false;
  }
}

async function findOpenFirestoreCollection(
  projectId: string,
  apiKey: string,
): Promise<string | null> {
  const results = await Promise.allSettled(
    COMMON_COLLECTIONS.map(async (c) => ({ c, open: await probeFirestoreCollection(projectId, apiKey, c) })),
  );
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.open) return r.value.c;
  }
  return null;
}

async function testRealtimeDatabaseOpen(databaseURL: string): Promise<boolean> {
  // Unauthenticated fetch of root .json
  // Denied rules → 401, or { "error": "Permission denied." }
  const result = await safeFetch(
    `${databaseURL}/.json`,
    { headers: { Accept: "application/json" } },
    8_000,
  );
  if (!result || result.status === 401 || result.status === 403) return false;
  if (result.status !== 200) return false;

  try {
    const body = JSON.parse(result.body) as unknown;
    // null → rules are restrictive (null is the returned value for a denied read in some configs)
    // object with data → open
    return body !== null && typeof body === "object";
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE PROBE RUNNER
// ─────────────────────────────────────────────────────────────────────────────

export async function runFirebaseProbes(
  content: string,
  findings: ScanVulnerability[],
): Promise<void> {
  const config = extractFirebaseConfig(content);
  if (!config) return;

  const { apiKey, projectId, databaseURL } = config;

  // Run Firestore and Realtime DB checks in parallel
  const [firestoreOpen, rtdbOpen] = await Promise.all([
    findOpenFirestoreCollection(projectId, apiKey),
    databaseURL ? testRealtimeDatabaseOpen(databaseURL) : Promise.resolve(false),
  ]);

  if (firestoreOpen) {
    findings.push(vuln({
      name: "Firestore Security Rules Allow Unauthenticated Read Access",
      severity: "critical",
      category: "Broken Access Control",
      description:
        "Firestore is configured to allow unauthenticated read access. " +
        `Documents were returned from the '${firestoreOpen}' collection without ` +
        "any authentication. The Firebase config (apiKey, projectId) is always " +
        "present in client-side JavaScript by design — security rules are the " +
        "only access control layer. With open rules, anyone who finds your app " +
        "can read your database.",
      evidence:
        `Firebase project: ${projectId}\n` +
        `Open collection: ${firestoreOpen}\n` +
        `GET https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${firestoreOpen}?key=<apiKey> → HTTP 200 with documents`,
      solution:
        "Update your Firestore security rules to require authentication:\n\n" +
        "rules_version = '2';\n" +
        "service cloud.firestore {\n" +
        "  match /databases/{database}/documents {\n" +
        "    match /{document=**} {\n" +
        "      allow read, write: if request.auth != null;\n" +
        "    }\n" +
        "  }\n" +
        "}\n\n" +
        "For user-specific data:\n" +
        "  allow read: if request.auth.uid == resource.data.userId;\n\n" +
        "Test rules in the Firebase console Rules Playground before deploying.",
      cweId: "CWE-284",
      cvssScore: 9.3,
      wstgId: "WSTG-ATHZ-01",
    }));
  } else {
    findings.push(vuln({
      name: "Firebase Backend Detected — Firestore Rules Appear Restrictive",
      severity: "info",
      category: "Technology Fingerprint",
      description:
        `Firebase is in use (project: ${projectId}). The apiKey in client-side ` +
        "JavaScript is public by design — it identifies your project, not a secret. " +
        "No open Firestore collections were found in common collection name patterns. " +
        "Verify your rules cover all collections, including any not tested here.",
      evidence: `Project ID: ${projectId}\nFirestore: no open collections found in ${COMMON_COLLECTIONS.length} tested paths`,
      solution:
        "Audit rules in the Firebase console. Use the Rules Playground to test edge cases. " +
        "Enable App Check to restrict API access to your own app clients only.",
      cweId: null,
      cvssScore: 0,
    }));
  }

  if (rtdbOpen) {
    findings.push(vuln({
      name: "Firebase Realtime Database Open to Unauthenticated Access",
      severity: "critical",
      category: "Broken Access Control",
      description:
        "The Firebase Realtime Database returns data to unauthenticated requests " +
        "at the root path. The development default rules " +
        '({ ".read": true, ".write": true }) or equivalent permissive rules are ' +
        "active, exposing the entire database tree to anyone who knows the database URL " +
        "(which is always present in the Firebase config in client-side JavaScript).",
      evidence: `GET ${databaseURL}/.json → HTTP 200 with database contents`,
      solution:
        "Update Realtime Database rules to require authentication:\n\n" +
        "{\n" +
        '  "rules": {\n' +
        '    ".read": "auth != null",\n' +
        '    ".write": "auth != null"\n' +
        "  }\n" +
        "}\n\n" +
        "For per-user data:\n" +
        '  "users": { "$uid": { ".read": "auth.uid === $uid" } }',
      cweId: "CWE-284",
      cvssScore: 9.8,
      wstgId: "WSTG-ATHZ-01",
    }));
  }
}

