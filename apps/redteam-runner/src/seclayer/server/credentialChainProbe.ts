// Cross-origin credential-chaining probe (T3-AnonKey-Abuse-001-shaped): a
// BaaS client key (e.g. a Supabase anon key) is meant to be public — it
// ships in every client bundle by design — but it directly unlocks any
// table/resource that was never explicitly restricted at the BACKEND. This
// is only provable by taking the key discovered on the SCANNED origin and
// testing it against the SEPARATE origin the same served content told us
// it's for (a `<PREFIX>_URL` sitting next to a `<PREFIX>_..._KEY`) — unlike
// every other probe in this codebase, which only ever calls back to the one
// target URL the scan was pointed at.
//
// Bounded and read-only: at most a few requests, all GETs, no guessing of
// unrelated third-party hosts — the target origin is one the scanned
// application's OWN content named, not a guess. Reuses safeFetch's existing
// SSRF allow/deny logic unchanged, so a malicious/attacker-planted URL in the
// page still can't steer requests at internal infrastructure.
import { safeFetch } from "./ssrf.js";
import { SCANNER_USER_AGENT } from "./config.js";
import { renderRawRequest, windowAround } from "./evidence.js";
import { findMinifiedSupabasePairs, isExampleSupabaseHost, jwtRole } from "./supabaseKeys.js";
import { classifyExposure, rowColumns } from "./exposureClass.js";
import type { ExploitEvidence } from "../src/types.js";

export interface UrlKeyPair {
  prefix: string;
  url: string;
  key: string;
}

