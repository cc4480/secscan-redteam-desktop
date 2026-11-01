/**
 * Network-primitives executor (net_exec) — the bridge the tool calls.
 *
 * Owns the three live actions behind the dispatch layer's gates:
 *   caps()       — the routes and hard caps, touches no target.
 *   sendPacket() — one crafted-packet batch via nping (see policy.ts for
 *                  why nping) with the runner-built reference packet bytes
 *                  recorded alongside nping's own sent/received lines.
 *   flood()      — the bounded load generator. Pacing is a single shared
 *                  slot clock: every send claims the next slot
 *                  (slot += 1000/rate), so the sustained rate can never
 *                  exceed the cap no matter how many workers run; the
 *                  worker count itself is the concurrency cap; the run
 *                  stops at the duration cap or on abort, whichever first.
 *
 * Socket sessions live in sockets.ts; this class delegates to it.
 */
import { createConnection } from "node:net";
import { createSocket as createUdpSocket } from "node:dgram";
import { realNmapSpawn, type SpawnFn } from "../nmap/runner.js";
import {
  buildIpv4Packet,
  buildIcmpMessage,
  buildTcpSegment,
  buildUdpDatagram,
  IP_PROTO_ICMP,
  IP_PROTO_TCP,
  IP_PROTO_UDP,
} from "./packets.js";
import {
  FLOOD_MAX_CONCURRENCY,
  FLOOD_MAX_DURATION_MS,
  FLOOD_MAX_PAYLOAD_BYTES,
  FLOOD_MAX_RATE_PER_SEC,
  NET_NPING_TIMEOUT_MS,
  buildNpingArgv,
  resolveNpingBinary,
  type FloodParams,
  type PacketSpec,
} from "./policy.js";
import { SocketSessions, type SocketOpenResult, type SocketProtocol, type SocketRecvResult } from "./sockets.js";

export interface NetDeps {
  spawn?: SpawnFn;
  env?: NodeJS.ProcessEnv;
}

export interface PacketSendResult {
  ok: boolean;
  message: string;
  /** The exact packet the spec describes, built runner-side (hex). */
  referenceHex: string;
  /** nping's RCVD lines — the replies it captured, verbatim. */
  replies: string[];
  sentLines: number;
}

export interface FloodRunResult {
  ok: boolean;
  message: string;
  sent: number;
  errors: number;
  elapsedMs: number;
  stoppedReason: "duration cap" | "aborted";
  params: FloodParams;
}

function waitOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** The net_exec executor: socket sessions + crafted packets + bounded flood. */
export class NetExecutor {
  /** Kill switch — the dispatch handler binds this to the engagement's hostKill. */
  killSwitch: { aborted: boolean } = { aborted: false };
  readonly sessions = new SocketSessions();
  private readonly spawn: SpawnFn;
  private readonly env: NodeJS.ProcessEnv;

  constructor(deps: NetDeps = {}) {
    this.spawn = deps.spawn ?? realNmapSpawn;
    this.env = deps.env ?? process.env;
  }

  /** Routes + hard caps. Touches no target. */
  caps(): string {
    return [
      "net_exec routes:",
      "  socket_open/send/recv/close — Node net/dgram raw byte sessions (TCP/UDP), handle-held across calls.",
      `  packet_send — crafted IPv4 TCP/UDP/ICMP via nping (${resolveNpingBinary(this.env)}), the sender that ships with the nmap install; packet bytes are also built runner-side as the reference construction.`,
      "  flood — in-process bounded load generator (tcp-connect | tcp-data | udp).",
      `Hard caps (constants, executor-enforced): flood rate ≤ ${FLOOD_MAX_RATE_PER_SEC}/s, duration ≤ ${FLOOD_MAX_DURATION_MS}ms, concurrency ≤ ${FLOOD_MAX_CONCURRENCY}, payload ≤ ${FLOOD_MAX_PAYLOAD_BYTES}B.`,
    ].join("\n");
  }

