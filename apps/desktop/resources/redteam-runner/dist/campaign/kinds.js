/**
 * Campaign kind registry (Q-CAMPAIGN, scoping N3).
 *
 * Doctrine-as-data: a CampaignKind carries everything about a campaign
 * doctrine that is NOT the engine — the prompts, the fallback vector
 * roster, the interlock reference, and the launch defaults. Adding a
 * kind is adding a data entry here; the state machine, planner, and
 * executor never branch on a kind name.
 *
 * Field set (scoping D-5): the donor's CampaignKind minus `command`
 * (there is no slash-command surface in this chat-first product; kinds
 * are selected by name at campaign creation), plus `interlockRef` (the
 * Q-LOCKOUT seam the kind names — the campaign layer declares the hook
 * point, Q-LOCKOUT owns the payload) and `defaults` (the launch
 * defaults the executor needs: mode, caps, battery posture).
 *
 * v1 ships ONE kind (Decision C-5): `web-hunt`, the web-application
 * hunt doctrine over the existing engagement modes. The registry admits
 * more kinds without an engine change. The donor's second kind NEVER
 * ports: no kind named "ad" can be registered or validated here — the
 * canonical manifest, Part C, forbids AD modules in this product.
 */
import { isForbiddenKind } from './schema.js';
export class CampaignKindError extends Error {
    constructor(message) {
        super(`[campaign-kind] ${message}`);
        this.name = 'CampaignKindError';
    }
}
function fail(why) {
    throw new CampaignKindError(why);
}
function reqText(v, path) {
    if (typeof v !== 'string' || v.trim() === '')
        fail(`${path} must be a non-empty string`);
    return v;
}
/**
 * Validate an untrusted value as a CampaignKind (file/config boundary
 * discipline: kind definitions are data, and data is validated before
 * the registry trusts it). Returns the kind unchanged on success;
 * throws CampaignKindError naming the offending field otherwise.
 * @param raw - The candidate kind definition.
 * @returns The validated kind.
 */
