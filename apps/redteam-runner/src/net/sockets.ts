/**
 * Raw socket shell sessions (net_exec socket_* actions).
 *
 * Node's net/dgram are the transport: a TCP stream or a UDP socket bound to
 * one peer, held open across tool calls under a handle so the agent can run
 * a byte-level conversation (banner grab, hand-rolled protocol negotiation,
 * canary echo) instead of one-shot probes. Received bytes buffer in arrival
 * order; socket_recv drains the buffer FIFO and waits — bounded — for more.
 *
 * Bounds are mechanical: at most NET_MAX_OPEN_SOCKETS sessions, an idle
 * timeout per session, per-call payload/return caps in policy.ts. A session
 * whose peer closes is reported closed, never silently reopened.
 */
import { createConnection, type Socket } from "node:net";
import { createSocket as createUdpSocket, type Socket as UdpSocket } from "node:dgram";
import {
  NET_CONNECT_TIMEOUT_MS,
  NET_MAX_OPEN_SOCKETS,
  NET_MAX_RECV_BYTES,
  NET_MAX_SOCKET_PAYLOAD_BYTES,
  NET_SOCKET_IDLE_TIMEOUT_MS,
} from "./policy.js";

export type SocketProtocol = "tcp" | "udp";

interface Session {
  handle: string;
  protocol: SocketProtocol;
  host: string;
  port: number;
  tcp?: Socket;
  udp?: UdpSocket;
  chunks: Buffer[];
  buffered: number;
  closed: boolean;
  closeReason?: string;
  idleTimer?: NodeJS.Timeout;
  waiters: Array<() => void>;
}

export interface SocketOpenResult {
  ok: boolean;
  handle?: string;
  localPort?: number;
  message: string;
}

export interface SocketRecvResult {
  ok: boolean;
  data: Buffer;
  message: string;
}

/** Live socket sessions for one engagement (one NetExecutor owns one set). */
export class SocketSessions {
  private readonly sessions = new Map<string, Session>();
  private seq = 0;

  /** Number of currently open sessions. */
  get openCount(): number {
    return this.sessions.size;
  }

  /** The peer a handle was opened against, or undefined when unknown/closed. */
  peerOf(handle: string): { host: string; port: number; protocol: SocketProtocol } | undefined {
    const s = this.sessions.get(handle);
    return s ? { host: s.host, port: s.port, protocol: s.protocol } : undefined;
  }

  private armIdle(s: Session): void {
    if (s.idleTimer) clearTimeout(s.idleTimer);
    s.idleTimer = setTimeout(() => this.destroy(s, `idle for ${NET_SOCKET_IDLE_TIMEOUT_MS}ms`), NET_SOCKET_IDLE_TIMEOUT_MS);
    s.idleTimer.unref?.();
  }

  private destroy(s: Session, reason: string): void {
    if (s.closed) return;
    s.closed = true;
    s.closeReason = reason;
    if (s.idleTimer) clearTimeout(s.idleTimer);
    try {
      s.tcp?.destroy();
    } catch {
      /* already gone */
    }
    try {
      s.udp?.close();
    } catch {
      /* already gone */
    }
    this.sessions.delete(s.handle);
    for (const w of s.waiters.splice(0)) w();
  }

  private pushChunk(s: Session, chunk: Buffer): void {
    if (s.closed) return;
    // Cap retained bytes: a flooding peer must not grow the runner's memory.
    // The oldest bytes are the ones the agent had its chance to read.
    if (s.buffered + chunk.length > NET_MAX_RECV_BYTES * 4) return;
    s.chunks.push(chunk);
    s.buffered += chunk.length;
    this.armIdle(s);
    for (const w of s.waiters.splice(0)) w();
  }

