import test from "node:test";
import assert from "node:assert/strict";
import {
  SECLAYER_BLUEPRINT_IDENTITY_COUNT,
  SECLAYER_TEST_IDENTITIES,
  SECLAYER_TEST_IDENTITY_COUNT,
  getSeclayerTestIdentities,
} from "./test-identities.js";

test("seclayer native test identity manifest is consistent and authoritative", () => {
  assert.equal(SECLAYER_TEST_IDENTITY_COUNT, SECLAYER_TEST_IDENTITIES.length);
  assert.equal(getSeclayerTestIdentities(), SECLAYER_TEST_IDENTITIES);

  const ids = SECLAYER_TEST_IDENTITIES.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, "identity ids must be unique");

  for (const identity of SECLAYER_TEST_IDENTITIES) {
    assert.ok(identity.id.length > 0, "id required");
    assert.ok(identity.name.length > 0, `name required for ${identity.id}`);
    assert.ok(identity.tools.length > 0, `tools required for ${identity.id}`);
    assert.ok(identity.probe.length > 0, `probe evidence required for ${identity.id}`);
  }
});

test("seclayer native test identity count is reconciled with blueprint target", () => {
  // Blueprint Item 10 states 36; enumerated identities provided by the 6 native
  // seclayer tools currently total 29 (see test-identities.ts counting rules).
  assert.equal(SECLAYER_BLUEPRINT_IDENTITY_COUNT, 36);
  assert.equal(
    SECLAYER_TEST_IDENTITY_COUNT,
    29,
    `expected reconciled implemented identity count 29 (blueprint states ${SECLAYER_BLUEPRINT_IDENTITY_COUNT}); update manifest+test together with evidence if probes change`,
  );
});

test("seclayer llm fan-out and shared BOLA identity are represented correctly", () => {
  const llm = SECLAYER_TEST_IDENTITIES.filter((i) => i.id.startsWith("dast.llm."));
  assert.deepEqual(
    llm.map((i) => i.id).sort(),
    ["dast.llm.insecure_tool_use", "dast.llm.memory_poisoning", "dast.llm.prompt_injection"],
  );
  assert.ok(llm.every((i) => i.tools.length === 1 && i.tools[0] === "seclayer_dast"));

  const bola = SECLAYER_TEST_IDENTITIES.find((i) => i.id === "bola.two_identity_idor");
  assert.ok(bola, "shared BOLA identity must exist");
  assert.deepEqual([...bola!.tools].sort(), ["seclayer_api", "seclayer_bola"]);
});
