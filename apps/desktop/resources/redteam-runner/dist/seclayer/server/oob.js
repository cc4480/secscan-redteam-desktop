import crypto from "crypto";
const POLL_INTERVAL_MS = 400;
export function createOobCollaborator(store, baseUrl) {
    const base = baseUrl.replace(/\/+$/, "");
    return {
        baseUrl: base,
        async issue(scanId) {
            // 24 random bytes → 48 hex chars: unguessable, so the public endpoint
            // can't be probed for valid tokens and a callback can't be forged.
            const token = crypto.randomBytes(24).toString("hex");
            // Await registration so the token is recorded BEFORE the payload carrying
            // its callback URL is sent — otherwise a fast target could hit the OOB
            // endpoint before the write lands and the genuine callback would be dropped.
            await store.registerOobToken(token, scanId);
            return { token, url: `${base}/api/oob/${token}` };
        },
        async poll(token, timeoutMs) {
            const deadline = Date.now() + Math.max(0, timeoutMs);
            // Fast path: a callback may already be recorded before we start polling.
            const existing = await store.getOobEvents(token);
            if (existing.length > 0)
                return existing[0];
            while (Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
                const events = await store.getOobEvents(token);
                if (events.length > 0)
                    return events[0];
            }
            return null;
        },
    };
}
