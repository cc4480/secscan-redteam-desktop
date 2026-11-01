/**
 * Research tools (deep-research-osint execution layer).
 *
 * All provider traffic is a fixture provider injected through
 * RunnerDeps — the suite never touches the live web. Fetch tests run
 * against a loopback HTTP server this file owns (ephemeral port,
 * closed in teardown). Dispatch goes through the real dispatchTool
 * wrapper at Tier 0, which is itself the tier-classification proof:
 * an unclassified tool fails closed to Tier 2 and every call below
 * would be denied.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import { dispatchTool } from "../src/dispatch/router.js";
import { COMMAND_TOOLS, EXPLOIT_TOOLS, RECON_TOOLS } from "../src/tools/compose.js";
import {
  ResearchError,
  type ResearchSearchHit,
  type ResearchSearchOptions,
  type SearchProvider,
} from "../src/research/provider.js";
import { buildBingSearchUrl, freshnessForSince, parseBingResults, unwrapBingHref } from "../src/research/bing.js";
import { classifyResearchHost, extractQueryHosts } from "../src/research/scope.js";
import { spillToolResult, readSpill } from "../src/tool-spill.js";
import { TargetRateLimiter } from "../src/safety/ratelimit.js";
import { TargetAutoHalt } from "../src/safety/autohalt.js";
import { CredentialAttemptGuard } from "../src/safety/lockout.js";
import type { Ctx } from "../src/context.js";

// ---------------------------------------------------------------------------
// Fixture provider
// ---------------------------------------------------------------------------

class FixtureProvider implements SearchProvider {
  readonly id = "fixture";
  readonly calls: { query: string; since?: string; limit: number }[] = [];
  constructor(private readonly outcome: ResearchSearchHit[] | Error) {}
  async search(query: string, opts: ResearchSearchOptions): Promise<ResearchSearchHit[]> {
    this.calls.push({ query, ...(opts.since ? { since: opts.since } : {}), limit: opts.limit });
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
}

const HIT_NEW: ResearchSearchHit = {
  title: "CVE-2024-3400 Detail - NVD",
  url: "https://nvd.nist.gov/vuln/detail/CVE-2024-3400",
  snippet: "A command injection vulnerability in Palo Alto Networks PAN-OS software.",
  publishedDate: "2026-10-12",
  source: "nvd.nist.gov",
};
const HIT_OLD: ResearchSearchHit = {
  title: "Old write-up",
  url: "https://blog.example.net/old-post",
  snippet: "An early analysis.",
  publishedDate: "2025-03-01",
};
const HIT_UNDATED: ResearchSearchHit = {
  title: "Vendor advisory",
  url: "https://vendor.example.org/advisory",
  snippet: "The vendor advisory text.",
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface AppendedEvent {
  action: string;
  result?: string;
  target?: string;
}

function researchCtx(provider: SearchProvider, opts?: { scope?: string[]; outOfScope?: string[]; verifiedScope?: string[] }) {
  const appended: AppendedEvent[] = [];
  const ctx = {
    input: { mode: "red", roe: { scope: opts?.scope ?? ["app.example.com"], outOfScope: opts?.outOfScope ?? [] }, fullBattery: false },
    hosts: [] as string[],
    config: { testMode: false },
    deps: { researchProvider: provider },
    ...(opts?.verifiedScope ? { verifiedScope: opts.verifiedScope } : {}),
    events: {
      dir: mkdtempSync(join(tmpdir(), "research-test-")),
      engagementId: "eng-research-test",
      append: (e: AppendedEvent) => appended.push(e),
      updateState: () => undefined,
    },
    hostKill: { aborted: false, controllers: new Set<AbortController>() },
    tier: { current: 0, declared: 0, chainSteps: new Map<string, number>() },
    safety: {
      limiter: new TargetRateLimiter({ rpsPerHost: 1000, burst: 1000 }, () => 0),
      autoHalt: new TargetAutoHalt(),
      lockout: new CredentialAttemptGuard(),
      killSwitchAborts: 0,
      rpsPerHost: 5,
    },
    itemLedger: new Map(),
    opsecCooldown: new Set<string>(),
    coverage: new Set<string>(),
    targetCoverage: new Map(),
    probesUsed: 0,
    consecutive5xx: 0,
    actions: 0,
  } as unknown as Ctx;
  return { ctx, appended };
}

const call = (name: string, args: Record<string, unknown>): ToolCallRequest =>
  ({ name, arguments: args }) as unknown as ToolCallRequest;

// ---------------------------------------------------------------------------
// Dispatch: search
// ---------------------------------------------------------------------------

describe("research_search — dispatch", () => {
  it("returns citable results with exact URLs, writes an audit event, and counts toward maxActions", async () => {
    const provider = new FixtureProvider([HIT_NEW, HIT_UNDATED]);
    const { ctx, appended } = researchCtx(provider);
    const r = await dispatchTool(ctx, "recon", "recon", call("research_search", { query: "CVE-2024-3400 affected versions" }));
    assert.equal(r.ok, true);
    assert.match(r.result, /\[1\] CVE-2024-3400 Detail - NVD \(nvd\.nist\.gov · 2026-10-12\)/);
    assert.ok(r.result.includes("https://nvd.nist.gov/vuln/detail/CVE-2024-3400"), "exact URL copied from provider output");
    assert.match(r.result, /\[2\] Vendor advisory \(.*undated\)/);
    assert.equal(appended.filter((e) => e.action === "research_search").length, 1);
    assert.equal((ctx as unknown as { actions: number }).actions, 1, "dispatch counted the call toward the action budget");
    assert.equal(provider.calls.length, 1);
  });

  it("honors since: results known to predate it are omitted, undated results kept, the bound reaches the provider", async () => {
    const provider = new FixtureProvider([HIT_OLD, HIT_NEW, HIT_UNDATED]);
    const { ctx } = researchCtx(provider);
    const r = await dispatchTool(ctx, "recon", "recon", call("research_search", { query: "PAN-OS advisory", since: "2026-06-01" }));
    assert.equal(r.ok, true);
    assert.ok(!r.result.includes(HIT_OLD.url), "the 2025 result is omitted");
    assert.ok(r.result.includes(HIT_NEW.url));
    assert.ok(r.result.includes(HIT_UNDATED.url), "undated results are kept");
    assert.match(r.result, /1 returned result\(s\) known to predate since=2026-06-01 were omitted/);
    assert.equal(provider.calls[0].since, "2026-06-01");
  });

  it("denies a query naming a deny-listed target host with SCOPE-EXIT and ZERO provider calls", async () => {
    const provider = new FixtureProvider([HIT_NEW]);
    const { ctx, appended } = researchCtx(provider, { outOfScope: ["secret.example.com"] });
    const r = await dispatchTool(ctx, "recon", "recon", call("research_search", { query: "secret.example.com admin panel exploit" }));
    assert.equal(r.ok, false);
    assert.match(r.result, /SCOPE-EXIT: secret\.example\.com/);
    assert.equal(appended.filter((e) => e.action === "scope_exit").length, 1);
    assert.equal(provider.calls.length, 0, "zero lookups: the provider was never called");
  });

  it("denies a query naming an out-of-scope sibling of the target's domain", async () => {
    const provider = new FixtureProvider([HIT_NEW]);
    const { ctx } = researchCtx(provider);
    const r = await dispatchTool(ctx, "recon", "recon", call("research_search", { query: "admin.example.com login portal version" }));
    assert.equal(r.ok, false);
    assert.match(r.result, /SCOPE-EXIT: admin\.example\.com/);
    assert.equal(provider.calls.length, 0);
  });

  it("allows target-directed research on the in-scope host itself", async () => {
    const provider = new FixtureProvider([HIT_NEW]);
    const { ctx } = researchCtx(provider);
    const r = await dispatchTool(ctx, "recon", "recon", call("research_search", { query: "app.example.com TLS configuration ciphers" }));
    assert.equal(r.ok, true);
    assert.equal(provider.calls.length, 1);
  });

  it("surfaces a provider failure as a typed error with no fabricated results", async () => {
    const provider = new FixtureProvider(
      new ResearchError("RESEARCH_TIMEOUT", "request to www.bing.com did not finish within 20000ms"),
    );
    const { ctx } = researchCtx(provider);
    const r = await dispatchTool(ctx, "recon", "recon", call("research_search", { query: "CVE-2024-3400" }));
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, "RESEARCH_TIMEOUT");
    assert.match(r.result, /RESEARCH_TIMEOUT/);
    assert.match(r.result, /UNVERIFIED/);
    assert.ok(!r.result.includes("[1]"), "no citation index was invented");
  });

  it("refuses a malformed since before any provider call", async () => {
    const provider = new FixtureProvider([HIT_NEW]);
    const { ctx } = researchCtx(provider);
    const r = await dispatchTool(ctx, "recon", "recon", call("research_search", { query: "x", since: "last week" }));
    assert.equal(r.ok, false);
    assert.match(r.result, /yyyy-mm-dd/);
    assert.equal(provider.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Dispatch: fetch (loopback server)
// ---------------------------------------------------------------------------

describe("research_fetch — dispatch", () => {
  let server: Server;
  let base = "";
  const PAGE = [
    "<html><head><title>Advisory</title><style>.x{color:red}</style>",
    "<script>var SHOULD_NOT_APPEAR = 1;</script></head>",
    "<body><nav>site chrome</nav><article>",
    "<h1>PAN-OS Advisory</h1>",
    "<p>A command injection vulnerability exists in the GlobalProtect feature.</p>",
    "<p>Affected versions are listed below.</p>",
    "</article></body></html>",
  ].join("");
  const BIG = `<html><body>${`<p>${"evidence sentence ".repeat(60)}</p>`.repeat(140)}</body></html>`;

  before(async () => {
    server = createServer((req, res) => {
      if (req.url === "/page") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(PAGE);
      } else if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(BIG);
      } else if (req.url === "/bin") {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(Buffer.from([0, 1, 2, 3]));
      } else {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const fetchCtx = (provider: SearchProvider) => researchCtx(provider, { scope: ["127.0.0.1"] });

  it("returns readable text stamped with source and retrieval time", async () => {
    const { ctx, appended } = fetchCtx(new FixtureProvider([]));
    const r = await dispatchTool(ctx, "recon", "recon", call("research_fetch", { url: `${base}/page` }));
    assert.equal(r.ok, true);
    assert.ok(r.result.startsWith(`Source: ${base}/page`), "the source URL stamps the output");
    assert.match(r.result, /Retrieved: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.ok(r.result.includes("A command injection vulnerability exists in the GlobalProtect feature."));
    assert.ok(!r.result.includes("SHOULD_NOT_APPEAR"), "script bodies are not readable text");
    assert.equal(appended.filter((e) => e.action === "research_fetch").length, 1);
  });

  it("caps oversized pages with a marker, and the spill seam retains the capped text for read_spill", async () => {
    const { ctx } = fetchCtx(new FixtureProvider([]));
    const r = await dispatchTool(ctx, "recon", "recon", call("research_fetch", { url: `${base}/big` }));
    assert.equal(r.ok, true);
    assert.match(r.result, /page text capped at 100000 chars/);
    const dir = (ctx.events as unknown as { dir: string }).dir;
    const spill = spillToolResult({ dir, tool: "research_fetch", target: `${base}/big`, text: r.result });
    assert.ok(spill.record, "the oversized result spilled through the existing seam");
    const back = readSpill({ dir, path: spill.record!.file });
    assert.equal(back.ok, true);
    if (back.ok) assert.ok(back.text.includes(`Source: ${base}/big`), "the spilled copy keeps the source stamp");
  });

  it("denies a fetch aimed at an out-of-scope target-family host before any request", async () => {
    const { ctx, appended } = researchCtx(new FixtureProvider([]));
    const r = await dispatchTool(ctx, "recon", "recon", call("research_fetch", { url: "https://admin.example.com/internal" }));
    assert.equal(r.ok, false);
    assert.match(r.result, /SCOPE-EXIT: admin\.example\.com/);
    assert.equal(appended.filter((e) => e.action === "scope_exit").length, 1);
  });

  it("reports binary content and HTTP errors as typed failures", async () => {
    const { ctx } = fetchCtx(new FixtureProvider([]));
    const bin = await dispatchTool(ctx, "recon", "recon", call("research_fetch", { url: `${base}/bin` }));
    assert.equal(bin.ok, false);
    assert.equal(bin.errorCode, "RESEARCH_UNSUPPORTED_CONTENT");
    const missing = await dispatchTool(ctx, "recon", "recon", call("research_fetch", { url: `${base}/missing` }));
    assert.equal(missing.ok, false);
    assert.equal(missing.errorCode, "RESEARCH_PROVIDER_ERROR");
    assert.match(missing.result, /HTTP 404/);
  });
});

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

describe("research tools — catalog", () => {
  it("registers both tools for the recon and exploit seats, not the command set, with no name collisions", () => {
    for (const set of [RECON_TOOLS, EXPLOIT_TOOLS]) {
      const names = set.map((t) => t.name);
      assert.ok(names.includes("research_search"));
      assert.ok(names.includes("research_fetch"));
      assert.equal(new Set(names).size, names.length, "tool names are unique within the set");
    }
    const command = COMMAND_TOOLS.map((t) => t.name);
    assert.ok(!command.includes("research_search") && !command.includes("research_fetch"));
  });
});

// ---------------------------------------------------------------------------
// Scope law units
// ---------------------------------------------------------------------------

describe("research scope law", () => {
  const ctxOf = (scope: string[], outOfScope: string[] = [], verifiedScope?: string[]) => ({
    input: { roe: { scope, outOfScope } },
    ...(verifiedScope ? { verifiedScope } : {}),
  });

  it("classifies unrelated hosts as general and record hosts by the guard", () => {
    const ctx = ctxOf(["app.example.com"], ["secret.example.com"]);
    assert.equal(classifyResearchHost(ctx, "nvd.nist.gov").kind, "general");
    assert.equal(classifyResearchHost(ctx, "app.example.com").kind, "in-scope");
    assert.equal(classifyResearchHost(ctx, "docs.app.example.com").kind, "in-scope");
    assert.equal(classifyResearchHost(ctx, "admin.example.com").kind, "denied");
    assert.equal(classifyResearchHost(ctx, "example.com").kind, "denied");
    assert.equal(classifyResearchHost(ctx, "secret.example.com").kind, "denied");
  });

  it("lets the deny list bind even without a family tie, and honors CIDR scope for IPs", () => {
    const denied = ctxOf(["app.example.com"], ["blocked-vendor.com"]);
    assert.equal(classifyResearchHost(denied, "blocked-vendor.com").kind, "denied");
    const cidr = ctxOf(["10.0.0.0/8"]);
    assert.equal(classifyResearchHost(cidr, "10.1.2.3").kind, "in-scope");
    assert.equal(classifyResearchHost(cidr, "192.0.2.1").kind, "general");
  });

  it("governs by the attested record over the launch ROE when both exist", () => {
    const ctx = ctxOf(["app.example.com"], [], ["attested.example.com"]);
    assert.equal(classifyResearchHost(ctx, "attested.example.com").kind, "in-scope");
    // The launch-ROE host shares a registrable domain with the attested
    // record, so it is target-family — and the attestation does not
    // allow it. Family-tied but unallowed is denied, not "general":
    // the attested record governs, exactly as scopeGuardFor rules.
    assert.equal(classifyResearchHost(ctx, "app.example.com").kind, "denied");
  });

  it("extracts exactly the hosts a query names", () => {
    assert.deepEqual(extractQueryHosts("PAN-OS CVE-2024-3400 affected versions"), []);
    assert.deepEqual(extractQueryHosts("log4j 2.14.1 release notes for node.js"), []);
    assert.deepEqual(extractQueryHosts("site:app.example.com vulnerability"), ["app.example.com"]);
    assert.deepEqual(
      extractQueryHosts("compare https://nvd.nist.gov/vuln/detail/CVE-2024-3400 with 10.0.0.5"),
      ["nvd.nist.gov", "10.0.0.5"],
    );
  });
});

// ---------------------------------------------------------------------------
// Bing provider units (recorded-markup fixtures, no live web)
// ---------------------------------------------------------------------------

describe("bing provider — parsing", () => {
  const wrap = (url: string): string =>
    `https://www.bing.com/ck/a?!&amp;&amp;p=deadbeef&amp;u=a1${Buffer.from(url, "utf8").toString("base64url")}&amp;ntb=1`;
  const FIXTURE_HTML = [
    `<ol id="b_results">`,
    `<li class="b_algo"><h2><a href="${wrap("https://nvd.nist.gov/vuln/detail/CVE-2024-3400")}" target="_blank">CVE-2024-3400 Detail - NVD</a></h2>`,
    `<div class="b_caption"><p>Oct 12, 2026 · A command injection vulnerability in Palo Alto Networks PAN-OS software.</p></div>`,
    `<cite>https://nvd.nist.gov › vuln › detail</cite></li>`,
    `<li class="b_algo"><h2><a href="https://unit42.paloaltonetworks.com/pan-os-cve/" target="_blank">PAN-OS Analysis</a></h2>`,
    `<div class="b_caption"><p>Analysis of the exploitation in the wild.</p></div></li>`,
    `<li class="b_algo"><h2><a href="${wrap("https://nvd.nist.gov/vuln/detail/CVE-2024-3400")}" target="_blank">Duplicate of the first result</a></h2>`,
    `<div class="b_caption"><p>Duplicate.</p></div></li>`,
    `</ol>`,
  ].join("");

  it("unwraps redirect URLs, dedupes, and reads printed dates", () => {
    const hits = parseBingResults(FIXTURE_HTML, 10);
    assert.ok(hits);
    assert.equal(hits.length, 2);
    assert.equal(hits[0].url, "https://nvd.nist.gov/vuln/detail/CVE-2024-3400");
    assert.equal(hits[0].publishedDate, "2026-10-12");
    assert.match(hits[0].snippet, /^Oct 12, 2026/);
    assert.equal(hits[1].url, "https://unit42.paloaltonetworks.com/pan-os-cve/");
    assert.equal(hits[1].publishedDate, undefined);
  });

  it("distinguishes a genuine no-results page from an unparseable one", () => {
    assert.deepEqual(parseBingResults(`<div class="b_no">There are no results for zzz</div>`, 10), []);
    assert.equal(parseBingResults(`<html><body>Please solve this puzzle to continue</body></html>`, 10), null);
  });

  it("unwraps ck/a hrefs and rejects bing self-links", () => {
    assert.equal(unwrapBingHref(wrap("https://example.org/a?b=1")), "https://example.org/a?b=1");
    assert.equal(unwrapBingHref("https://example.org/direct"), "https://example.org/direct");
    assert.equal(unwrapBingHref("https://www.bing.com/search?q=x"), undefined);
  });

  it("maps since to Bing freshness by distance and puts it in the URL", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    assert.equal(freshnessForSince("2026-10-31", now), "Day");
    assert.equal(freshnessForSince("2026-10-25", now), "Week");
    assert.equal(freshnessForSince("2026-10-01", now), "Month");
    assert.equal(freshnessForSince("2024-01-01", now), undefined);
    const url = buildBingSearchUrl("openssl release", { since: "2026-10-25", limit: 5 }, undefined, now);
    assert.ok(url.includes("freshness=Week"));
    assert.ok(url.includes("q=openssl+release"));
  });
});

// ---------------------------------------------------------------------------
// Scope law — F-1: deny entries naming LOCAL literals bind
//
// HostSet.contains() short-circuits localhost / 127.0.0.1 / ::1 /
// 0.0.0.0 to {member:false, reason:"local"} before consulting the set,
// so a deny entry naming one of them never bound through
// denyMembership alone (checker Finding F-1: a research_fetch to a
// deny-listed 127.0.0.1 executed). The research classifier re-checks
// the raw deny entries for exactly that verdict. These tests pin both
// directions: listed local literals are denied with zero lookups, and
// unlisted local literals behave exactly as before.
// ---------------------------------------------------------------------------

describe("research scope law — local-literal deny entries (F-1)", () => {
  const ctxOf = (scope: string[], outOfScope: string[] = []) => ({
    input: { roe: { scope, outOfScope } },
  });

  it("denies every local literal the deny list names", () => {
    for (const literal of ["localhost", "127.0.0.1", "::1", "0.0.0.0"]) {
      const ctx = ctxOf(["app.example.com"], [literal]);
      assert.equal(
        classifyResearchHost(ctx, literal).kind,
        "denied",
        `${literal} named on the deny list must bind`,
      );
    }
  });

  it("binds local literals named in entry forms (URL, port, brackets, covering CIDR)", () => {
    assert.equal(
      classifyResearchHost(ctxOf(["app.example.com"], ["http://127.0.0.1:8080/admin"]), "127.0.0.1").kind,
      "denied",
    );
    assert.equal(
      classifyResearchHost(ctxOf(["app.example.com"], ["localhost:8443"]), "localhost").kind,
      "denied",
    );
    assert.equal(classifyResearchHost(ctxOf(["app.example.com"], ["[::1]"]), "::1").kind, "denied");
    assert.equal(
      classifyResearchHost(ctxOf(["app.example.com"], ["127.0.0.0/8"]), "127.0.0.1").kind,
      "denied",
    );
  });

  it("leaves local literals OFF the deny list general, exactly as before", () => {
    const ctx = ctxOf(["app.example.com"], ["10.9.9.9"]);
    for (const literal of ["localhost", "127.0.0.1", "::1", "0.0.0.0"]) {
      assert.equal(
        classifyResearchHost(ctx, literal).kind,
        "general",
        `${literal} not on the deny list stays general`,
      );
    }
    assert.equal(classifyResearchHost(ctxOf(["app.example.com"], []), "127.0.0.1").kind, "general");
  });
});

describe("research tools — F-1 local-literal deny at dispatch", () => {
  let server: Server;
  let base = "";
  let hits = 0;

  before(async () => {
    server = createServer((_req, res) => {
      hits++;
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body><article><h1>Loopback Page</h1><p>loopback body text</p></article></body></html>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("refuses a fetch to a deny-listed loopback before any request (checker P1)", async () => {
    const provider = new FixtureProvider([]);
    const { ctx, appended } = researchCtx(provider, {
      scope: ["app.example.com"],
      outOfScope: ["127.0.0.1"],
    });
    const beforeHits = hits;
    const r = await dispatchTool(ctx, "recon", "recon", call("research_fetch", { url: `${base}/page` }));
    assert.equal(r.ok, false);
    assert.match(r.result, /SCOPE-EXIT: 127\.0\.0\.1/);
    assert.equal(appended.filter((e) => e.action === "scope_exit").length, 1);
    assert.equal(hits, beforeHits, "zero requests: the loopback server was never hit");
  });

  it("refuses a search naming a deny-listed loopback with zero provider calls", async () => {
    const provider = new FixtureProvider([HIT_NEW]);
    const { ctx, appended } = researchCtx(provider, { outOfScope: ["127.0.0.1"] });
    const r = await dispatchTool(
      ctx,
      "recon",
      "recon",
      call("research_search", { query: "127.0.0.1 admin interface default password" }),
    );
    assert.equal(r.ok, false);
    assert.match(r.result, /SCOPE-EXIT: 127\.0\.0\.1/);
    assert.equal(appended.filter((e) => e.action === "scope_exit").length, 1);
    assert.equal(provider.calls.length, 0, "zero lookups: the provider was never called");
  });

  it("still fetches the same loopback when it is NOT deny-listed (no new denials)", async () => {
    const provider = new FixtureProvider([]);
    const { ctx } = researchCtx(provider, {
      scope: ["app.example.com"],
      outOfScope: ["10.9.9.9"],
    });
    const beforeHits = hits;
    const r = await dispatchTool(ctx, "recon", "recon", call("research_fetch", { url: `${base}/page` }));
    assert.equal(r.ok, true);
    assert.ok(r.result.includes("loopback body text"));
    assert.equal(hits, beforeHits + 1, "the general-research fetch executed exactly as before");
  });

  it("still searches a query naming a non-denied loopback (no new denials)", async () => {
    const provider = new FixtureProvider([HIT_NEW]);
    const { ctx } = researchCtx(provider, { outOfScope: ["10.9.9.9"] });
    const r = await dispatchTool(
      ctx,
      "recon",
      "recon",
      call("research_search", { query: "127.0.0.1 port forwarding guide" }),
    );
    assert.equal(r.ok, true);
    assert.equal(provider.calls.length, 1);
  });
});
