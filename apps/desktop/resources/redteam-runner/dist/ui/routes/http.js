export function json(res, status, value) {
    const body = JSON.stringify(value);
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
}
export function badRequest(res, message) {
    json(res, 400, { error: message });
}
export function notFound(res) {
    json(res, 404, { error: "not found" });
}
/** Read a JSON body with a 1MB cap. Rejects on bad JSON or overflow. */
export function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let overflowed = false;
        req.on("data", (c) => {
            size += c.length;
            if (size > 1_048_576) {
                // Reject WITHOUT destroying the socket: the caller still owes the
                // client a response (a 413), and destroying here would reset the
                // connection before that response can be written. Accumulation
                // stops, so memory stays bounded; the server discards the rest of
                // the body once the response ends.
                if (!overflowed) {
                    overflowed = true;
                    reject(new Error("body too large"));
                }
                return;
            }
            chunks.push(c);
        });
        req.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8").trim();
            if (!raw) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(raw));
            }
            catch {
                reject(new Error("invalid JSON body"));
            }
        });
        req.on("error", reject);
    });
}
//# sourceMappingURL=http.js.map