/**
 * Arsenal collections map — the curated, versioned Level-1 census plus the
 * priority collections' facet baselines (spec §4.4 layer 1).
 *
 * Data source (the ONLY source; nothing here is recalled or padded): the
 * ARS-10 catalog checklist, enumerated from the Awesome Hacking README at
 * pinned commit `440486fd08b0a0d9ad9a041a0bb234dcdf65dee2` and filed at
 * `arsenal-catalog-checklist-2026-10-31.md`. All 81 rows of that census are
 * below, in checklist order, with name/URL character-exact. The stale "~90"
 * figure from the spec/register is NOT chased (ARS-10 FLAG 1, ARS-1 ruling:
 * the crew builds against 81).
 *
 * Slugs follow spec §4.2 as ARS-3's `arsenalSlugFor` implements it: lowercase
 * kebab of the repo name (last URL segment, no camel splitting); a
 * `*.github.io` repo segment strips to the project prefix; site-root URLs
 * fall back to the display name.
 *
 * Facet curation: only the seven priority rows carry curated `topics` /
 * `targets` / `batteryCategories` — the human-set baseline every entry in
 * that collection inherits (spec §4.4). Non-priority rows inherit their
 * Level-1 section topic only, until curated (spec §10: curation of the
 * remaining rows is post-v1).
 */
import type { BatteryCategory } from "../battery.js";
import type { InheritedFacets, TargetPrefix } from "./tag-rules.js";

/** One Level-1 collection row (identity + curated facet baseline). */
export interface ArsenalCollection {
  slug: string;
  /** Display name, character-exact from the pinned census. */
  name: string;
  /** Canonical URL, character-exact from the pinned census. */
  url: string;
  /** Level-1 topic = the README section heading the row sits under (spec §4.2). */
  topic: string;
  /** True for the seven Level-2 priority collections (spec §10). */
  level2: boolean;
  /** Curated facet topics (bare slugs); priority rows only, `[]` until curated. */
  topics: readonly string[];
  /** Curated target-profile baseline; priority rows only, `[]` until curated. */
  targets: readonly TargetPrefix[];
  /** Curated battery-category baseline; priority rows only, `[]` until curated. */
  batteryCategories: readonly BatteryCategory[];
  /** Honesty note (sourcing flags, form caveats) where the census carries one. */
  note?: string;
}

const AWESOME_REPOSITORIES = "Awesome Repositories";
const OTHER_USEFUL_REPOSITORIES = "Other Useful Repositories";

/** A non-priority Level-1 row: identity only, topic inheritance only. */
function l1(
  slug: string,
  name: string,
  url: string,
  topic: string,
  note?: string,
): ArsenalCollection {
  return {
    slug,
    name,
    url,
    topic,
    level2: false,
    topics: [],
    targets: [],
    batteryCategories: [],
    ...(note === undefined ? {} : { note }),
  };
}

/**
 * The complete Level-1 map: all 81 census rows in checklist order (rows
 * 1–47 "Awesome Repositories", rows 48–81 "Other Useful Repositories").
 */
