/**
 * Arsenal tagging — deterministic keyword → facet rules (spec §4.4).
 *
 * Pure functions only: no I/O, no clocks, no randomness. The same text always
 * derives the same facets, which is what makes `arsenal_recommend` replayable
 * and its `why` facets honest (spec §7.4/T10).
 *
 * Facet vocabulary (stored forms — exactly what lands in the `entries` table):
 * - `targets`: target-profile prefixes from `targets/types.ts`
 *   (`SS` secscan · `SL` seclayer · `WA` webapp · `WS` windows · `LX` linux).
 * - `battery`: battery categories (`logic` | `functionality` | `validation`)
 *   and/or item ids (`L-1`…`L-8`, `F-1`…`F-12`, `V-1`…`V-8`) from
 *   `battery.ts`. Category-level is the default; item-level only on a
 *   specific keyword hit. A rule that names an item also yields the item's
 *   category (the engine adds it), so a category filter finds item-tagged
 *   entries.
 * - `tags`: free facet strings in stored form — bare tags (`wordlist`,
 *   `payloads`) plus the prefixed inheritances (`topic:<topic>`,
 *   `collection:<slug>`) when a rule names a topic.
 *
 * Rules only ADD facets. Inherited facets (from `collections-map.ts`) are
 * unioned in by {@link deriveEntryFacets} and are never removed.
 */
import { BATTERY, BATTERY_CATEGORIES, } from "../battery.js";
import { TARGET_PREFIXES } from "../targets/types.js";
/** Every battery facet value a rule may honestly name: categories + item ids. */
export const BATTERY_FACET_VALUES = new Set([
    ...BATTERY_CATEGORIES,
    ...BATTERY.map((item) => item.id),
]);
/** Every target prefix a rule may name. */
export const TARGET_PREFIX_VALUES = new Set(Object.values(TARGET_PREFIXES));
const ITEM_CATEGORY = new Map(BATTERY.map((item) => [item.id, item.category]));
/**
 * The ordered rule table (spec §4.4 layer 2). Order is documentation-only:
 * outputs are sorted sets, so application order is unobservable. Patterns
 * never carry the global flag (a stateful `lastIndex` would break purity).
 */
