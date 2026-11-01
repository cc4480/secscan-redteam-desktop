/**
 * Session operations for the MSF executor (W8): the session follow-through
 * of a validated exploit run, interactive session commands, and session
 * close. Credential dumping lives in executor/credential-dump.ts and runs
 * on the gate exported here.
 *
 * Perimeter (unchanged from the rest of the bridge): exact
 * scope preflight before any daemon contact, sessions addressable only by
 * runner-issued handles bound to the exploited host, destructive-command
 * denylist on session commands, and dumped credential material SEALED to
 * the engagement evidence store — tool results carry counts, types and
 * the evidence reference, never the raw material.
 */

import { capOutput, checkDestructive, redactSecrets } from "../../host-exec/common.js";
import type { ConsoleRunResult, MsfClient } from "../client.js";
import type { MsfRequestFn } from "../protocol.js";
import type { MsfSessionManager } from "../sessions.js";
import { authedClient } from "./auth.js";
import type { MsfResult } from "./executor.js";

/** The slice of MsfExecutor these operations run against. */
export interface SessionOpsHost {
  readonly deps: {
    request?: MsfRequestFn;
    env: NodeJS.ProcessEnv;
    endpoint?: { host: string; port: number; useTls: boolean };
  };
  readonly testMode: boolean;
  readonly sessions: MsfSessionManager;
  preflight(host: string, scopeHosts: string[]): { secrets: string[] } | { refused: string };
  refusedResult(host: string, refused: string, secrets?: string[]): MsfResult;
}

const SESSION_CMD_TIMEOUT_MS = 30_000;