// Capture the whole NAME sitting before _URL / _KEY, then normalizeName() strips
// any framework prefix so the pairing core is what's left. This makes
// NEXT_PUBLIC_SUPABASE_URL, VITE_SUPABASE_URL and a bare SUPABASE_URL all pair
// on the same "SUPABASE" core — a real Supabase app almost never writes the bare
// form. The name is captured reluctantly up to a known suffix, so
// VITE_SUPABASE_ANON_KEY yields NAME "VITE_SUPABASE" (→ "SUPABASE"), not "ANON".
// PUBLISHABLE_KEY is Supabase's newer name for the anon key.
const URL_DECL_RE = /\b([A-Z0-9_]+?)_URL\s*[=:]\s*["']?(https?:\/\/[^"'\s,}]+)["']?/g;
const KEY_DECL_RE = /\b([A-Z0-9_]+?)_(?:ANON_KEY|API_KEY|PUBLISHABLE_KEY|KEY)\s*[=:]\s*["']?([A-Za-z0-9_\-.]{20,})["']?/g;

// Build-tool prefixes that expose an env var to the client bundle. Stripped so
// the pairing core is the service name the developer chose, not the framework's.
const FRAMEWORK_PREFIXES = [
  "NEXT_PUBLIC", "VITE", "REACT_APP", "EXPO_PUBLIC", "GATSBY",
  "NUXT_PUBLIC", "VUE_APP", "PUBLIC", "NG",
];

// Strip a leading framework prefix so VITE_SUPABASE -> SUPABASE, leaving the
// developer-chosen service name (which may itself be multi-segment) to pair on.
function normalizeName(name: string): string {
  for (const p of FRAMEWORK_PREFIXES) {
    if (name.startsWith(p + "_") && name.length > p.length + 1) return name.slice(p.length + 1);
  }
  return name;
}

// The Supabase/PostgREST/GoTrue SDK's positional init — createClient(url, key)
// — pairs a URL and a key with NO shared variable name at all, so the
// name-prefix passes above never see it. Their being the first two arguments of
// the SAME createClient call is itself the pairing signal (stronger, if
// anything, than a shared prefix), so it carries the same false-positive bar.
const CREATE_CLIENT_RE =
  /createClient\s*(?:<[^>]*>)?\s*\(\s*["'](https?:\/\/[^"']+)["']\s*,\s*["']([A-Za-z0-9_\-.]{20,})["']/g;

// Name a synthetic prefix for a pair discovered positionally (no variable name
// to borrow). A *.supabase.co host is unmistakable and worth surfacing by name;
// anything else is a generic BaaS.
function prefixForUrl(url: string): string {
  try {
    return /(^|\.)supabase\.co$/i.test(new URL(url).hostname) ? "SUPABASE" : "BAAS";
  } catch {
    return "BAAS";
  }
}

// Pulls (URL, key) pairs out of served content by three means, in order:
//   1. Same-token env-var declarations — `SUPABASE_URL` next to
//      `SUPABASE_ANON_KEY`, or their `VITE_`/`NEXT_PUBLIC_`-prefixed forms.
//   2. The positional `createClient(url, key)` SDK call.
//   3. A Supabase project URL and the token next to it in MINIFIED code, where every variable name is gone
//      (`const a="https://<ref>.supabase.co",b="eyJ…"`): paired by distance and by the project reference the
//      key's own claims carry (see supabaseKeys.ts).
// The shared token (1), shared call site (2) or the key's own project claim (3) is what proves the two belong
// together, rather than pairing an arbitrary URL with an arbitrary key found
// anywhere on the page. Deduped by (url,key) and bounded to 3 pairs.
export function extractUrlKeyPairs(bodyText: string): UrlKeyPair[] {
  if (!bodyText) return [];
  const seen = new Set<string>();
  const out: UrlKeyPair[] = [];
  const push = (prefix: string, rawUrl: string, key: string) => {
    // A key that decodes to a role other than "anon" (service_role, a signed-in user's token) is never sent as the
    // public key: it would read everything, and it is not ours to use. Tokens that are not JWTs pass through.
    const role = jwtRole(key);
    if (role !== null && role !== "anon") return;
    // Nor is a project named in the Supabase documentation's examples (xyzcompany, project-id...) the app's backend.
    if (isExampleSupabaseHost(rawUrl)) return;
    const url = rawUrl.replace(/\/+$/, "");
    const dedupeKey = `${url}|${key}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    out.push({ prefix, url, key });
  };

  // 1. Same-core env-var pairs (framework prefix stripped before pairing).
  const urls = new Map<string, string>();
  let m: RegExpExecArray | null;
  URL_DECL_RE.lastIndex = 0;
  while ((m = URL_DECL_RE.exec(bodyText)) !== null) {
    const core = normalizeName(m[1]);
    if (!urls.has(core)) urls.set(core, m[2]);
  }
  KEY_DECL_RE.lastIndex = 0;
  while ((m = KEY_DECL_RE.exec(bodyText)) !== null && out.length < 3) {
    const core = normalizeName(m[1]);
    const url = urls.get(core);
    if (url) push(core, url, m[2]);
  }

  // 2. Positional createClient(url, key).
  CREATE_CLIENT_RE.lastIndex = 0;
  while ((m = CREATE_CLIENT_RE.exec(bodyText)) !== null && out.length < 3) {
    push(prefixForUrl(m[1]), m[1], m[2]);
  }

  // 3. Minified code: the names are gone, the tokens are not.
  if (out.length < 3) {
    for (const p of findMinifiedSupabasePairs(bodyText)) {
      if (out.length >= 3) break;
      push("SUPABASE", p.url, p.key);
    }
  }

  return out.slice(0, 3);
}

async function timedGet(url: string, headers: Record<string, string>): Promise<{ res: Response; text: string } | null> {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), 5000);
  try {
    const res = await safeFetch(url, { headers, signal: ctl.signal });
    return { res, text: await res.text().catch(() => "") };
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

// A small, targeted guess list for the second step (table names), used only
// when the PostgREST root doesn't hand back an enumerable schema — same
// "targeted guess list, not a directory brute-force" discipline as
// EXPOSED_USER_OBJECT_PATHS in apiProbes.ts.
const COMMON_TABLE_GUESSES = ["config", "admin_config", "settings", "app_config", "users", "profiles"];

export async function probeCredentialUrlPairs(
  pairs: UrlKeyPair[],
  // Table names the app's own code reads (`.from("tasks")`), tried before the guess list. A production bundle
  // keeps them, and they are what the app actually uses, unlike the six names below.
  appTables: string[] = [],
): Promise<any | null> {
  // The first readable table that nothing marks as sensitive or public. Reported as information if no table turns
  // out to be sensitive; a table that is public by design is not reported at all.
  let unclassified: { pair: UrlKeyPair; table: string; tableUrl: string; text: string; rows: unknown[] } | null = null;
  for (const pair of pairs) {
    const headers = { apikey: pair.key, Authorization: `Bearer ${pair.key}`, "User-Agent": SCANNER_USER_AGENT };

    // Step 1: PostgREST's own root lists every table exposed to this key's
    // role when schema introspection is on (the common case) — real
    // discovery, not a guess, when it works.
    const root = await timedGet(`${pair.url}/rest/v1/`, headers);
    const tableNames: string[] = [];
    if (root && root.res.status === 200) {
      try {
        const spec = JSON.parse(root.text);
        for (const path of Object.keys(spec?.paths || {})) {
          const name = path.replace(/^\//, "");
          if (name && !name.includes("/") && !name.includes("rpc")) tableNames.push(name);
        }
      } catch {
        /* not an OpenAPI doc — fall through to guesses */
      }
    }
    const candidates = [...new Set([...appTables, ...(tableNames.length ? tableNames.slice(0, 5) : COMMON_TABLE_GUESSES)])].slice(0, 12);

    for (const table of candidates) {
      const tableUrl = `${pair.url}/rest/v1/${table}?select=*&limit=5`;
      const attack = await timedGet(tableUrl, headers);
      if (!attack || attack.res.status !== 200) continue;
      let rows: unknown;
      try {
        rows = JSON.parse(attack.text);
      } catch {
        continue;
      }
      if (!Array.isArray(rows) || rows.length === 0) continue; // 200 + empty isn't proof of anything readable

      // Rows came back. Whether that is a flaw depends on what they are (exposureClass.ts): a table of announcements
      // or products is meant to be read by every visitor, and calling it CRITICAL buries the findings that matter.
      const exposure = classifyExposure(table, rows);
      if (exposure === "public") continue;
      if (exposure === "unclassified") {
        if (!unclassified) unclassified = { pair, table, tableUrl, text: attack.text, rows };
        continue;
      }

      const proof = attack.text.slice(0, 300);
      const attackResponse = `HTTP/1.1 ${attack.res.status} ${attack.res.statusText}\n\n` + windowAround(attack.text, 0, proof.length, 1200);

      const evidence: ExploitEvidence = {
        method: "oracle",
        attack: {
          request: renderRawRequest("GET", tableUrl, { apikey: `${pair.key.slice(0, 12)}…` }),
          response: attackResponse,
        },
        signal: {
          quote: proof,
          offsetInResponse: attackResponse.indexOf(proof),
          why: `The client-side key found in this page's own JavaScript (window.${pair.prefix}_...) was accepted directly by ${pair.url}, a SEPARATE origin, and returned ${rows.length} real row(s) from table "${table}" with no application-level authorization at all.`,
        },
        demonstration: `We extracted the "${pair.prefix}_URL" and "${pair.prefix}_..._KEY" pair from this page's own client-side JavaScript, then called ${pair.url}'s REST API directly with that key — bypassing this application's own backend entirely — and it returned real data from "${table}".`,
        reproduction: `curl -s "${tableUrl}" -H "apikey: ${pair.key}"`,
        capturedAt: new Date().toISOString(),
      };

      return {
        testName: `Client-Side Key Grants Unrestricted Backend Access (${pair.prefix})`,
        payload: `${pair.url}/rest/v1/${table} with the client-exposed ${pair.prefix} key`,
        severity: "critical",
        description: `A client-side API key (window.${pair.prefix}_...) — intentionally public by design, since it ships in every client bundle — directly reads table "${table}" at ${pair.url} with no additional authorization. The backing service (e.g. a BaaS/RLS-style table) was never restricted to actually require an authenticated, authorized caller; the public key alone is sufficient.`,
        fix: "Restrict this table/resource so the public/anon client key alone is never sufficient to read it — require row-level security scoped to an authenticated caller's own identity, or move this data behind an authenticated backend endpoint that doesn't expose the client key's full access.",
        evidence,
      };
    }
  }

  if (unclassified) {
    const { pair, table, tableUrl, text, rows } = unclassified;
    const proof = text.slice(0, 300);
    const response = `HTTP/1.1 200 OK\n\n` + windowAround(text, 0, proof.length, 1200);
    return {
      testName: `Backend Table Readable With the Client-Side Key, Not Classified (${pair.prefix})`,
      payload: `${pair.url}/rest/v1/${table} with the client-exposed ${pair.prefix} key`,
      severity: "info",
      description: `The client-side ${pair.prefix} key reads table "${table}" at ${pair.url}, and returned ${rows.length} row(s) (columns: ${rowColumns(rows)}). The table's name and the sampled rows do not mark it as personal, secret or per-user data (no email, token, password or owner column such as user_id), so this is not reported as a flaw, and nothing marks it as public catalogue content either. A table of announcements or a changelog looks exactly like this, and so does one that should have been locked.`,
      fix: "Confirm the table is meant to be readable by every visitor and holds no draft, hidden or per-user rows. If not, enable row-level security and add a policy scoped to the caller's own identity or to published rows.",
      evidence: {
        method: "oracle",
        attack: { request: renderRawRequest("GET", tableUrl, { apikey: `${pair.key.slice(0, 12)}…` }), response },
        signal: {
          quote: proof,
          offsetInResponse: response.indexOf(proof),
          why: `The key is public by design and the table answered it with rows; whether that is intended depends on what the table holds, which a black-box scan cannot tell.`,
        },
        demonstration: `We called ${pair.url}'s REST API for "${table}" with the key from this page's own JavaScript and received rows.`,
        reproduction: `curl -s "${tableUrl}" -H "apikey: ${pair.key}"`,
        capturedAt: new Date().toISOString(),
      },
    };
  }
  return null;
}
