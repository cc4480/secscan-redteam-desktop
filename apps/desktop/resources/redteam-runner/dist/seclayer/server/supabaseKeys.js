// Reading a Supabase project's address and keys out of CLIENT code, by what the tokens say rather than by
// what the code calls them.
//
// A production build (Vite, Next, webpack) renames every identifier to a letter or two, so
// `const sM="https://<ref>.supabase.co",aM="eyJ…",Tn=cO(sM,aM,{…})` has no `SUPABASE_URL`, no
// `SUPABASE_ANON_KEY` and no `createClient("literal","literal")` left for a name-based pairing to find. What survives
// minification is the token itself: a Supabase JWT carries `role` ("anon" or "service_role") and `ref` (the project
// it was issued for), and the project URL is a string literal. Those are enough to pair a URL with its public key and to
// recognise a leaked service_role key, with no variable name at all.
//
// Pure functions over text; no network.
/** The claims of a JWT, read without verifying the signature; null when the text is not one. */
export function jwtClaims(token) {
    try {
        const parts = token.split(".");
        if (parts.length < 2)
            return null;
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        return payload !== null && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
    }
    catch {
        return null;
    }
}
export function jwtRole(token) {
    const role = jwtClaims(token)?.["role"];
    return typeof role === "string" ? role : null;
}
export function isServiceRoleToken(token) {
    return jwtRole(token) === "service_role";
}
// The lookbehind keeps a match from starting inside a longer run of token characters. Without it a script that is only
// `eyJeyJeyJ…` makes every `eyJ` rescan to the end of the run, and the time grows with the square of the length.
const JWT_SHAPE = /eyJ(?<![A-Za-z0-9_-]eyJ)[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const PUBLISHABLE_SHAPE = /\bsb_publishable_[A-Za-z0-9_-]{20,}/g;
/** A project URL written as a quoted string; Supabase project references are 20 lowercase letters and digits. */
const PROJECT_URL = /["'`](https:\/\/([a-z0-9]{20})\.supabase\.co)\/?["'`]/g;
/** How far from the project URL a key can sit and still be read as that project's key. */
const KEY_DISTANCE = 1200;
const MAX_TOKENS = 60;
const MAX_PROJECTS = 3;
function tokensIn(text, shape) {
    const out = [];
    for (const m of text.matchAll(shape)) {
        out.push({ value: m[0], index: m.index ?? 0 });
        if (out.length >= MAX_TOKENS)
            break;
    }
    return out;
}
/**
 * Project names the Supabase libraries and their documentation use in examples (`https://xyzcompany.supabase.co`). A
 * production bundle has its comments stripped, but an unminified or development build keeps them, and a host named in an
 * example is never the site's backend: it must not be probed, and the key beside it is a sample.
 */
const EXAMPLE_REF = /^(?:xyzcompany|project[-_]?(?:id|ref)|my[-_]?project|your[-_]?(?:supabase[-_]?)?project(?:[-_]?(?:id|ref))?|example|ref|x{3,})$/i;
/** True for a `*.supabase.co` address whose project name is one of the documentation's. */
export function isExampleSupabaseHost(url) {
    try {
        const host = new URL(url).hostname.toLowerCase();
        const m = /^([a-z0-9-]+)\.supabase\.co$/.exec(host);
        return m !== null && EXAMPLE_REF.test(m[1]);
    }
    catch {
        return false;
    }
}
/** The first service_role JWT in the text, found by its decoded role claim, whatever it is stored under. */
export function findServiceRoleToken(text) {
    if (!text)
        return null;
    for (const t of tokensIn(text, JWT_SHAPE))
        if (isServiceRoleToken(t.value))
            return t.value;
    return null;
}
/**
 * 2 = the project's public key (an anon JWT or a publishable key), 1 = a token that says nothing about its role,
 * 0 = not usable: the service_role key or any other role, or a key issued for a different project.
 */
function keyFit(token, ref) {
    if (token.startsWith("sb_publishable_"))
        return 2;
    const claims = jwtClaims(token);
    if (!claims)
        return 1;
    const claimedRef = claims["ref"];
    if (typeof claimedRef === "string" && claimedRef.toLowerCase() !== ref)
        return 0;
    const role = claims["role"];
    if (role === "anon")
        return 2;
    return typeof role === "string" ? 0 : 1;
}
/**
 * Supabase (URL, public key) pairs in code whose variable names are gone: the URL is the quoted
 * `https://<ref>.supabase.co`, the key is the token that sits next to it (on either side), or, wherever it sits, the
 * anon token whose own `ref` claim names that project. A service_role key, a signed-in user's token and a key issued
 * for another project are never paired.
 */
export function findMinifiedSupabasePairs(text) {
    if (!text || !text.includes("supabase.co"))
        return [];
    const sites = new Map();
    for (const m of text.matchAll(PROJECT_URL)) {
        const ref = m[2];
        const site = sites.get(ref) ?? { url: m[1], indexes: [] };
        if (site.indexes.length < 24)
            site.indexes.push(m.index ?? 0);
        sites.set(ref, site);
        if (sites.size >= MAX_PROJECTS)
            break;
    }
    if (sites.size === 0)
        return [];
    const jwts = tokensIn(text, JWT_SHAPE);
    const publishable = tokensIn(text, PUBLISHABLE_SHAPE);
    const nearby = [...jwts, ...publishable];
    const pairs = [];
    for (const [ref, { url, indexes }] of sites) {
        let best = null;
        for (const at of indexes) {
            for (const t of nearby) {
                const distance = Math.abs(t.index - at);
                if (distance > KEY_DISTANCE)
                    continue;
                const fit = keyFit(t.value, ref);
                if (fit === 0)
                    continue;
                if (!best || fit > best.fit || (fit === best.fit && distance < best.distance))
                    best = { token: t.value, fit, distance };
            }
        }
        if (best) {
            pairs.push({ url, key: best.token });
            continue;
        }
        const own = jwts.find((t) => {
            const claims = jwtClaims(t.value);
            return typeof claims?.["ref"] === "string" && claims["ref"].toLowerCase() === ref && keyFit(t.value, ref) === 2;
        });
        if (own) {
            pairs.push({ url, key: own.value });
            continue;
        }
        // One project and one publishable key in the whole text can only belong to each other.
        const distinct = [...new Set(publishable.map((t) => t.value))];
        if (sites.size === 1 && distinct.length === 1)
            pairs.push({ url, key: distinct[0] });
    }
    return pairs;
}
/** Table names the app's code reads: `.from("tasks")`. Not `.storage.from("bucket")`, and not `Array.from("…")`. */
export function extractTableNames(text) {
    if (!text)
        return [];
    const names = new Set();
    const rx = /(?<!\.storage\s*|\b(?:Array|Buffer|Int8Array|Uint8Array|Uint16Array|Uint32Array|Float32Array|Float64Array)\s*)\.from\s*(?:<[^>()]*>)?\s*\(\s*["'`]([a-zA-Z_][a-zA-Z0-9_]*)["'`]\s*\)/g;
    for (const m of text.matchAll(rx)) {
        if (m[1])
            names.add(m[1]);
        if (names.size >= 12)
            break;
    }
    return [...names];
}
/** Storage bucket names the app's code opens: `supabase.storage.from("avatars")`. */
export function extractStorageBucketNames(text) {
    if (!text)
        return [];
    const names = new Set();
    for (const m of text.matchAll(/\.storage\s*\.from\s*\(\s*["'`]([A-Za-z0-9][A-Za-z0-9._-]{0,62})["'`]\s*\)/g)) {
        if (m[1])
            names.add(m[1]);
        if (names.size >= 10)
            break;
    }
    return [...names];
}
