/**
 * Step 2 — tagging (spec T3 + §4.4): positive cases per spec-pinned rule,
 * negatives, the ADD-only invariant (inherited facets are never removed),
 * facet edge cases, and the collections map's fidelity to the pinned census
 * (ARS-10 checklist: 81 rows, seven priority).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BATTERY, BATTERY_CATEGORIES } from "../src/battery.js";
import { TARGET_PREFIXES } from "../src/targets/types.js";
import {
  BATTERY_FACET_VALUES,
  TAG_RULES,
  TARGET_PREFIX_VALUES,
  deriveEntryFacets,
  deriveFacets,
  type InheritedFacets,
} from "../src/arsenal/tag-rules.js";
import {
  COLLECTIONS_MAP,
  PRIORITY_COLLECTION_SLUGS,
  PRIORITY_COLLECTIONS,
  collectionBySlug,
  inheritedFacetsForCollection,
} from "../src/arsenal/collections-map.js";
import {
  arsenalSlugFor,
  normalizeArsenalUrl,
} from "../src/arsenal/ingest.js";

describe("tag rules — spec T3 positives", () => {
  it("jwt → F-10 (plus its category), case-insensitively", () => {
    for (const text of ["JWT Attacks", "jwt", "JSON Web Token forgery"]) {
      const facets = deriveFacets(text);
      assert.ok(facets.battery.includes("F-10"), text);
      assert.ok(facets.battery.includes("functionality"), text);
    }
  });

  it("ssrf → F-9", () => {
    for (const text of ["SSRF payloads", "Server-Side Request Forgery", "ssrf to cloud metadata"]) {
      const facets = deriveFacets(text);
      assert.ok(facets.battery.includes("F-9"), text);
      assert.ok(facets.battery.includes("functionality"), text);
    }
  });

  it("idor / bola → F-1", () => {
    for (const text of ["IDOR", "BOLA explained", "Insecure Direct Object References"]) {
      assert.ok(deriveFacets(text).battery.includes("F-1"), text);
    }
  });

  it("wordlist / dictionary → wordlist tag (no battery claim)", () => {
    for (const text of ["DNS wordlist", "a dictionary for fuzzing"]) {
      const facets = deriveFacets(text);
      assert.ok(facets.tags.includes("wordlist"), text);
    }
    assert.deepEqual(deriveFacets("plain wordlist").battery, []);
  });

  it("payload → payloads tag", () => {
    assert.ok(deriveFacets("PayloadsAllTheThings").tags.includes("payloads"));
  });

  it("item rules carry their parent category", () => {
    assert.deepEqual(deriveFacets("race condition").battery, ["L-4", "logic"]);
    assert.deepEqual(deriveFacets("mass assignment").battery, ["F-2", "functionality"]);
    assert.deepEqual(deriveFacets("type juggling").battery, ["V-1", "validation"]);
  });

  it("target rules: linux / windows / api wording", () => {
    assert.deepEqual(deriveFacets("Linux privilege escalation").targets, ["LX"]);
    assert.deepEqual(deriveFacets("Windows Kerberos attacks").targets, ["WS"]);
    assert.deepEqual(deriveFacets("GraphQL API testing").targets, ["WA"]);
  });
});

describe("tag rules — negatives and edge cases", () => {
  it("ordinary words trigger nothing", () => {
    for (const text of [
      "A gentle guide to vegetable gardening",
      "How to cook rice properly",
      "tools",
      "",
      "   ",
    ]) {
      assert.deepEqual(deriveFacets(text), { tags: [], targets: [], battery: [] }, JSON.stringify(text));
    }
  });

  it("word boundaries hold: 'jsonwebtoken' is not a JWT hit", () => {
    assert.ok(!deriveFacets("jsonwebtoken library").battery.includes("F-10"));
  });

  it("derivation is deterministic and sorted", () => {
    const text = "JWT SSRF wordlist for the API on Linux";
    const first = deriveFacets(text);
    assert.deepEqual(deriveFacets(text), first);
    assert.deepEqual(first.tags, [...first.tags].sort());
    assert.deepEqual(first.targets, [...first.targets].sort());
    assert.deepEqual(first.battery, [...first.battery].sort());
  });

  it("the rule table names only real taxonomy values", () => {
    const categories = new Set<string>(BATTERY_CATEGORIES);
    const itemIds = new Set(BATTERY.map((item) => item.id));
    assert.ok(TAG_RULES.length > 0);
    const ids = new Set<string>();
    for (const rule of TAG_RULES) {
      assert.ok(!ids.has(rule.id), `duplicate rule id ${rule.id}`);
      ids.add(rule.id);
      assert.ok(rule.pattern instanceof RegExp, rule.id);
      assert.equal(rule.pattern.global, false, `${rule.id}: global regexes are stateful`);
      for (const value of rule.addBattery ?? []) {
        assert.ok(
          categories.has(value) || itemIds.has(value),
          `${rule.id} names unknown battery facet ${value}`,
        );
        assert.ok(BATTERY_FACET_VALUES.has(value), rule.id);
      }
      for (const target of rule.addTargets ?? []) {
        assert.ok(TARGET_PREFIX_VALUES.has(target), `${rule.id} names unknown target ${target}`);
        assert.ok(Object.values(TARGET_PREFIXES).includes(target), rule.id);
      }
    }
  });
});

describe("inheritance — rules only ADD (spec T3)", () => {
  const inherited: InheritedFacets = {
    topics: ["osint"],
    collectionSlug: "awesome-osint",
    targets: ["LX"],
    battery: ["logic"],
  };

  it("inherited facets survive when no rule fires", () => {
    const facets = deriveEntryFacets({ name: "A plain guide", description: "" }, inherited);
    assert.deepEqual(facets, {
      tags: ["collection:awesome-osint", "topic:osint"],
      targets: ["LX"],
      battery: ["logic"],
    });
  });

  it("rule facets union with inherited ones; nothing is removed", () => {
    const facets = deriveEntryFacets(
      { name: "JWT attacks against the API", description: "token forgery" },
      inherited,
    );
    assert.ok(facets.targets.includes("LX"), "inherited target kept");
    assert.ok(facets.targets.includes("WA"), "rule target added");
    assert.ok(facets.battery.includes("logic"), "inherited category kept");
    assert.ok(facets.battery.includes("F-10"), "rule item added");
    assert.ok(facets.battery.includes("functionality"), "item category added");
    assert.ok(facets.tags.includes("topic:osint"));
    assert.ok(facets.tags.includes("collection:awesome-osint"));
    assert.ok(facets.tags.includes("api"));
  });

  it("inputs are not mutated (frozen inherited facets)", () => {
    const frozen: InheritedFacets = {
      topics: Object.freeze(["wordlists"]),
      collectionSlug: "seclists",
      targets: Object.freeze(["WA"]),
      battery: Object.freeze(["validation"]),
    };
    const facets = deriveEntryFacets({ name: "wordlist", description: null }, frozen);
    assert.ok(facets.tags.includes("topic:wordlists"));
    assert.ok(facets.tags.includes("wordlist"));
    assert.deepEqual(frozen.targets, ["WA"]);
  });

  it("no inheritance + no rule hits = empty facets", () => {
    assert.deepEqual(deriveEntryFacets({ name: "rice", description: "cooking" }), {
      tags: [],
      targets: [],
      battery: [],
    });
  });
});

describe("collections map — pinned census fidelity", () => {
  it("carries exactly the 81 checklist rows (ARS-10 FLAG 1: never padded toward ~90)", () => {
    assert.equal(COLLECTIONS_MAP.length, 81);
  });

  it("slugs are unique; URLs are unique after spec §4.3 normalization", () => {
    const slugs = new Set(COLLECTIONS_MAP.map((row) => row.slug));
    assert.equal(slugs.size, COLLECTIONS_MAP.length);
    const urls = new Set<string>();
    for (const row of COLLECTIONS_MAP) {
      const normalized = normalizeArsenalUrl(row.url);
      assert.ok(normalized !== null, `${row.slug}: URL does not normalize`);
      assert.ok(!urls.has(normalized), `${row.slug}: duplicate normalized URL`);
      urls.add(normalized);
    }
  });

  it("every slug matches ARS-3's slug rule applied to (url, name)", () => {
    for (const row of COLLECTIONS_MAP) {
      assert.equal(
        arsenalSlugFor(row.url, row.name),
        row.slug,
        `${row.slug}: slug disagrees with ingest's rule`,
      );
    }
  });

  it("the priority list is the seven, in spec §10 order (seventh under its real name)", () => {
    assert.deepEqual(PRIORITY_COLLECTION_SLUGS, [
      "seclists",
      "payloadsallthethings",
      "gtfobins",
      "red-teaming-toolkit",
      "awesome-web-hacking",
      "api-security-checklist",
      "bug-bounty-reference",
    ]);
    assert.equal(PRIORITY_COLLECTIONS.length, 7);
    assert.equal(COLLECTIONS_MAP.filter((row) => row.level2).length, 7);
    for (const row of PRIORITY_COLLECTIONS) assert.equal(row.level2, true, row.slug);
  });

  it("priority rows are character-exact against the census", () => {
    const expected: Record<string, { name: string; url: string }> = {
      seclists: { name: "SecLists", url: "https://github.com/danielmiessler/SecLists" },
      payloadsallthethings: {
        name: "PayloadsAllTheThings",
        url: "https://github.com/swisskyrepo/PayloadsAllTheThings",
      },
      gtfobins: { name: "GTFOBins", url: "https://gtfobins.github.io" },
      "red-teaming-toolkit": {
        name: "Red Teaming Toolkit",
        url: "https://github.com/infosecn1nja/Red-Teaming-Toolkit",
      },
      "awesome-web-hacking": {
        name: "Web Hacking",
        url: "https://github.com/infoslack/awesome-web-hacking",
      },
      "api-security-checklist": {
        name: "API Security Checklist",
        url: "https://github.com/shieldfy/API-Security-Checklist",
      },
      "bug-bounty-reference": {
        name: "Bug Bounty Reference",
        url: "https://github.com/ngalongc/bug-bounty-reference",
      },
    };
    for (const [slug, want] of Object.entries(expected)) {
      const row = collectionBySlug(slug);
      assert.ok(row !== undefined, slug);
      assert.equal(row.name, want.name, slug);
      assert.equal(row.url, want.url, slug);
    }
  });

  it("the api-security-checklist row records the FLAG 2 ruling in the entry itself", () => {
    const row = collectionBySlug("api-security-checklist");
    assert.ok(row !== undefined);
    assert.ok(row.note !== undefined && row.note.includes("defensive countermeasures checklist"));
    assert.ok(row.note.includes("API Security"));
    // No row anywhere pretends to be the unsourced name.
    assert.equal(collectionBySlug("api-security"), undefined);
  });

  it("flagged L1 rows keep their census form (anchor / tool app / site)", () => {
    assert.equal(
      collectionBySlug("awesome-php")?.url,
      "https://github.com/ziadoz/awesome-php#security",
    );
    assert.equal(collectionBySlug("cyberchef")?.url, "https://gchq.github.io/CyberChef/");
    assert.ok(collectionBySlug("gtfobins")?.note?.includes("project site"));
  });

  it("non-priority rows are uncurated: topic inheritance only", () => {
    for (const row of COLLECTIONS_MAP) {
      if (row.level2) continue;
      assert.deepEqual(row.topics, [], row.slug);
      assert.deepEqual(row.targets, [], row.slug);
      assert.deepEqual(row.batteryCategories, [], row.slug);
    }
    const inherited = inheritedFacetsForCollection("awesome-osint");
    assert.ok(inherited !== undefined);
    assert.deepEqual(inherited.topics, ["awesome-repositories"]);
    assert.equal(inherited.collectionSlug, "awesome-osint");
  });

  it("priority inheritance feeds deriveEntryFacets (seclists shape)", () => {
    const inherited = inheritedFacetsForCollection("seclists");
    assert.ok(inherited !== undefined);
    const facets = deriveEntryFacets({ name: "Common Passwords", description: "" }, inherited);
    assert.deepEqual(facets.targets, ["LX", "WA", "WS"]);
    assert.deepEqual(facets.battery, ["functionality", "validation"]);
    assert.ok(facets.tags.includes("topic:wordlists"));
    assert.ok(facets.tags.includes("collection:seclists"));
    assert.ok(facets.tags.includes("passwords"));
  });

  it("unknown slugs resolve to undefined, never a fabricated row", () => {
    assert.equal(collectionBySlug("api-security"), undefined);
    assert.equal(collectionBySlug("nope"), undefined);
    assert.equal(inheritedFacetsForCollection("nope"), undefined);
  });
});
