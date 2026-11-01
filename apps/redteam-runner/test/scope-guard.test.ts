/**
 * Scope guard tests — the TypeScript port of the ZimZilla scope pair.
 *
 * The first two describes port the guard-relevant checks from the Python
 * suite (tests/test_scope_validator.py, which passed at intake) plus the
 * membership/extraction semantics of zimzilla/scope.py itself: allow/deny
 * matching for domains, subdomains, IPs and CIDRs, deny-beats-allow
 * precedence, the local-host rule, and the command-text scan with its
 * fail-closed substitution case. The validator's own checks (extraction
 * JSON parsing, ranking, tree rendering) have no runner counterpart and
 * are not ported; its `_classify` cases are, via classifyScopeEntry.
 *
 * The last describe pins the dispatch choke point: dispatchTool must
 * refuse an out-of-scope or deny-listed target — and a command that
 * reaches a deny-listed host — before any handler or executor runs, and
 * must leave in-scope calls untouched.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HostSet,
  ScopeGuard,
  classifyScopeEntry,
  commandUsesNetworkTool,
  extractTargets,
  scopeGuardFor,
} from "../src/safety/scope-guard.js";
import { authorizePhase } from "../src/phases/authorize.js";
import { dispatchTool } from "../src/dispatch/router.js";
import type { Ctx } from "../src/context.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";

// The scope mappings the Python validator's build_scope produces for its
// fixture programme (Acme Bounty): wildcard *.acme.com becomes its base
// domain; the iOS app is unplaceable and skipped.
const ALLOW_MAPPING = {
  domains: ["acme.com", "api.acme.io"],
  ips: ["203.0.113.10"],
  cidrs: ["198.51.100.0/24"],
};
const DENY_MAPPING = { domains: ["status.acme.com", "staging.acme.com"] };

describe("ported from test_scope_validator.py", () => {
  it("classifyScopeEntry matches the Python _classify cases", () => {
    const cases: Record<string, string> = {
      "*.acme.com": "wildcard",
      "api.acme.io": "domain",
      "203.0.113.10": "ip",
      "198.51.100.0/24": "cidr",
      "Acme iOS app": "other",
      "999.1.1.1": "other",
      "https://x.io/path": "domain",
      "2001:db8::1": "ip",
      "fe80::/10": "cidr",
    };
    for (const [asset, want] of Object.entries(cases)) {
      assert.equal(classifyScopeEntry(asset), want, `classify ${asset}`);
    }
  });

  it("guard: allowed host is in allow list", () => {
    const allow = HostSet.fromMapping(ALLOW_MAPPING);
    assert.equal(allow.contains("api.acme.io").member, true);
  });

  it("guard: deny beats allow for out-of-scope host", () => {
    const deny = HostSet.fromMapping(DENY_MAPPING);
    assert.equal(deny.contains("status.acme.com").member, true);
    // status.acme.com is also a subdomain of allow-listed acme.com — the
    // guard must still refuse it (deny precedence, exercised end to end).
    const guard = ScopeGuard.fromRoe({
      scope: ["*.acme.com", "api.acme.io", "203.0.113.10", "198.51.100.0/24"],
      outOfScope: ["status.acme.com", "*.staging.acme.com"],
    });
    const v = guard.checkHost("status.acme.com");
    assert.equal(v.allowed, false);
    assert.equal(v.kind, "deny");
  });

  it("guard: wildcard subdomain matched", () => {
    const allow = HostSet.fromMapping(ALLOW_MAPPING);
    assert.equal(allow.contains("www.acme.com").member, true);
  });

  it("recon-guard semantics: deny matches subdomains of a denied host", () => {
    // The Python recon guard skips any host the deny set contains,
    // including subdomains — www.status.acme.com must be a member.
    const deny = HostSet.fromMapping(DENY_MAPPING);
    assert.equal(deny.contains("www.status.acme.com").member, true);
    assert.equal(deny.contains("api.acme.io").member, false);
  });

  it("unplaceable assets are reported as skipped, not dropped", () => {
    const { set, skipped } = HostSet.fromEntries(["*.acme.com", "api.acme.io", "203.0.113.10", "198.51.100.0/24", "Acme iOS app"]);
    assert.ok(set.domains.has("acme.com"), "wildcard becomes its base domain");
    assert.deepEqual([...set.ips], ["203.0.113.10"]);
    assert.equal(set.cidrs.length, 1);
    assert.deepEqual(skipped, ["Acme iOS app"]);
  });
});

describe("HostSet.contains — scope.py membership semantics", () => {
  const allow = HostSet.fromMapping(ALLOW_MAPPING);

  it("empty host is not a member", () => {
    assert.deepEqual(allow.contains(""), { member: false, reason: "empty" });
  });

  it("local hosts are never members, even when listed", () => {
    const s = HostSet.fromMapping({ ips: ["127.0.0.1"], domains: ["localhost"] });
    for (const h of ["localhost", "127.0.0.1", "::1", "0.0.0.0"]) {
      assert.deepEqual(s.contains(h), { member: false, reason: "local" }, h);
    }
  });

  it("IP membership: listed ip, CIDR containment, unlisted ip", () => {
    assert.deepEqual(allow.contains("203.0.113.10"), { member: true, reason: "listed ip" });
    assert.deepEqual(allow.contains("198.51.100.42"), { member: true, reason: "in 198.51.100.0/24" });
    assert.deepEqual(allow.contains("192.0.2.1"), { member: false, reason: "ip not listed" });
  });

  it("hostname membership: exact, subdomain, boundary, case, root dot", () => {
    assert.equal(allow.contains("api.acme.io").reason, "listed domain");
    assert.equal(allow.contains("deep.sub.acme.com").member, true);
    assert.equal(allow.contains("evilacme.com").member, false, "suffix without a dot boundary is not a subdomain");
    assert.equal(allow.contains("WWW.Acme.COM").member, true, "case-insensitive");
    assert.equal(allow.contains("www.acme.com.").member, true, "FQDN root dot is the same host");
    assert.deepEqual(allow.contains("example.org"), { member: false, reason: "host not listed" });
  });

  it("IPv6: CIDR containment and family separation", () => {
    const { set } = HostSet.fromEntries(["2001:db8::/32", "10.0.0.0/8"]);
    assert.equal(set.contains("2001:db8::1").member, true);
    assert.equal(set.contains("2001:db9::1").member, false);
    assert.equal(set.contains("10.2.3.4").member, true);
    assert.equal(set.contains("::ffff:10.2.3.4").member, false, "an IPv6 address never matches an IPv4 network");
  });

  it("fromMapping accepts the Python key spellings and ip-key CIDRs", () => {
    const s = HostSet.fromMapping({
      in_scope: ["Example.COM"],
      hosts: ["10.0.0.0/8", "192.0.2.5", "node.internal"],
      networks: ["2001:db8::/32"],
    });
    assert.equal(s.contains("example.com").member, true);
    assert.equal(s.contains("node.internal").member, true, "non-IP hosts-key entries normalise to domains");
    assert.equal(s.contains("10.9.9.9").reason, "in 10.0.0.0/8");
    assert.equal(s.contains("2001:db8::5").member, true);
  });

  it("fromMapping normalises URL entries under the domain keys", () => {
    const s = HostSet.fromMapping({ domains: ["https://App.Example.com:8443/x"] });
    assert.equal(s.contains("app.example.com").member, true);
  });
});

describe("ScopeGuard.checkHost — allow/deny decision", () => {
  it("no scope declared allows (the Python no-scope-files case)", () => {
    const g = ScopeGuard.fromRoe({});
    assert.equal(g.checkHost("anything.example").allowed, true);
  });

  it("in-scope forms pass: exact, subdomain, CIDR member, listed IP", () => {
    const g = ScopeGuard.fromRoe({ scope: ["example.com", "10.0.0.0/24", "203.0.113.10"] });
    assert.equal(g.checkHost("example.com").allowed, true);
    assert.equal(g.checkHost("api.example.com").allowed, true);
    assert.equal(g.checkHost("10.0.0.77").allowed, true);
    assert.equal(g.checkHost("203.0.113.10").allowed, true);
  });

  it("hosts outside the allow set are refused as out of scope", () => {
    const g = ScopeGuard.fromRoe({ scope: ["example.com"] });
    const v = g.checkHost("evil.example");
    assert.equal(v.allowed, false);
    assert.equal(v.kind, "allow");
    assert.match(v.reason, /out of scope/);
  });

  it("deny wins over allow for hosts and their subdomains", () => {
    const g = ScopeGuard.fromRoe({ scope: ["acme.com"], outOfScope: ["status.acme.com"] });
    assert.equal(g.checkHost("status.acme.com").kind, "deny");
    assert.equal(g.checkHost("www.status.acme.com").kind, "deny");
    assert.equal(g.checkHost("api.acme.com").allowed, true);
  });

  it("local hosts: allowed only when literally listed in scope", () => {
    const listed = ScopeGuard.fromRoe({ scope: ["127.0.0.1:19100"] });
    assert.equal(listed.checkHost("127.0.0.1").allowed, true);
    const unlisted = ScopeGuard.fromRoe({ scope: ["example.com"], outOfScope: ["localhost"] });
    const v = unlisted.checkHost("localhost");
    assert.equal(v.allowed, false, "the deny list cannot block a local host, but an unlisted local host is still out of scope");
    assert.equal(v.kind, "allow");
  });

  it("unclassifiable scope entries surface on the guard", () => {
    const g = ScopeGuard.fromRoe({ scope: ["example.com", "Acme iOS app"] });
    assert.deepEqual(g.skippedEntries, ["Acme iOS app"]);
    assert.equal(g.checkHost("example.com").allowed, true);
  });
});

describe("command scan — scope.py extraction and check_command", () => {
  const guard = ScopeGuard.fromRoe({ scope: ["acme.com"], outOfScope: ["status.acme.com", "10.9.9.9"] });

  it("commandUsesNetworkTool sees through pipes, assignments and prefixes", () => {
    assert.equal(commandUsesNetworkTool("cat x | curl https://a.example"), true);
    assert.equal(commandUsesNetworkTool("FOO=bar nmap example.com"), true);
    assert.equal(commandUsesNetworkTool("sudo wget http://x.example"), true);
    // Pinned blind spot, faithful to the Python source: prefix stripping
    // does not know `timeout` takes a duration argument, so "5" becomes
    // the apparent binary and the tool behind it is not seen.
    assert.equal(commandUsesNetworkTool("sudo timeout 5 wget http://x.example"), false);
    assert.equal(commandUsesNetworkTool("echo hello"), false);
    assert.equal(commandUsesNetworkTool("cat report.json"), false);
  });

  it("extractTargets: URLs, host:port, IPs, flag-embedded URLs", () => {
    assert.ok(extractTargets("curl https://evil.example/x").includes("evil.example"));
    assert.ok(extractTargets("nmap example.com:8443").includes("example.com"));
    assert.ok(extractTargets("ping 192.0.2.8").includes("192.0.2.8"));
    assert.ok(extractTargets("ffuf --url=https://evil.example/FUZZ").includes("evil.example"));
  });

  it("extractTargets: impacket and UNC forms are always targets", () => {
    const t = extractTargets("secretsdump.py corp.local/j.doe:Passw0rd@dc01.corp.local");
    assert.ok(t.includes("corp.local"), "the domain half is a target");
    assert.ok(t.includes("dc01.corp.local"), "the @host half is a target");
    assert.ok(extractTargets(String.raw`dir \\dc01.corp.local\SYSVOL`).includes("dc01.corp.local"));
  });

  it("extractTargets: bare hostnames need network context or a real TLD", () => {
    assert.deepEqual(extractTargets("cat report.json"), [], "a filename is not a host");
    assert.deepEqual(extractTargets("curl report.json"), ["report.json"], "in network context the same token is a target (Python behavior)");
    assert.ok(extractTargets("echo evil.com").includes("evil.com"), "a never-a-file-extension TLD counts without a network tool");
    assert.deepEqual(extractTargets("cat ./report.json"), [], "path-shaped tokens are filenames");
    assert.deepEqual(extractTargets("ping 1.2.3"), [], "version-shaped tokens are not hosts");
  });

  it("checkCommand: deny-listed targets are violations, in-scope are not", () => {
    const v = guard.checkCommand("curl https://status.acme.com/health");
    assert.equal(v.length, 1);
    assert.equal(v[0].target, "status.acme.com");
    assert.equal(v[0].reason, "listed domain");
    assert.equal(guard.checkCommand("curl https://www.status.acme.com/")[0].reason, "subdomain of status.acme.com");
    assert.deepEqual(guard.checkCommand("curl https://api.acme.com/"), []);
    assert.equal(guard.checkCommand("nmap 10.9.9.9")[0].target, "10.9.9.9");
  });

  it("checkCommand: repeated targets deduplicate", () => {
    assert.equal(guard.checkCommand("curl https://status.acme.com/a https://status.acme.com/b").length, 1);
  });

  it("checkCommand: dynamic-only target fails closed", () => {
    const v = guard.checkCommand("curl https://$(cat /tmp/t)/x");
    assert.equal(v.length, 1);
    assert.equal(v[0].target, "<command substitution>");
    // A literal target alongside the substitution is checked as usual.
    assert.deepEqual(guard.checkCommand("curl https://api.acme.com/$(whoami)"), []);
  });

  it("checkCommand: no deny list declared means no command enforcement", () => {
    const g = ScopeGuard.fromRoe({ scope: ["acme.com"] });
    assert.deepEqual(g.checkCommand("curl https://anything.example/"), []);
    assert.deepEqual(g.checkCommand("curl https://$(cat /tmp/t)/x"), []);
  });
});

describe("dispatch scope gate — the choke point", () => {
  interface FakeEvents {
    action: string;
    result: string;
    target?: string;
  }

  function fakeCtx(roe: { scope: string[]; outOfScope?: string[] }, opts: { verifiedScope?: string[] } = {}) {
    const appended: FakeEvents[] = [];
    const probes: Array<{ url: string }> = [];
    const sshCommands: string[] = [];
    const ctx = {
      input: { mode: "red", roe, fullBattery: false },
      ...(opts.verifiedScope ? { verifiedScope: opts.verifiedScope } : {}),
      hosts: roe.scope,
      events: {
        dir: "/tmp/scope-guard-test-no-such-dir",
        append: (e: FakeEvents) => appended.push(e),
      },
      hostKill: { aborted: false, controllers: new Set<AbortController>() },
      tier: { current: 2, declared: 2, chainSteps: new Map<string, number>() },
      safety: {
        limiter: { acquire: async () => {} },
        autoHalt: { isHalted: () => false, haltReason: () => undefined, recordOutcome: () => undefined },
        killSwitchAborts: 0,
        rpsPerHost: 5,
      },
      itemLedger: new Map(),
      opsecCooldown: new Set<string>(),
      coverage: new Set<string>(),
      targetCoverage: new Map(),
      probesUsed: 0,
      consecutive5xx: 0,
      prober: {
        probe: async (req: { url: string }) => {
          probes.push(req);
          return { status: 200, ms: 1, bodySnippet: "ok" };
        },
      },
      hostExecutor: {
        killSwitch: undefined,
        sshExec: async (a: { command: string }) => {
          sshCommands.push(a.command);
          return { summary: "ssh ok", output: "Linux", ok: true };
        },
      },
    } as unknown as Ctx;
    return { ctx, appended, probes, sshCommands };
  }

  const call = (name: string, args: Record<string, unknown>): ToolCallRequest =>
    ({ name, arguments: args }) as unknown as ToolCallRequest;

  it("refuses an out-of-scope http_probe before the prober runs", async () => {
    const { ctx, appended, probes } = fakeCtx({ scope: ["example.com"] });
    const r = await dispatchTool(ctx, "recon", "recon", call("http_probe", { url: "https://evil.example/" }));
    assert.match(r.result, /DENIED by scope/);
    assert.equal(probes.length, 0, "no probe was sent");
    assert.ok(appended.some((e) => e.action === "scope_violation"), "the refusal is a scope_violation audit event");
  });

  it("refuses a deny-listed host that is inside the allow set (deny beats allow)", async () => {
    const { ctx, appended, probes } = fakeCtx({ scope: ["acme.com"], outOfScope: ["status.acme.com"] });
    const r = await dispatchTool(ctx, "recon", "recon", call("http_probe", { url: "https://status.acme.com/" }));
    assert.match(r.result, /DENIED by scope/);
    assert.match(r.result, /out-of-scope list/);
    assert.equal(probes.length, 0);
    assert.ok(appended.some((e) => e.action === "scope_violation" && e.target === "status.acme.com"));
  });

  it("lets an in-scope http_probe through untouched", async () => {
    const { ctx, probes } = fakeCtx({ scope: ["example.com"] });
    const r = await dispatchTool(ctx, "recon", "recon", call("http_probe", { url: "https://example.com/" }));
    assert.match(r.result, /^HTTP 200/);
    assert.equal(probes.length, 1);
  });

  it("lets a subdomain of a listed domain through the dispatch gate", async () => {
    // The guard's allow matching covers subdomains of a listed domain;
    // downstream per-tool checks still apply their own rules (the fake
    // prober here stands in for them and accepts).
    const { ctx, probes } = fakeCtx({ scope: ["example.com"] });
    const r = await dispatchTool(ctx, "recon", "recon", call("http_probe", { url: "https://api.example.com/" }));
    assert.match(r.result, /^HTTP 200/);
    assert.equal(probes.length, 1);
  });

  it("refuses an ssh_exec whose command reaches a deny-listed host, before the executor runs", async () => {
    const { ctx, appended, sshCommands } = fakeCtx({ scope: ["app.example.com"], outOfScope: ["status.example.com"] });
    const r = await dispatchTool(
      ctx,
      "exploiter",
      "exploit",
      call("ssh_exec", { host: "app.example.com", targetProfile: "linux", command: "curl https://status.example.com/x" }),
    );
    assert.match(r.result, /DENIED by scope/);
    assert.match(r.result, /status\.example\.com/);
    assert.equal(sshCommands.length, 0, "the executor was never invoked");
    assert.ok(appended.some((e) => e.action === "scope_violation"));
  });

  it("lets an ssh_exec with a clean command through to the executor", async () => {
    const { ctx, sshCommands } = fakeCtx({ scope: ["app.example.com"], outOfScope: ["status.example.com"] });
    const r = await dispatchTool(
      ctx,
      "exploiter",
      "exploit",
      call("ssh_exec", { host: "app.example.com", targetProfile: "linux", command: "uname -a" }),
    );
    assert.ok(!/DENIED by scope/.test(r.result), "the scope gate did not refuse it");
    assert.deepEqual(sshCommands, ["uname -a"]);
  });

  it("record scope wins at dispatch: a host in the record but not the launch scope is allowed", async () => {
    // The launch request declared launch.example.com; the AUTHORIZE
    // phase attested record.example.com instead. The record governs.
    const { ctx, probes } = fakeCtx({ scope: ["launch.example.com"] }, { verifiedScope: ["record.example.com"] });
    const r = await dispatchTool(ctx, "recon", "recon", call("http_probe", { url: "https://record.example.com/" }));
    assert.match(r.result, /^HTTP 200/);
    assert.equal(probes.length, 1);
  });

  it("record scope wins at dispatch: a host in the launch scope but NOT in the record is denied, zero dispatch", async () => {
    const { ctx, appended, probes } = fakeCtx({ scope: ["launch.example.com"] }, { verifiedScope: ["record.example.com"] });
    const r = await dispatchTool(ctx, "recon", "recon", call("http_probe", { url: "https://launch.example.com/" }));
    assert.match(r.result, /DENIED by scope/);
    assert.equal(probes.length, 0, "no probe was sent to the unattested host");
    assert.ok(appended.some((e) => e.action === "scope_violation" && e.target === "launch.example.com"));
  });

  it("the ROE out-of-scope deny still beats the record allow set", async () => {
    const { ctx, probes } = fakeCtx(
      { scope: ["acme.com"], outOfScope: ["status.acme.com"] },
      { verifiedScope: ["acme.com"] },
    );
    const r = await dispatchTool(ctx, "recon", "recon", call("http_probe", { url: "https://status.acme.com/" }));
    assert.match(r.result, /DENIED by scope/);
    assert.match(r.result, /out-of-scope list/);
    assert.equal(probes.length, 0);
  });
});

describe("scopeGuardFor — the verified record is the allow source", () => {
  it("builds from the launch ROE until authorize stamps the record, then rebuilds from the record", () => {
    const ctx: Parameters<typeof scopeGuardFor>[0] = {
      input: { roe: { scope: ["launch.example.com"] } },
    };
    const launchGuard = scopeGuardFor(ctx);
    assert.equal(launchGuard.checkHost("launch.example.com").allowed, true);
    assert.equal(launchGuard.checkHost("record.example.com").allowed, false);

    ctx.verifiedScope = ["record.example.com"];
    const recordGuard = scopeGuardFor(ctx);
    assert.notEqual(recordGuard, launchGuard, "the cached launch guard is rebuilt once the record lands");
    assert.equal(recordGuard.checkHost("record.example.com").allowed, true);
    assert.equal(recordGuard.checkHost("launch.example.com").allowed, false, "launch scope no longer governs");
  });

  it("fromVerifiedRecord matches fromRoe membership for the same entries, deny included", () => {
    const record = ScopeGuard.fromVerifiedRecord({
      verifiedScope: ["acme.com", "10.0.0.0/24"],
      outOfScope: ["status.acme.com"],
    });
    assert.equal(record.checkHost("api.acme.com").allowed, true);
    assert.equal(record.checkHost("10.0.0.9").allowed, true);
    assert.equal(record.checkHost("status.acme.com").kind, "deny");
    assert.equal(record.checkHost("other.example").allowed, false);
  });
});

describe("authorize phase — stamps the verified record the guard derives from", () => {
  it("on success, ctx.verifiedScope is the attested scope and a later launch-object edit does not move the guard", async () => {
    const appended: Array<{ action: string; result: string }> = [];
    const ctx = {
      domain: "example.com",
      hosts: ["example.com", "api.example.com"],
      input: {
        mode: "red",
        objective: "record-scope proof",
        operatorName: "Test Operator",
        roe: { scope: ["example.com", "api.example.com"], outOfScope: [] as string[] },
      },
      config: { testMode: false, verifyViaService: false, mcpEndpoint: "", mcpToken: "", localSandbox: false },
      deps: {},
      events: {
        append: (e: { action: string; result: string }) => appended.push(e),
        updateState: () => undefined,
      },
    } as unknown as Ctx;

    const verdict = await authorizePhase(ctx);
    assert.equal(verdict.allowed, true);
    assert.deepEqual(ctx.verifiedScope, ["example.com", "api.example.com"]);
    assert.ok(appended.some((e) => e.action === "scope_guard"), "the guard state is in the audit log");

    // The launch object is edited after authorize (a different scope
    // entirely): the guard keeps enforcing the attested record.
    ctx.input.roe.scope = ["mutated.example.org"];
    const guard = scopeGuardFor(ctx);
    assert.equal(guard.checkHost("api.example.com").allowed, true, "the attested host stays in scope");
    assert.equal(guard.checkHost("mutated.example.org").allowed, false, "the unattested host stays out of scope");
  });
});