export function validateCampaignKind(raw) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        fail('kind must be an object');
    const o = raw;
    const name = reqText(o.name, 'kind.name');
    if (isForbiddenKind(name))
        fail('the "ad" kind is forbidden in this product (manifest Part C) — it can never be registered');
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name))
        fail(`kind.name ${JSON.stringify(name)} must be a short slug`);
    reqText(o.displayName, 'kind.displayName');
    if (typeof o.dirPrefix !== 'string')
        fail('kind.dirPrefix must be a string');
    reqText(o.reconPrompt, 'kind.reconPrompt');
    reqText(o.plannerPrompt, 'kind.plannerPrompt');
    reqText(o.contract, 'kind.contract');
    reqText(o.summaryPrompt, 'kind.summaryPrompt');
    reqText(o.interlockRef, 'kind.interlockRef');
    if (!Array.isArray(o.vectors) || o.vectors.length === 0)
        fail('kind.vectors must be a non-empty array');
    const seen = new Set();
    for (const [i, v] of o.vectors.entries()) {
        if (typeof v !== 'object' || v === null)
            fail(`kind.vectors[${i}] must be an object`);
        const vec = v;
        const vname = reqText(vec.name, `kind.vectors[${i}].name`);
        if (seen.has(vname))
            fail(`kind.vectors[${i}].name ${JSON.stringify(vname)} is duplicated in this kind`);
        seen.add(vname);
        reqText(vec.brief, `kind.vectors[${i}].brief`);
        reqText(vec.owns, `kind.vectors[${i}].owns`);
    }
    const d = o.defaults;
    if (typeof d !== 'object' || d === null)
        fail('kind.defaults must be an object');
    if (d.mode !== 'red' && d.mode !== 'black')
        fail('kind.defaults.mode must be "red" or "black"');
    if (!Number.isInteger(d.maxWaves) || d.maxWaves < 1)
        fail('kind.defaults.maxWaves must be an integer >= 1');
    if (d.maxBudget !== undefined && (typeof d.maxBudget !== 'number' || !Number.isFinite(d.maxBudget))) {
        fail('kind.defaults.maxBudget must be a finite number when present');
    }
    if (typeof d.fullBattery !== 'boolean')
        fail('kind.defaults.fullBattery must be a boolean');
    return raw;
}
const WEB_HUNT_VECTORS = [
    {
        name: 'access-control',
        brief: 'Broken access control: enumerate reachable endpoints and object references; test whether unauthenticated or lower-privileged requests reach them (IDOR on object ids, forced browsing, method tampering, missing function-level checks). Prove each with the exact request and response.',
        owns: 'access control',
    },
    {
        name: 'auth-session',
        brief: 'Authentication and session handling: user enumeration, credential-stuffing resistance, lockout posture, password-reset flaws, token predictability; session cookie flags (HttpOnly/Secure/SameSite), entropy, and whether logout invalidates the session server-side.',
        owns: 'authentication',
    },
    {
        name: 'injection',
        brief: 'Injection: test every discovered input — query parameters, form fields, headers, cookies, JSON bodies — for SQL, NoSQL, command, template, and LDAP injection. Safe non-destructive probes first; escalate only on a positive signal; report the payload and the execution evidence.',
        owns: 'injection',
    },
    {
        name: 'business-logic',
        brief: "Business logic: walk the application's real workflows for step-skipping, replay of one-time actions, negative/overflowing quantities, price or role tampering in request bodies, self-approval, and race windows in anything that should happen exactly once.",
        owns: 'business logic',
    },
    {
        name: 'data-exposure',
        brief: 'Sensitive data exposure: verbose errors and stack traces, debug endpoints, source maps, .git and backup files, directory listings, API responses returning more fields than the UI shows, and credentials in client-side bundles.',
        owns: 'data exposure',
    },
    {
        name: 'misconfiguration',
        brief: 'Security misconfiguration: TLS and certificate validity, security headers, CORS policy including credentialed origins, default credentials on admin surfaces, exposed management or metrics ports, and permissive file-upload handling.',
        owns: 'misconfiguration',
    },
    {
        name: 'input-validation',
        brief: 'Input validation and client-side trust: reflected and stored XSS, HTML injection, open redirects, SSRF via URL-shaped parameters, path traversal in file parameters, XXE in XML endpoints, and deserialization of attacker-controlled data.',
        owns: 'input validation',
    },
    {
        name: 'race-conditions',
        brief: 'Race conditions and state: find operations that should be atomic — redemption, transfers, invites, rate limits, counters — and fire them concurrently to test for double-spend, limit bypass, and inconsistent state. Report timing evidence, not just outcome.',
        owns: 'race conditions',
    },
    {
        name: 'crypto-transport',
        brief: 'Cryptography and transport: TLS configuration and cipher suites, mixed content and downgrade paths, how tokens and password hashes are constructed and whether they are reversible, and predictable randomness in anything security-relevant.',
        owns: 'crypto',
    },
    {
        name: 'dependencies',
        brief: 'Dependency and supply chain: fingerprint served or referenced components — JS libraries, frameworks, server banners, reachable package manifests — and identify versions with known vulnerabilities. Confirm exploitability against this deployment rather than reporting a bare version match.',
        owns: 'dependencies',
    },
];
/** The one v1 kind (Decision C-5): the web-application hunt doctrine. */
export const WEB_HUNT_KIND = validateCampaignKind({
    name: 'web-hunt',
    displayName: 'Web hunt',
    dirPrefix: '',
    reconPrompt: 'Open the engagement by mapping the target before attacking it: reachability and schemes/ports, exposed hosts/paths/endpoints/parameters, technology and auth scheme from headers, cookies, error pages and well-known paths, entry points that take input, and the bug classes this stack plausibly carries. Recon that stops early to try a payload has failed at its job.',
    plannerPrompt: "You are the wave planner for a persistent campaign against one verified scope. Decide what the NEXT wave (one engagement) should aim at, given the campaign objective, every earlier wave's aim and outcome, and the coverage gaps that remain. Aim at what is still open; a follow-up on an earlier finding — a different endpoint of the same service, a second parameter, a bypass of the same control — outranks fresh ground. Never widen the scope: the wave inherits the campaign's verified scope exactly. Never repeat a killed hypothesis with the identical probe.",
    contract: 'Reply with ONE JSON object and nothing else: {"aim": "one line: what this wave attacks and why now", "focusVectors": ["vector names from the kind roster, at most 4"], "rationale": "one or two lines tying the aim to earlier waves and the remaining gaps"}. No prose before or after the JSON.',
    summaryPrompt: 'Close the campaign in plain language: what was tested wave by wave, what was found (worst first, with the evidence), what is worth checking next, and what is not worth the time. Be honest about coverage — a class never tested is stated, never left to read as clean.',
    vectors: WEB_HUNT_VECTORS,
    interlockRef: 'credential-attempt-lockout',
    defaults: { mode: 'red', maxWaves: 3, fullBattery: true },
});
const KIND_REGISTRY = new Map([[WEB_HUNT_KIND.name, WEB_HUNT_KIND]]);
/**
 * All registered campaign kinds, in registration order.
 * @returns The registered kinds (v1: exactly one).
 */
export function listCampaignKinds() {
    return [...KIND_REGISTRY.values()];
}
/**
 * Look a kind up by name. Fail-loud: an unknown kind is a configuration
 * error, never a silent default — a campaign created against a kind
 * that does not exist must surface at creation, not at wave 3.
 * @param name - The kind name from a campaign record or CLI input.
 * @returns The registered kind.
 */
export function getCampaignKind(name) {
    if (isForbiddenKind(name)) {
        fail('the "ad" kind is forbidden in this product (manifest Part C) — it can never be registered or run');
    }
    const kind = KIND_REGISTRY.get(name);
    if (!kind) {
        fail(`unknown campaign kind ${JSON.stringify(name)} — registered kinds: ${[...KIND_REGISTRY.keys()].join(', ')}`);
    }
    return kind;
}
/**
 * Whether a kind name resolves in the registry.
 * @param name - The kind name to test.
 * @returns True when the kind is registered.
 */
export function hasCampaignKind(name) {
    return KIND_REGISTRY.has(name);
}
//# sourceMappingURL=kinds.js.map