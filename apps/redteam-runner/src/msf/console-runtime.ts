/**
 * Shared msfconsole runtime — the process/session state behind
 * LocalMsfClient (local-client.ts).
 *
 * Sessions live INSIDE the msfconsole process that opened them and cannot
 * cross framework instances, while the executor constructs one client per
 * operation — so all process/session state is held by the module-level
 * runtime below and client instances are thin facades over it. Session
 * state therefore survives across client constructions.
 */

import { spawn } from "node:child_process";
import type { MsfModule } from "./local-client.js";

/** The minimal child-process surface the client drives — injectable for tests. */
export interface MsfConsoleProcess {
  write(data: string): void;
  onData(cb: (chunk: string) => void): void;
  kill(): void;
  readonly exited: Promise<number | null>;
}

export type MsfSpawnFn = (bin: string, argv: string[]) => MsfConsoleProcess;

/** Default spawner: the real msfconsole, stderr merged into the data stream. */
export const defaultMsfSpawn: MsfSpawnFn = (bin, argv) => {
  const child = spawn(bin, argv, { stdio: ["pipe", "pipe", "pipe"] });
  const listeners: Array<(chunk: string) => void> = [];
  const emit = (buf: Buffer): void => {
    const s = buf.toString("utf8");
    for (const cb of listeners) cb(s);
  };
  child.stdout.on("data", emit);
  child.stderr.on("data", emit);
  const exited = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code));
    child.on("error", () => resolve(null));
  });
  return {
    write: (data) => {
      child.stdin.write(data);
    },
    onData: (cb) => {
      listeners.push(cb);
    },
    kill: () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* best effort — the process may already be gone */
      }
    },
    exited,
  };
};

/** Quiet period after which a console counts as idle (module finished). */
export const MSF_CONSOLE_QUIET_MS = 1500;

