/**
 * AD enumeration implementation (v0.19.0 refactor — extracted from executor.ts).
 */
import { HOST_EXEC_TIMEOUT_MS, capOutput, collectSecrets, redactSecrets, resolveAdCredentials, validateHostTarget } from "../common.js";
import { adEnumerate } from "../ad.js";
export async function adEnumImpl(core, args) {
    const started = Date.now();
    const validOps = ["users", "groups", "computers", "trusts", "ous", "gpos", "acls", "attack_paths", "adcs"];
    const operations = args.operations.filter((o) => validOps.includes(o));
    if (operations.length === 0) {
        return core.refusedResult("winrm", args.host, "ad_enum requires at least one valid operation");
    }
    const v = validateHostTarget(args.host, args.scopeHosts);
    if (!v.ok)
        return core.refusedResult("winrm", args.host, v.reason);
    let creds;
    let secrets;
    try {
        creds = resolveAdCredentials(core.deps.env);
        secrets = collectSecrets(creds);
    }
    catch (err) {
        return core.refusedResult("winrm", args.host, err.message);
    }
    const t = core.deps.ad();
    try {
        const r = await core.bounded(adEnumerate(t, {
            host: args.host,
            port: args.port,
            useTls: args.useTls,
            baseDn: args.baseDn,
            creds,
            operations,
            timeoutMs: args.timeoutMs ?? HOST_EXEC_TIMEOUT_MS,
            signal: args.signal,
        }), (args.timeoutMs ?? HOST_EXEC_TIMEOUT_MS) + 60_000, "ad_enum", t);
        const lines = r.sections.map((s) => `[${s.operation}] findings=${s.findingCount}\n${s.summary}`).join("\n\n");
        return {
            ok: r.ok,
            transport: "winrm",
            host: args.host,
            summary: redactSecrets(`ad enum ${args.host}: ${r.sections.length} operations, ${r.sections.reduce((n, s) => n + s.findingCount, 0)} findings (${operations.join(",")})`, secrets),
            output: redactSecrets(capOutput(lines), secrets),
            ms: Date.now() - started,
        };
    }
    catch (err) {
        return {
            ok: false,
            transport: "winrm",
            host: args.host,
            summary: redactSecrets(`ad enum ${args.host} failed: ${err.message}`, secrets),
            output: "",
            ms: Date.now() - started,
        };
    }
    finally {
        await t.close().catch(() => undefined);
    }
}
/**
 * Pass-the-ticket (battery WS-064). Ticket material via env (ccache/kirbi)
 * or kinit as the test account; replayed ccache-only with kvno proof.
 * The SPN's hostname is scope-checked in addition to the host.
 */
//# sourceMappingURL=ad.js.map