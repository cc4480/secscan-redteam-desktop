import { ExecutorCore } from "./core.js";
import { type HostExecResult } from "./types.js";
export declare function sshAgentAuditImpl(core: ExecutorCore, args: {
    host: string;
    port?: number;
    mode: "socket-check" | "abuse-path";
    scopeHosts: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<HostExecResult>;
/**
 * RDP credential validation via NLA (battery WS-019). Test-account
 * credentials from the environment; the handshake itself never sees them
 * in logs (only the NT hash derivation, in memory).
 */
export interface AgentAuditParsed {
    summary: string;
    detail: string;
}
/** Parse the LX-018 socket-check compound command output. */
export declare function parseAgentSocketCheck(stdout: string): AgentAuditParsed;
/** Parse the LX-019 abuse-path command output: who could reach the socket. */
export declare function parseAgentAbusePath(stdout: string): AgentAuditParsed;
