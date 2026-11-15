/**
 * Metasploit arm tests (v0.11.0 lineage) — the runner's CVE-specific
 * exploit arm, executing the framework installed on this host natively.
 *
 * NO real Metasploit is needed: a scripted fake msfconsole process is
 * injected through MsfDeps.spawn and speaks the console's text protocol.
 * What we prove:
 *  - policy: dos/destructive modules refused, only generic cmd payloads,
 *    marker command is runner-built and denylist-clean
 *  - a missing/unrunnable framework fails closed with setup instructions
 *  - out-of-scope hosts are rejected BEFORE any local process is spawned
 *  - console command streams are sanitized (no command injection via
 *    option values)
 *  - a call-signal abort kills a running console mid-flight
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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MsfExecutor,
  checkMsfPayload,
  checkMsfModule,
  msfModuleDenyList,
  buildMarkerCommand,
  extractCves,
  buildModuleQueries,
  suggestModules,
  LocalMsfClient,
  parseMsfSearchOutput,
  _resetMsfRuntimeForTests,
  isMsfSessionPayload,
  isAllowedSessionPostModule,
  MSF_SESSION_POST_MODULES,
  countCredentialRecords,
  type MsfConsoleProcess,
} from "../src/msf/index.js";
import { runEngagement } from "../src/phases.js";
import { handleMsfTools } from "../src/dispatch/msf.js";
import type { Ctx } from "../src/context.js";
import type { EngagementInput } from "../src/types.js";
import type { AgentRole, ChatMessage, ChatResult, ToolCallRequest } from "@secscan/redteam-llm-router";

const SCOPE = ["10.9.0.12"];

// ---------------------------------------------------------------------------
// Fake msfconsole — a scripted console process behind MsfDeps.spawn.
// Records every spawn and every line written; speaks just enough of the
// console's text protocol (search table, use/set/run, sessions -i/-k,
// background) for the native client to drive it.
// ---------------------------------------------------------------------------

/** Fake SAM dump the fake post/hashdump run "gathers" (2 records). */
const FAKE_SAM_DUMP =
  "[*] Dumping password hashes...\n" +
  "Administrator:500:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::\n" +
  "fakeuser:1001:aad3b435b51404eeaad3b435b51404ee:5ebe2294ecd0e0f08eab7690d2a6ee69:::\n";

const SEARCH_TABLE = [
  "Matching Modules",
  "================",
  "",
  "   #  Name                                      Disclosure Date  Rank       Check  Description",
  "   -  ----                                      ---------------  ----       -----  -----------",
  "   0  exploit/windows/smb/ms17_010_eternalblue  2017-03-14       excellent  Yes    MS17-010 EternalBlue SMB Remote Windows Kernel Pool Corruption",
  "   1  exploit/windows/smb/ms08_067_netapi       2008-10-28       great      Yes    MS08-067 Microsoft Server Service Relative Path Stack Corruption",
  "   2  auxiliary/dos/windows/smb/ms06_025_rras   2006-04-25       normal     No     Microsoft RRAS Service RASMAN Registry Overflow DoS",
  "   3  auxiliary/scanner/smb/smb_enumshares      2011-01-01       normal     No     SMB Share Enumeration",
  "",
].join("\n");

class FakeConsoleProc implements MsfConsoleProcess {
  readonly writes: string[] = [];
  killed = false;
  private listeners: Array<(chunk: string) => void> = [];
  private resolveExit!: (code: number | null) => void;
  readonly exited: Promise<number | null> = new Promise((r) => {
    this.resolveExit = r;
  });
  private mode: "console" | "session" = "console";
  private currentModule = "";
  private payload = "";
  private cmdMarker: string | null = null;

  constructor(
    private readonly fake: FakeMsf,
    readonly argv: string[],
  ) {}

  emit(s: string): void {
    for (const cb of this.listeners) cb(s);
  }

  exit(code: number): void {
    this.resolveExit(code);
  }

  onData(cb: (chunk: string) => void): void {
    this.listeners.push(cb);
  }

  kill(): void {
    this.killed = true;
    this.resolveExit(null);
  }

