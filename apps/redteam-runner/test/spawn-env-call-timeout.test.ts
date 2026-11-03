/**
 * S4-H3: the two Hop-3 confinement defects.
 *
 * (1) Scrubbed spawn env — external tools were spawned with the runner's
 * full environment (denylist-scrubbed at best), so any env var whose name
 * the denylist did not recognise — a session cookie, a Kerberos ccache —
 * reached the child. The fix is an ALLOWLIST (toolchain.toolChildEnv):
 * system essentials + the REDTEAM_* tool-location vars only. Proven at
 * the unit seam and at the real spawn seams (xtool via its fake-spawn
 * capture, nmap and nuclei via a real child printing its own env; the
 * net/nping spawn is the same realNmapSpawn, net/executor.ts).
 *
 * (2) Timeouts that fire — the per-call AbortControllers were created in
 * the handlers but nothing ever aborted them, so a hung tool held its
 * dispatch slot forever. The router now creates the controller, arms it
 * from dispatch/timeout.ts, and passes its signal down the handler
 * chain. Proven through the real dispatchTool: a never-settling call
 * returns the typed TOOL_TIMEOUT at ~its budget with its executor signal
 * aborted; a call that settles first is unaffected and never aborted late.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toolChildEnv } from "../src/toolchain.js";
import { findXTool } from "../src/xtool/registry.js";
import { runXTool, type XSpawnFn } from "../src/xtool/executor.js";
import { realNmapSpawn } from "../src/nmap/runner.js";
import { realNucleiSpawn } from "../src/nuclei/runner.js";
import { armCallTimeout, resolveCallTimeoutMs, TOOL_TIMEOUT } from "../src/dispatch/timeout.js";
import { dispatchTool } from "../src/dispatch/router.js";
import { TargetRateLimiter } from "../src/safety/ratelimit.js";
import { CredentialAttemptGuard } from "../src/safety/lockout.js";
import type { Ctx } from "../src/context.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";

const SENTINELS: Record<string, string> = {
  MODEL_API_KEY: "LEAK-APIKEY",
  ZZ_PLAIN_SENTINEL: "LEAK-PLAIN",
  REDTEAM_KRB_CCACHE_B64: "LEAK-CCACHE",
  REDTEAM_SSH_PASSWORD: "LEAK-SSHPW",
  REDTEAM_MSFRPC_PASS: "LEAK-MSF",
};

describe("toolChildEnv — the spawn allowlist", () => {
  it("drops every secret-shaped and unlisted var, keeps system + tool-location vars", () => {
    const env = toolChildEnv({
      ...SENTINELS,
      PATH: "/usr/bin",
      SystemRoot: "C:\\Windows",
      TEMP: "/tmp",
      REDTEAM_TOOLS_DIR: "/opt/tools",
      REDTEAM_NMAP_BIN: "/opt/tools/nmap",
      REDTEAM_NPING_BIN: "/opt/tools/nping",
      REDTEAM_WORDLIST: "/opt/tools/common.txt",
      REDTEAM_NUCLEI_TEMPLATES: "/opt/templates",
      REDTEAM_FFUF_BIN: "/opt/tools/ffuf",
    });
    for (const k of Object.keys(SENTINELS)) assert.ok(!(k in env), `${k} must not reach a child`);
    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.SystemRoot, "C:\\Windows");
    assert.equal(env.TEMP, "/tmp");
    assert.equal(env.REDTEAM_NMAP_BIN, "/opt/tools/nmap");
    assert.equal(env.REDTEAM_NPING_BIN, "/opt/tools/nping");
    assert.equal(env.REDTEAM_WORDLIST, "/opt/tools/common.txt");
    assert.equal(env.REDTEAM_NUCLEI_TEMPLATES, "/opt/templates");
    assert.equal(env.REDTEAM_FFUF_BIN, "/opt/tools/ffuf");
  });
});

describe("spawn seams hand the child the allowlisted env", () => {
  it("xtool: the captured spawn env is scrubbed, PATH + tool var survive", async () => {
    const spec = findXTool("ffuf");
    assert.ok(spec);
    let captured: NodeJS.ProcessEnv | undefined;
    const fakeSpawn: XSpawnFn = async (opts) => {
      captured = opts.env;
      return { stdout: "", stderr: "", code: 0, timedOut: false };
    };
    await runXTool(
      spec,
      { action: "run", target: "https://example.invalid", profileId: spec.profiles[0]!.id, wordlist: "/tmp/wl.txt", rateLimit: 0, timeoutS: 5, env: { ...SENTINELS, PATH: "/usr/bin", REDTEAM_FFUF_BIN: "/opt/tools/ffuf" } },
      fakeSpawn,
    );
    assert.ok(captured);
    for (const k of Object.keys(SENTINELS)) assert.ok(!(k in captured), `${k} leaked to the xtool child`);
    assert.equal(captured.PATH, "/usr/bin");
    assert.equal(captured.REDTEAM_FFUF_BIN, "/opt/tools/ffuf");
  });

  const PRINT_ENV = "process.stdout.write(JSON.stringify(process.env))";
  const withSentinels = async (fn: () => Promise<NodeJS.ProcessEnv>): Promise<NodeJS.ProcessEnv> => {
    const saved = { ...process.env };
    Object.assign(process.env, SENTINELS);
    try {
      return await fn();
    } finally {
      for (const k of Object.keys(SENTINELS)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  };

  it("nmap (and nping, which reuses realNmapSpawn): the real child's env is scrubbed", async () => {
    const env = await withSentinels(async () => {
      const r = await realNmapSpawn({ file: process.execPath, args: ["-e", PRINT_ENV], timeoutMs: 5000 });
      return JSON.parse(r.stdout) as NodeJS.ProcessEnv;
    });
    for (const k of Object.keys(SENTINELS)) assert.ok(!(k in env), `${k} leaked to the nmap child`);
    assert.ok(typeof env.PATH === "string" && env.PATH.length > 0);
  });

  it("nuclei: the real child's env is scrubbed", async () => {
    const env = await withSentinels(async () => {
      const r = await realNucleiSpawn()([process.execPath, "-e", PRINT_ENV], { timeoutMs: 5000 });
      return JSON.parse(r.stdout) as NodeJS.ProcessEnv;
    });
    for (const k of Object.keys(SENTINELS)) assert.ok(!(k in env), `${k} leaked to the nuclei child`);
    assert.ok(typeof env.PATH === "string" && env.PATH.length > 0);
  });
});

describe("dispatch call timeout — the armed controller", () => {
  it("resolveCallTimeoutMs honours a valid override and defaults otherwise", () => {
    assert.equal(resolveCallTimeoutMs({ REDTEAM_CALL_TIMEOUT_MS: "50" }), 50);
    assert.equal(resolveCallTimeoutMs({ REDTEAM_CALL_TIMEOUT_MS: "bogus" }), 1_200_000);
    assert.equal(resolveCallTimeoutMs({}), 1_200_000);
  });

  it("armCallTimeout aborts at the budget; the disarm prevents a late abort", async () => {
    const armed = new AbortController();
    armCallTimeout(armed, 40);
    await new Promise((r) => setTimeout(r, 160));
    assert.equal(armed.signal.aborted, true);

    const disarmed = new AbortController();
    const disarm = armCallTimeout(disarmed, 40);
    disarm();
    await new Promise((r) => setTimeout(r, 160));
    assert.equal(disarmed.signal.aborted, false);
  });
});

describe("dispatchTool — a hung call is bounded, a fast call untouched", () => {
  const HOST = "10.9.0.12";
  const CALL: ToolCallRequest = { id: "c1", name: "nmap_exec", arguments: { action: "scan", host: HOST, targetProfile: "windows", profile: "quick" } };

  function fakeCtx(executor: unknown): Ctx {
    return {
      input: { mode: "red", roe: { scope: [HOST], outOfScope: [] }, fullBattery: false },
      hosts: [HOST],
      events: { dir: "/tmp/s4h3-no-such-dir", engagementId: "eng-s4h3", append: () => {}, updateState: () => {} },
      tier: { current: 2, declared: 2, chainSteps: new Map() },
      safety: { limiter: new TargetRateLimiter({ rpsPerHost: 1000, burst: 1000 }, () => 0), lockout: new CredentialAttemptGuard(), rpsPerHost: 5, environment: "staging", productionConfirmed: false },
      itemLedger: new Map(),
      coverage: new Set(),
      targetCoverage: new Map(),
      probesUsed: 0,
      actions: 0,
      nmapExecutor: executor,
    } as never;
  }

  it("a never-settling call returns TOOL_TIMEOUT at ~the budget and its signal aborts", async () => {
    process.env.REDTEAM_CALL_TIMEOUT_MS = "50";
    process.env.REDTEAM_NMAP_BIN = process.execPath; // presence gate: explicit + exists
    let seenSignal: AbortSignal | undefined;
    const hanging = {
      scan: (a: { signal?: AbortSignal }) => {
        seenSignal = a.signal;
        return new Promise(() => {});
      },
      profiles: async () => ({ message: "x" }),
    };
    try {
      const t0 = Date.now();
      const d = await dispatchTool(fakeCtx(hanging), "recon", "recon", CALL);
      const elapsed = Date.now() - t0;
      assert.equal(d.errorCode, TOOL_TIMEOUT);
      assert.ok(d.result.startsWith("TIMEOUT: "));
      assert.equal(seenSignal?.aborted, true);
      assert.ok(elapsed < 5000, `call took ${elapsed}ms — the budget did not bound it`);
    } finally {
      delete process.env.REDTEAM_CALL_TIMEOUT_MS;
      delete process.env.REDTEAM_NMAP_BIN;
    }
  });

  it("a call that settles before its budget returns its own result and is never aborted late", async () => {
    process.env.REDTEAM_CALL_TIMEOUT_MS = "50";
    process.env.REDTEAM_NMAP_BIN = process.execPath;
    let seenSignal: AbortSignal | undefined;
    const fast = {
      scan: async (a: { signal?: AbortSignal }) => {
        seenSignal = a.signal;
        return { ok: true, message: "done", run: { hosts: [], summary: "none", upHostCount: 0, elapsedS: 0 } };
      },
      profiles: async () => ({ message: "x" }),
    };
    try {
      const d = await dispatchTool(fakeCtx(fast), "recon", "recon", CALL);
      assert.ok(d.result.includes("done"));
      assert.notEqual(d.errorCode, TOOL_TIMEOUT);
      await new Promise((r) => setTimeout(r, 200)); // 4x the budget
      assert.equal(seenSignal?.aborted, false);
    } finally {
      delete process.env.REDTEAM_CALL_TIMEOUT_MS;
      delete process.env.REDTEAM_NMAP_BIN;
    }
  });
});
