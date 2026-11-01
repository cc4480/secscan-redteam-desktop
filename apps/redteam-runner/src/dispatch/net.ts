/**
 * Network-primitives tool handler: net_exec.
 *
 * Gate order for every target-touching action (the router's central tier +
 * scope gates have already run; these are the handler's own layers, in the
 * nmap handler's shape):
 *   1. ROE technique check.
 *   2. Scope — the engagement ScopeGuard (CIDR/subdomain semantics, deny
 *      beats allow) must admit the host BEFORE the executor sees the call.
 *      An out-of-scope call returns a typed DENIED and the executor never
 *      runs: zero packets, by construction and by test.
 *   3. Action gates: flood is exploit-phase only, and on production it
 *      needs the engagement's recorded production confirmation; socket
 *      send/recv/close must name the host the handle was opened against.
 *
 * Every claimed invocation appends a `net_exec` audit event carrying the
 * target, a digest of the parameters (payloads are digested, never logged
 * verbatim), and the result summary.
 */
import { createHash } from "node:crypto";
import { BATTERY_CATEGORIES, type BatteryCategory } from "../battery.js";
import { type TargetId, isTargetId } from "../targets.js";
import { techniqueAllowed } from "../gate.js";
import { type Ctx } from "../context.js";
import { type ActorRole, type EngagementPhase } from "../types.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import { type DispatchResult } from "./types.js";
import { noteCategoryCoverage, optStr } from "./prelude.js";
import { scopeGuardFor } from "../safety/scope-guard.js";
import { NetExecutor } from "../net/index.js";
import {
  NET_MAX_RECV_BYTES,
  resolveFloodParams,
  validatePacketSpec,
} from "../net/policy.js";

/** socket_recv wait ceiling for one call. */
const MAX_RECV_WAIT_MS = 15_000;

const executors = new WeakMap<Ctx, NetExecutor>();

/** The engagement's NetExecutor (created lazily; sessions live per-Ctx). */
export function netExecutorFor(ctx: Ctx): NetExecutor {
  let exec = executors.get(ctx);
  if (!exec) {
    exec = new NetExecutor();
    executors.set(ctx, exec);
  }
  return exec;
}

/** Test seam: bind a prepared executor (injected spawn/fixtures) to a ctx. */
export function setNetExecutor(ctx: Ctx, exec: NetExecutor): void {
  executors.set(ctx, exec);
}

/** sha256 digest of the call parameters — payloads enter as digests only. */
function paramsDigest(args: Record<string, unknown>): string {
  const canon: Record<string, unknown> = {};
  for (const key of Object.keys(args).sort()) {
    const v = args[key];
    if (key === "dataHex" || key === "dataText" || key === "payloadHex") {
      canon[key] = `sha256:${createHash("sha256").update(String(v)).digest("hex").slice(0, 16)}(${String(v).length} chars)`;
    } else {
      canon[key] = v;
    }
  }
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex").slice(0, 16);
}

