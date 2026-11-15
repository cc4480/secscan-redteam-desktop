/**
 * LocalMsfClient — native local execution of the Metasploit Framework.
 *
 * Replaces the retired msfrpcd bridge (MessagePack RPC to a daemon that
 * might not even be running — the operator's live symptom). The framework
 * installed on THIS host is driven as `msfconsole` child processes: module
 * search runs one-shot (`msfconsole -q -x "search …; exit"`), module runs
 * write the same console command stream the RPC console used (`use`,
 * `set`, `set PAYLOAD`/`set CMD`, `run`) to a dedicated process, and
 * Meterpreter interaction goes through `sessions -i` / `background` in the
 * process that opened the session.
 *
 * Process/session state lives in the shared runtime (console-runtime.ts);
 * client instances are thin facades over it. There are no credentials and
 * no network listener. What MAY run (module/payload policy) is unchanged
 * and lives in policy.ts; this module owns only the client operations.
 * All methods fail closed: a missing/unrunnable framework throws
 * MsfAuthError with setup instructions; session hygiene never throws.
 */

import { MSF_NATIVE_SETUP_INSTRUCTIONS } from "./policy.js";
import {
  attachProcess,
  captureQuiet,
  cleanConsoleValue as clean,
  defaultMsfSpawn,
  ensureBackgrounded,
  findProcByDaemon,
  msfRuntime,
  parseMsfSearchOutput,
  runOnce,
  sleep,
  type MsfSpawnFn,
} from "./console-runtime.js";

export { parseMsfSearchOutput, MSF_CONSOLE_QUIET_MS, _resetMsfRuntimeForTests } from "./console-runtime.js";
export type { MsfConsoleProcess, MsfSpawnFn } from "./console-runtime.js";

export class MsfAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MsfAuthError";
  }
}

export interface MsfModule {
  type: string;
  name: string;
  fullname: string;
  rank: string;
  description: string;
  disclosureDate?: string;
}

export interface ConsoleRunResult {
  /** Full captured console output (capped by caller). */
  output: string;
  /** True when the console went idle (module finished) before the deadline. */
  completed: boolean;
  /** True when we gave up waiting and killed the console. */
  timedOut: boolean;
  /** True when the abort signal fired and we killed the console. */
  aborted: boolean;
}

export interface LocalMsfClientDeps {
  /** Resolved msfconsole binary path (toolchain resolver output). */
  bin: string;
  /** Injectable spawner — tests drive a scripted fake console. */
  spawn?: MsfSpawnFn;
}

/**
 * Thin facade over the shared runtime: drives the host's own Metasploit
 * framework as local msfconsole processes. See the module doc comment.
 */
export class LocalMsfClient {
  private readonly bin: string;
  private readonly spawnFn: MsfSpawnFn;

  constructor(deps: LocalMsfClientDeps) {
    this.bin = deps.bin;
    this.spawnFn = deps.spawn ?? defaultMsfSpawn;
  }

  private requireProbe(): void {
    if (!msfRuntime.probeOk) {
      throw new MsfAuthError(`[msf] the local Metasploit framework has not been probed usable.\n${MSF_NATIVE_SETUP_INSTRUCTIONS}`);
    }
  }

  /**
   * Verify the local framework actually runs (`msfconsole --version`).
   * Cached in the shared runtime — later clients skip the probe.
   * Throws MsfAuthError (with setup instructions) on any failure.
   */
  async login(): Promise<void> {
    if (msfRuntime.probeOk) return;
    try {
      const { code } = await runOnce(this.bin, this.spawnFn, ["--version"], 30_000);
      if (code !== 0) throw new Error(`msfconsole --version exited ${String(code)}`);
      msfRuntime.probeOk = true;
    } catch (err) {
      throw new MsfAuthError(`[msf] the local Metasploit framework is not usable: ${(err as Error).message}\n${MSF_NATIVE_SETUP_INSTRUCTIONS}`);
    }
  }

  /** Search the module database via a one-shot console. Query uses msf search syntax. */
  async searchModules(query: string): Promise<MsfModule[]> {
    this.requireProbe();
    const { code, output } = await runOnce(this.bin, this.spawnFn, ["-q", "-x", `search ${clean(query)}; exit`], 120_000);
    if (code !== 0 && code !== null) throw new Error(`msfconsole search exited ${code}`);
    return parseMsfSearchOutput(output);
  }

