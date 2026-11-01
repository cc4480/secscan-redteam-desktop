/**
 * Network-primitives policy (net_exec) — pure and testable, no I/O.
 *
 * Three rules shape everything here:
 *
 *  1. The agent supplies STRUCTURED fields only. argv and packet bytes are
 *     built runner-side from validated fields, so no agent input reaches a
 *     command line or a socket header unexamined — the nmap_exec doctrine.
 *  2. The flood caps are CONSTANTS in this module and are enforced again in
 *     the executor's send loop. Neither the tool schema nor the prompt is a
 *     control; the executor clamps to these values and reports the values
 *     it actually used.
 *  3. Invalid input is REFUSED with a reason, never silently dropped or
 *     rewritten — a refused field is a result the coordinator re-plans
 *     around.
 *
 * Wire route for crafted packets: nping, which ships beside the nmap binary
 * the toolchain resolver already trusts (on the operator machine it rides
 * the Metasploit-bundled nmap install). Node has no raw-socket API, so the
 * runner builds the packet bytes itself (packets.ts, recorded as the
 * reference construction) and nping performs the privileged send + reply
 * capture from the same validated spec.
 */
import { resolve } from "node:path";
import { resolveNmapBinary } from "../nmap/policy.js";
import { parseIpv4, tcpFlagsToByte, TCP_FLAG_NAMES } from "./packets.js";

export const NET_ENV_NPING_BIN = "REDTEAM_NPING_BIN";

/** Open socket sessions per engagement (socket shell). */
export const NET_MAX_OPEN_SOCKETS = 32;
/** Largest single socket_send payload. */
export const NET_MAX_SOCKET_PAYLOAD_BYTES = 64 * 1024;
/** Largest single socket_recv return. */
export const NET_MAX_RECV_BYTES = 64 * 1024;
export const NET_CONNECT_TIMEOUT_MS = 10_000;
export const NET_SOCKET_IDLE_TIMEOUT_MS = 120_000;
/** Largest crafted-packet payload (hex-supplied). */
export const NET_MAX_PACKET_PAYLOAD_BYTES = 4096;
/** Crafted packets per packet_send call. */
export const NET_MAX_PACKET_COUNT = 10;
export const NET_NPING_TIMEOUT_MS = 20_000;

/** Flood hard cap: packets/connections per second, sustained. */
export const FLOOD_MAX_RATE_PER_SEC = 1000;
/** Flood hard cap: total run time. */
export const FLOOD_MAX_DURATION_MS = 30_000;
/** Flood hard cap: simultaneous in-flight connections/senders. */
export const FLOOD_MAX_CONCURRENCY = 64;
/** Flood hard cap: payload bytes per packet/datagram. */
export const FLOOD_MAX_PAYLOAD_BYTES = 1400;

export const FLOOD_MODES = ["tcp-connect", "tcp-data", "udp"] as const;
export type FloodMode = (typeof FLOOD_MODES)[number];

export type PacketProtocol = "tcp" | "udp" | "icmp";

/** A validated crafted-packet specification (all fields runner-checked). */
export interface PacketSpec {
  protocol: PacketProtocol;
  /** Destination IPv4 literal — packet crafting never resolves names. */
  destIp: string;
  sourceIp?: string;
  sourcePort?: number;
  destPort?: number;
  tcpFlags?: string[];
  seq?: number;
  ack?: number;
  window?: number;
  ttl?: number;
  identification?: number;
  icmpType?: number;
  icmpCode?: number;
  icmpId?: number;
  icmpSeq?: number;
  payloadHex?: string;
  count: number;
}

type Raw = Record<string, unknown>;

function intIn(raw: Raw, key: string, min: number, max: number): { v?: number; bad?: string } {
  const v = raw[key];
  if (v === undefined) return {};
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    return { bad: `${key} must be an integer in [${min}, ${max}] — got ${JSON.stringify(v)}` };
  }
  return { v };
}

/**
 * Validate the flat packet_send arguments into a PacketSpec.
 * @param raw - the tool call arguments (packet fields at top level).
 * @param destIp - the call's host argument.
 * @returns the spec, or the refusal reason.
 */
