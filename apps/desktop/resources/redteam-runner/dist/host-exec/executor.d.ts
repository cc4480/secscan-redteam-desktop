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
import { type HostExecDeps, type HostExecResult } from "./executor/types.js";
import { sshExecImpl } from "./executor/ssh.js";
import { smbExecImpl, smbPthImpl } from "./executor/smb.js";
import { winrmExecImpl, winrmProbeImpl } from "./executor/winrm.js";
import { nfsEnumImpl } from "./executor/nfs.js";
import { sshAgentAuditImpl } from "./executor/agent-audit.js";
import { rdpValidateImpl, rdpShadowPrepImpl } from "./executor/rdp.js";
import { adEnumImpl } from "./executor/ad.js";
import { krbPttImpl } from "./executor/krb.js";
export type { HostExecDeps, HostExecResult };
export { parseAgentSocketCheck, parseAgentAbusePath, type AgentAuditParsed } from "./executor/agent-audit.js";
type ArgsOf<F> = F extends (core: ExecutorCore, args: infer A) => unknown ? A : never;
export declare class HostExecutor {
    private readonly core;
    /** Kill-switch state, shared with the engagement context (phases.ts owns it). */
    get killSwitch(): {
        aborted: boolean;
    };
    set killSwitch(v: {
        aborted: boolean;
    });
    constructor(deps?: HostExecDeps);
    sshExec(args: ArgsOf<typeof sshExecImpl>): Promise<HostExecResult>;
    smbExec(args: ArgsOf<typeof smbExecImpl>): Promise<HostExecResult>;
    winrmExec(args: ArgsOf<typeof winrmExecImpl>): Promise<HostExecResult>;
    winrmProbe(args: ArgsOf<typeof winrmProbeImpl>): Promise<HostExecResult>;
    nfsEnum(args: ArgsOf<typeof nfsEnumImpl>): Promise<HostExecResult>;
    sshAgentAudit(args: ArgsOf<typeof sshAgentAuditImpl>): Promise<HostExecResult>;
    rdpValidate(args: ArgsOf<typeof rdpValidateImpl>): Promise<HostExecResult>;
    rdpShadowPrep(args: ArgsOf<typeof rdpShadowPrepImpl>): Promise<HostExecResult>;
    smbPth(args: ArgsOf<typeof smbPthImpl>): Promise<HostExecResult>;
    adEnum(args: ArgsOf<typeof adEnumImpl>): Promise<HostExecResult>;
    krbPtt(args: ArgsOf<typeof krbPttImpl>): Promise<HostExecResult>;
}
