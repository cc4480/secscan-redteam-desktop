/**
 * SMB operations (Windows targets): session setup, share reachability, file listing.
 *
 * LIBRARY CHOICE: `@marsaud/smb2` (v0.18.0) — the most complete Node SMB2
 * implementation available: SMB2/3 dialect negotiation, NTLMv2 auth, tree
 * connect, readdir/stat/readFile. Evaluated alternatives: `smb2` (0.2.11,
 * older, same lineage), `v9u-smb2` (1.0.6 fork, same 2022 vintage),
 * `samba-client` (shells out to a system smbclient binary — fragile, not
 * portable). The SMB2 wire protocol itself is stable, so the 2022 vintage
 * is a maintenance caveat, not a protocol risk.
 *
 * HONEST LIMITATION, stated plainly: the library has NO NetShareEnum
 * (SRVSVC) support, so true share enumeration is not possible through it.
 * `list_shares` therefore probes well-known administrative shares (C$,
 * ADMIN$, IPC$) plus any share names the agents supply from recon, and
 * reports which accept the session — share REACHABILITY probing, not full
 * enumeration. Permission mapping on discovered shares (readdir/stat) is
 * fully supported. If the library ever gains SRVSVC, this module grows a
 * real enumerate-shares path.
 *
 * Read-only surface: list_dir, stat, probe-shares. No writes, no deletes —
 * the runner never needs them for the battery, so the tool doesn't offer them.
 */
import { createRequire } from "node:module";
import { HOST_EXEC_TIMEOUT_MS } from "../common.js";
// @marsaud/smb2 is CJS (module.exports = the client class); the tsconfig has
// no esModuleInterop, so normalize via createRequire instead of a default
// import that TypeScript can't construct.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SMB2 = require("@marsaud/smb2");
function checkAborted(signal) {
    if (signal?.aborted)
        throw new Error("[smb] aborted by call signal");
}
/** Well-known administrative shares probed by list_shares (plus recon-supplied names). */
export const WELL_KNOWN_SHARES = ["C$", "ADMIN$", "IPC$"];
function connect(args, share) {
    checkAborted(args.signal);
    const domain = args.creds.domain;
    const username = domain ? `${domain}\\${args.creds.username}` : args.creds.username;
    // The library authenticates with NTLMv2 using the provided password.
    // Empty username/password = anonymous attempt; the server's accept/reject
    // IS the observation (WS-002 null-session test).
    return new SMB2({
        share: `\\\\${args.host}\\${share}`,
        domain: domain ?? "WORKGROUP",
        username,
        password: args.creds.password ?? "",
        autoCloseTimeout: 0,
    });
}
function withTimeout(p, ms, what, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`[smb] ${what} timed out after ${ms}ms`)), ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new Error("[smb] aborted by call signal"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        p.then((v) => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            resolve(v);
        }, (e) => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            reject(e);
        });
    });
}
export function createSmbTransport() {
    const open = [];
    const track = (c) => {
        open.push(c);
        return c;
    };
    return {
        async probeShares(args, candidates) {
            checkAborted(args.signal);
            const timeoutMs = args.timeoutMs ?? HOST_EXEC_TIMEOUT_MS;
            const names = [...WELL_KNOWN_SHARES, ...candidates.filter((c) => c && !WELL_KNOWN_SHARES.includes(c))].slice(0, 20);
            const out = [];
            for (const share of names) {
                checkAborted(args.signal);
                const client = track(connect(args, share));
                try {
                    await withTimeout(new Promise((resolve, reject) => {
                        // IPC$ has no browsable root; a clean stat of "" failing with
                        // "not found" still proves the TREE CONNECT succeeded.
                        client.stat("", (err) => {
                            if (err && !/not_found|no_such|STATUS_OBJECT_NAME_NOT_FOUND/i.test(err.message)) {
                                reject(err);
                                return;
                            }
                            resolve();
                        });
                    }), timeoutMs, `share probe ${share}`, args.signal);
                    out.push({ share, accessible: true, note: "tree connect accepted" });
                }
                catch (err) {
                    const msg = err.message;
                    const denied = /access_denied|logon_failure|bad_.*password|auth/i.test(msg);
                    out.push({ share, accessible: false, note: denied ? "session/share denied" : `unreachable: ${msg.slice(0, 120)}` });
                }
            }
            return out;
        },
        async listDir(args, share, path = "") {
            checkAborted(args.signal);
            const timeoutMs = args.timeoutMs ?? HOST_EXEC_TIMEOUT_MS;
            const client = track(connect(args, share));
            // Paths are relative to the connected share's root (library convention).
            const rel = path.replace(/\//g, "\\").replace(/^\\+/, "");
            const files = await withTimeout(new Promise((resolve, reject) => {
                client.readdir(rel, (err, list) => (err ? reject(err) : resolve(list)));
            }), timeoutMs, `readdir ${share}\\${rel}`, args.signal);
            return files.slice(0, 200).map((name) => ({ name, isDirectory: false }));
        },
        async stat(args, share, path) {
            checkAborted(args.signal);
            const timeoutMs = args.timeoutMs ?? HOST_EXEC_TIMEOUT_MS;
            const client = track(connect(args, share));
            const rel = path.replace(/\//g, "\\").replace(/^\\+/, "");
            try {
                const st = await withTimeout(new Promise((resolve, reject) => {
                    client.stat(rel, (err, s) => (err ? reject(err) : resolve(s)));
                }), timeoutMs, `stat ${share}\\${rel}`, args.signal);
                return { exists: true, isDirectory: st.isDirectory(), size: st.size };
            }
            catch {
                return { exists: false, isDirectory: false };
            }
        },
        async close() {
            for (const c of open.splice(0)) {
                try {
                    c.close();
                }
                catch {
                    /* best effort */
                }
            }
        },
    };
}
//# sourceMappingURL=library.js.map