export const TAG_RULES = [
    // ---------------------------------------------------------- battery items
    {
        id: "jwt-forgery",
        pattern: /\bjwt\b|json web tokens?/i,
        addBattery: ["F-10"],
    },
    {
        id: "session-forgery",
        pattern: /\bsessions?\b/i,
        addBattery: ["F-10"],
    },
    {
        id: "session-cookie-hygiene",
        pattern: /session fixation|\bfixation\b|httponly|same[\s-]?site|cookie (flags|hygiene|attributes)/i,
        addBattery: ["F-11"],
    },
    {
        id: "ssrf",
        pattern: /\bssrf\b|server[\s-]?side request/i,
        addBattery: ["F-9"],
    },
    {
        id: "cloud-metadata",
        pattern: /cloud metadata|metadata endpoint|169\.254\.169\.254/i,
        addBattery: ["F-9"],
        addTags: ["cloud"],
    },
    {
        id: "idor-bola",
        pattern: /\bidor\b|\bbola\b|insecure direct object/i,
        addBattery: ["F-1"],
    },
    {
        id: "mass-assignment",
        pattern: /mass[\s-]?assignment/i,
        addBattery: ["F-2"],
    },
    {
        id: "hidden-parameters",
        pattern: /(hidden|undocumented|debug) (parameters?|params?)/i,
        addBattery: ["F-3"],
    },
    {
        id: "method-tampering",
        pattern: /method (tampering|override)|x-http-method/i,
        addBattery: ["F-4"],
    },
    {
        id: "content-type-confusion",
        pattern: /content[\s-]?type confusion/i,
        addBattery: ["F-5"],
    },
    {
        id: "file-upload",
        pattern: /file uploads?|insecure files?|upload bypass/i,
        addBattery: ["F-6"],
    },
    {
        id: "enumeration-oracle",
        pattern: /(user(name)?|account|id) enumeration|enumeration oracle/i,
        addBattery: ["F-8"],
    },
    {
        id: "race-condition",
        pattern: /race conditions?|\btoctou\b/i,
        addBattery: ["L-4"],
    },
    {
        id: "coupon-stacking",
        pattern: /coupons?|promo codes?|discount stacking/i,
        addBattery: ["L-3"],
    },
    {
        id: "price-manipulation",
        pattern: /price (manipulation|tampering)|currency manipulation|quantity manipulation/i,
        addBattery: ["L-2"],
    },
    {
        id: "workflow-abuse",
        pattern: /workflow (bypass|abuse)|step[\s-]?skipping/i,
        addBattery: ["L-1"],
    },
    {
        id: "state-machine-abuse",
        pattern: /state[\s-]?machine abuse/i,
        addBattery: ["L-5"],
    },
    {
        id: "auth-flow-logic",
        pattern: /password reset|account recovery|reset tokens?/i,
        addBattery: ["L-6"],
    },
    {
        id: "role-boundaries",
        pattern: /role tampering|privilege boundar|multi[\s-]?role/i,
        addBattery: ["L-7"],
    },
    {
        id: "negative-values",
        pattern: /negative (values?|quantit\w*|amounts?|numbers?)/i,
        addBattery: ["L-8"],
    },
    {
        id: "type-juggling",
        pattern: /type juggling|type confusion/i,
        addBattery: ["V-1"],
    },
    {
        id: "boundary-values",
        pattern: /boundary values?/i,
        addBattery: ["V-2"],
    },
    {
        id: "truncation",
        pattern: /truncation/i,
        addBattery: ["V-3"],
    },
    {
        id: "encoding-tricks",
        pattern: /unicode|encoding (bypass|tricks|evasion)|homograph/i,
        addBattery: ["V-4"],
    },
    {
        id: "regex-bypass",
        pattern: /regex (bypass|evasion)|regular expression bypass/i,
        addBattery: ["V-5"],
    },
    {
        id: "client-side-validation",
        pattern: /client[\s-]?side([\s-]?only)? validation/i,
        addBattery: ["V-6"],
    },
    {
        id: "error-oracle",
        pattern: /error (message )?(oracle|disclosure|leakage|leaks?)/i,
        addBattery: ["V-7"],
    },
    // ------------------------------------------------------ battery categories
    {
        id: "xss",
        pattern: /\bxss\b|cross[\s-]?site scripting/i,
        addBattery: ["validation"],
        addTags: ["xss"],
    },
    {
        id: "sqli",
        pattern: /sql injection|\bsqli\b/i,
        addBattery: ["validation"],
        addTags: ["sqli"],
    },
    {
        id: "csrf",
        pattern: /\bcsrf\b|cross[\s-]?site request forgery/i,
        addBattery: ["functionality"],
        addTags: ["csrf"],
    },
    {
        id: "ssti",
        pattern: /template injection|\bssti\b/i,
        addBattery: ["validation"],
        addTags: ["ssti"],
    },
    {
        id: "path-traversal",
        pattern: /directory traversal|path traversal|file inclusion|\blfi\b|\brfi\b/i,
        addBattery: ["validation"],
        addTags: ["path-traversal"],
    },
    {
        id: "fuzzing",
        pattern: /fuzz/i,
        addBattery: ["validation"],
        addTags: ["fuzzing"],
    },
    {
        // Broad backstop: any other injection wording is at least a
        // validation-category signal (specific injections rule in above).
        id: "injection",
        pattern: /injection/i,
        addBattery: ["validation"],
    },
    {
        id: "business-logic",
        pattern: /business logic/i,
        addBattery: ["logic"],
        addTags: ["business-logic"],
    },
    {
        id: "oauth",
        pattern: /\boauth\b/i,
        addBattery: ["functionality"],
        addTags: ["oauth"],
    },
    {
        id: "saml",
        pattern: /\bsaml\b/i,
        addBattery: ["functionality"],
        addTags: ["saml"],
    },
    // --------------------------------------------------------------- targets
    {
        id: "linux-target",
        pattern: /\blinux\b|\bubuntu\b|\bdebian\b|linpeas|\bsuid\b|\bunix\b/i,
        addTargets: ["LX"],
    },
    {
        id: "windows-target",
        pattern: /\bwindows\b|powershell|active directory|\bntlm\b|kerberos|winpeas|mimikatz/i,
        addTargets: ["WS"],
    },
    {
        id: "api-target",
        pattern: /\bapi\b|graphql/i,
        addTargets: ["WA"],
        addTags: ["api"],
    },
    {
        id: "webapp-target",
        pattern: /web applications?|web[\s-]?apps?|\bwebapp\b/i,
        addTargets: ["WA"],
    },
    {
        id: "secscan-target",
        pattern: /secscan/i,
        addTargets: ["SS"],
    },
    {
        id: "seclayer-target",
        pattern: /seclayer/i,
        addTargets: ["SL"],
    },
    // ------------------------------------------------------------- free tags
    {
        id: "wordlist-tag",
        pattern: /wordlists?|dictionar(y|ies)/i,
        addTags: ["wordlist"],
    },
    {
        id: "payloads-tag",
        pattern: /payloads?/i,
        addTags: ["payloads"],
    },
    {
        id: "passwords-tag",
        pattern: /passwords?|rockyou/i,
        addTags: ["passwords"],
    },
    {
        // Topic tags are emitted in stored `topic:` form so rule-derived facets
        // overlap stored entry facets in `arsenal_recommend` (spec §7.4).
        id: "osint-topic",
        pattern: /\bosint\b|open[\s-]?source intelligence/i,
        addTags: ["topic:osint"],
    },
    {
        id: "web-hacking-topic",
        pattern: /web hacking/i,
        addTags: ["topic:web-hacking"],
    },
    {
        id: "bug-bounty-topic",
        pattern: /bug bounty/i,
        addTags: ["topic:bug-bounty"],
    },
    {
        id: "privesc-topic",
        pattern: /privilege escalation|\bprivesc\b/i,
        addTags: ["topic:privilege-escalation"],
    },
    {
        id: "recon-tag",
        pattern: /recon(naissance)?/i,
        addTags: ["recon"],
    },
    {
        id: "cloud-tag",
        pattern: /\bcloud\b|\baws\b|\bazure\b|\bgcp\b/i,
        addTags: ["cloud"],
    },
    {
        id: "cheatsheet-tag",
        pattern: /cheat[\s-]?sheets?/i,
        addTags: ["cheatsheet"],
    },
    {
        id: "enumeration-tag",
        pattern: /enumerat/i,
        addTags: ["enumeration"],
    },
    {
        id: "regex-tag",
        pattern: /\bregex\b|regular expressions?/i,
        addTags: ["regex"],
    },
];
function addBatteryValue(out, value) {
    out.add(value);
    const category = ITEM_CATEGORY.get(value);
    if (category !== undefined)
        out.add(category);
}
function sorted(set) {
    return [...set].sort();
}
/**
 * Run the rule table over free text (spec §7.4: the `arsenal_recommend`
 * derivation over the caller's task text; also the rules half of entry
 * tagging). Pure: no inherited facets, no I/O, deterministic.
 */
