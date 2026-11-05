/**
 * Default seams — the real DNS resolver and the real `node:https` transport
 * whose `lookup` is pinned to the checked address. Extracted from
 * `fetch-guard.ts` so the parent module stays inside the runner's 300-line
 * file budget. Tests always inject stubs and never reach these.
 */
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
/* ------------------------------------------------------------------ */
/* Default seams — the real network. Tests always inject stubs.        */
/* ------------------------------------------------------------------ */
export const defaultResolve = async (hostname) => {
    const answers = await lookup(hostname, { all: true, verbatim: true });
    return answers.map(answer => answer.address);
};
export const defaultTransport = req => new Promise((resolvePromise, reject) => {
    const url = new URL(req.url);
    const request = httpsRequest({
        protocol: 'https:',
        hostname: req.hostname,
        port: url.port === '' ? 443 : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { ...req.headers },
        // SNI + certificate validation run against the original hostname;
        // an IP-literal host has no SNI name to send.
        servername: req.hostname.includes(':') || /^[0-9.]+$/.test(req.hostname)
            ? undefined
            : req.hostname,
        // The pin: DNS inside the transport is replaced by the one address
        // the guard already resolved and checked. The address validated is
        // the address connected — there is no second resolution to race.
        lookup: ((_hostname, options, callback) => {
            const cb = callback;
            if (options !== null &&
                typeof options === 'object' &&
                options.all === true) {
                cb(null, [{ address: req.address, family: req.family }]);
            }
            else {
                cb(null, req.address, req.family);
            }
        }),
        signal: req.signal,
    }, (res) => {
        resolvePromise({
            status: res.statusCode ?? 0,
            contentType: res.headers['content-type'] ?? null,
            location: res.headers.location ?? null,
            body: res,
        });
    });
    request.on('error', reject);
    request.end();
});
//# sourceMappingURL=fetch-guard-defaults.js.map