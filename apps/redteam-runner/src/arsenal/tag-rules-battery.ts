/**
 * Battery-item and battery-category tag rules — extracted from
 * `tag-rules.ts` (via the rule table) to keep every module inside the
 * runner's 300-line file budget. Pure data, spec §4.4 layer 2; the parent
 * concatenates this table with the target/free-tag table, order preserved.
 */
import type { TagRule } from "./tag-rules.js";

export const BATTERY_AND_CATEGORY_RULES: readonly TagRule[] = [
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
];