  write(data: string): void {
    for (const line of data.split("\n")) {
      const text = line.trim();
      if (!text) continue;
      this.writes.push(text);
      this.handleLine(text);
    }
  }

  private handleLine(text: string): void {
    if (this.mode === "session") {
      if (text === "background") {
        this.mode = "console";
        this.emit("[*] Backgrounding session 7...\nmsf6 > ");
        return;
      }
      this.fake.sessionWrites.push(text);
      const marker = text.match(/REDTEAM-MARKER-[A-Za-z0-9_-]+/);
      if (text.includes("echo REDTEAM-MARKER-") && marker) {
        this.emit(`${marker[0]}\nmeterpreter > `);
      } else if (text.includes("sysinfo")) {
        this.emit("Computer : FAKE-PC\nOS : Windows 10 (Build 19045)\nmeterpreter > ");
      } else if (text.includes("load kiwi")) {
        this.emit("[*] Loaded extension: kiwi\nmeterpreter > ");
      } else if (text.includes("creds_all")) {
        this.emit("[*] KERBEROS:\nUsername : fakeuser\nPassword : fake-pass-123\nmeterpreter > ");
      }
      return;
    }
    if (text.startsWith("use ")) {
      this.currentModule = text.slice(4).trim();
      return;
    }
    if (text.startsWith("set PAYLOAD ")) {
      this.payload = text.slice("set PAYLOAD ".length).trim();
      return;
    }
    if (text.startsWith("set CMD ")) {
      const m = text.match(/REDTEAM-MARKER-[A-Za-z0-9_-]+/);
      this.cmdMarker = m ? m[0] : null;
      return;
    }
    if (text === "run") {
      if (this.fake.hangRun) return; // never answer — lets abort testing work
      if (this.currentModule.startsWith("post/")) {
        this.emit(FAKE_SAM_DUMP + "msf6 post(windows/gather/hashdump) > ");
        return;
      }
      if (this.payload.includes("meterpreter")) {
        this.emit("[*] Sending stage (200000 bytes) to 10.9.0.12\n[*] Meterpreter session 7 opened (10.0.0.2:4444 -> 10.9.0.12:49152)\nmsf6 exploit(windows/smb/ms17_010_eternalblue) > ");
        return;
      }
      this.emit(`[*] Running...\n${this.cmdMarker ?? "REDTEAM-MARKER-abc123"}\n[*] Done\nmsf6 > `);
      return;
    }
    if (text.startsWith("sessions -i ")) {
      this.mode = "session";
      this.emit("[*] Starting interaction with 7...\n\nmeterpreter > ");
      return;
    }
    if (text.startsWith("sessions -k ")) {
      this.emit("[*] Session closed.\nmsf6 > ");
      return;
    }
    if (text === "exit") this.exit(0);
  }
}

interface FakeMsf {
  procs: FakeConsoleProc[];
  sessionWrites: string[];
  hangRun: boolean;
  versionOk: boolean;
  spawn: (bin: string, argv: string[]) => MsfConsoleProcess;
  close(): void;
}

