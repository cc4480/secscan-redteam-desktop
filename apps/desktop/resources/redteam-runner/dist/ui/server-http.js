import { readFileSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { json, badRequest, notFound, readJsonBody } from "./routes/http.js";
export const HERE = dirname(fileURLToPath(import.meta.url));
export const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
};
export function servePublic(res, name) {
    const safe = name === '' || name === '/' ? 'index.html' : name.replace(/^\/+/, '');
    if (!/^[A-Za-z0-9_./-]+$/.test(safe) || safe.includes('..')) {
        notFound(res);
        return;
    }
    const p = join(HERE, 'public', safe);
    if (!existsSync(p)) {
        notFound(res);
        return;
    }
    try {
        const body = readFileSync(p);
        res.writeHead(200, {
            'Content-Type': MIME[extname(p)] ?? 'application/octet-stream',
            'Content-Length': body.length,
            'Cache-Control': 'no-store',
        });
        res.end(body);
    }
    catch {
        notFound(res);
    }
}
export function loginPage() {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SecScan RedTeam UI</title></head>
<body style="background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<form method="post" action="/api/auth" style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:32px;max-width:380px;width:90%">
<h2 style="margin-top:0">RedTeam Console</h2>
<p style="color:#8b949e;font-size:14px">Enter the token printed in the terminal where you ran <code>redteam-runner ui</code>.</p>
<input name="token" type="password" autocomplete="off" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:10px" placeholder="ui token" required>
<button type="submit" style="margin-top:12px;width:100%;background:#238636;color:#fff;border:0;border-radius:6px;padding:10px;font-size:15px;cursor:pointer">Unlock console</button>
</form></body></html>`;
}
/** Sentinel returned by readBodyOrReject when it has already answered. */
export const BODY_REJECTED = Symbol('body-rejected');
/**
 * Read a JSON request body for a route that requires one. A malformed or
 * oversized body is the caller's error, not the server's: answer 400 (413
 * when the body exceeds the reader's cap) and return BODY_REJECTED so the
 * route stops there instead of surfacing the failure as a 500.
 */
export async function readBodyOrReject(req, res) {
    try {
        return await readJsonBody(req);
    }
    catch (err) {
        const message = err.message;
        if (message === 'body too large')
            json(res, 413, { error: message });
        else
            badRequest(res, message);
        return BODY_REJECTED;
    }
}
//# sourceMappingURL=server-http.js.map