  socketOpen(args: { protocol: SocketProtocol; host: string; port: number; signal?: AbortSignal }): Promise<SocketOpenResult> {
    return this.sessions.open(args);
  }

  socketSend(handle: string, data: Buffer): Promise<{ ok: boolean; sent: number; message: string }> {
    return this.sessions.send(handle, data);
  }

  socketRecv(handle: string, maxBytes: number, timeoutMs: number): Promise<SocketRecvResult> {
    return this.sessions.recv(handle, maxBytes, timeoutMs);
  }

  socketClose(handle: string): { ok: boolean; message: string } {
    return this.sessions.close(handle);
  }

  /** The exact packet bytes a spec describes (source 0.0.0.0 when unspecified: the sender's real address). */
  referencePacket(spec: PacketSpec): Buffer {
    const src = spec.sourceIp ?? "0.0.0.0";
    const payload = spec.payloadHex ? Buffer.from(spec.payloadHex, "hex") : Buffer.alloc(0);
    if (spec.protocol === "tcp") {
      const seg = buildTcpSegment(src, spec.destIp, {
        sourcePort: spec.sourcePort ?? 0,
        destPort: spec.destPort ?? 0,
        seq: spec.seq ?? 0,
        ack: spec.ack ?? 0,
        flags: spec.tcpFlags ?? ["syn"],
        window: spec.window ?? 8192,
        payload,
      });
      return buildIpv4Packet({ sourceIp: src, destIp: spec.destIp, protocol: IP_PROTO_TCP, ttl: spec.ttl, identification: spec.identification, payload: seg });
    }
    if (spec.protocol === "udp") {
      const dg = buildUdpDatagram(src, spec.destIp, { sourcePort: spec.sourcePort ?? 0, destPort: spec.destPort ?? 0, payload });
      return buildIpv4Packet({ sourceIp: src, destIp: spec.destIp, protocol: IP_PROTO_UDP, ttl: spec.ttl, identification: spec.identification, payload: dg });
    }
    const msg = buildIcmpMessage({ type: spec.icmpType ?? 8, code: spec.icmpCode ?? 0, id: spec.icmpId ?? 0, seq: spec.icmpSeq ?? 0, payload });
    return buildIpv4Packet({ sourceIp: src, destIp: spec.destIp, protocol: IP_PROTO_ICMP, ttl: spec.ttl, identification: spec.identification, payload: msg });
  }

  /**
   * Send a validated crafted-packet spec via nping and capture its replies.
   * @param spec - a policy-validated PacketSpec (scope already checked by dispatch).
   * @param signal - the call's abort signal.
   * @returns nping's outcome plus the reference packet hex.
   */
  async sendPacket(spec: PacketSpec, signal?: AbortSignal): Promise<PacketSendResult> {
    const referenceHex = this.referencePacket(spec).toString("hex");
    if (this.killSwitch.aborted) {
      return { ok: false, message: "ABORTED by operator (kill switch) — no packet sent.", referenceHex, replies: [], sentLines: 0 };
    }
    const argv = buildNpingArgv(resolveNpingBinary(this.env), spec);
    let r: Awaited<ReturnType<SpawnFn>>;
    try {
      r = await this.spawn({ file: argv[0]!, args: argv.slice(1), timeoutMs: NET_NPING_TIMEOUT_MS, signal });
    } catch (err) {
      return { ok: false, message: `nping spawn failed: ${(err as Error).message}`, referenceHex, replies: [], sentLines: 0 };
    }
    const lines = r.stdout.split("\n");
    const sentLines = lines.filter((l) => l.startsWith("SENT")).length;
    const replies = lines.filter((l) => l.startsWith("RCVD")).map((l) => l.trim());
    if (r.timedOut) {
      return { ok: false, message: `nping exceeded ${NET_NPING_TIMEOUT_MS}ms and was killed. Sent lines seen: ${sentLines}.`, referenceHex, replies, sentLines };
    }
    if (r.code !== 0) {
      const why = r.stderr.trim().split("\n").slice(0, 2).join(" / ") || `exit ${r.code}`;
      return {
        ok: false,
        message: `nping did not send: ${why}. (Crafted-packet sending needs nping — it ships with the nmap install — and raw-socket privilege: Administrator/Npcap on Windows, CAP_NET_RAW on Linux.)`,
        referenceHex,
        replies,
        sentLines,
      };
    }
    return {
      ok: true,
      message: `nping sent ${sentLines} packet(s); ${replies.length} repl${replies.length === 1 ? "y" : "ies"} captured.`,
      referenceHex,
      replies,
      sentLines,
    };
  }

