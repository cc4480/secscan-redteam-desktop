/**
 * Metasploit bridge tests (v0.11.0) — the runner's CVE-specific exploit arm.
 *
 * NO real Metasploit is needed: a fake msfrpcd speaks the real MessagePack
 * wire protocol over a local HTTP server. What we prove:
 *  - policy: dos/destructive modules refused, only generic cmd payloads,
 *    marker command is runner-built and denylist-clean
 *  - auth failure and unreachable daemon fail closed with setup instructions
 *  - out-of-scope hosts are rejected BEFORE any msfrpcd request
 *  - msfrpc password never appears in summaries, outputs, or errors
 *  - a call-signal abort destroys a running console mid-flight
 *  - suggest maps service/version → ranked candidates; run captures the
 *    canary marker echo as validation; stray sessions are stopped
 *  - phases.ts wiring: msf_exec in the agent tool list, exploit-phase-only
 *    gating for run, DENIED events on scope refusal
 *  - W8 sessions: a Meterpreter-payload run opens a session ONLY as the
 *    follow-through of the validated run (marker proven through it);
 *    session commands round-trip and are host-bound; credential dumps
 *    seal raw output to evidence and return counts/types/refs only
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encode, decode } from "@msgpack/msgpack";
import {
  MsfExecutor,
  checkMsfPayload,
  checkMsfModule,
  msfModuleDenyList,
  buildMarkerCommand,
  resolveMsfCredentials,
  msfSecrets,
  extractCves,
  buildModuleQueries,
  suggestModules,
  MsfClient,
  isMsfSessionPayload,
  isAllowedSessionPostModule,
  MSF_SESSION_POST_MODULES,
  countCredentialRecords,
} from "../src/msf/index.js";
import { runEngagement } from "../src/phases.js";
import type { EngagementInput } from "../src/types.js";
import type { AgentRole, ChatMessage, ChatResult, ToolCallRequest } from "@secscan/redteam-llm-router";

const FAKE_ENV: NodeJS.ProcessEnv = {
  REDTEAM_MSFRPC_HOST: "127.0.0.1",
  REDTEAM_MSFRPC_PORT: "55553",
  REDTEAM_MSFRPC_USER: "msf",
  REDTEAM_MSFRPC_PASS: "msf-test-secret-pw",
  REDTEAM_MSFRPC_TLS: "0",
};

const SCOPE = ["10.9.0.12"];

// ---------------------------------------------------------------------------
// Fake msfrpcd — speaks the real msgpack wire protocol, records everything
// ---------------------------------------------------------------------------

interface FakeMsf {
  server: Server;
  url: string;
  requests: { method: string; args: unknown[] }[];
  consolesDestroyed: string[];
  sessionsStopped: string[];
  writes: string[];
  readCount: number;
  hangRead: boolean;
  markerEcho: string;
  /** Live fake sessions (daemon id → info), as session.list reports them. */
  sessions: Record<string, Record<string, unknown>>;
  /** Everything written to Meterpreter sessions, in order. */
  meterpreterWrites: string[];
  close(): Promise<void>;
}

/** Fake SAM dump the fake post/hashdump run "gathers" (2 records). */
const FAKE_SAM_DUMP =
  "[*] Dumping password hashes...\n" +
  "Administrator:500:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::\n" +
  "fakeuser:1001:aad3b435b51404eeaad3b435b51404ee:5ebe2294ecd0e0f08eab7690d2a6ee69:::\n";

