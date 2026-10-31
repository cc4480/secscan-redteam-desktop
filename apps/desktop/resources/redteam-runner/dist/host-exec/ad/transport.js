// ---------------------------------------------------------------------------
// Transport (injectable for tests)
// ---------------------------------------------------------------------------
import { Client as LdapClient } from "ldapts";
import { HOST_EXEC_TIMEOUT_MS } from "../common.js";
function normalizeEntry(dn, raw) {
    const attrs = {};
    for (const [k, v] of Object.entries(raw)) {
        if (k === "dn")
            continue;
        const vals = Array.isArray(v) ? v : [v];
        attrs[k] = vals.map((x) => (Buffer.isBuffer(x) ? x.toString("base64") : String(x)));
    }
    return { dn, attrs };
}
export function createAdTransport() {
    let client;
    const api = {
        async connect(url) {
            client = new LdapClient({ url, timeout: HOST_EXEC_TIMEOUT_MS, connectTimeout: HOST_EXEC_TIMEOUT_MS });
        },
        async bind(dn, password) {
            if (!client)
                throw new Error("[ad] not connected");
            await client.bind(dn, password);
        },
        async search(base, filter, attributes, sizeLimit = 2000) {
            const raw = await api.searchRaw(base, filter, attributes, sizeLimit);
            return raw.map((e) => normalizeEntry(e.dn, e.attrs));
        },
        async searchRaw(base, filter, attributes, sizeLimit = 2000) {
            if (!client)
                throw new Error("[ad] not connected");
            const res = await client.search(base, {
                scope: "sub",
                filter,
                attributes,
                sizeLimit,
                timeLimit: 30,
                paged: false,
            });
            return res.searchEntries.map((e) => {
                const attrs = {};
                for (const [k, v] of Object.entries(e)) {
                    if (k === "dn")
                        continue;
                    const vals = Array.isArray(v) ? v : [v];
                    attrs[k] = vals.map((x) => (Buffer.isBuffer(x) ? x.toString("base64") : String(x)));
                }
                return { dn: e.dn, attrs };
            });
        },
        async close() {
            try {
                await client?.unbind();
            }
            catch {
                /* best effort */
            }
            client = undefined;
        },
    };
    return api;
}
//# sourceMappingURL=transport.js.map