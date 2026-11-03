/**
 * Target-prefix and free-tag rules — extracted from `tag-rules.ts` (via the
 * rule table) to keep every module inside the runner's 300-line file
 * budget. Pure data, spec §4.4 layer 2; concatenated after the battery
 * table by the parent.
 */
import type { TagRule } from "./tag-rules.js";

export const TARGET_AND_TAG_RULES: readonly TagRule[] = [
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