export const COLLECTIONS_MAP: readonly ArsenalCollection[] = [
  // ------------------------------------------------ Awesome Repositories
  l1("android-security-awesome", "Android Security", "https://github.com/ashishb/android-security-awesome", AWESOME_REPOSITORIES),
  l1("awesome-appsec", "AppSec", "https://github.com/paragonie/awesome-appsec", AWESOME_REPOSITORIES),
  l1("awesome-asset-discovery", "Asset Discovery", "https://github.com/redhuntlabs/Awesome-Asset-Discovery", AWESOME_REPOSITORIES),
  l1("awesome-bug-bounty", "Bug Bounty", "https://github.com/djadmin/awesome-bug-bounty", AWESOME_REPOSITORIES),
  l1("awesome-cellular-hacking", "Cellular Hacking", "https://github.com/W00t3k/Awesome-Cellular-Hacking", AWESOME_REPOSITORIES),
  l1("awesome-cicd-attacks", "CI/CD Attacks", "https://github.com/TupleType/awesome-cicd-attacks", AWESOME_REPOSITORIES),
  l1("awesome-ctf", "CTF", "https://github.com/apsdehal/awesome-ctf", AWESOME_REPOSITORIES),
  l1("awesome-cyber-security-university", "Cyber Security University", "https://github.com/brootware/awesome-cyber-security-university", AWESOME_REPOSITORIES),
  l1("awesome-cyber-skills", "Cyber Skills", "https://github.com/joe-shenouda/awesome-cyber-skills", AWESOME_REPOSITORIES),
  l1("cybersources", "Cybersources", "https://github.com/bst04/CyberSources", AWESOME_REPOSITORIES),
  l1("awesome-detection-engineering", "Detection Engineering", "https://github.com/infosecB/awesome-detection-engineering", AWESOME_REPOSITORIES),
  l1("awesome-devsecops", "DevSecOps", "https://github.com/devsecops/awesome-devsecops", AWESOME_REPOSITORIES),
  l1("awesome-drone-hacking", "Drone Hacking", "https://github.com/nicholasaleks/Awesome-Drone-Hacking", AWESOME_REPOSITORIES),
  l1("awesome-embedded-and-iot-security", "Embedded and IoT Security", "https://github.com/fkie-cad/awesome-embedded-and-iot-security", AWESOME_REPOSITORIES),
  l1("awesome-fuzzing", "Fuzzing", "https://github.com/secfigo/Awesome-Fuzzing", AWESOME_REPOSITORIES),
  l1("awesome-hacking", "Hacking", "https://github.com/carpedm20/awesome-hacking", AWESOME_REPOSITORIES),
  l1("awesome-honeypots", "Honeypots", "https://github.com/paralax/awesome-honeypots", AWESOME_REPOSITORIES),
  l1("awesome-incident-response", "Incident Response", "https://github.com/meirwah/awesome-incident-response", AWESOME_REPOSITORIES),
  l1("awesome-industrial-control-system-security", "Industrial Control System Security", "https://github.com/hslatman/awesome-industrial-control-system-security", AWESOME_REPOSITORIES),
  l1("awesome-infosec", "InfoSec", "https://github.com/onlurking/awesome-infosec", AWESOME_REPOSITORIES),
  l1("awesome-iot-and-hardware-security", "IoT and Hardware Security", "https://github.com/kayranfatih/awesome-iot-and-hardware-security", AWESOME_REPOSITORIES),
  l1("awesome-mainframe-hacking", "Mainframe Hacking", "https://github.com/samanL33T/Awesome-Mainframe-Hacking", AWESOME_REPOSITORIES),
  l1("awesome-malware-analysis", "Malware Analysis", "https://github.com/rshipp/awesome-malware-analysis", AWESOME_REPOSITORIES),
  l1("awesome-malware-persistence", "Malware Persistence", "https://github.com/Karneades/awesome-malware-persistence", AWESOME_REPOSITORIES),
  l1("awesome-nodejs-security", "Node.js Security", "https://github.com/lirantal/awesome-nodejs-security", AWESOME_REPOSITORIES),
  l1("awesome-osint", "OSINT", "https://github.com/jivoi/awesome-osint", AWESOME_REPOSITORIES),
  l1("osx-and-ios-security-awesome", "OSX and iOS Security", "https://github.com/ashishb/osx-and-ios-security-awesome", AWESOME_REPOSITORIES),
  l1("awesome-password-cracking", "Password Cracking", "https://github.com/n0kovo/awesome-password-cracking", AWESOME_REPOSITORIES),
  l1("awesome-pcaptools", "Pcaptools", "https://github.com/caesar0301/awesome-pcaptools", AWESOME_REPOSITORIES),
  l1("awesome-pentest", "Pentest", "https://github.com/enaqx/awesome-pentest", AWESOME_REPOSITORIES),
  l1(
    "awesome-php",
    "PHP Security",
    "https://github.com/ziadoz/awesome-php#security",
    AWESOME_REPOSITORIES,
    "L1 URL is a section anchor inside the general ziadoz/awesome-php list, not a security-specific repo (ARS-10 FLAG 3). Valid L1 row per spec §4.2; L1-only in v1.",
  ),
  l1("awesome-prompt-injection", "Prompt Injection", "https://github.com/Joe-B-Security/awesome-prompt-injection", AWESOME_REPOSITORIES),
  l1("awesome-rtc-hacking", "Real-time Communications hacking & pentesting resources", "https://github.com/EnableSecurity/awesome-rtc-hacking", AWESOME_REPOSITORIES),
  {
    slug: "red-teaming-toolkit",
    name: "Red Teaming Toolkit",
    url: "https://github.com/infosecn1nja/Red-Teaming-Toolkit",
    topic: AWESOME_REPOSITORIES,
    level2: true,
    topics: ["red-teaming", "post-exploitation"],
    targets: ["WS", "LX"],
    batteryCategories: ["functionality"],
  },
  l1("awesome-rl-for-cybersecurity", "Reinforcement Learning for Cyber Security", "https://github.com/Kim-Hammar/awesome-rl-for-cybersecurity", AWESOME_REPOSITORIES),
  l1("awesome-reversing", "Reversing", "https://github.com/HACKE-RC/awesome-reversing", AWESOME_REPOSITORIES),
  l1("awesome-sec-talks", "Sec Talks", "https://github.com/PaulSec/awesome-sec-talks", AWESOME_REPOSITORIES),
  {
    slug: "seclists",
    name: "SecLists",
    url: "https://github.com/danielmiessler/SecLists",
    topic: AWESOME_REPOSITORIES,
    level2: true,
    topics: ["wordlists"],
    targets: ["WA", "WS", "LX"],
    batteryCategories: ["functionality", "validation"],
  },
  l1("awesome-security", "Security", "https://github.com/sbilly/awesome-security", AWESOME_REPOSITORIES),
  l1("awesome-social-engineering", "Social Engineering", "https://github.com/giuliacassara/awesome-social-engineering", AWESOME_REPOSITORIES),
  l1("static-analysis", "Static Analysis", "https://github.com/analysis-tools-dev/static-analysis", AWESOME_REPOSITORIES),
  l1("h4cker", "The Art of Hacking Series", "https://github.com/The-Art-of-Hacking/h4cker", AWESOME_REPOSITORIES),
  l1("awesome-threat-intelligence", "Threat Intelligence", "https://github.com/hslatman/awesome-threat-intelligence", AWESOME_REPOSITORIES),
  l1("awesome-vehicle-security", "Vehicle Security", "https://github.com/jaredthecoder/awesome-vehicle-security", AWESOME_REPOSITORIES),
  {
    slug: "awesome-web-hacking",
    name: "Web Hacking",
    url: "https://github.com/infoslack/awesome-web-hacking",
    topic: AWESOME_REPOSITORIES,
    level2: true,
    topics: ["web-hacking"],
    targets: ["WA"],
    batteryCategories: ["logic", "functionality", "validation"],
  },
  l1("awesome-web3-security", "Web3 Security", "https://github.com/Anugrahsr/Awesome-web3-Security", AWESOME_REPOSITORIES),
  l1("awesome-yara", "YARA", "https://github.com/InQuest/awesome-yara", AWESOME_REPOSITORIES),
  // ------------------------------------------- Other Useful Repositories
  l1("awesome-ai-security", "AI Security", "https://github.com/DeepSpaceHarbor/Awesome-AI-Security", OTHER_USEFUL_REPOSITORIES),
  l1("awesome-annual-security-reports", "Annual Security Reports", "https://github.com/jacobdjwilson/awesome-annual-security-reports", OTHER_USEFUL_REPOSITORIES),
  {
    slug: "api-security-checklist",
    name: "API Security Checklist",
    url: "https://github.com/shieldfy/API-Security-Checklist",
    topic: OTHER_USEFUL_REPOSITORIES,
    level2: true,
    topics: ["api-security", "defense"],
    targets: ["WA"],
    batteryCategories: ["functionality", "validation"],
    note:
      "Fills the directive's \"API Security\" priority slot UNDER ITS REAL NAME per ARS-1's corrected FLAG 2 ruling: the pinned census has no entry named \"API Security\"; this row (checklist row 50) is a defensive countermeasures checklist — not an API-attack-tooling list. Tagging describes what it contains, never what the slot name implies.",
  },
  l1("aptnotes", "APT Notes", "https://github.com/kbandla/APTnotes", OTHER_USEFUL_REPOSITORIES),
  {
    slug: "bug-bounty-reference",
    name: "Bug Bounty Reference",
    url: "https://github.com/ngalongc/bug-bounty-reference",
    topic: OTHER_USEFUL_REPOSITORIES,
    level2: true,
    topics: ["bug-bounty", "web-hacking"],
    targets: ["WA"],
    batteryCategories: ["functionality", "validation"],
  },
  l1("capsulecorp-pentest", "Capsulecorp Pentest", "https://github.com/r3dy/capsulecorp-pentest", OTHER_USEFUL_REPOSITORIES),
  l1("awesome-cryptography", "Cryptography", "https://github.com/sobolevn/awesome-cryptography", OTHER_USEFUL_REPOSITORIES),
  l1("cve", "CVE PoC", "https://github.com/trickest/cve", OTHER_USEFUL_REPOSITORIES),
  l1(
    "cyberchef",
    "CyberChef",
    "https://gchq.github.io/CyberChef/",
    OTHER_USEFUL_REPOSITORIES,
    "L1 URL is a tool web app, not a list repo (ARS-10 FLAG 3). Valid L1 row; L1-only in v1 — Level-2 list ingest does not apply in kind.",
  ),
  l1("detectionlab", "Detection Lab", "https://github.com/clong/DetectionLab", OTHER_USEFUL_REPOSITORIES),
  l1("awesome-executable-packing", "Executable Packing", "https://github.com/packing-box/awesome-executable-packing", OTHER_USEFUL_REPOSITORIES),
  l1("awesome-forensics", "Forensics", "https://github.com/Cugu/awesome-forensics", OTHER_USEFUL_REPOSITORIES),
  l1("free-programming-books", "Free Programming Books", "https://github.com/EbookFoundation/free-programming-books", OTHER_USEFUL_REPOSITORIES),
  {
    slug: "gtfobins",
    name: "GTFOBins",
    url: "https://gtfobins.github.io",
    topic: OTHER_USEFUL_REPOSITORIES,
    level2: true,
    topics: ["privilege-escalation", "linux"],
    targets: ["LX"],
    batteryCategories: ["functionality"],
    note:
      "L1 URL is the project site, not a repo (ARS-10 FLAG 3); slug from the display name per spec §4.2. The Level-2 source form is the site index at that URL (one link per binary, no descriptions), fetched through fetch-guard like every https source (ARS-1 ruling).",
  },
  l1("hacker101", "Hacker101", "https://github.com/Hacker0x01/hacker101", OTHER_USEFUL_REPOSITORIES),
  l1("infosec-getting-started", "Infosec Getting Started", "https://github.com/gradiuscypher/infosec_getting_started", OTHER_USEFUL_REPOSITORIES),
  l1("infosec-reference", "Infosec Reference", "https://github.com/rmusser01/Infosec_Reference", OTHER_USEFUL_REPOSITORIES),
  l1("awesome-iocs", "IOC", "https://github.com/sroberts/awesome-iocs", OTHER_USEFUL_REPOSITORIES),
  l1("linux-kernel-exploitation", "Linux Kernel Exploitation", "https://github.com/xairy/linux-kernel-exploitation", OTHER_USEFUL_REPOSITORIES),
  l1("awesome-ml-for-cybersecurity", "Machine Learning for Cyber Security", "https://github.com/jivoi/awesome-ml-for-cybersecurity", OTHER_USEFUL_REPOSITORIES),
  l1("payloads", "Payloads", "https://github.com/foospidy/payloads", OTHER_USEFUL_REPOSITORIES),
  {
    slug: "payloadsallthethings",
    name: "PayloadsAllTheThings",
    url: "https://github.com/swisskyrepo/PayloadsAllTheThings",
    topic: OTHER_USEFUL_REPOSITORIES,
    level2: true,
    topics: ["payloads", "web-hacking"],
    targets: ["WA"],
    batteryCategories: ["functionality", "validation"],
  },
  l1("pentest-wiki", "Pentest Wiki", "https://github.com/nixawk/pentest-wiki", OTHER_USEFUL_REPOSITORIES),
  l1("probable-wordlists", "Probable Wordlists", "https://github.com/berzerk0/Probable-Wordlists", OTHER_USEFUL_REPOSITORIES),
  l1("redteam-physical-tools", "Red Team Physical Tools", "https://github.com/DavidProbinsky/RedTeam-Physical-Tools", OTHER_USEFUL_REPOSITORIES),
  l1("reverseengineering-reading-list", "Reverse Engineering", "https://github.com/onethawt/reverseengineering-reading-list", OTHER_USEFUL_REPOSITORIES),
  l1("rfsec-toolkit", "RFSec-ToolKit", "https://github.com/cn0xroot/RFSec-ToolKit", OTHER_USEFUL_REPOSITORIES),
  l1("cheatsheetseries", "Security Cheatsheets", "https://github.com/OWASP/CheatSheetSeries", OTHER_USEFUL_REPOSITORIES),
  l1("awesome-shell", "Shell", "https://github.com/alebcay/awesome-shell", OTHER_USEFUL_REPOSITORIES),
  l1("awesome-suricata", "Suricata", "https://github.com/satta/awesome-suricata", OTHER_USEFUL_REPOSITORIES),
  l1("threathunter-playbook", "ThreatHunter-Playbook", "https://github.com/OTRF/ThreatHunter-Playbook", OTHER_USEFUL_REPOSITORIES),
  l1("awesome-tor", "Tor", "https://github.com/polycarbohydrate/awesome-tor", OTHER_USEFUL_REPOSITORIES),
  l1("vulhub", "Vulhub", "https://github.com/vulhub/vulhub", OTHER_USEFUL_REPOSITORIES),
  l1("awesome-web-security", "Web Security", "https://github.com/qazbnm456/awesome-web-security", OTHER_USEFUL_REPOSITORIES),
];

