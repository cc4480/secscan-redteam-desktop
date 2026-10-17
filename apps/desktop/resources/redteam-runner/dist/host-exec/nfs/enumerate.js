// ---------------------------------------------------------------------------
// Portmapper + mountd
// ---------------------------------------------------------------------------
import { HOST_EXEC_TIMEOUT_MS } from "../common.js";
import { XdrReader, xdrU32 } from "./xdr.js";
import { rpcCall, rpcXid, parseRpcReply, RpcAcceptError, RPC_PROG_MISMATCH } from "./rpc.js";
import { defaultNfsDial } from "./connection.js";
const PORTMAPPER_PORT = 111;
const PORTMAPPER_PROG = 100000;
const MOUNT_PROG = 100005;
const PROTO_TCP = 6;
async function rpcRoundTrip(conn, call, timeoutMs) {
    let timer;
    try {
        const p = (async () => {
            await conn.write(call);
            return conn.readRecord();
        })();
        const winner = await Promise.race([
            p,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`[nfs] RPC round-trip timed out after ${timeoutMs}ms`)), timeoutMs);
            }),
        ]);
        return parseRpcReply(winner, rpcXid(call));
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
/** Portmapper GETPORT for the mount daemon; tries mount vers 3, then vers 1. */
async function getMountdPort(dial, host, timeoutMs, signal) {
    const conn = await dial(host, PORTMAPPER_PORT, timeoutMs, signal);
    try {
        for (const vers of [3, 1]) {
            const args = Buffer.concat([xdrU32(MOUNT_PROG), xdrU32(vers), xdrU32(PROTO_TCP), xdrU32(0)]);
            const body = await rpcRoundTrip(conn, rpcCall(PORTMAPPER_PROG, 2, 3, args), timeoutMs);
            const port = new XdrReader(body).u32();
            if (port !== 0)
                return port;
        }
        throw new Error("[nfs] mountd not registered with the portmapper (vers 3 and 1)");
    }
    finally {
        conn.close();
    }
}
function parseExportList(body) {
    const r = new XdrReader(body);
    const out = [];
    while (r.u32() !== 0) {
        // exportnode: value_follows, dirpath, groups
        const dirpath = r.str();
        const groups = [];
        while (r.u32() !== 0) {
            // groupnode: value_follows, name
            groups.push(r.str());
        }
        out.push({ export: dirpath, groups });
    }
    return out;
}
export function createNfsTransport(dial = defaultNfsDial) {
    const open = new Set();
    const track = (c) => {
        open.add(c);
        return c;
    };
    return {
        async enumerateExports(args) {
            if (args.signal?.aborted)
                throw new Error("[nfs] aborted by kill switch before enumerate");
            const timeoutMs = args.timeoutMs ?? HOST_EXEC_TIMEOUT_MS;
            const mountdPort = await getMountdPort(dial, args.host, timeoutMs, args.signal);
            const conn = track(await dial(args.host, mountdPort, timeoutMs, args.signal));
            try {
                // EXPORT is proc 5 in both mount v3 and v1. Try v3 first; fall back
                // to v1 on PROG_UNAVAIL / PROG_MISMATCH (daemon too old for v3).
                let lastErr = null;
                for (const vers of [3, 1]) {
                    try {
                        const body = await rpcRoundTrip(conn, rpcCall(MOUNT_PROG, vers, 5, Buffer.alloc(0)), timeoutMs);
                        return parseExportList(body);
                    }
                    catch (err) {
                        lastErr = err;
                        const accept = err instanceof RpcAcceptError ? err.acceptStatus : -1;
                        if (vers === 3 && (accept === 1 || accept === RPC_PROG_MISMATCH))
                            continue; // try v1
                        throw err;
                    }
                }
                throw lastErr;
            }
            finally {
                open.delete(conn);
                conn.close();
            }
        },
        async close() {
            for (const c of open) {
                try {
                    c.close();
                }
                catch {
                    /* best effort */
                }
            }
            open.clear();
        },
    };
}
//# sourceMappingURL=enumerate.js.map