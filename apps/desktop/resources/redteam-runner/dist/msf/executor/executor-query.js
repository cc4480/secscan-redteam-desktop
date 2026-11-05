/**
 * MsfExecutor's read-only query surface (search / suggest) — split out of
 * executor.ts for the file budget with no behaviour change. Each function
 * takes the executor explicitly and uses only its public members (deps,
 * preflight, refusedResult); the class keeps the same method signatures.
 *
 * Recon-safe by construction: neither function runs a module.
 */
import { capOutput, redactSecrets } from '../../host-exec/common.js';
import { filterAndRank, suggestModules } from '../suggest.js';
import { authedClient } from './auth.js';
import { MSF_TIMEOUT_MS } from './executor-types.js';
export async function msfSearch(exec, args) {
    const started = Date.now();
    const pre = exec.preflight(args.host, args.scopeHosts);
    if ('refused' in pre)
        return exec.refusedResult(args.host, pre.refused);
    const input = { service: args.service, cve: args.cve, platform: args.platform };
    try {
        const { client, secrets } = await authedClient(exec.deps, MSF_TIMEOUT_MS, args.signal);
        const modules = args.query
            ? filterAndRank(await client.searchModules(args.query))
            : await suggestModules(client, input);
        const runnable = modules.filter(m => !m.dropped);
        const lines = runnable
            .slice(0, 15)
            .map(m => `${m.fullname} [rank:${m.rank || 'n/a'}] — ${(m.description || '').slice(0, 140)}`);
        const dropped = modules.filter(m => m.dropped).length;
        return {
            ok: true,
            transport: 'msf',
            host: args.host,
            summary: redactSecrets(`msf search vs ${args.host}: ${runnable.length} runnable module(s)` +
                (dropped > 0 ? `, ${dropped} refused by policy` : ''), secrets),
            output: redactSecrets(capOutput(lines.join('\n') || '(no modules matched)'), secrets),
            ms: Date.now() - started,
        };
    }
    catch (err) {
        return {
            ok: false,
            transport: 'msf',
            host: args.host,
            summary: `msf search failed: ${err.message}`,
            output: '',
            ms: Date.now() - started,
        };
    }
}
export async function msfSuggest(exec, args) {
    const started = Date.now();
    const pre = exec.preflight(args.host, args.scopeHosts);
    if ('refused' in pre)
        return exec.refusedResult(args.host, pre.refused);
    try {
        const { client, secrets } = await authedClient(exec.deps, MSF_TIMEOUT_MS, args.signal);
        const ranked = await suggestModules(client, {
            service: args.service,
            version: args.version,
            cve: args.cve,
            platform: args.platform,
        });
        const runnable = ranked.filter(m => !m.dropped);
        const lines = runnable.map(m => `${m.fullname} [rank:${m.rank || 'n/a'}] — ${(m.description || '').slice(0, 140)}`);
        const dropped = ranked.filter(m => m.dropped);
        const droppedLines = dropped.map(m => `${m.fullname} — REFUSED: ${m.dropped}`);
        return {
            ok: true,
            transport: 'msf',
            host: args.host,
            summary: redactSecrets(`msf suggest vs ${args.host} (service=${args.service ?? '?'}, version=${args.version ?? '?'}): ` +
                `${runnable.length} candidate(s) for coordinator approval` +
                (dropped.length > 0 ? `, ${dropped.length} refused by policy` : ''), secrets),
            output: redactSecrets(capOutput([...lines, ...(droppedLines.length > 0 ? ['', '--- refused by policy ---', ...droppedLines] : [])].join('\n') ||
                '(no candidate modules)'), secrets),
            ms: Date.now() - started,
        };
    }
    catch (err) {
        return {
            ok: false,
            transport: 'msf',
            host: args.host,
            summary: `msf suggest failed: ${err.message}`,
            output: '',
            ms: Date.now() - started,
        };
    }
}
//# sourceMappingURL=executor-query.js.map