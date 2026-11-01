/**
 * Network primitives (net_exec) — raw socket shell, crafted packets, and
 * the bounded flood generator.
 *
 * Added on the operator's direct order (2026-11-01): the in-app agent
 * listed these as missing from the tool layer. Shaped like the nmap/nuclei
 * bridges: a pure policy module (caps + validation + argv), a pure packet
 * builder, an executor with an injected spawn, and one dispatch handler
 * that owns the scope check before any packet.
 */
export { NET_ENV_NPING_BIN, NET_MAX_OPEN_SOCKETS, NET_MAX_PACKET_PAYLOAD_BYTES, NET_MAX_PACKET_COUNT, NET_MAX_RECV_BYTES, NET_MAX_SOCKET_PAYLOAD_BYTES, FLOOD_MAX_CONCURRENCY, FLOOD_MAX_DURATION_MS, FLOOD_MAX_PAYLOAD_BYTES, FLOOD_MAX_RATE_PER_SEC, FLOOD_MODES, buildNpingArgv, resolveFloodParams, resolveNpingBinary, validatePacketSpec, } from "./policy.js";
export type { FloodMode, FloodParams, PacketProtocol, PacketSpec } from "./policy.js";
export { buildIcmpMessage, buildIpv4Packet, buildTcpSegment, buildUdpDatagram, internetChecksum, parseIpv4, parseIpv4Packet, tcpByteToFlags, tcpFlagsToByte, } from "./packets.js";
export type { ParsedPacket, TcpFlagName } from "./packets.js";
export { NetExecutor } from "./executor.js";
export type { FloodRunResult, NetDeps, PacketSendResult } from "./executor.js";
export { SocketSessions } from "./sockets.js";
export type { SocketOpenResult, SocketProtocol, SocketRecvResult } from "./sockets.js";