function startFakeMsf(opts: { versionOk?: boolean } = {}): FakeMsf {
  const fake: FakeMsf = {
    procs: [],
    sessionWrites: [],
    hangRun: false,
    versionOk: opts.versionOk ?? true,
    spawn: (_bin, argv) => {
      const proc = new FakeConsoleProc(fake, argv);
      fake.procs.push(proc);
      if (argv.includes("--version")) {
        queueMicrotask(() => {
          if (fake.versionOk) {
            proc.emit("Framework Version: 6.4.0-dev\n");
            proc.exit(0);
          } else {
            proc.exit(1);
          }
        });
      } else if (argv.some((a) => a.startsWith("search "))) {
        queueMicrotask(() => {
          proc.emit(SEARCH_TABLE);
          proc.exit(0);
        });
      }
      return proc;
    },
    close() {
      _resetMsfRuntimeForTests();
    },
  };
  return fake;
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
    const fake = startFakeMsf();
    try {
      const client = new LocalMsfClient({ bin: "msfconsole", spawn: fake.spawn });
      await client.login();
      const ranked = await suggestModules(client, { service: "smb", platform: "windows" });
      const dos = ranked.find((m) => m.fullname.includes("dos/"));
      assert.ok(dos?.dropped?.includes("denial-of-service"), "dos module dropped with reason");
      const runnable = ranked.filter((m) => !m.dropped);
      assert.ok(runnable.length >= 2);
      assert.ok(runnable[0]!.weight >= runnable[1]!.weight, "ranked by weight desc");
    } finally {
      fake.close();
    }
  });

  it("parseMsfSearchOutput reads the console search table into prefix-less modules", () => {
    const mods = parseMsfSearchOutput(SEARCH_TABLE);
    assert.equal(mods.length, 4);
    assert.deepEqual(mods[0], {
      type: "exploit",
      name: "windows/smb/ms17_010_eternalblue",
      fullname: "windows/smb/ms17_010_eternalblue",
      rank: "excellent",
      description: "MS17-010 EternalBlue SMB Remote Windows Kernel Pool Corruption",
      disclosureDate: "2017-03-14",
    });
    assert.equal(mods[2]!.type, "auxiliary");
    assert.equal(mods[2]!.fullname, "dos/windows/smb/ms06_025_rras");
    assert.deepEqual(parseMsfSearchOutput("no modules here\n"), []);
  });

  it("a missing framework fails the probe closed with native setup instructions", async () => {
    const fake = startFakeMsf({ versionOk: false });
    try {
      const client = new LocalMsfClient({ bin: "msfconsole", spawn: fake.spawn });
      await assert.rejects(client.login(), /msfconsole/);
    } finally {
      fake.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Executor against the fake msfconsole
// ---------------------------------------------------------------------------

describe("MsfExecutor", () => {
  let fake: FakeMsf;
  beforeEach(() => {
    _resetMsfRuntimeForTests();
    fake = startFakeMsf();
  });
  afterEach(() => {
    fake.close();
  });

  const exec = () => new MsfExecutor({ spawn: fake.spawn, env: {} });
  /** Interactive console processes (argv ["-q"]) spawned so far. */
  const consoles = () => fake.procs.filter((p) => p.argv.length === 1 && p.argv[0] === "-q");
  /** Every line written to any spawned process, in spawn order. */
  const allWrites = () => fake.procs.flatMap((p) => p.writes);

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

  it("out-of-scope host is refused BEFORE any local process is spawned", async () => {
    const res = await exec().search({ host: "10.99.0.99", scopeHosts: SCOPE, service: "smb" });
    assert.equal(res.ok, false);
    assert.ok(res.refused?.includes("out of scope"));
    assert.equal(fake.procs.length, 0, "no local process spawned");
  });

  it("a missing framework fails closed with setup instructions", async () => {
    const bad = startFakeMsf({ versionOk: false });
    try {
      const e = new MsfExecutor({ spawn: bad.spawn, env: {} });
      const res = await e.search({ host: "10.9.0.12", scopeHosts: SCOPE, service: "smb" });
      assert.equal(res.ok, false);
      assert.ok(res.summary.includes("not usable") || res.summary.includes("msfconsole"), res.summary);
    } finally {
      bad.close();
    }
  });

  it("dos module run is refused by policy before any process is spawned", async () => {
    const res = await exec().run({
      host: "10.9.0.12", scopeHosts: SCOPE, moduleType: "auxiliary",
      module: "dos/windows/smb/ms06_025_rras", marker: "abc123",
    });
    assert.equal(res.ok, false);
    assert.ok(res.refused?.includes("denial-of-service"));
    assert.equal(consoles().length, 0);
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
    assert.ok(allWrites().some((w) => w.includes("RHOSTS 10.9.0.12")), "RHOSTS pinned to scope-checked host");
    assert.ok(allWrites().some((w) => w.includes("set PAYLOAD cmd/unix/generic")), "generic payload only");
    assert.equal(consoles().length, 1);
    assert.ok(consoles()[0]!.killed, "console process killed after a sessionless run");
  });

  it("option values cannot inject extra console commands", async () => {
    const res = await exec().run({
      host: "10.9.0.12", scopeHosts: SCOPE, moduleType: "exploit",
      module: "windows/smb/ms17_010_eternalblue", marker: "abc123",
      options: { NOTE: "x; sessions -k 7" },
    });
    assert.equal(res.ok, true, res.summary);
    assert.ok(
      !allWrites().some((w) => w.trim() === "sessions -k 7"),
      "the injected text never becomes its own console command",
    );
    assert.ok(
      allWrites().some((w) => w.startsWith("set NOTE") && w.includes("sessions -k 7")),
      "separators are flattened into the value itself",
    );
  });

  it("aborting mid-run kills the console (call signal for running modules)", async () => {
    fake.hangRun = true; // the run never produces output
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
    assert.ok(consoles()[0]?.killed, "console process killed on abort");
  });
});

// ---------------------------------------------------------------------------
// W8 — sessions + credential dumping (executor level, fake msfconsole)
// ---------------------------------------------------------------------------

describe("MsfExecutor sessions + credential dump (W8)", () => {
  let fake: FakeMsf;
  beforeEach(() => {
    _resetMsfRuntimeForTests();
    fake = startFakeMsf();
  });
  afterEach(() => {
    fake.close();
  });

  const exec = () => new MsfExecutor({ spawn: fake.spawn, env: {} });
  const consoles = () => fake.procs.filter((p) => p.argv.length === 1 && p.argv[0] === "-q");
  const allWrites = () => fake.procs.flatMap((p) => p.writes);

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
    assert.ok(!consoles()[0]!.killed, "the opened session's console is NOT hygiene-killed");
    assert.ok(
      fake.sessionWrites.some((w) => w.includes("echo REDTEAM-MARKER-abc123")),
      "marker command ran through the session",
    );
  });

  it("negative control: a session command with no prior validated run is refused with ZERO processes spawned", async () => {
    const e = exec();
    const res = await e.sessionCommand({
      host: "10.9.0.12", scopeHosts: SCOPE,
      handle: "00000000-0000-0000-0000-000000000000", command: "sysinfo",
    });
    assert.equal(res.ok, false);
    assert.ok(res.refused?.includes("unknown or closed"), res.summary);
    assert.equal(fake.procs.length, 0, "no local process spawned at all");
  });

  it("commands round-trip through the mocked session", async () => {
    const e = exec();
    const { session } = await openSession(e);
    const res = await e.sessionCommand({
      host: "10.9.0.12", scopeHosts: SCOPE, handle: session!.handle, command: "sysinfo",
    });
    assert.equal(res.ok, true, res.summary);
    assert.ok(res.output.includes("FAKE-PC"), res.output);
    assert.ok(fake.sessionWrites.some((w) => w.includes("sysinfo")));
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

  it("out-of-scope session command is denied before any new process spawns", async () => {
    const e = exec();
    const { session } = await openSession(e);
    const before = fake.procs.length;
    const res = await e.sessionCommand({
      host: "10.99.0.99", scopeHosts: SCOPE, handle: session!.handle, command: "sysinfo",
    });
    assert.equal(res.ok, false);
    assert.ok(res.refused?.includes("out of scope"), res.summary);
    assert.equal(fake.procs.length, before, "no new local process");
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
      assert.ok(allWrites().some((w) => w.includes("set SESSION 7")), "post module pinned to the open session");
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
      assert.ok(fake.sessionWrites.some((w) => w.includes("load kiwi")));
      assert.ok(fake.sessionWrites.some((w) => w.includes("creds_all")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("unknown dump kind is refused before any post module runs", async () => {
    const e = exec();
    const { session } = await openSession(e);
    const postRunsBefore = allWrites().filter((w) => w.startsWith("use post/")).length;
    const res = await e.credentialDump({
      host: "10.9.0.12", scopeHosts: SCOPE, handle: session!.handle,
      kind: "everything", evidenceDir: "/tmp/never-written",
    });
    assert.equal(res.ok, false);
    assert.ok(res.refused?.includes("unknown credential dump kind"), res.summary);
    assert.equal(allWrites().filter((w) => w.startsWith("use post/")).length, postRunsBefore);
  });

  it("session close stops the session and forgets the handle", async () => {
    const e = exec();
    const { session } = await openSession(e);
    const res = await e.sessionClose({ host: "10.9.0.12", scopeHosts: SCOPE, handle: session!.handle });
    assert.equal(res.ok, true, res.summary);
    assert.ok(consoles()[0]!.killed, "the session's console process is stopped");
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
    const msfExecutor = new MsfExecutor({ spawn: fake.spawn, env: {} });
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
    const fake = startFakeMsf();
    try {
      const { res, events } = await run("search", false, fake);
      assert.equal(res.status, "complete");
      assert.ok(events.length >= 1, "msf_exec event logged");
      assert.ok(events[0]!.result.includes("msf search"), events[0]!.result.slice(0, 160));
    } finally {
      fake.close();
    }
  });

  it("out-of-scope msf_exec run is DENIED before any local process spawns", async () => {
    const fake = startFakeMsf();
    try {
      const { res, events } = await run("run", true, fake);
      assert.equal(res.status, "complete");
      assert.ok(events.length >= 1);
      assert.ok(events[0]!.result.includes("DENIED"), events[0]!.result.slice(0, 200));
      assert.ok(events[0]!.result.includes("out of scope"));
      assert.equal(fake.procs.length, 0, "no local process spawned for out-of-scope host");
    } finally {
      fake.close();
    }
  });

  it("in-scope msf_exec run validates the marker and reports the CVE instance", async () => {
    const fake = startFakeMsf();
    try {
      const { res, events } = await run("run", false, fake);
      assert.equal(res.status, "complete");
      assert.ok(events.length >= 1);
      assert.ok(events[0]!.result.includes("MARKER ECHOED"), events[0]!.result.slice(0, 200));
      assert.ok(events[0]!.result.includes("ms17_010_eternalblue"));
      assert.ok(events[0]!.result.includes("[CVE-2017-0144]"), "per-CVE instance tagged in result");
    } finally {
      fake.close();
    }
  });

  it("the agent tool list includes msf_exec", async () => {
    const fake = startFakeMsf();
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
      fake.close();
    }
  });

  it("W8 flow: run opens a session; session_command + credential_dump land as events; dump stays sealed", async () => {
    const fake = startFakeMsf();
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
      const msfExecutor = new MsfExecutor({ spawn: fake.spawn, env: {} });
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
      fake.close();
    }
  });
});

describe("msf_exec dispatcher guard (eng-2026-11-02-wcsu rider)", () => {
  it("returns a failed tool result instead of throwing when the executor dies with the wcsu TypeError", async () => {
    // The live crash shape: a search whose innards read `.length` of
    // undefined. Whatever inside the msf stack throws, the dispatcher must
    // hand the agent a failed result it can route around — never let the
    // exception tear down the dispatch path.
    const throwingExecutor = {
      search: async (): Promise<never> => {
        throw new TypeError("Cannot read properties of undefined (reading 'length')");
      },
    };
    const ctx = {
      input: { mode: "red", roe: {} },
      hosts: ["10.9.0.12"],
      probesUsed: 0,
      coverage: new Set(),
      targetCoverage: new Map(),
      config: undefined,
      events: { updateState: () => {}, append: () => {} },
      msfExecutor: throwingExecutor,
    } as unknown as Ctx;
    const call: ToolCallRequest = { id: "call-msf-search", name: "msf_exec", arguments: {} };
    const args: Record<string, unknown> = {
      action: "search",
      host: "10.9.0.12",
      targetProfile: "windows",
      category: "functionality",
      service: "smb",
    };
    const res = await handleMsfTools(ctx, "exploiter", "recon", call, args);
    assert.ok(res, "the handler answers the call");
    assert.equal(res.ok, false);
    assert.match(res.result, /msf_exec search failed/);
    assert.match(res.result, /reading 'length'/);
  });
});