  /**
   * Run the bounded flood. Params arrive pre-clamped from policy; the caps
   * are re-applied here so no caller can exceed them.
   * @param args - target + effective params + abort signal.
   * @returns run statistics and why the run stopped.
   */
  async flood(args: { host: string; port: number; params: FloodParams; signal?: AbortSignal }): Promise<FloodRunResult> {
    const p = args.params;
    const started = Date.now();
    if (this.killSwitch.aborted || args.signal?.aborted) {
      return { ok: false, message: "ABORTED by operator (kill switch) — flood not started.", sent: 0, errors: 0, elapsedMs: 0, stoppedReason: "aborted", params: p };
    }
    const payload = Buffer.alloc(p.payloadBytes, 0x41);
    const deadline = started + p.durationMs;
    const interval = 1000 / p.ratePerSec;
    let nextSlot = started;
    let sent = 0;
    let errors = 0;
    const aborted = (): boolean => this.killSwitch.aborted || args.signal?.aborted === true;
    const claimSlot = (): number => {
      const slot = Math.max(Date.now(), nextSlot);
      nextSlot = slot + interval;
      return slot;
    };
    const udp = p.mode === "udp" ? createUdpSocket("udp4") : undefined;
    udp?.on("error", () => errors++);
    const sendOnce = async (): Promise<void> => {
      if (p.mode === "udp") {
        await new Promise<void>((resolve) => {
          udp!.send(payload, args.port, args.host, (err) => {
            if (err) errors++;
            else sent++;
            resolve();
          });
        });
        return;
      }
      if (p.mode === "tcp-connect") {
        await new Promise<void>((resolve) => {
          const sock = createConnection({ host: args.host, port: args.port });
          const done = (counted: boolean): void => {
            if (counted) sent++;
            else errors++;
            sock.destroy();
            resolve();
          };
          sock.once("connect", () => done(true));
          sock.once("error", () => done(false));
        });
        return;
      }
      // tcp-data: one short-lived connection per send, payload written on connect.
      await new Promise<void>((resolve) => {
        const sock = createConnection({ host: args.host, port: args.port });
        sock.once("connect", () => {
          sock.write(payload, (err) => {
            if (err) errors++;
            else sent++;
            sock.destroy();
            resolve();
          });
        });
        sock.once("error", () => {
          errors++;
          resolve();
        });
      });
    };
    const worker = async (): Promise<void> => {
      for (;;) {
        if (aborted()) return;
        const slot = claimSlot();
        if (slot >= deadline) return;
        await waitOrAbort(slot - Date.now(), args.signal);
        if (aborted() || Date.now() >= deadline) return;
        await sendOnce();
      }
    };
    await Promise.all(Array.from({ length: p.concurrency }, () => worker()));
    try {
      udp?.close();
    } catch {
      /* already closed */
    }
    const stoppedReason = aborted() ? "aborted" : "duration cap";
    return {
      ok: true,
      message: `flood ${p.mode} → ${args.host}:${args.port}: ${sent} sent, ${errors} errors in ${Date.now() - started}ms (stopped: ${stoppedReason}; rate cap ${p.ratePerSec}/s, concurrency ${p.concurrency})`,
      sent,
      errors,
      elapsedMs: Date.now() - started,
      stoppedReason,
      params: p,
    };
  }
}
