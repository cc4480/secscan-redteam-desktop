import { FLOOD_MAX_CONCURRENCY, FLOOD_MAX_DURATION_MS, FLOOD_MAX_PAYLOAD_BYTES, FLOOD_MAX_RATE_PER_SEC, NET_MAX_PACKET_COUNT, } from "../net/policy.js";
import { TCP_FLAG_NAMES } from "../net/packets.js";
export const NET_EXEC_TOOL = {
    name: "net_exec",
    description: "Network primitives against ONE scope-checked host. Actions: " +
        "'caps' (list routes and hard caps — touches no target, safe in any phase), " +
        "'socket_open' (open a TCP or UDP session; returns a handle held across calls), " +
        "'socket_send' (write raw bytes on a handle — dataHex preferred, dataText accepted), " +
        "'socket_recv' (read buffered bytes from a handle, waiting up to waitMs for the first chunk), " +
        "'socket_close' (close a handle), " +
        "'packet_send' (send crafted IPv4 TCP/UDP/ICMP packets built from the packet fields below — host must be an IPv4 literal; replies captured and returned), " +
        "'flood' (bounded load generation, exploit phase only; production targets need the engagement's production confirmation). " +
        "Socket and packet actions are Tier 2; flood parameters are CLAMPED to hard caps in the executor " +
        `(rate ≤ ${FLOOD_MAX_RATE_PER_SEC}/s, duration ≤ ${FLOOD_MAX_DURATION_MS}ms, concurrency ≤ ${FLOOD_MAX_CONCURRENCY}, payload ≤ ${FLOOD_MAX_PAYLOAD_BYTES}B) and the result reports the effective values. ` +
        `packet_send count is capped at ${NET_MAX_PACKET_COUNT}. nping performs the privileged send (it ships with the nmap install); ` +
        "some header fields nping owns itself (checksums; source port when unset) — the result includes the runner-built reference packet hex for exactly what was specified. " +
        "Include attackId (a real ATT&CK ID such as 'T1046'), category, hypothesis. " +
        "Note: the standing ROE layer always excludes technique T1499 — a call tagged T1499 is refused by that check exactly like every other tool's, so tag flood with the battery item's technique for the resilience test being run.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["caps", "socket_open", "socket_send", "socket_recv", "socket_close", "packet_send", "flood"],
            },
            host: { type: "string", description: "Scope-checked hostname or IP (IPv4 literal for packet_send). Required for every action except caps." },
            port: { type: "number", description: "Target port 1-65535 (socket_open, flood)." },
            protocol: { type: "string", enum: ["tcp", "udp"], description: "socket_open transport. Defaults to tcp." },
            handle: { type: "string", description: "Session handle from socket_open (socket_send/recv/close)." },
            dataHex: { type: "string", description: "socket_send payload as hex — the exact bytes on the wire." },
            dataText: { type: "string", description: "socket_send payload as text (used when dataHex is absent)." },
            waitMs: { type: "number", description: "socket_recv: max wait for the first chunk when nothing is buffered (default 3000, cap 15000)." },
            // Crafted-packet fields (packet_send).
            packetProtocol: { type: "string", enum: ["tcp", "udp", "icmp"] },
            sourceIp: { type: "string", description: "Spoofed source IPv4 literal (optional; default = real source)." },
            sourcePort: { type: "number" },
            destPort: { type: "number", description: "packet_send destination port (required for tcp/udp)." },
            tcpFlags: { type: "array", items: { type: "string", enum: [...TCP_FLAG_NAMES] } },
            seq: { type: "number" },
            ack: { type: "number" },
            window: { type: "number" },
            ttl: { type: "number" },
            identification: { type: "number" },
            icmpType: { type: "number" },
            icmpCode: { type: "number" },
            icmpId: { type: "number" },
            icmpSeq: { type: "number" },
            payloadHex: { type: "string", description: "Packet payload as hex." },
            count: { type: "number", description: `Packets to send (1-${NET_MAX_PACKET_COUNT}).` },
            // Flood fields.
            floodMode: { type: "string", enum: ["tcp-connect", "tcp-data", "udp"] },
            ratePerSec: { type: "number", description: `Requested rate; clamped to ${FLOOD_MAX_RATE_PER_SEC}/s.` },
            durationMs: { type: "number", description: `Requested duration; clamped to ${FLOOD_MAX_DURATION_MS}ms.` },
            concurrency: { type: "number", description: `Requested concurrency; clamped to ${FLOOD_MAX_CONCURRENCY}.` },
            payloadBytes: { type: "number", description: `Flood payload size; clamped to ${FLOOD_MAX_PAYLOAD_BYTES}B.` },
            attackId: { type: "string" },
            category: { type: "string", enum: ["logic", "functionality", "validation"] },
            targetProfile: { type: "string", enum: ["windows", "linux"] },
            hypothesis: { type: "string" },
        },
        required: ["action", "category"],
    },
};
//# sourceMappingURL=net.js.map