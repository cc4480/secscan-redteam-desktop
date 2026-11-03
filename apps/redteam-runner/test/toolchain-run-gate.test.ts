/**
 * Run-path presence gating for dead toolchain env overrides (S4-H2).
 *
 * `toolchain.ts` honours an explicit env override (REDTEAM_FFUF_BIN,
 * REDTEAM_NMAP_BIN, …) even when the path is missing, and reports that
 * honestly as { source: "explicit", exists: false } — readiness depends on
 * that contract, so the resolver does not change. The defect was that the
 * xtool `run` and nmap `scan` dispatch paths never read the presence flag
 * before spawning: a stale override (the 2026-11-02 incident, where seven
 * REDTEAM_* vars pointed into a deleted tools tree) beat the working
 * bundled binary and failed opaquely as "exited null". The probe path
 * already gated on presence; these tests pin the run paths to the same
 * UNAVAILABLE + setup-text refusal, before any spawn.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { handleXTool } from "../src/dispatch/xtool.js";
import { handleNmapTools } from "../src/dispatch/nmap.js";
import { resolveExternalBinary } from "../src/toolchain.js";
import type { Ctx } from "../src/context.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";

const EXE = process.platform === "win32" ? ".exe" : "";

function baseCtx(over: Record<string, unknown> = {}): Ctx {
  return {
    input: { mode: "red", roe: { excludedTechniques: [], scope: ["seclayer.app"] } },
    tier: { current: 1 },
    hosts: ["seclayer.app"],
    probesUsed: 0,
    hostKill: { controllers: new Set() },
    safety: { rpsPerHost: 5 },
    ...over,
  } as unknown as Ctx;
}

const call = (name: string): ToolCallRequest => ({ name }) as unknown as ToolCallRequest;

/** Run `fn` with the given process.env overrides, restoring the old values. */
async function withEnv<T>(over: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(over)) {
    saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/**
 * A throwaway tools tree holding a WORKING bundled ffuf (a tiny script that
 * emits one JSONL hit and exits 0) plus a bundled wordlist, and a dummy
 * bundled nmap file (presence is a filesystem fact; the nmap executor is
 * mocked in these tests, so the file is never executed).
 */
function bundledTree(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "rt-run-gate-"));
  const ffuf = join(root, "ffuf", `ffuf${EXE}`);
  mkdirSync(dirname(ffuf), { recursive: true });
  writeFileSync(ffuf, '#!/bin/sh\necho \'{"url":"https://seclayer.app/admin","status":200,"length":12}\'\n');
  chmodSync(ffuf, 0o755);
  const nmap = join(root, "nmap", `nmap${EXE}`);
  mkdirSync(dirname(nmap), { recursive: true });
  writeFileSync(nmap, "");
  mkdirSync(join(root, "wordlists"), { recursive: true });
  writeFileSync(join(root, "wordlists", "common.txt"), "admin\n");
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("xtool run path: dead explicit override is refused, not spawned", () => {
  it("ffuf run with a dead REDTEAM_FFUF_BIN returns UNAVAILABLE + setup text", async () => {
    const { root, cleanup } = bundledTree();
    try {
      const dead = join(root, "deleted-tools", `ffuf${EXE}`);
      const r = await withEnv(
        { REDTEAM_TOOLS_DIR: root, REDTEAM_FFUF_BIN: dead, REDTEAM_WORDLIST: undefined },
        () =>
          handleXTool(baseCtx(), "recon", "recon", call("ffuf_exec"), {
            action: "run",
            host: "https://seclayer.app/FUZZ",
            targetProfile: "linux",
            profile: "dirs",
          }),
      );
      assert.ok(r, "handled");
      // The probe path's refusal shape: UNAVAILABLE plus the tool's setup
      // text — not the spawn failure ("exited null") the run path used to
      // produce after trying the dead path.
      assert.match(r.result, /^UNAVAILABLE:/, "refused as UNAVAILABLE before spawning");
      assert.match(r.result, /ffuf not found/, "carries the ffuf setup text");
      assert.ok(!/exited null/.test(r.result), "never reached the executor's spawn result");
    } finally {
      cleanup();
    }
  });

  // POSIX-only control: the fixture stands in for the bundled binary with a `#!/bin/sh`
  // script, and a Windows fixture cannot synthesize a real PE to satisfy `ffuf.exe`. The
  // refusal tests above (the security property) run on every platform; only this
  // "the bundled copy actually executes" control cannot be faked on Windows.
  it("control: ffuf run with no override resolves the bundled copy and proceeds", { skip: process.platform === "win32" ? "needs a real PE: a fixture cannot synthesize ffuf.exe on Windows" : false }, async () => {
    const { root, cleanup } = bundledTree();
    try {
      const r = await withEnv(
        { REDTEAM_TOOLS_DIR: root, REDTEAM_FFUF_BIN: undefined, REDTEAM_WORDLIST: undefined },
        () =>
          handleXTool(baseCtx(), "recon", "recon", call("ffuf_exec"), {
            action: "run",
            host: "https://seclayer.app/FUZZ",
            targetProfile: "linux",
            profile: "dirs",
          }),
      );
      assert.ok(r, "handled");
      assert.ok(!/^UNAVAILABLE:/.test(r.result), "bundled copy is present, so no refusal");
      assert.match(r.result, /ffuf dirs on https:\/\/seclayer\.app\/FUZZ exited 0/, "the bundled ffuf actually ran");
      assert.match(r.result, /1 finding\(s\)/, "its output was parsed");
    } finally {
      cleanup();
    }
  });

  it("control: the probe path's existing gating is unchanged (dead override → UNAVAILABLE)", async () => {
    const r = await withEnv(
      { REDTEAM_FFUF_BIN: "/no/such/ffuf", REDTEAM_TOOLS_DIR: undefined },
      () =>
        handleXTool(baseCtx(), "recon", "recon", call("ffuf_exec"), {
          action: "probe",
          host: "",
          targetProfile: "linux",
        }),
    );
    assert.ok(r, "handled");
    assert.match(r.result, /^UNAVAILABLE:/);
    assert.match(r.result, /ffuf not found/);
  });
});

