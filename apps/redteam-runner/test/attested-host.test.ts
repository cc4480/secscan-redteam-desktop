/**
 * Attested-host allowance (live run eng-2026-11-02-or12 defect 1).
 *
 * The fleet's web tools refused the engagement's own attested lab
 * target — http_probe: "private/loopback host rejected: 127.0.0.1";
 * secscan_exec: "Scanning private, loopback, or link-local addresses
 * is not allowed" — because the tool-internal egress guards never
 * consulted the verified engagement record. These tests pin the fix:
 *
 *  - a host in the attested verified set (ctx.verifiedScope, judged by
 *    the canonical scope guard) is allowed through BOTH guard layers
 *    even when private/loopback;
 *  - a host NOT attested keeps today's refusal, byte for byte;
 *  - link-local (169.254.0.0/16, fe80::/10) stays refused even when
 *    attested — cloud metadata is never a legitimate target;
 *  - with NO engagement record, behavior is exactly today's.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attestedHostAllowed } from "../src/safety/attested-host.js";
import { WebProber, validateProbeTarget } from "../src/prober.js";
import { handleSecscanTools } from "../src/dispatch/secscan.js";
import type { Ctx } from "../src/context.js";
import { assertPublicResolution, TargetValidationError } from "#secscan/targetGuard.js";

type GuardCtx = Parameters<typeof attestedHostAllowed>[0];

function recordCtx(verifiedScope?: string[], outOfScope?: string[]): GuardCtx {
  return {
    verifiedScope,
    input: { roe: { outOfScope } },
  } as GuardCtx;
}

describe("attestedHostAllowed — the verified record is the only key", () => {
  it("allows a literally attested loopback host, and nothing else", () => {
    const ctx = recordCtx(["127.0.0.1"]);
    assert.equal(attestedHostAllowed(ctx, "127.0.0.1"), true);
    assert.equal(attestedHostAllowed(ctx, "10.0.0.9"), false);
    assert.equal(attestedHostAllowed(ctx, "example.com"), false);
  });

  it("allows attested private hosts, including by attested CIDR", () => {
    assert.equal(attestedHostAllowed(recordCtx(["10.0.0.9"]), "10.0.0.9"), true);
    assert.equal(attestedHostAllowed(recordCtx(["10.0.0.0/8"]), "10.1.2.3"), true);
    assert.equal(attestedHostAllowed(recordCtx(["10.0.0.0/8"]), "192.168.1.1"), false);
  });

  it("no engagement record = nothing is attested (today's behavior)", () => {
    assert.equal(attestedHostAllowed(recordCtx(undefined), "127.0.0.1"), false);
    assert.equal(attestedHostAllowed(recordCtx([]), "127.0.0.1"), false);
  });

  it("an out-of-scope deny beats the attested allow (deny beats allow)", () => {
    const ctx = recordCtx(["10.0.0.9"], ["10.0.0.9"]);
    assert.equal(attestedHostAllowed(ctx, "10.0.0.9"), false);
    // (A loopback deny entry is inert in the canonical guard itself —
    // HostSet.contains never matches LOCAL_HOSTS — so the seam inherits
    // the dispatch gate's exact semantics rather than inventing its own.)
  });
});

describe("prober validateProbeTarget — attested allowance", () => {
  const SCOPE = ["127.0.0.1", "10.0.0.5", "169.254.169.254", "example.com"];
  const attested = (h: string) => h === "127.0.0.1" || h === "10.0.0.5" || h === "169.254.169.254";

  it("attested loopback and private targets pass validation", () => {
    assert.equal(validateProbeTarget("http://127.0.0.1:8000/", SCOPE, { attestedHost: attested }).ok, true);
    assert.equal(validateProbeTarget("http://10.0.0.5/", SCOPE, { attestedHost: attested }).ok, true);
  });

  it("unattested loopback keeps today's refusal verbatim", () => {
    const v = validateProbeTarget("http://127.0.0.1:8000/", SCOPE, {});
    assert.equal(v.ok, false);
    assert.equal(v.reason, "private/loopback host rejected: 127.0.0.1");
    const v2 = validateProbeTarget("http://127.0.0.1:8000/", SCOPE, { attestedHost: () => false });
    assert.equal(v2.ok, false);
    assert.equal(v2.reason, "private/loopback host rejected: 127.0.0.1");
  });

  it("attested link-local is STILL refused — metadata is never a target", () => {
    const v = validateProbeTarget("http://169.254.169.254/latest/meta-data/", SCOPE, { attestedHost: attested });
    assert.equal(v.ok, false);
    assert.match(v.reason ?? "", /link-local host rejected/);
  });

  it("attested public targets are unchanged", () => {
    assert.equal(validateProbeTarget("https://example.com/", SCOPE, { attestedHost: attested }).ok, true);
    assert.equal(validateProbeTarget("https://example.com/", SCOPE, {}).ok, true);
  });
});

describe("WebProber — attested loopback actually fetches; unattested refuses", () => {
  let server: Server;
  let port = 0;
  before(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("lab-ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("probe succeeds against an attested 127.0.0.1 target", async () => {
    const prober = new WebProber({
      scopeHosts: ["127.0.0.1"],
      minDelayMs: 0,
      attestedHost: (h) => attestedHostAllowed(recordCtx(["127.0.0.1"]), h),
    });
    const r = await prober.probe({ method: "GET", url: `http://127.0.0.1:${port}/` });
    assert.equal(r.status, 200);
    assert.match(r.bodySnippet ?? "", /lab-ok/);
  });

  it("the same probe without attestation refuses with the or12 message", async () => {
    const prober = new WebProber({ scopeHosts: ["127.0.0.1"], minDelayMs: 0 });
    await assert.rejects(
      prober.probe({ method: "GET", url: `http://127.0.0.1:${port}/` }),
      /\[prober\] refused: private\/loopback host rejected: 127\.0\.0\.1/,
    );
  });
});

describe("secscan targetGuard — attested allowance", () => {
  const yes = () => true;
  const onlyLoopback = (h: string) => h === "127.0.0.1";

  it("attested loopback/private literals resolve; unattested refuse verbatim", async () => {
    assert.deepEqual(await assertPublicResolution("127.0.0.1", { attestedHost: onlyLoopback }), ["127.0.0.1"]);
    assert.deepEqual(await assertPublicResolution("10.0.0.9", { attestedHost: yes }), ["10.0.0.9"]);
    await assert.rejects(assertPublicResolution("127.0.0.1", {}), (err: unknown) => {
      assert.ok(err instanceof TargetValidationError);
      assert.equal(err.code, "private_ip");
      assert.equal(err.message, "Scanning private, loopback, or link-local addresses is not allowed.");
      return true;
    });
    await assert.rejects(assertPublicResolution("127.0.0.1", { attestedHost: () => false }), /not allowed/);
  });

  it("attested link-local literals are STILL refused (v4 and v6)", async () => {
    await assert.rejects(assertPublicResolution("169.254.169.254", { attestedHost: yes }), /not allowed/);
    await assert.rejects(assertPublicResolution("fe80::1", { attestedHost: yes }), /not allowed/);
  });

  it("public literals are unchanged with and without an allowance", async () => {
    assert.deepEqual(await assertPublicResolution("8.8.8.8", {}), ["8.8.8.8"]);
    assert.deepEqual(await assertPublicResolution("8.8.8.8", { attestedHost: yes }), ["8.8.8.8"]);
  });
});

describe("secscan_exec dispatch — the or12 scenario end to end", () => {
  // Port 8000: the engine only scans ALLOWED_TARGET_PORTS, and 8080 is
  // the gauntlet lab target's home — colliding with it must fail loud,
  // never hang the suite on an unhandled listen error.
  let server: Server;
  before(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><head><title>lab</title></head><body>lab target</body></html>");
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(8000, "127.0.0.1", resolve);
    });
  });
  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function fakeCtx(verifiedScope?: string[]): Ctx {
    return {
      input: { mode: "red", roe: {}, fullBattery: false },
      verificationProof: "attested in the verified engagement record (test)",
      verifiedScope,
      coverage: new Set(),
      targetCoverage: new Map(),
      probesUsed: 0,
      liveFindings: [],
      fingerprint: { host: "127.0.0.1", stack: [], appType: "test" },
      registry: { confirmed: [], killed: [] },
      registryPath: join(mkdtempSync(join(tmpdir(), "attested-host-registry-")), "registry.json"),
      events: { engagementId: "attested-host-test", updateState: () => {}, append: () => {} },
    } as unknown as Ctx;
  }
  const CALL = { name: "secscan_exec" } as never;
  const ARGS = { url: "http://127.0.0.1:8000/", depth: "deep", category: "validation" };

  it("attested 127.0.0.1 target scans to completion", async () => {
    const r = await handleSecscanTools(fakeCtx(["127.0.0.1"]), "recon", "recon", CALL, ARGS);
    assert.equal(r?.ok, true);
    assert.match(r?.result ?? "", /^SecScan native scan complete:/);
  });

  it("the same target with NO record on file fails with the or12 refusal", async () => {
    const r = await handleSecscanTools(fakeCtx(undefined), "recon", "recon", CALL, ARGS);
    assert.equal(r?.ok, false);
    assert.match(r?.result ?? "", /Scanning private, loopback, or link-local addresses is not allowed/);
  });
});