  /**
   * Open a session to host:port.
   * @param args - protocol, target, and the caller's abort signal.
   * @returns the handle and local port, or the failure reason.
   */
  async open(args: { protocol: SocketProtocol; host: string; port: number; signal?: AbortSignal }): Promise<SocketOpenResult> {
    if (this.sessions.size >= NET_MAX_OPEN_SOCKETS) {
      return { ok: false, message: `session cap reached (${NET_MAX_OPEN_SOCKETS} open) — close a handle first` };
    }
    const handle = `net-${++this.seq}`;
    const s: Session = {
      handle,
      protocol: args.protocol,
      host: args.host,
      port: args.port,
      chunks: [],
      buffered: 0,
      closed: false,
      waiters: [],
    };
    if (args.protocol === "udp") {
      const udp = createUdpSocket("udp4");
      s.udp = udp;
      udp.on("message", (msg) => this.pushChunk(s, Buffer.from(msg)));
      udp.on("error", (err) => this.destroy(s, `udp error: ${err.message}`));
      await new Promise<void>((resolve) => udp.bind(0, resolve));
      // Deliberately NOT connect()ed: a connected dgram socket rejects
      // addressed sends (EISCONN) and the callback-only send overload is
      // misparsed by Node's argument normalizer — send() addresses every
      // datagram to the session peer explicitly instead.
      this.sessions.set(handle, s);
      this.armIdle(s);
      return { ok: true, handle, localPort: udp.address().port, message: `udp session ${handle} open to ${args.host}:${args.port}` };
    }
    const tcp = createConnection({ host: args.host, port: args.port });
    s.tcp = tcp;
    tcp.on("data", (d) => this.pushChunk(s, Buffer.from(d)));
    tcp.on("close", () => this.destroy(s, "peer closed the connection"));
    tcp.on("error", (err) => this.destroy(s, `tcp error: ${err.message}`));
    const connected = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), NET_CONNECT_TIMEOUT_MS);
      timer.unref?.();
      const onAbort = (): void => resolve(false);
      args.signal?.addEventListener("abort", onAbort, { once: true });
      tcp.once("connect", () => {
        clearTimeout(timer);
        args.signal?.removeEventListener("abort", onAbort);
        resolve(true);
      });
      tcp.once("error", () => {
        clearTimeout(timer);
        args.signal?.removeEventListener("abort", onAbort);
        resolve(false);
      });
    });
    if (!connected) {
      const reason = s.closeReason ?? (args.signal?.aborted ? "aborted by call signal" : `no connection within ${NET_CONNECT_TIMEOUT_MS}ms`);
      this.destroy(s, reason);
      return { ok: false, message: `connect to ${args.host}:${args.port} failed: ${reason}` };
    }
    this.sessions.set(handle, s);
    this.armIdle(s);
    return { ok: true, handle, localPort: tcp.localPort, message: `tcp session ${handle} open to ${args.host}:${args.port}` };
  }

  /**
   * Send bytes on an open session.
   * @param handle - a handle from open().
   * @param data - the bytes (already cap-checked by the caller; re-checked here).
   * @returns bytes written, or the failure reason.
   */
  async send(handle: string, data: Buffer): Promise<{ ok: boolean; sent: number; message: string }> {
    const s = this.sessions.get(handle);
    if (!s) return { ok: false, sent: 0, message: `unknown or closed handle ${JSON.stringify(handle)}` };
    if (data.length > NET_MAX_SOCKET_PAYLOAD_BYTES) {
      return { ok: false, sent: 0, message: `payload exceeds the ${NET_MAX_SOCKET_PAYLOAD_BYTES}-byte cap` };
    }
    this.armIdle(s);
    try {
      if (s.protocol === "tcp") {
        await new Promise<void>((resolve, reject) => {
          s.tcp!.write(data, (err) => (err ? reject(err) : resolve()));
        });
      } else {
        await new Promise<void>((resolve, reject) => {
          // Explicit peer: the (msg, callback) overload misreads the
          // callback as a port on current Node — always address the send.
          s.udp!.send(data, s.port, s.host, (err) => (err ? reject(err) : resolve()));
        });
      }
    } catch (err) {
      return { ok: false, sent: 0, message: `send on ${handle} failed: ${(err as Error).message}` };
    }
    return { ok: true, sent: data.length, message: `sent ${data.length} byte(s) on ${handle}` };
  }

  /**
   * Drain received bytes FIFO, waiting up to timeoutMs for the first chunk.
   * @param handle - a handle from open().
   * @param maxBytes - return cap (clamped to NET_MAX_RECV_BYTES).
   * @param timeoutMs - how long to wait when the buffer is empty.
   * @returns the bytes read (possibly empty on timeout — a result, not an error).
   */
  async recv(handle: string, maxBytes: number, timeoutMs: number): Promise<SocketRecvResult> {
    const s = this.sessions.get(handle);
    if (!s) return { ok: false, data: Buffer.alloc(0), message: `unknown or closed handle ${JSON.stringify(handle)}` };
    const cap = Math.max(1, Math.min(maxBytes, NET_MAX_RECV_BYTES));
    if (s.buffered === 0 && !s.closed && timeoutMs > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), timeoutMs);
        timer.unref?.();
        s.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    const out: Buffer[] = [];
    let taken = 0;
    while (s.chunks.length > 0 && taken < cap) {
      const head = s.chunks[0]!;
      const room = cap - taken;
      if (head.length <= room) {
        out.push(head);
        s.chunks.shift();
        taken += head.length;
        s.buffered -= head.length;
      } else {
        out.push(head.subarray(0, room));
        s.chunks[0] = head.subarray(room);
        taken += room;
        s.buffered -= room;
      }
    }
    this.armIdle(s);
    const data = Buffer.concat(out);
    const note = data.length === 0 ? (s.closed ? ` (session closed: ${s.closeReason ?? "closed"})` : " (nothing arrived in the wait window)") : "";
    return { ok: true, data, message: `received ${data.length} byte(s) on ${handle}${note}` };
  }

  /**
   * Close one session.
   * @param handle - a handle from open().
   * @returns whether a live session was closed.
   */
  close(handle: string): { ok: boolean; message: string } {
    const s = this.sessions.get(handle);
    if (!s) return { ok: false, message: `unknown or closed handle ${JSON.stringify(handle)}` };
    this.destroy(s, "closed by the agent");
    return { ok: true, message: `session ${handle} closed` };
  }

  /** Close every session (engagement teardown). */
  closeAll(): void {
    for (const s of [...this.sessions.values()]) this.destroy(s, "all sessions closed");
  }
}
