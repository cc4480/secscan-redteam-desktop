/**
 * HostExecutor — the runner's hands on hosts (v0.19.0 refactor).
 *
 * The executor is now a thin facade: shared machinery lives in
 * ./executor/core.ts (ExecutorCore), per-transport implementations in
 * ./executor/ssh.ts, ./smb.ts, ./winrm.ts, ./nfs.ts, ./agent-audit.ts,
 * ./rdp.ts, ./ad.ts, ./krb.ts. This file keeps the `HostExecutor` public
 * surface (and the agent-audit parsers + types) exactly where it was.
 */
import { ExecutorCore } from "./executor/core.js";
import { sshExecImpl } from "./executor/ssh.js";
import { smbExecImpl, smbPthImpl } from "./executor/smb.js";
import { winrmExecImpl, winrmProbeImpl } from "./executor/winrm.js";
import { nfsEnumImpl } from "./executor/nfs.js";
import { sshAgentAuditImpl } from "./executor/agent-audit.js";
import { rdpValidateImpl, rdpShadowPrepImpl } from "./executor/rdp.js";
import { adEnumImpl } from "./executor/ad.js";
import { krbPttImpl } from "./executor/krb.js";
export { parseAgentSocketCheck, parseAgentAbusePath } from "./executor/agent-audit.js";
export class HostExecutor {
    core;
    /** Kill-switch state, shared with the engagement context (phases.ts owns it). */
    get killSwitch() {
        return this.core.killSwitch;
    }
    set killSwitch(v) {
        this.core.killSwitch = v;
    }
    constructor(deps = {}) {
        this.core = new ExecutorCore(deps);
    }
    async sshExec(args) {
        return sshExecImpl(this.core, args);
    }
    async smbExec(args) {
        return smbExecImpl(this.core, args);
    }
    async winrmExec(args) {
        return winrmExecImpl(this.core, args);
    }
    async winrmProbe(args) {
        return winrmProbeImpl(this.core, args);
    }
    async nfsEnum(args) {
        return nfsEnumImpl(this.core, args);
    }
    async sshAgentAudit(args) {
        return sshAgentAuditImpl(this.core, args);
    }
    async rdpValidate(args) {
        return rdpValidateImpl(this.core, args);
    }
    async rdpShadowPrep(args) {
        return rdpShadowPrepImpl(this.core, args);
    }
    async smbPth(args) {
        return smbPthImpl(this.core, args);
    }
    async adEnum(args) {
        return adEnumImpl(this.core, args);
    }
    async krbPtt(args) {
        return krbPttImpl(this.core, args);
    }
}
//# sourceMappingURL=executor.js.map