async function startFakeMsf(opts: { badAuth?: boolean } = {}): Promise<FakeMsf> {
  const requests: { method: string; args: unknown[] }[] = [];
  const consolesDestroyed: string[] = [];
  const sessionsStopped: string[] = [];
  const writes: string[] = [];
  const meterpreterWrites: string[] = [];
  const sessions: Record<string, Record<string, unknown>> = {};
  let pendingSessionOutput = "";
  let postModuleRan = false;
  const fake: FakeMsf = {
    server: null as unknown as Server,
    url: "",
    requests,
    consolesDestroyed,
    sessionsStopped,
    writes,
    readCount: 0,
    hangRead: false,
    markerEcho: "REDTEAM-MARKER-abc123",
    sessions,
    meterpreterWrites,
    async close() {
      // Destroy open sockets first: a deliberately-hung console.read (abort
      // test) would otherwise keep server.close() waiting forever.
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => fake.server.close(() => r()));
    },
  };
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const reply = (obj: unknown) => {
        res.writeHead(200, { "Content-Type": "binary/message-pack" });
        res.end(Buffer.from(encode(obj)));
      };
      let decoded: unknown[];
      try {
        decoded = decode(Buffer.concat(chunks)) as unknown[];
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      const [method, maybeToken, ...rest] = decoded;
      const m = String(method);
      const args = m === "auth.login" ? [maybeToken, ...rest] : rest;
      requests.push({ method: m, args });
      switch (m) {
        case "auth.login": {
          const [, user, pass] = decoded as unknown[];
          if (opts.badAuth || pass !== FAKE_ENV.REDTEAM_MSFRPC_PASS || user !== FAKE_ENV.REDTEAM_MSFRPC_USER) {
            reply({ result: "failed", error: "login failed" });
          } else {
            reply({ result: "success", token: "fake-token-123" });
          }
          return;
        }
        case "module.search":
          reply({
            modules: [
              { type: "exploit", name: "windows/smb/ms17_010_eternalblue", fullname: "windows/smb/ms17_010_eternalblue", rank: "excellent", description: "MS17-010 EternalBlue SMB Remote Windows Kernel Pool Corruption" },
              { type: "exploit", name: "windows/smb/ms08_067_netapi", fullname: "windows/smb/ms08_067_netapi", rank: "great", description: "MS08-067 Microsoft Server Service Relative Path Stack Corruption" },
              { type: "auxiliary", name: "dos/windows/smb/ms06_025_rras", fullname: "dos/windows/smb/ms06_025_rras", rank: "normal", description: "Microsoft RRAS Service RASMAN Registry Overflow DoS" },
              { type: "auxiliary", name: "scanner/smb/smb_enumshares", fullname: "scanner/smb/smb_enumshares", rank: "normal", description: "SMB Share Enumeration" },
            ],
          });
          return;
        case "console.create":
          reply({ id: "cid-1", prompt: "msf6 > " });
          return;
        case "console.write": {
          const [, , _cid, data] = decoded as unknown[];
          const text = String(data);
          writes.push(text);
          if (text.trim() === "run") {
            // A Meterpreter payload landing = a session appears (id "7").
            const payloadWrite = [...writes].reverse().find((w) => w.includes("set PAYLOAD"));
            if (payloadWrite && payloadWrite.includes("meterpreter")) {
              sessions["7"] = {
                type: "meterpreter",
                target_host: "10.9.0.12",
                session_host: "10.9.0.12",
                payload: payloadWrite.replace("set PAYLOAD", "").trim(),
              };
            }
            if (writes.some((w) => w.trim().startsWith("use post/"))) postModuleRan = true;
          }
          reply({ wrote: text.length });
          return;
        }
        case "console.read": {
          fake.readCount++;
          if (fake.hangRead) return; // never respond — lets abort testing work
          const ran = writes.some((w) => w.trim() === "run");
          reply({
            data: postModuleRan ? FAKE_SAM_DUMP : ran ? `[*] Running...\n${fake.markerEcho}\n[*] Done\n` : "",
            prompt: "msf6 > ",
            busy: false,
          });
          return;
        }
        case "console.destroy": {
          const [, , cid] = decoded as unknown[];
          consolesDestroyed.push(String(cid));
          reply({ result: "success" });
          return;
        }
        case "session.list":
          reply(sessions);
          return;
        case "session.stop": {
          const [, , id] = decoded as unknown[];
          sessionsStopped.push(String(id));
          delete sessions[String(id)];
          reply({ result: "success" });
          return;
        }
        case "session.meterpreter_write": {
          const [, , _sid, data] = decoded as unknown[];
          const text = String(data);
          meterpreterWrites.push(text);
          const marker = text.match(/REDTEAM-MARKER-[A-Za-z0-9_-]+/);
          if (text.includes("echo REDTEAM-MARKER-") && marker) {
            pendingSessionOutput += `${marker[0]}\n`;
          } else if (text.includes("sysinfo")) {
            pendingSessionOutput += "Computer : FAKE-PC\nOS : Windows 10 (Build 19045)\n";
          } else if (text.includes("load kiwi")) {
            pendingSessionOutput += "[*] Loaded extension: kiwi\n";
          } else if (text.includes("creds_all")) {
            pendingSessionOutput += "[*] KERBEROS:\nUsername : fakeuser\nPassword : fake-pass-123\n";
          }
          reply({ result: "success" });
          return;
        }
        case "session.meterpreter_read": {
          const data = pendingSessionOutput;
          pendingSessionOutput = "";
          reply({ data, prompt: "meterpreter > " });
          return;
        }
        default:
          reply({ error: `unknown ${m}` });
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  fake.server = server;
  fake.url = `http://127.0.0.1:${port}`;
  return fake;
}

/** Request fn hitting the fake server (real wire protocol, no real msf). */
function fakeRequest(fake: FakeMsf) {
  return async (body: Uint8Array): Promise<Uint8Array> => {
    const res = await fetch(`${fake.url}/api/`, {
      method: "POST",
      headers: { "Content-Type": "binary/message-pack" },
      body: body as unknown as BodyInit,
    });
    return new Uint8Array(await res.arrayBuffer());
  };
}

function msfEnv(): NodeJS.ProcessEnv {
  return { ...FAKE_ENV };
}

// ---------------------------------------------------------------------------
// Policy — pure functions
// ---------------------------------------------------------------------------

describe("msf policy", () => {
  it("allows generic + Meterpreter session payloads, refuses everything else", () => {
    assert.equal(checkMsfPayload("cmd/unix/generic"), null);
    assert.equal(checkMsfPayload("cmd/windows/generic"), null);
    // W8: Meterpreter session payloads are the session-run path.
    assert.equal(checkMsfPayload("windows/meterpreter/reverse_tcp"), null);
    assert.equal(checkMsfPayload("windows/x64/meterpreter/reverse_https"), null);
    assert.equal(checkMsfPayload("linux/x64/meterpreter/bind_tcp"), null);
    assert.ok(isMsfSessionPayload("windows/x64/meterpreter/reverse_tcp"));
    assert.ok(!isMsfSessionPayload("cmd/unix/generic"));
    // Non-Meterpreter session payloads stay refused.
    assert.ok(checkMsfPayload("windows/shell_reverse_tcp"));
    assert.ok(checkMsfPayload("linux/x64/shell_reverse_tcp"));
    assert.ok(checkMsfPayload("windows/meterpreter/reverse_http")); // transport not in the allowed set
    assert.ok(checkMsfPayload(""));
  });

  it("refuses dos and destructive modules, allows normal exploits", () => {
    assert.equal(checkMsfModule("windows/smb/ms17_010_eternalblue", "exploit"), null);
    assert.equal(checkMsfModule("scanner/smb/smb_enumshares", "auxiliary"), null);
    assert.ok(checkMsfModule("dos/windows/smb/ms06_025_rras", "auxiliary")?.includes("denial-of-service"));
    assert.ok(checkMsfModule("exploit/windows/fileformat/wiper_x", "exploit"));
    assert.ok(checkMsfModule("auxiliary/dos/tcp/synflood", "auxiliary"));
    // W8 post allowlist: the curated gathers may run (through a session
    // only); every other post module is refused structurally.
    assert.equal(checkMsfModule("post/windows/gather/hashdump", "post"), null);
    assert.equal(checkMsfModule("post/multi/gather/firefox_creds", "post"), null);
    assert.equal(checkMsfModule("windows/gather/hashdump", "post"), null); // prefix-less form
    assert.ok(isAllowedSessionPostModule("post/windows/gather/lsa_secrets"));
    assert.equal(MSF_SESSION_POST_MODULES.length, 10);
    assert.ok(checkMsfModule("post/windows/gather/credentials/kiwi", "post")?.includes("post module not allowed")); // kiwi is an extension, not a module
    assert.ok(checkMsfModule("post/multi/manage/shell_to_meterpreter", "post")?.includes("post module not allowed"));
    assert.ok(checkMsfModule("encoder/x86/shikata_ga_nai", "encoder")?.includes("module type not allowed"));
  });

  it("counts credential records in dump output (SAM lines + labelled pairs)", () => {
    assert.equal(countCredentialRecords(FAKE_SAM_DUMP), 2);
    assert.equal(countCredentialRecords("Username : u\nPassword : p\n"), 1);
    assert.equal(countCredentialRecords("nothing here\n"), 0);
  });

  it("denylist is exported and non-empty", () => {
    assert.ok(msfModuleDenyList().length >= 3);
  });

  it("marker command is runner-built, sanitized, and denylist-clean", () => {
    const { command, refused } = buildMarkerCommand("abc123; rm -rf /");
    assert.equal(refused, null);
    assert.ok(command.startsWith("echo REDTEAM-MARKER-"));
    assert.ok(!command.includes(";"), "injection stripped");
  });

  it("extracts CVEs and builds most-specific-first queries", () => {
    assert.deepEqual(extractCves("Samba 4.3.11 CVE-2017-7494 blah cve-2021-44228"), ["CVE-2017-7494", "CVE-2021-44228"]);
    const qs = buildModuleQueries({ service: "samba", version: "Samba 4.3.11 (CVE-2017-7494)", platform: "linux" });
    assert.ok(qs[0].includes("cve:CVE-2017-7494"), qs[0]);
    assert.ok(qs.some((q) => q.includes("smb")));
  });

  it("filterAndRank drops policy-denied modules but names them", async () => {
    const fake = await startFakeMsf();
    try {
      const client = new MsfClient(fakeRequest(fake));
      await client.login(FAKE_ENV.REDTEAM_MSFRPC_USER!, FAKE_ENV.REDTEAM_MSFRPC_PASS!);
      const ranked = await suggestModules(client, { service: "smb", platform: "windows" });
      const dos = ranked.find((m) => m.fullname.includes("dos/"));
      assert.ok(dos?.dropped?.includes("denial-of-service"), "dos module dropped with reason");
      const runnable = ranked.filter((m) => !m.dropped);
      assert.ok(runnable.length >= 2);
      assert.ok(runnable[0]!.weight >= runnable[1]!.weight, "ranked by weight desc");
    } finally {
      await fake.close();
    }
  });

  it("resolveMsfCredentials fails fast with setup instructions when missing", () => {
    assert.throws(() => resolveMsfCredentials({}), /msfrpcd is unreachable/);
    const c = resolveMsfCredentials(msfEnv());
    assert.equal(c.host, "127.0.0.1");
    assert.equal(c.port, 55553);
    assert.equal(c.useTls, false);
    assert.deepEqual(msfSecrets(c), [FAKE_ENV.REDTEAM_MSFRPC_PASS]);
  });
});

// ---------------------------------------------------------------------------
// Executor against the fake msfrpcd
// ---------------------------------------------------------------------------

describe("MsfExecutor", () => {
  let fake: FakeMsf;
  beforeEach(async () => {
    fake = await startFakeMsf();
  });
  afterEach(async () => {
    await fake.close();
  });

  const exec = () => new MsfExecutor({ request: fakeRequest(fake), env: msfEnv() });

  it("search returns runnable modules and names policy refusals", async () => {
    const res = await exec().search({ host: "10.9.0.12", scopeHosts: SCOPE, service: "smb", platform: "windows" });
    assert.equal(res.ok, true);
    assert.ok(res.summary.includes("3 runnable"), res.summary);
    assert.ok(res.summary.includes("1 refused by policy"), res.summary);
    assert.ok(res.output.includes("ms17_010_eternalblue"));
  });

  it("suggest maps service/version to ranked candidates for coordinator approval", async () => {
    const res = await exec().suggest({ host: "10.9.0.12", scopeHosts: SCOPE, service: "samba", version: "Samba 4.3.11", platform: "linux" });
    assert.equal(res.ok, true);
    assert.ok(res.summary.includes("coordinator approval"), res.summary);
    assert.ok(res.output.includes("eternalblue"));
  });

  it("out-of-scope host is refused BEFORE any msfrpcd request", async () => {
    const res = await exec().search({ host: "10.99.0.99", scopeHosts: SCOPE, service: "smb" });
    assert.equal(res.ok, false);
    assert.ok(res.refused?.includes("out of scope"));
    assert.equal(fake.requests.length, 0, "no packet to msfrpcd");
  });

  it("bad msfrpcd credentials fail closed with setup instructions", async () => {
    const bad = await startFakeMsf({ badAuth: true });
    try {
      const e = new MsfExecutor({ request: fakeRequest(bad), env: msfEnv() });
      const res = await e.search({ host: "10.9.0.12", scopeHosts: SCOPE, service: "smb" });
      assert.equal(res.ok, false);
      assert.ok(res.summary.includes("authentication failed") || res.summary.includes("msfrpcd"), res.summary);
    } finally {
      await bad.close();
    }
  });

  it("dos module run is refused by policy before any request", async () => {
    const res = await exec().run({
      host: "10.9.0.12", scopeHosts: SCOPE, moduleType: "auxiliary",
      module: "dos/windows/smb/ms06_025_rras", marker: "abc123",
    });
    assert.equal(res.ok, false);
    assert.ok(res.refused?.includes("denial-of-service"));
    assert.equal(fake.requests.filter((r) => r.method === "console.create").length, 0);
  });

  it("non-generic, non-Meterpreter payload run is refused by policy", async () => {
    const res = await exec().run({
      host: "10.9.0.12", scopeHosts: SCOPE, moduleType: "exploit",
      module: "windows/smb/ms17_010_eternalblue", payload: "windows/shell_reverse_tcp", marker: "abc123",
    });
    assert.equal(res.ok, false);
    assert.ok(res.refused?.includes("payload not allowed"));
  });

  it("run captures the canary marker echo as validation", async () => {
    const res = await exec().run({
      host: "10.9.0.12", scopeHosts: SCOPE, moduleType: "exploit",
      module: "windows/smb/ms17_010_eternalblue", marker: "abc123",
    });
    assert.equal(res.ok, true, res.summary);
    assert.ok(res.summary.includes("MARKER ECHOED"), res.summary);
    assert.ok(res.output.includes("REDTEAM-MARKER-"), "marker in captured output");
    assert.ok(fake.writes.some((w) => w.includes("RHOSTS 10.9.0.12")), "RHOSTS pinned to scope-checked host");
    assert.ok(fake.writes.some((w) => w.includes("set PAYLOAD cmd/unix/generic")), "generic payload only");
    assert.ok(fake.consolesDestroyed.includes("cid-1"), "console destroyed after run");
  });

  it("msfrpc password never appears in summaries or outputs", async () => {
    const secret = FAKE_ENV.REDTEAM_MSFRPC_PASS!;
    const e = new MsfExecutor({
      request: fakeRequest(fake),
      env: { ...msfEnv(), REDTEAM_MSFRPC_PASS: secret },
    });
    const res = await e.run({
      host: "10.9.0.12", scopeHosts: SCOPE, moduleType: "exploit",
      module: "windows/smb/ms17_010_eternalblue", marker: "abc123",
      options: { LEAK_TEST: secret },
    });
    assert.ok(!res.summary.includes(secret), "summary redacted");
    assert.ok(!res.output.includes(secret), "output redacted");
  });

  it("aborting mid-run destroys the console (call signal for running modules)", async () => {
    fake.hangRead = true; // console.read never answers
    const e = exec();
    const ctrl = new AbortController();
    const p = e.run({
      host: "10.9.0.12", scopeHosts: SCOPE, moduleType: "exploit",
      module: "windows/smb/ms17_010_eternalblue", marker: "abc123",
      signal: ctrl.signal, timeoutMs: 30_000,
    });
    await new Promise((r) => setTimeout(r, 300));
    ctrl.abort();
    const res = await p;
    assert.equal(res.ok, false);
    assert.ok(res.summary.includes("ABORTED"), res.summary);
    assert.ok(fake.consolesDestroyed.includes("cid-1"), "console destroyed on abort");
  });
});

// ---------------------------------------------------------------------------
// W8 — sessions + credential dumping (executor level, fake msfrpcd)
// ---------------------------------------------------------------------------

describe("MsfExecutor sessions + credential dump (W8)", () => {
  let fake: FakeMsf;
  beforeEach(async () => {
    fake = await startFakeMsf();
  });
  afterEach(async () => {
    await fake.close();
  });

  const exec = () => new MsfExecutor({ request: fakeRequest(fake), env: msfEnv() });

  async function openSession(e: MsfExecutor) {
    const res = await e.run({
      host: "10.9.0.12", scopeHosts: SCOPE, moduleType: "exploit",
      module: "windows/smb/ms17_010_eternalblue", payload: "windows/x64/meterpreter/reverse_tcp", marker: "abc123",
    });
    assert.equal(res.ok, true, res.summary);
    assert.ok(res.session?.handle, "run returns the session handle");
    return res;
  }

  it("a Meterpreter run opens a session as the follow-through — marker proven through it, session kept", async () => {
    const e = exec();
    const res = await openSession(e);
    assert.ok(res.summary.includes("Meterpreter session opened"), res.summary);
    assert.ok(res.summary.includes("MARKER ECHOED through the session"), res.summary);
    assert.equal(e.sessions.list().length, 1);
    assert.equal(e.sessions.list()[0]!.targetHost, "10.9.0.12");
    assert.ok(!fake.sessionsStopped.includes("7"), "the opened session is NOT hygiene-stopped");
    assert.ok(
      fake.meterpreterWrites.some((w) => w.includes("echo REDTEAM-MARKER-abc123")),
      "marker command ran through the session",
    );
  });

  it("negative control: a session command with no prior validated run is refused with ZERO daemon requests", async () => {
    const e = exec();
    const res = await e.sessionCommand({
      host: "10.9.0.12", scopeHosts: SCOPE,
      handle: "00000000-0000-0000-0000-000000000000", command: "sysinfo",
    });
    assert.equal(res.ok, false);
    assert.ok(res.refused?.includes("unknown or closed"), res.summary);
    assert.equal(fake.requests.length, 0, "no msfrpcd request at all");
  });

  it("commands round-trip through the mocked session", async () => {
    const e = exec();
    const { session } = await openSession(e);
    const res = await e.sessionCommand({
      host: "10.9.0.12", scopeHosts: SCOPE, handle: session!.handle, command: "sysinfo",
    });
    assert.equal(res.ok, true, res.summary);
    assert.ok(res.output.includes("FAKE-PC"), res.output);
    assert.ok(fake.meterpreterWrites.some((w) => w.includes("sysinfo")));
  });

  it("a session handle is bound to the exploited host", async () => {
    const e = exec();
    const { session } = await openSession(e);
    const res = await e.sessionCommand({
      host: "10.9.0.13", scopeHosts: ["10.9.0.12", "10.9.0.13"], handle: session!.handle, command: "sysinfo",
    });
    assert.equal(res.ok, false);
    assert.ok(res.refused?.includes("bound to 10.9.0.12"), res.summary);
  });

  it("out-of-scope session command is denied before any new daemon request", async () => {
    const e = exec();
    const { session } = await openSession(e);
    const before = fake.requests.length;
    const res = await e.sessionCommand({
      host: "10.99.0.99", scopeHosts: SCOPE, handle: session!.handle, command: "sysinfo",
    });
    assert.equal(res.ok, false);
    assert.ok(res.refused?.includes("out of scope"), res.summary);
    assert.equal(fake.requests.length, before, "no new msfrpcd request");
  });

  it("destructive session commands are refused by the denylist", async () => {
    const e = exec();
    const { session } = await openSession(e);
    const res = await e.sessionCommand({
      host: "10.9.0.12", scopeHosts: SCOPE, handle: session!.handle, command: "rm -rf /",
    });
    assert.equal(res.ok, false);
    assert.ok(res.refused?.includes("denylist"), res.summary);
  });

  it("credential dump seals raw output to evidence and returns counts/types/refs only", async () => {
    const e = exec();
    const { session } = await openSession(e);
    const dir = mkdtempSync(join(tmpdir(), "msf-dump-"));
    try {
      const res = await e.credentialDump({
        host: "10.9.0.12", scopeHosts: SCOPE, handle: session!.handle,
        kind: "hashdump", evidenceDir: join(dir, "evidence"),
      });
      assert.equal(res.ok, true, res.summary);
      assert.equal(res.output, "", "no raw material in the tool output");
      assert.ok(!res.summary.includes("31d6cfe0"), "no hash in the summary");
      assert.equal(res.evidence?.records, 2);
      assert.deepEqual(res.evidence?.types, ["sam-hash"]);
      assert.ok(res.evidence && existsSync(res.evidence.path), "sealed evidence file exists");
      const sealed = readFileSync(res.evidence!.path, "utf8");
      assert.ok(sealed.includes("31d6cfe0d16ae931b73c59d7e0c089c0"), "raw material is in the evidence store");
      const manifest = JSON.parse(readFileSync(`${res.evidence!.path}.json`, "utf8")) as { sha256: string; records: number };
      assert.equal(manifest.sha256, res.evidence!.sha256);
      assert.equal(manifest.records, 2);
      assert.ok(fake.writes.some((w) => w.includes("set SESSION 7")), "post module pinned to the open session");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("kiwi dump runs through the session channel and seals the same way", async () => {
    const e = exec();
    const { session } = await openSession(e);
    const dir = mkdtempSync(join(tmpdir(), "msf-kiwi-"));
    try {
      const res = await e.credentialDump({
        host: "10.9.0.12", scopeHosts: SCOPE, handle: session!.handle,
        kind: "kiwi", evidenceDir: join(dir, "evidence"),
      });
      assert.equal(res.ok, true, res.summary);
      assert.ok((res.evidence?.records ?? 0) >= 1);
      assert.ok(!res.summary.includes("fake-pass-123"), "no password in the summary");
      assert.ok(fake.meterpreterWrites.some((w) => w.includes("load kiwi")));
      assert.ok(fake.meterpreterWrites.some((w) => w.includes("creds_all")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("unknown dump kind is refused before any post console opens", async () => {
    const e = exec();
    const { session } = await openSession(e);
    const consolesBefore = fake.requests.filter((r) => r.method === "console.create").length;
    const res = await e.credentialDump({
      host: "10.9.0.12", scopeHosts: SCOPE, handle: session!.handle,
      kind: "everything", evidenceDir: "/tmp/never-written",
    });
    assert.equal(res.ok, false);
    assert.ok(res.refused?.includes("unknown credential dump kind"), res.summary);
    assert.equal(fake.requests.filter((r) => r.method === "console.create").length, consolesBefore);
  });

  it("session close stops the daemon session and forgets the handle", async () => {
    const e = exec();
    const { session } = await openSession(e);
    const res = await e.sessionClose({ host: "10.9.0.12", scopeHosts: SCOPE, handle: session!.handle });
    assert.equal(res.ok, true, res.summary);
    assert.ok(fake.sessionsStopped.includes("7"));
    assert.equal(e.sessions.list().length, 0);
    const after = await e.sessionCommand({
      host: "10.9.0.12", scopeHosts: SCOPE, handle: session!.handle, command: "sysinfo",
    });
    assert.equal(after.ok, false);
    assert.ok(after.refused?.includes("unknown or closed"));
  });
});

// ---------------------------------------------------------------------------
// phases.ts wiring — tool list, exploit-phase gating, DENIED events
// ---------------------------------------------------------------------------

describe("msf_exec wiring", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "msf-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const textOnly = (text: string): ChatResult => ({ text, toolCalls: [], provider: "fake", model: "fake" });
  const toolCall = (name: string, args: Record<string, unknown>): ToolCallRequest => ({
    id: `call-${name}`,
    name,
    arguments: args,
  });

  function scriptedLlm(action: "search" | "run", outOfScope: boolean) {
    return async (role: AgentRole, messages: ChatMessage[], _opts: { tools?: { name: string }[] }): Promise<ChatResult> => {
      const has = (s: string) => messages.some((m) => m.content.includes(s));
      if (role === "coordinator") {
        if (has("Transition awaiting sign-off")) return textOnly("SIGN-OFF: approved.");
        if (has("RE-PLAN") || has("Last batch results") || has("OVERRIDE"))
          return textOnly('```json\n{"tasks": [], "finish": true, "note": "done"}\n```');
        if (has("Return ONLY a JSON block")) {
          return textOnly(
            '```json\n{"tasks": [{"kind": "probe", "brief": "msf cve validation", "attackId": "T1190", "category": "functionality", "maxTurns": 4}], "finish": false, "note": "go"}\n```',
          );
        }
        return textOnly(
          '```json\n{"adversaryProfile": "test", "steps": [{"phase": "exploit", "attackId": "T1190", "description": "msf validation"}]}\n```',
        );
      }
      if (role === "recon") return textOnly("recon brief: smb detected");
      if (role === "reporter") return textOnly('# Report\n\n```json {"findings": []} ```');
      const sys = messages.find((m) => m.role === "system")?.content ?? "";
      if (sys.includes("Task:") || has("Execute the task now")) {
        const toolSeen = messages.some((m) => m.role === "tool");
        if (!toolSeen) {
          const host = outOfScope ? "10.99.0.99" : "10.9.0.12";
          const args: Record<string, unknown> =
            action === "search"
              ? { action: "search", host, category: "functionality", targetProfile: "windows", service: "smb", hypothesis: "WS-105 mapping" }
              : { action: "run", host, category: "functionality", targetProfile: "windows", moduleType: "exploit", module: "windows/smb/ms17_010_eternalblue", attackId: "T1190", cve: "CVE-2017-0144", hypothesis: "WS-106 validation" };
          return { text: "firing msf_exec", toolCalls: [toolCall("msf_exec", args)], provider: "fake", model: "fake" };
        }
        return textOnly("TRIED: msf / OBSERVED: done / VERDICT: killed - done");
      }
      return textOnly("idle");
    };
  }

  async function run(action: "search" | "run", outOfScope: boolean, fake: FakeMsf) {
    const input: EngagementInput = {
      target: "10.9.0.12",
      mode: "red",
      objective: "msf wiring test",
      roe: { scope: ["10.9.0.12"] },
    };
    const msfExecutor = new MsfExecutor({ request: fakeRequest(fake), env: msfEnv() });
    const res = await runEngagement(input, {
      mcpToken: "test",
      deepseekApiKey: "test",
      qwenApiKey: "test",
      engagementsDir: dir,
      registryPath: join(dir, "registry.json"),
      deps: {
        verify: async () => true,
        completeForRole: scriptedLlm(action, outOfScope) as never,
        msfExecutor,
      },
    });
    const events = readFileSync(join(dir, res.engagementId, "events.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { action: string; result: string });
    return { res, events: events.filter((e) => e.action === "msf_exec"), fake };
  }

  it("msf_exec search executes and the audit lands in the event feed", async () => {
    const fake = await startFakeMsf();
    try {
      const { res, events } = await run("search", false, fake);
      assert.equal(res.status, "complete");
      assert.ok(events.length >= 1, "msf_exec event logged");
      assert.ok(events[0]!.result.includes("msf search"), events[0]!.result.slice(0, 160));
      assert.ok(!events[0]!.result.includes(FAKE_ENV.REDTEAM_MSFRPC_PASS!), "no secret in event");
    } finally {
      await fake.close();
    }
  });

  it("out-of-scope msf_exec run is DENIED before any msfrpcd request", async () => {
    const fake = await startFakeMsf();
    try {
      const { res, events } = await run("run", true, fake);
      assert.equal(res.status, "complete");
      assert.ok(events.length >= 1);
      assert.ok(events[0]!.result.includes("DENIED"), events[0]!.result.slice(0, 200));
      assert.ok(events[0]!.result.includes("out of scope"));
      assert.equal(fake.requests.length, 0, "no msfrpcd request for out-of-scope host");
    } finally {
      await fake.close();
    }
  });

  it("in-scope msf_exec run validates the marker and reports the CVE instance", async () => {
    const fake = await startFakeMsf();
    try {
      const { res, events } = await run("run", false, fake);
      assert.equal(res.status, "complete");
      assert.ok(events.length >= 1);
      assert.ok(events[0]!.result.includes("MARKER ECHOED"), events[0]!.result.slice(0, 200));
      assert.ok(events[0]!.result.includes("ms17_010_eternalblue"));
      assert.ok(events[0]!.result.includes("[CVE-2017-0144]"), "per-CVE instance tagged in result");
    } finally {
      await fake.close();
    }
  });

  it("the agent tool list includes msf_exec", async () => {
    const fake = await startFakeMsf();
    try {
      let sawTools: string[] = [];
      const llm = async (role: AgentRole, _messages: ChatMessage[], opts: { tools?: { name: string }[] }): Promise<ChatResult> => {
        if (opts.tools) sawTools = [...new Set([...sawTools, ...opts.tools.map((t) => t.name)])];
        if (role === "coordinator" && _messages.some((m) => m.content.includes("Transition awaiting sign-off")))
          return textOnly("SIGN-OFF: approved.");
        return textOnly("idle");
      };
      const input: EngagementInput = {
        target: "10.9.0.12",
        mode: "red",
        objective: "tool list check",
        roe: { scope: ["10.9.0.12"] },
      };
      await runEngagement(input, {
        mcpToken: "test",
        deepseekApiKey: "test",
        qwenApiKey: "test",
        engagementsDir: dir,
        registryPath: join(dir, "registry.json"),
        deps: { verify: async () => true, completeForRole: llm as never },
      });
      assert.ok(sawTools.includes("msf_exec"), "agent tool list includes msf_exec");
    } finally {
      await fake.close();
    }
  });

  it("W8 flow: run opens a session; session_command + credential_dump land as events; dump stays sealed", async () => {
    const fake = await startFakeMsf();
    try {
      let handle = "missing-handle";
      const llm = async (role: AgentRole, messages: ChatMessage[], _opts: { tools?: { name: string }[] }): Promise<ChatResult> => {
        const has = (s: string) => messages.some((m) => m.content.includes(s));
        if (role === "coordinator") {
          if (has("Transition awaiting sign-off")) return textOnly("SIGN-OFF: approved.");
          if (has("RE-PLAN") || has("Last batch results") || has("OVERRIDE"))
            return textOnly('```json\n{"tasks": [], "finish": true, "note": "done"}\n```');
          if (has("Return ONLY a JSON block")) {
            return textOnly(
              '```json\n{"tasks": [{"kind": "probe", "brief": "msf session flow", "attackId": "T1190", "category": "functionality", "maxTurns": 6}], "finish": false, "note": "go"}\n```',
            );
          }
          return textOnly(
            '```json\n{"adversaryProfile": "test", "steps": [{"phase": "exploit", "attackId": "T1190", "description": "msf session flow"}]}\n```',
          );
        }
        if (role === "recon") return textOnly("recon brief: smb detected");
        if (role === "reporter") return textOnly('# Report\n\n```json {"findings": []} ```');
        const sys = messages.find((m) => m.role === "system")?.content ?? "";
        if (sys.includes("Task:") || has("Execute the task now")) {
          const toolMsgs = messages.filter((m) => m.role === "tool");
          const base = { host: "10.9.0.12", category: "functionality", targetProfile: "windows" };
          if (toolMsgs.length === 0) {
            return {
              text: "firing run",
              toolCalls: [toolCall("msf_exec", { ...base, action: "run", moduleType: "exploit", module: "windows/smb/ms17_010_eternalblue", payload: "windows/x64/meterpreter/reverse_tcp", attackId: "T1190", cve: "CVE-2017-0144", hypothesis: "session flow" })],
              provider: "fake",
              model: "fake",
            };
          }
          if (toolMsgs.length === 1) {
            const m = toolMsgs[0]!.content.match(/handle ([0-9a-f-]{36})/);
            handle = m ? m[1]! : "missing-handle";
            return {
              text: "session command",
              toolCalls: [toolCall("msf_exec", { ...base, action: "session_command", sessionHandle: handle, command: "sysinfo", attackId: "T1059", hypothesis: "interact" })],
              provider: "fake",
              model: "fake",
            };
          }
          if (toolMsgs.length === 2) {
            return {
              text: "dump",
              toolCalls: [toolCall("msf_exec", { ...base, action: "credential_dump", sessionHandle: handle, dumpKind: "hashdump", attackId: "T1003", hypothesis: "dump" })],
              provider: "fake",
              model: "fake",
            };
          }
          if (toolMsgs.length === 3) {
            return {
              text: "close",
              toolCalls: [toolCall("msf_exec", { ...base, action: "session_close", sessionHandle: handle, attackId: "T1059", hypothesis: "close" })],
              provider: "fake",
              model: "fake",
            };
          }
          return textOnly("TRIED: msf session flow / OBSERVED: done / VERDICT: killed - done");
        }
        return textOnly("idle");
      };
      const input: EngagementInput = {
        target: "10.9.0.12",
        mode: "red",
        objective: "msf session wiring test",
        roe: { scope: ["10.9.0.12"] },
      };
      const msfExecutor = new MsfExecutor({ request: fakeRequest(fake), env: msfEnv() });
      const res = await runEngagement(input, {
        mcpToken: "test",
        deepseekApiKey: "test",
        qwenApiKey: "test",
        engagementsDir: dir,
        deps: {
          verify: async () => true,
          completeForRole: llm as never,
          msfExecutor,
        },
      });
      assert.equal(res.status, "complete");
      assert.notEqual(handle, "missing-handle", "the run result carried the session handle to the agent");
      const all = readFileSync(join(dir, res.engagementId, "events.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { action: string; result: string });
      const opened = all.find((e) => e.action === "msf_session_opened");
      assert.ok(opened, "msf_session_opened event logged");
      const cmd = all.find((e) => e.action === "msf_session_command");
      assert.ok(cmd, "msf_session_command event logged");
      assert.ok(cmd!.result.includes("sysinfo"), "the command itself is in the event log");
      assert.ok(cmd!.result.includes("FAKE-PC"), "the full response is in the event log");
      const dump = all.find((e) => e.action === "msf_credential_dump");
      assert.ok(dump, "msf_credential_dump event logged");
      assert.ok(dump!.result.includes("sealed"), dump!.result.slice(0, 200));
      assert.ok(!dump!.result.includes("31d6cfe0"), "no raw hash in the event log");
      const evidenceDir = join(dir, res.engagementId, "evidence");
      const sealedFiles = readdirSync(evidenceDir).filter((f) => f.startsWith("msf-credential-dump-hashdump-") && f.endsWith(".txt"));
      assert.equal(sealedFiles.length, 1, "exactly one sealed dump file");
      assert.ok(
        readFileSync(join(evidenceDir, sealedFiles[0]!), "utf8").includes("31d6cfe0d16ae931b73c59d7e0c089c0"),
        "raw material lives in the sealed evidence file",
      );
      assert.ok(all.some((e) => e.action === "msf_session_closed"), "msf_session_closed event logged");
    } finally {
      await fake.close();
    }
  });
});