export function validatePacketSpec(raw: Raw, destIp: string): { ok: true; spec: PacketSpec } | { ok: false; reason: string } {
  if (!parseIpv4(destIp)) {
    return { ok: false, reason: `packet_send needs an IPv4 literal target (hostnames are not resolved for crafted packets) — got ${JSON.stringify(destIp)}` };
  }
  const protocol = String(raw["packetProtocol"] ?? "tcp").toLowerCase();
  if (protocol !== "tcp" && protocol !== "udp" && protocol !== "icmp") {
    return { ok: false, reason: `packetProtocol must be tcp|udp|icmp — got ${JSON.stringify(raw["packetProtocol"])}` };
  }
  const spec: PacketSpec = { protocol, destIp, count: 1 };
  if (raw["sourceIp"] !== undefined) {
    if (typeof raw["sourceIp"] !== "string" || !parseIpv4(raw["sourceIp"])) {
      return { ok: false, reason: `sourceIp must be an IPv4 literal — got ${JSON.stringify(raw["sourceIp"])}` };
    }
    spec.sourceIp = raw["sourceIp"];
  }
  const fields: Array<[string, number, number, (n: number) => void]> = [
    ["sourcePort", 0, 65535, (n) => (spec.sourcePort = n)],
    ["destPort", 0, 65535, (n) => (spec.destPort = n)],
    ["seq", 0, 4294967295, (n) => (spec.seq = n)],
    ["ack", 0, 4294967295, (n) => (spec.ack = n)],
    ["window", 0, 65535, (n) => (spec.window = n)],
    ["ttl", 1, 255, (n) => (spec.ttl = n)],
    ["identification", 0, 65535, (n) => (spec.identification = n)],
    ["icmpType", 0, 255, (n) => (spec.icmpType = n)],
    ["icmpCode", 0, 255, (n) => (spec.icmpCode = n)],
    ["icmpId", 0, 65535, (n) => (spec.icmpId = n)],
    ["icmpSeq", 0, 65535, (n) => (spec.icmpSeq = n)],
    ["count", 1, NET_MAX_PACKET_COUNT, (n) => (spec.count = n)],
  ];
  for (const [key, min, max, set] of fields) {
    const r = intIn(raw, key, min, max);
    if (r.bad) return { ok: false, reason: r.bad };
    if (r.v !== undefined) set(r.v);
  }
  if (protocol !== "icmp" && spec.destPort === undefined) {
    return { ok: false, reason: `packet_send (${protocol}) requires destPort` };
  }
  if (raw["tcpFlags"] !== undefined) {
    if (protocol !== "tcp") return { ok: false, reason: "tcpFlags only apply to packetProtocol tcp" };
    if (!Array.isArray(raw["tcpFlags"]) || raw["tcpFlags"].some((f) => typeof f !== "string")) {
      return { ok: false, reason: "tcpFlags must be an array of flag names" };
    }
    const names = (raw["tcpFlags"] as string[]).map((f) => f.toLowerCase());
    if (tcpFlagsToByte(names) === null) {
      return { ok: false, reason: `unknown TCP flag — valid: ${TCP_FLAG_NAMES.join(", ")}` };
    }
    spec.tcpFlags = names;
  }
  if (raw["payloadHex"] !== undefined) {
    const hex = raw["payloadHex"];
    if (typeof hex !== "string" || !/^([0-9a-fA-F]{2})*$/.test(hex)) {
      return { ok: false, reason: "payloadHex must be an even-length hex string" };
    }
    if (hex.length / 2 > NET_MAX_PACKET_PAYLOAD_BYTES) {
      return { ok: false, reason: `payloadHex exceeds the ${NET_MAX_PACKET_PAYLOAD_BYTES}-byte cap` };
    }
    spec.payloadHex = hex.toLowerCase();
  }
  return { ok: true, spec };
}

/**
 * nping argv for a validated spec — runner-built, target last (it is a
 * validated IPv4 literal, so it can never be read as a flag).
 * @param nping - the resolved nping binary path.
 * @param spec - a validated PacketSpec.
 * @returns the argv (binary at index 0).
 */