describe("nmap scan path: dead explicit override is refused, not spawned", () => {
  it("scan with a dead REDTEAM_NMAP_BIN returns UNAVAILABLE + setup text before exec.scan", async () => {
    const { root, cleanup } = bundledTree();
    let scanned = false;
    try {
      const ctx = baseCtx({
        nmapExecutor: {
          scan: async () => {
            scanned = true;
            return { ok: true, message: "ok", run: { hosts: [] } };
          },
          profiles: async () => ({ message: "Profiles" }),
        },
      });
      const r = await withEnv(
        { REDTEAM_TOOLS_DIR: root, REDTEAM_NMAP_BIN: join(root, "deleted-tools", `nmap${EXE}`) },
        () =>
          handleNmapTools(ctx, "recon", "recon", call("nmap_exec"), {
            action: "scan",
            host: "seclayer.app",
            targetProfile: "linux",
            profile: "quick",
          }),
      );
      assert.ok(r, "handled");
      assert.match(r.result, /^UNAVAILABLE:/, "refused as UNAVAILABLE before scanning");
      assert.match(r.result, /nmap binary not found/, "carries the nmap setup text");
      assert.equal(scanned, false, "exec.scan was never invoked");
    } finally {
      cleanup();
    }
  });

  it("control: scan with no override resolves the bundled copy and proceeds to exec.scan", async () => {
    const { root, cleanup } = bundledTree();
    let scanned: string | null = null;
    try {
      const ctx = baseCtx({
        nmapExecutor: {
          scan: async (a: { target: string }) => {
            scanned = a.target;
            return { ok: true, message: "ok", run: { hosts: [] } };
          },
          profiles: async () => ({ message: "Profiles" }),
        },
      });
      const r = await withEnv({ REDTEAM_TOOLS_DIR: root, REDTEAM_NMAP_BIN: undefined }, () =>
        handleNmapTools(ctx, "recon", "recon", call("nmap_exec"), {
          action: "scan",
          host: "seclayer.app",
          targetProfile: "linux",
          profile: "quick",
        }),
      );
      assert.ok(r, "handled");
      assert.ok(!/^UNAVAILABLE:/.test(r.result), "bundled copy is present, so no refusal");
      assert.equal(scanned, "seclayer.app", "exec.scan received the in-scope host");
    } finally {
      cleanup();
    }
  });
});

describe("readiness contract: the resolver itself is unchanged", () => {
  it("still reports a dead explicit override as { source: 'explicit', exists: false }", () => {
    const r = resolveExternalBinary("ffuf", { env: { REDTEAM_FFUF_BIN: "/no/such/ffuf" } });
    assert.equal(r.source, "explicit");
    assert.equal(r.exists, false);
    assert.equal(r.path, "/no/such/ffuf");
    assert.equal(r.envVar, "REDTEAM_FFUF_BIN");
  });
});