function numArg(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Route one net_exec call.
 * @param ctx - the engagement context.
 * @param role - the calling actor's role.
 * @param phase - the current engagement phase.
 * @param call - the model's tool call.
 * @param args - the call arguments.
 * @returns the result, or null when the call is not net_exec.
 */
export async function handleNetTools(
  ctx: Ctx,
  role: ActorRole,
  phase: EngagementPhase,
  call: ToolCallRequest,
  args: Record<string, unknown>,
): Promise<DispatchResult | null> {
  if (call.name !== "net_exec") return null;
  const attackId = optStr(args["attackId"])?.toUpperCase();
  const rawCat = (optStr(args["category"]) ?? "").toLowerCase();
  const category = (BATTERY_CATEGORIES as string[]).includes(rawCat) ? (rawCat as BatteryCategory) : undefined;
  const rawTp = (optStr(args["targetProfile"]) ?? "").toLowerCase();
  const targetProfile = isTargetId(rawTp) && (rawTp === "windows" || rawTp === "linux") ? (rawTp as TargetId) : undefined;
  const action = optStr(args["action"]) ?? "";
  const host = optStr(args["host"]) ?? "";
  const exec = netExecutorFor(ctx);
  const audit = (target: string, result: string): void => {
    ctx.events.append({
      phase,
      actor: role,
      action: "net_exec",
      target,
      result: `${action} params=${paramsDigest(args)} — ${result}`,
    });
  };
  const deny = (result: string, repairable?: string): DispatchResult => {
    audit(host, result);
    return { result, attackId, target: host, ...(repairable ? { repairable } : {}) };
  };

  if (action === "caps") {
    const message = exec.caps();
    audit("(no target)", message.split("\n")[0]!);
    return { result: message, attackId, target: "(no target — capability listing)" };
  }
  const ACTIONS = ["socket_open", "socket_send", "socket_recv", "socket_close", "packet_send", "flood"];
  if (!ACTIONS.includes(action)) {
    return deny(`DENIED: unknown net_exec action ${JSON.stringify(action)} — want one of caps, ${ACTIONS.join(", ")}.`, `unknown net_exec action ${JSON.stringify(action)}`);
  }
  if (!techniqueAllowed(attackId, ctx.input.mode, ctx.input.roe, { testMode: ctx.config?.testMode === true })) {
    return deny(`DENIED by ROE: technique ${attackId} is excluded for this engagement.`);
  }
  if (!host) return deny("DENIED: net_exec requires a host for target actions.", "net_exec requires a 'host' argument");

  // Scope gate — fail closed BEFORE any packet. The router's central gate
  // ran on the same host; this is the handler layer behind it (the guard
  // carries CIDR/subdomain semantics an exact-match list cannot).
  const verdict = scopeGuardFor(ctx).checkHost(host);
  if (!verdict.allowed) {
    return deny(`DENIED by scope: ${verdict.reason}`);
  }

  // Socket handle actions must name the host the handle was opened against:
  // a handle is not a capability to reach a different host.
  const handle = optStr(args["handle"]) ?? "";
  if (action === "socket_send" || action === "socket_recv" || action === "socket_close") {
    if (!handle) return deny(`DENIED: ${action} requires a handle from socket_open.`, `${action} requires a 'handle' argument`);
    const peer = exec.sessions.peerOf(handle);
    if (!peer) return deny(`DENIED: unknown or closed handle ${JSON.stringify(handle)}.`);
    if (peer.host.toLowerCase() !== host.toLowerCase()) {
      return deny(`DENIED: handle ${handle} is open against ${peer.host}, not ${host} — a handle reaches only its own peer.`);
    }
  }
  if (action === "flood") {
    if (phase !== "exploit") {
      return deny(`DENIED: flood runs in the exploit phase only (current phase: ${phase}) — load generation is not recon.`);
    }
    if (ctx.safety.environment === "production" && !ctx.safety.productionConfirmed) {
      return deny("DENIED: flood against a production engagement requires the operator's production confirmation (confirmProduction) on the engagement record.");
    }
  }

  ctx.probesUsed++;
  noteCategoryCoverage(ctx, category, targetProfile);

  const ctrl = new AbortController();
  try {
    if (action === "socket_open") {
      const port = numArg(args, "port");
      if (port === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
        return deny("DENIED: socket_open requires a port in [1, 65535].", "socket_open requires a valid 'port' argument");
      }
      const protocol = optStr(args["protocol"]) === "udp" ? "udp" : "tcp";
      const res = await exec.socketOpen({ protocol, host, port, signal: ctrl.signal });
      audit(host, res.message);
      return { result: res.ok ? `${res.message} (handle ${res.handle}, local port ${res.localPort})` : `FAILED: ${res.message}`, attackId, target: host, ok: res.ok };
    }
    if (action === "socket_send") {
      let data: Buffer;
      const hex = optStr(args["dataHex"]);
      if (hex !== undefined) {
        if (!/^([0-9a-fA-F]{2})*$/.test(hex)) return deny("DENIED: dataHex must be an even-length hex string.", "dataHex must be even-length hex");
        data = Buffer.from(hex, "hex");
      } else if (typeof args["dataText"] === "string") {
        data = Buffer.from(args["dataText"], "utf8");
      } else {
        return deny("DENIED: socket_send requires dataHex or dataText.", "socket_send requires a payload argument");
      }
      const res = await exec.socketSend(handle, data);
      audit(host, res.message);
      return { result: res.ok ? res.message : `FAILED: ${res.message}`, attackId, target: host, ok: res.ok };
    }
    if (action === "socket_recv") {
      const waitMs = Math.max(0, Math.min(numArg(args, "waitMs") ?? 3000, MAX_RECV_WAIT_MS));
      const res = await exec.socketRecv(handle, NET_MAX_RECV_BYTES, waitMs);
      audit(host, res.message);
      if (!res.ok) return { result: `FAILED: ${res.message}`, attackId, target: host, ok: false };
      const preview = res.data.toString("utf8").replace(/[^\x20-\x7e\n\r\t]/g, ".").slice(0, 500);
      return {
        result: `${res.message}\nhex: ${res.data.toString("hex")}\ntext: ${preview}`,
        attackId,
        target: host,
        ok: true,
      };
    }
    if (action === "socket_close") {
      const res = exec.socketClose(handle);
      audit(host, res.message);
      return { result: res.ok ? res.message : `FAILED: ${res.message}`, attackId, target: host, ok: res.ok };
    }
    if (action === "packet_send") {
      const v = validatePacketSpec(args, host);
      if (!v.ok) return deny(`DENIED: ${v.reason}`, v.reason);
      const res = await exec.sendPacket(v.spec, ctrl.signal);
      const replies = res.replies.length ? `\n${res.replies.join("\n")}` : "";
      audit(host, res.message);
      return {
        result: `${res.ok ? "" : "FAILED: "}${res.message}\nreference packet (hex): ${res.referenceHex}${replies}`,
        attackId,
        target: host,
        ok: res.ok,
      };
    }
    // flood
    const port = numArg(args, "port");
    if (port === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
      return deny("DENIED: flood requires a port in [1, 65535].", "flood requires a valid 'port' argument");
    }
    const fr = resolveFloodParams(args);
    if (!fr.ok) return deny(`DENIED: ${fr.reason}`, fr.reason);
    const res = await exec.flood({ host, port, params: fr.params, signal: ctrl.signal });
    const clamped = fr.params.clamped.length ? ` Clamped: ${fr.params.clamped.join("; ")}.` : "";
    audit(host, res.message);
    return { result: `${res.ok ? "" : "FAILED: "}${res.message}${clamped}`, attackId, target: host, ok: res.ok };
  } finally {
  }
}