  /** Current sessions across every live console process (runtime id → info). */
  async sessionList(): Promise<Record<string, Record<string, unknown>>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const rec of msfRuntime.procs) {
      if (rec.dead) continue;
      for (const [msfId, session] of rec.sessions) {
        out[session.daemonId] = { type: session.type, session_id: msfId };
      }
    }
    return out;
  }

  /** Stop one session: `sessions -k` when its process hosts others, otherwise kill the process. Never throws. */
  async sessionStop(daemonId: string): Promise<void> {
    try {
      const hit = findProcByDaemon(daemonId);
      if (!hit) return;
      const { rec, msfId } = hit;
      rec.sessions.delete(msfId);
      if (rec.dead) return;
      if (rec.sessions.size > 0) {
        await ensureBackgrounded(rec);
        rec.proc.write(`sessions -k ${msfId}\n`);
        await sleep(300);
      } else {
        rec.proc.kill();
        msfRuntime.procs.delete(rec);
      }
    } catch {
      /* best effort — hygiene must never fail the caller */
    }
  }

  /**
   * Write to a live Meterpreter session's command channel. Only the
   * session manager calls this, and only for sessions registered from a
   * validated exploit run. Enters the session (`sessions -i`) first when
   * the process is not already interacting with it.
   */
  async sessionMeterpreterWrite(daemonId: string, data: string): Promise<void> {
    this.requireProbe();
    const hit = findProcByDaemon(daemonId);
    if (!hit) throw new Error(`[msf] unknown session ${daemonId}`);
    const { rec, msfId } = hit;
    if (rec.dead) throw new Error(`[msf] session ${daemonId}'s console process has exited`);
    if (rec.interactingDaemonId !== daemonId) {
      if (rec.interactingDaemonId !== null) await ensureBackgrounded(rec);
      rec.proc.write(`sessions -i ${msfId}\n`);
      rec.interactingDaemonId = daemonId;
      await sleep(300);
    }
    rec.proc.write(data.endsWith("\n") ? data : `${data}\n`);
  }

  /** Drain a console process's pending output (the session channel's read side). Returns "" when idle. */
  async sessionMeterpreterRead(daemonId: string): Promise<string> {
    const hit = findProcByDaemon(daemonId);
    if (!hit) return "";
    const out = hit.rec.buffer;
    hit.rec.buffer = "";
    return out;
  }

  /**
   * Run a module and capture its console output.
   *
   * Post modules pinned to a SESSION run inside that session's owning
   * process (the only place the session exists). Every other run gets a
   * dedicated process: the stream is `use` → `set` each option →
   * `set PAYLOAD`/`set CMD` → `run`, captured until the console goes
   * quiet, the deadline hits, or the abort signal fires (abort/timeout
   * kills the process — that is the call signal for a running module).
   * A run whose output reports a session opening keeps its process alive
   * and registers the session in the shared runtime; any other finished
   * process is killed, so a validation run cannot leave consoles behind.
   */
  async runModuleConsole(args: {
    moduleType: "exploit" | "auxiliary" | "post";
    fullname: string;
    options: Record<string, string>;
    payload?: string;
    cmd?: string;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<ConsoleRunResult> {
    this.requireProbe();
    const deadline = Math.max(1000, args.timeoutMs);

    if (args.moduleType === "post" && args.options["SESSION"]) {
      const hit = findProcByDaemon(args.options["SESSION"]);
      if (hit) {
        const { rec, msfId } = hit;
        if (rec.dead) throw new Error("[msf] the console process owning the SESSION has exited");
        await ensureBackgrounded(rec);
        const lines = [`use post/${clean(args.fullname)}`, `set SESSION ${clean(msfId)}`];
        for (const [k, v] of Object.entries(args.options)) {
          if (k === "SESSION") continue;
          lines.push(`set ${clean(k)} ${clean(v)}`);
        }
        lines.push("run");
        const startLen = rec.buffer.length;
        rec.proc.write(lines.join("\n") + "\n");
        const cap = await captureQuiet(rec, startLen, deadline, args.signal);
        return { output: cap.output, completed: !cap.aborted && !cap.timedOut, timedOut: cap.timedOut, aborted: cap.aborted };
      }
    }

    const proc = this.spawnFn(this.bin, ["-q"]);
    const rec = attachProcess(proc);
    const lines = [`use ${clean(args.moduleType)}/${clean(args.fullname)}`];
    for (const [k, v] of Object.entries(args.options)) lines.push(`set ${clean(k)} ${clean(v)}`);
    if (args.payload) lines.push(`set PAYLOAD ${clean(args.payload)}`);
    if (args.cmd) lines.push(`set CMD ${clean(args.cmd)}`);
    lines.push("run");
    const startLen = rec.buffer.length;
    proc.write(lines.join("\n") + "\n");

    const cap = await captureQuiet(rec, startLen, deadline, args.signal);
    if (cap.aborted || cap.timedOut) {
      try {
        proc.kill();
      } catch {
        /* best effort */
      }
      msfRuntime.procs.delete(rec);
      return { output: cap.output, completed: false, timedOut: cap.timedOut, aborted: cap.aborted };
    }

    let sawSession = false;
    for (const m of cap.output.matchAll(/(Meterpreter|Command shell) session (\d+) opened/g)) {
      sawSession = true;
      rec.sessions.set(m[2]!, { daemonId: `local-${++msfRuntime.daemonCounter}`, type: m[1]! });
    }
    if (!sawSession) {
      try {
        proc.kill();
      } catch {
        /* best effort */
      }
      msfRuntime.procs.delete(rec);
    }
    return { output: cap.output, completed: true, timedOut: false, aborted: false };
  }
}