export const MAX_BUFFER = 1024 * 1024;
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Every value written to a console becomes part of a newline-delimited
 * command stream, so CR/LF and command separators in an agent-supplied
 * module name or option value would inject extra console commands. Strip
 * them (the retired RPC console's rule, kept verbatim).
 */
export const cleanConsoleValue = (s: string): string => s.replace(/[\r\n;`$|&]+/g, " ").trim();

export interface SessionRecord {
  daemonId: string;
  type: string;
}

export interface ProcRecord {
  proc: MsfConsoleProcess;
  buffer: string;
  sessions: Map<string, SessionRecord>;
  interactingDaemonId: string | null;
  dead: boolean;
}

interface Runtime {
  daemonCounter: number;
  procs: Set<ProcRecord>;
  probeOk: boolean;
}

export const msfRuntime: Runtime = { daemonCounter: 0, procs: new Set(), probeOk: false };

/** Test-only: forget every process, session, and the cached probe. */
export function _resetMsfRuntimeForTests(): void {
  for (const rec of msfRuntime.procs) {
    try {
      rec.proc.kill();
    } catch {
      /* best effort */
    }
  }
  msfRuntime.procs.clear();
  msfRuntime.daemonCounter = 0;
  msfRuntime.probeOk = false;
}

/** Register a spawned process in the shared runtime and start capturing its output. */
export function attachProcess(proc: MsfConsoleProcess): ProcRecord {
  const rec: ProcRecord = { proc, buffer: "", sessions: new Map(), interactingDaemonId: null, dead: false };
  proc.onData((chunk) => {
    if (rec.dead) return;
    rec.buffer += chunk;
    if (rec.buffer.length > MAX_BUFFER) rec.buffer = rec.buffer.slice(rec.buffer.length - MAX_BUFFER);
  });
  void proc.exited.then(() => {
    rec.dead = true;
    msfRuntime.procs.delete(rec);
  });
  msfRuntime.procs.add(rec);
  return rec;
}

/** Locate the process + console session id owning a runtime session id. */
export function findProcByDaemon(daemonId: string): { rec: ProcRecord; msfId: string } | null {
  for (const rec of msfRuntime.procs) {
    for (const [msfId, session] of rec.sessions) {
      if (session.daemonId === daemonId) return { rec, msfId };
    }
  }
  return null;
}

/**
 * Capture a process's output from `startLen` (a buffer offset the caller
 * snapshots BEFORE writing its commands — output can arrive synchronously
 * with the write) until it goes quiet, the deadline hits, or the signal aborts.
 */
export async function captureQuiet(
  rec: ProcRecord,
  startLen: number,
  deadlineMs: number,
  signal?: AbortSignal,
): Promise<{ output: string; aborted: boolean; timedOut: boolean }> {
  const started = Date.now();
  let sawChunk = false;
  let lastChangeAt = Date.now();
  let lastLen = startLen;
  for (;;) {
    if (signal?.aborted) return { output: rec.buffer.slice(startLen), aborted: true, timedOut: false };
    if (rec.dead) break;
    if (rec.buffer.length !== lastLen) {
      lastLen = rec.buffer.length;
      lastChangeAt = Date.now();
      sawChunk = true;
    }
    const now = Date.now();
    if (sawChunk && now - lastChangeAt >= MSF_CONSOLE_QUIET_MS) break;
    if (now - started >= deadlineMs) return { output: rec.buffer.slice(startLen), aborted: false, timedOut: true };
    await sleep(50);
  }
  return { output: rec.buffer.slice(startLen), aborted: false, timedOut: false };
}

/** One-shot run of the binary; collects output until exit or timeout. Never registered in the runtime. */
export async function runOnce(
  bin: string,
  spawnFn: MsfSpawnFn,
  argv: string[],
  timeoutMs: number,
): Promise<{ code: number | null; output: string }> {
  const proc = spawnFn(bin, argv);
  let output = "";
  proc.onData((c) => {
    output += c;
    if (output.length > MAX_BUFFER) output = output.slice(output.length - MAX_BUFFER);
  });
  const race = await Promise.race([
    proc.exited.then((code) => ({ kind: "exit" as const, code })),
    sleep(timeoutMs).then(() => ({ kind: "timeout" as const, code: null })),
  ]);
  if (race.kind === "timeout") {
    proc.kill();
    throw new Error(`msfconsole timed out after ${timeoutMs}ms`);
  }
  return { code: race.code, output };
}

const SEARCH_ROW_RE =
  /^\s*(?:\d+\s+)?([\w./-]*\/[\w./-]+)\s+(?:(\d{4}-\d{2}-\d{2})\s+)?(excellent|great|good|normal|average|low|manual)\s+(?:Yes|No)\s+(.*)$/;

/**
 * Parse `msfconsole search` table output into modules. Rows look like:
 * `0  exploit/windows/smb/ms17_010_eternalblue  2017-03-14  excellent  Yes  MS17-010 …`.
 * The table's Name column carries the type prefix; the module shape used
 * across this arm keeps `fullname` prefix-less (type separate), matching
 * what the retired RPC search returned. Header, separator, and non-row
 * lines are skipped. Exported for tests.
 * @param text - raw console output of a search run.
 * @returns the parsed modules, in table order.
 */
export function parseMsfSearchOutput(text: string): MsfModule[] {
  const out: MsfModule[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = SEARCH_ROW_RE.exec(line);
    if (!m) continue;
    const full = m[1]!.trim();
    const slash = full.indexOf("/");
    if (slash <= 0) continue;
    const fullname = full.slice(slash + 1);
    const mod: MsfModule = {
      type: full.slice(0, slash),
      name: fullname,
      fullname,
      rank: m[3]!,
      description: m[4]!.trim(),
    };
    if (m[2]) mod.disclosureDate = m[2];
    out.push(mod);
  }
  return out;
}

/** Return a process's console to its prompt when a session interaction is open on it. */
export async function ensureBackgrounded(rec: ProcRecord): Promise<void> {
  if (rec.interactingDaemonId === null) return;
  rec.proc.write("background\n");
  const until = Date.now() + 500;
  let lastLen = rec.buffer.length;
  let lastChange = Date.now();
  while (Date.now() < until + 500) {
    if (rec.buffer.length !== lastLen) {
      lastLen = rec.buffer.length;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= 500) {
      break;
    }
    await sleep(50);
  }
  rec.interactingDaemonId = null;
}