/**
 * The canonical priority slug list, in spec §10 order — consumed as
 * `ArsenalBuildData.prioritySlugs` at refresh time (ARS-1 forward contract).
 * The seventh slot is `api-security-checklist` under its real name (ARS-1's
 * corrected FLAG 2 ruling; see that row's note).
 */
export const PRIORITY_COLLECTION_SLUGS: readonly string[] = [
  "seclists",
  "payloadsallthethings",
  "gtfobins",
  "red-teaming-toolkit",
  "awesome-web-hacking",
  "api-security-checklist",
  "bug-bounty-reference",
];

const BY_SLUG: ReadonlyMap<string, ArsenalCollection> = new Map(
  COLLECTIONS_MAP.map((row) => [row.slug, row]),
);

/** The seven priority rows, in {@link PRIORITY_COLLECTION_SLUGS} order. */
export const PRIORITY_COLLECTIONS: readonly ArsenalCollection[] =
  PRIORITY_COLLECTION_SLUGS.map((slug) => BY_SLUG.get(slug)!);

/** Look up one collection row by slug. */
export function collectionBySlug(slug: string): ArsenalCollection | undefined {
  return BY_SLUG.get(slug);
}

function topicTagSlug(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * The inherited facets (spec §4.4 layer 1) for one collection: curated facet
 * topics where the row carries them, otherwise the row's Level-1 section
 * topic; the collection slug; and the curated target / battery-category
 * baseline (`[]` until curated). Feed to {@link deriveEntryFacets}.
 */
export function inheritedFacetsForCollection(
  slug: string,
): InheritedFacets | undefined {
  const row = BY_SLUG.get(slug);
  if (row === undefined) return undefined;
  return {
    topics: row.topics.length > 0 ? row.topics : [topicTagSlug(row.topic)],
    collectionSlug: row.slug,
    targets: row.targets,
    battery: row.batteryCategories,
  };
}
