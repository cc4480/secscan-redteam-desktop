/**
 * Store-backed fleet resolver tests — the runner host resolves the
 * fleet's provider keys from the app credentials store
 * ($DSH_HOME/.credentials.yaml) at dispatch time.
 *
 * What we prove here:
 *  - a key seated in the store after the resolver was created is picked
 *    up by the next read, with no restart
 *  - a rotated key replaces the old one on the next read
 *  - the launching environment wins over the store (per-run override),
 *    and a blank environment value does not shadow the store
 *  - a malformed document fails loud at creation, never silently
 *  - resolution is name-agnostic: the provider selector resolves through
 *    the same path as any provider key
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStoreFleetConfigResolver } from "../src/fleet-store-resolver.js";

const KEY = "DEEPSEEK_API_KEY";
const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempHome(): { env: NodeJS.ProcessEnv; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "fleet-store-resolver-"));
  dirs.push(dir);
  return { env: { DSH_HOME: dir }, file: join(dir, ".credentials.yaml") };
}

function writeStore(file: string, refs: Record<string, string>): void {
  const lines = Object.entries(refs).map(([name, value]) => `  ${name}: ${value}`);
  writeFileSync(file, `version: 1\nrefs:\n${lines.join("\n")}\n`, { mode: 0o600 });
  // Distinct mtimes keep the resolver's change detection honest even
  // when two writes land inside one filesystem timestamp tick.
  const later = new Date(Date.now() + 1100);
  utimesSync(file, later, later);
}

describe("createStoreFleetConfigResolver", () => {
  it("serves a key seated in the store", () => {
    const { env, file } = tempHome();
    writeStore(file, { [KEY]: "sk-stored" });
    const resolver = createStoreFleetConfigResolver(env);
    assert.equal(resolver.valueFor(KEY), "sk-stored");
    assert.equal(resolver.valueFor("QWEN_API_KEY"), undefined);
  });

  it("picks up a key seated after creation, with no restart", () => {
    const { env, file } = tempHome();
    const resolver = createStoreFleetConfigResolver(env);
    assert.equal(resolver.valueFor(KEY), undefined);
    writeStore(file, { [KEY]: "sk-arrived-late" });
    assert.equal(resolver.valueFor(KEY), "sk-arrived-late");
  });

  it("picks up a rotated key on the next read", () => {
    const { env, file } = tempHome();
    writeStore(file, { [KEY]: "sk-first" });
    const resolver = createStoreFleetConfigResolver(env);
    assert.equal(resolver.valueFor(KEY), "sk-first");
    writeStore(file, { [KEY]: "sk-second-rotated" });
    assert.equal(resolver.valueFor(KEY), "sk-second-rotated");
  });

  it("the launching environment wins over the store", () => {
    const { env, file } = tempHome();
    writeStore(file, { [KEY]: "sk-stored" });
    env[KEY] = "sk-from-env";
    const resolver = createStoreFleetConfigResolver(env);
    assert.equal(resolver.valueFor(KEY), "sk-from-env");
  });

  it("a blank environment value does not shadow the store", () => {
    const { env, file } = tempHome();
    writeStore(file, { [KEY]: "sk-stored" });
    env[KEY] = "";
    const resolver = createStoreFleetConfigResolver(env);
    assert.equal(resolver.valueFor(KEY), "sk-stored");
  });

  it("fails loud at creation on a malformed document", () => {
    const { env, file } = tempHome();
    writeFileSync(file, "version: 1\nbogus: true\n", { mode: 0o600 });
    assert.throws(() => createStoreFleetConfigResolver(env));
  });

  it("resolves the provider selector through the same name-agnostic path", () => {
    const { env } = tempHome();
    env["REDTEAM_LLM_PROVIDER"] = "deepseek";
    const resolver = createStoreFleetConfigResolver(env);
    assert.equal(resolver.valueFor("REDTEAM_LLM_PROVIDER"), "deepseek");
  });
});