export interface SessionCommandArgs {
  host: string;
  scopeHosts: string[];
  handle: string;
  command: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SessionCloseArgs {
  host: string;
  scopeHosts: string[];
  handle: string;
  signal?: AbortSignal;
}

function unknownHandle(host: SessionOpsHost, targetHost: string): MsfResult {
  return host.refusedResult(
    targetHost,
    "unknown or closed msf session handle — sessions open only as the mechanical follow-through of a validated exploit run (msf_exec run with a Meterpreter payload); there is no free-standing session open",
  );
}

/** Shared gate for every session operation: preflight + handle + host binding. */
export function gateSession(
  host: SessionOpsHost,
  args: { host: string; scopeHosts: string[]; handle: string },
): { record: NonNullable<ReturnType<MsfSessionManager["get"]>> } | { refused: MsfResult } {
  const pre = host.preflight(args.host, args.scopeHosts);
  if ("refused" in pre) return { refused: host.refusedResult(args.host, pre.refused) };
  const record = host.sessions.get(args.handle);
  if (!record) return { refused: unknownHandle(host, args.host) };
  if (record.targetHost !== args.host) {
    return {
      refused: host.refusedResult(
        args.host,
        `session handle is bound to ${record.targetHost}, not ${args.host} — a session never crosses hosts`,
      ),
    };
  }
  return { record };
}

/**
 * Finish an exploit run whose payload was a Meterpreter session payload:
 * diff the daemon session list, register the new Meterpreter session,
 * stop any other new session, and prove the session by echoing the
 * runner-built marker through it. The session stays OPEN on success —
 * opening it is the mechanical audit-log step that follows the validated
 * exploit; it is registered only after the exploit ran, never before.
 */
export async function finishSessionRun(
  host: SessionOpsHost,
  input: {
    client: MsfClient;
    secrets: string[];
    before: Set<string>;
    console: ConsoleRunResult;
    targetHost: string;
    module: string;
    payload: string;
    marker: string;
    markerCmd: string;
    timeoutMs: number;
    signal?: AbortSignal;
    started: number;
  },
): Promise<MsfResult> {
  const { client, targetHost } = input;
  const after: Record<string, Record<string, unknown>> = await client
    .sessionList()
    .catch((): Record<string, Record<string, unknown>> => ({}));
  const newIds = Object.keys(after).filter((id) => !input.before.has(id));
  const base = {
    transport: "msf" as const,
    host: targetHost,
    ms: Date.now() - input.started,
  };
  if (input.console.aborted || input.console.timedOut) {
    // Call abort / timeout: no session is kept — hygiene stops them all.
    for (const id of newIds) await client.sessionStop(id).catch(() => undefined);
    const verdict = input.console.aborted
      ? "ABORTED by call signal (console destroyed; session stopped)"
      : "timed out (console destroyed; session stopped)";
    return {
      ...base,
      ok: false,
      summary: redactSecrets(`msf exploit/${input.module} vs ${targetHost}: ${verdict}`, input.secrets),
      output: redactSecrets(capOutput(input.console.output), input.secrets),
    };
  }
  const candidates = newIds.filter((id) =>
    String(after[id]?.["type"] ?? "").toLowerCase().includes("meterpreter"),
  );
  const chosen = candidates.sort((a, b) => Number(a) - Number(b))[0];
  for (const id of newIds) {
    if (id !== chosen) await client.sessionStop(id).catch(() => undefined);
  }
  if (!chosen) {
    return {
      ...base,
      ok: false,
      summary: redactSecrets(
        `msf exploit/${input.module} vs ${targetHost}: completed without a Meterpreter session — no session registered`,
        input.secrets,
      ),
      output: redactSecrets(capOutput(input.console.output), input.secrets),
    };
  }
  const record = host.sessions.register({
    daemonId: chosen,
    targetHost,
    module: input.module,
    payload: input.payload,
    marker: input.marker,
  });
  let sessionOutput = "";
  let markerHit = false;
  try {
    const res = await host.sessions.exec(client, record.handle, input.markerCmd, {
      timeoutMs: Math.min(input.timeoutMs, SESSION_CMD_TIMEOUT_MS),
      signal: input.signal,
    });
    sessionOutput = res.output;
    markerHit = sessionOutput.includes("REDTEAM-MARKER-");
  } catch {
    markerHit = false;
  }
  return {
    ...base,
    ok: markerHit,
    summary: redactSecrets(
      `msf exploit/${input.module} vs ${targetHost}: Meterpreter session opened (handle ${record.handle}) — ` +
        (markerHit
          ? "MARKER ECHOED through the session — command execution validated; session is open for session_command / credential_dump"
          : "session opened but the marker did not echo through it — session registered, validation unproven"),
      input.secrets,
    ),
    output: redactSecrets(capOutput(sessionOutput || input.console.output), input.secrets),
    session: { handle: record.handle, daemonId: record.daemonId },
  };
}

/** Run ONE command through an open session. The dispatch layer writes the full command + response to the engagement event log. */
export async function sessionCommand(
  host: SessionOpsHost,
  args: SessionCommandArgs,
): Promise<MsfResult> {
  const started = Date.now();
  const gate = gateSession(host, args);
  if ("refused" in gate) return gate.refused;
  const denied = host.testMode ? null : checkDestructive(args.command);
  if (denied) return host.refusedResult(args.host, `destructive-command denylist: ${denied}`);
  try {
    const { client, secrets } = await authedClient(host.deps, SESSION_CMD_TIMEOUT_MS, args.signal);
    const { output } = await host.sessions.exec(client, args.handle, args.command, {
      timeoutMs: args.timeoutMs ?? SESSION_CMD_TIMEOUT_MS,
      signal: args.signal,
    });
    return {
      ok: true,
      transport: "msf",
      host: args.host,
      summary: redactSecrets(
        `msf session command on ${args.host} (handle ${args.handle}): ${output.length} chars of response`,
        secrets,
      ),
      output: redactSecrets(capOutput(output), secrets),
      ms: Date.now() - started,
      session: { handle: gate.record.handle, daemonId: gate.record.daemonId },
    };
  } catch (err) {
    return {
      ok: false,
      transport: "msf",
      host: args.host,
      summary: `msf session command failed: ${(err as Error).message}`.slice(0, 300),
      output: "",
      ms: Date.now() - started,
    };
  }
}

/** Close an open session (daemon session stopped, handle forgotten). */
export async function closeSession(
  host: SessionOpsHost,
  args: SessionCloseArgs,
): Promise<MsfResult> {
  const started = Date.now();
  const gate = gateSession(host, args);
  if ("refused" in gate) return gate.refused;
  try {
    const { client } = await authedClient(host.deps, SESSION_CMD_TIMEOUT_MS, args.signal);
    await host.sessions.close(client, args.handle);
    return {
      ok: true,
      transport: "msf",
      host: args.host,
      summary: `msf session closed on ${args.host} (handle ${args.handle})`,
      output: "",
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      transport: "msf",
      host: args.host,
      summary: `msf session close failed: ${(err as Error).message}`.slice(0, 300),
      output: "",
      ms: Date.now() - started,
    };
  }
}