export function buildNpingArgv(nping: string, spec: PacketSpec): string[] {
  const argv = [nping, `--${spec.protocol}`, "-c", String(spec.count)];
  if (spec.destPort !== undefined) argv.push("-p", String(spec.destPort));
  if (spec.sourcePort !== undefined) argv.push("-g", String(spec.sourcePort));
  if (spec.sourceIp) argv.push("--source-ip", spec.sourceIp);
  if (spec.ttl !== undefined) argv.push("--ttl", String(spec.ttl));
  if (spec.identification !== undefined) argv.push("--id", String(spec.identification));
  if (spec.protocol === "tcp") {
    if (spec.tcpFlags?.length) argv.push("--flags", spec.tcpFlags.join(","));
    if (spec.seq !== undefined) argv.push("--seq", String(spec.seq));
    if (spec.ack !== undefined) argv.push("--ack", String(spec.ack));
    if (spec.window !== undefined) argv.push("--win", String(spec.window));
  }
  if (spec.protocol === "icmp") {
    if (spec.icmpType !== undefined) argv.push("--icmp-type", String(spec.icmpType));
    if (spec.icmpCode !== undefined) argv.push("--icmp-code", String(spec.icmpCode));
    if (spec.icmpId !== undefined) argv.push("--icmp-id", String(spec.icmpId));
    if (spec.icmpSeq !== undefined) argv.push("--icmp-seq", String(spec.icmpSeq));
  }
  if (spec.payloadHex) argv.push("--data", spec.payloadHex);
  argv.push(spec.destIp);
  return argv;
}

/**
 * Resolve the nping binary: explicit env wins; otherwise the sibling of the
 * resolved nmap binary (nping ships in the same install). When nmap itself
 * resolves to a bare PATH name, nping is the bare name too.
 * @param env - environment to read overrides from.
 * @returns the nping path to spawn (existence is proven by the spawn).
 */
export function resolveNpingBinary(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = (env[NET_ENV_NPING_BIN] ?? "").trim();
  if (explicit) return explicit;
  const nmap = resolveNmapBinary(env);
  if (nmap.includes("/") || nmap.includes("\\")) {
    const ext = nmap.toLowerCase().endsWith(".exe") ? ".exe" : "";
    return resolve(nmap, "..", `nping${ext}`);
  }
  return "nping";
}

/** Flood parameters after the hard caps are applied. */
export interface FloodParams {
  mode: FloodMode;
  ratePerSec: number;
  durationMs: number;
  concurrency: number;
  payloadBytes: number;
  /** Human-readable notes for every value the caps moved. */
  clamped: string[];
}

/**
 * Resolve requested flood parameters against the hard caps: values above a
 * cap are clamped DOWN and named in `clamped`; values that are not positive
 * integers are refused.
 * @param raw - the tool call arguments.
 * @returns the effective parameters, or the refusal reason.
 */
export function resolveFloodParams(raw: Raw): { ok: true; params: FloodParams } | { ok: false; reason: string } {
  const mode = String(raw["floodMode"] ?? "udp").toLowerCase();
  if (!(FLOOD_MODES as readonly string[]).includes(mode)) {
    return { ok: false, reason: `floodMode must be one of ${FLOOD_MODES.join("|")} — got ${JSON.stringify(raw["floodMode"])}` };
  }
  const clamped: string[] = [];
  const pick = (key: string, dflt: number, cap: number): number | null => {
    const v = raw[key];
    if (v === undefined) return dflt;
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) return null;
    if (v > cap) {
      clamped.push(`${key} ${v} → ${cap} (hard cap)`);
      return cap;
    }
    return v;
  };
  const ratePerSec = pick("ratePerSec", 100, FLOOD_MAX_RATE_PER_SEC);
  if (ratePerSec === null) return { ok: false, reason: `ratePerSec must be a positive integer — got ${JSON.stringify(raw["ratePerSec"])}` };
  const durationMs = pick("durationMs", 5000, FLOOD_MAX_DURATION_MS);
  if (durationMs === null) return { ok: false, reason: `durationMs must be a positive integer — got ${JSON.stringify(raw["durationMs"])}` };
  const concurrency = pick("concurrency", 8, FLOOD_MAX_CONCURRENCY);
  if (concurrency === null) return { ok: false, reason: `concurrency must be a positive integer — got ${JSON.stringify(raw["concurrency"])}` };
  const payloadBytes = pick("payloadBytes", 64, FLOOD_MAX_PAYLOAD_BYTES);
  if (payloadBytes === null) return { ok: false, reason: `payloadBytes must be a positive integer — got ${JSON.stringify(raw["payloadBytes"])}` };
  return { ok: true, params: { mode: mode as FloodMode, ratePerSec, durationMs, concurrency, payloadBytes, clamped } };
}
