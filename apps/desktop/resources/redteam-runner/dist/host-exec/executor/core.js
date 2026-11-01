/**
 * ExecutorCore: shared host-execution machinery (v0.19.0 refactor — extracted from executor.ts).
 */
import { checkDestructive, collectSecrets, redactSecrets, resolveSmbCredentials, resolveSshCredentials, resolveWinrmCredentials, validateHostTarget } from "../common.js";
import { createAdTransport } from "../ad.js";
import { createKrbTransport } from "../krb.js";
import { createNfsTransport } from "../nfs.js";
import { createRdpTransport } from "../rdp.js";
import { createSmbPthTransport, createSmbTransport } from "../smb.js";
import { createSshTransport } from "../ssh.js";
import { createWinrmTransport } from "../winrm.js";
export class ExecutorCore {
    deps;
    /** TEST MODE: preflight skips the destructive-command denylist (see HostExecDeps.testMode). */
    testMode;
    async bounded(p, ms, label, t) {
        let timer;
        try {
            return await Promise.race([
                p,
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`[host-exec] ${label} timed out after ${ms}ms (executor backstop)`)), ms);
                }),
            ]);
        }
        catch (err) {
            await t.close().catch(() => undefined);
            throw err;
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    constructor(deps = {}) {
        this.deps = {
            ssh: deps.ssh ?? createSshTransport,
            smb: deps.smb ?? createSmbTransport,
            smbPth: deps.smbPth ?? createSmbPthTransport,
            winrm: deps.winrm ?? createWinrmTransport,
            rdp: deps.rdp ?? createRdpTransport,
            ad: deps.ad ?? createAdTransport,
            krb: deps.krb ?? ((env) => createKrbTransport({ env })),
            nfs: deps.nfs ?? createNfsTransport,
            env: deps.env ?? process.env,
        };
        this.testMode = deps.testMode === true;
    }
    preflight(transport, host, scopeHosts, command) {
        const v = validateHostTarget(host, scopeHosts);
        if (!v.ok)
            return { refused: v.reason };
        if (command) {
            const denied = this.testMode ? null : checkDestructive(command);
            if (denied)
                return { refused: `destructive-command denylist: ${denied}` };
        }
        try {
            const creds = transport === "ssh"
                ? resolveSshCredentials(this.deps.env)
                : transport === "smb"
                    ? resolveSmbCredentials(this.deps.env)
                    : resolveWinrmCredentials(this.deps.env);
            return { creds, secrets: collectSecrets(creds) };
        }
        catch (err) {
            return { refused: err.message };
        }
    }
    /**
     * Preflight for unauthenticated recon (WinRM probe, NFS enumeration):
     * scope check, then done. No credential resolution —
     * these tools are unauthenticated by design, so no secrets exist and
     * redaction over [] is a no-op. No denylist either — no commands run.
     */
    preflightNoCreds(_transport, host, scopeHosts) {
        const v = validateHostTarget(host, scopeHosts);
        if (!v.ok)
            return { refused: v.reason };
        return { secrets: [] };
    }
    refusedResult(transport, host, refused, secrets = []) {
        return {
            ok: false,
            transport,
            host,
            summary: redactSecrets(`REFUSED: ${refused}`, secrets),
            output: "",
            ms: 0,
            refused: redactSecrets(refused, secrets),
        };
    }
}
//# sourceMappingURL=core.js.map