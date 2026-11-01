// ---------------------------------------------------------------------------
// Channel abstraction (injectable for tests)
// ---------------------------------------------------------------------------
import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
class RealRdpChannel {
    sock;
    buf = Buffer.alloc(0);
    waiters = [];
    closedFlag = false;
    constructor(sock) {
        this.sock = sock;
        sock.on("data", (d) => this.onData(d));
        sock.on("close", () => this.onClose(new Error("[rdp] connection closed by peer")));
        sock.on("error", (e) => this.onClose(e instanceof Error ? e : new Error(String(e))));
    }
    onData(d) {
        this.buf = Buffer.concat([this.buf, d]);
        this.pump();
    }
    pump() {
        while (this.waiters.length > 0 && this.buf.length >= this.waiters[0].n) {
            const w = this.waiters.shift();
            clearTimeout(w.timer);
            const out = this.buf.subarray(0, w.n);
            this.buf = this.buf.subarray(w.n);
            w.resolve(out);
        }
    }
    onClose(err) {
        if (this.closedFlag)
            return;
        this.closedFlag = true;
        for (const w of this.waiters.splice(0)) {
            clearTimeout(w.timer);
            w.reject(err);
        }
    }
    write(b) {
        if (this.closedFlag)
            throw new Error("[rdp] write on closed channel");
        this.sock.write(b);
    }
    readExactly(n, timeoutMs) {
        if (this.buf.length >= n) {
            const out = this.buf.subarray(0, n);
            this.buf = this.buf.subarray(n);
            return Promise.resolve(out);
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const i = this.waiters.findIndex((w) => w.resolve === resolve);
                if (i >= 0)
                    this.waiters.splice(i, 1);
                reject(new Error(`[rdp] read timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.waiters.push({ n, resolve, reject, timer });
        });
    }
    drain() {
        const out = this.buf;
        this.buf = Buffer.alloc(0);
        return out;
    }
    async startTls() {
        const sock = this.sock;
        if (this.closedFlag)
            throw new Error("[rdp] cannot TLS-upgrade a closed channel");
        // Carry any already-buffered bytes back so the TLS layer sees them.
        const leftover = this.buf;
        this.buf = Buffer.alloc(0);
        this.waiters = [];
        const tlsSock = tlsConnect({
            socket: sock,
            // The server certificate is part of the observation (self-signed is
            // expected on RDP); this is an operator-scoped test host, not a trust
            // decision. Documented, deliberate.
            rejectUnauthorized: false,
        });
        await new Promise((resolve, reject) => {
            tlsSock.once("secureConnect", () => resolve());
            tlsSock.once("error", reject);
        });
        if (leftover.length > 0)
            tlsSock.unshift(leftover);
        this.sock = tlsSock;
        tlsSock.on("data", (d) => this.onData(d));
        tlsSock.on("close", () => this.onClose(new Error("[rdp] TLS connection closed by peer")));
        tlsSock.on("error", (e) => this.onClose(e instanceof Error ? e : new Error(String(e))));
    }
    close() {
        this.closedFlag = true;
        try {
            this.sock.destroy();
        }
        catch {
            /* best effort */
        }
    }
}
export function createRdpTransport() {
    const channels = [];
    return {
        async open(host, port, timeoutMs, signal) {
            if (signal?.aborted)
                throw new Error("[rdp] aborted by call signal before connect");
            const sock = netConnect({ host, port });
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    sock.destroy();
                    reject(new Error(`[rdp] TCP connect timed out after ${timeoutMs}ms`));
                }, timeoutMs);
                const onAbort = () => {
                    clearTimeout(timer);
                    sock.destroy();
                    reject(new Error("[rdp] aborted by call signal"));
                };
                signal?.addEventListener("abort", onAbort, { once: true });
                sock.once("connect", () => {
                    clearTimeout(timer);
                    signal?.removeEventListener("abort", onAbort);
                    resolve();
                });
                sock.once("error", (e) => {
                    clearTimeout(timer);
                    signal?.removeEventListener("abort", onAbort);
                    reject(new Error(`[rdp] TCP connect failed: ${e.message}`));
                });
            });
            const ch = new RealRdpChannel(sock);
            channels.push(ch);
            signal?.addEventListener("abort", () => ch.close(), { once: true });
            return ch;
        },
        async close() {
            for (const c of channels.splice(0)) {
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
//# sourceMappingURL=channel.js.map