export function deriveFacets(text) {
    const tags = new Set();
    const targets = new Set();
    const battery = new Set();
    for (const rule of TAG_RULES) {
        if (!rule.pattern.test(text))
            continue;
        for (const tag of rule.addTags ?? [])
            tags.add(tag);
        for (const target of rule.addTargets ?? [])
            targets.add(target);
        for (const value of rule.addBattery ?? [])
            addBatteryValue(battery, value);
    }
    return { tags: sorted(tags), targets: sorted(targets), battery: sorted(battery) };
}
/**
 * Tag one index entry (spec §4.4): the inherited collection facets are
 * unioned with the rule facets over `name + " " + description`. Rules only
 * ADD — an inherited facet survives even when no rule fires.
 */
export function deriveEntryFacets(entry, inherited) {
    const tags = new Set();
    const targets = new Set();
    const battery = new Set();
    if (inherited !== undefined) {
        for (const topic of inherited.topics ?? [])
            tags.add(`topic:${topic}`);
        if (inherited.collectionSlug !== undefined && inherited.collectionSlug !== "") {
            tags.add(`collection:${inherited.collectionSlug}`);
        }
        for (const target of inherited.targets ?? [])
            targets.add(target);
        for (const value of inherited.battery ?? [])
            addBatteryValue(battery, value);
    }
    const ruled = deriveFacets(`${entry.name} ${entry.description ?? ""}`);
    for (const tag of ruled.tags)
        tags.add(tag);
    for (const target of ruled.targets)
        targets.add(target);
    for (const value of ruled.battery)
        battery.add(value);
    return { tags: sorted(tags), targets: sorted(targets), battery: sorted(battery) };
}
//# sourceMappingURL=tag-rules.js.map