/**
 * SSH command execution (Linux targets).
 *
 * LIBRARY CHOICE: `ssh2` (v1.17.x, actively maintained as of 2026) — the
 * de-facto Node SSH2 implementation: key + password auth, exec channels,
 * per-command timeouts, and clean teardown. Evaluated alternatives: none
 * credible — every other Node SSH client is a thin wrapper around ssh2 or
 * unmaintained.
 *
 * Non-interactive exec channels only: no shells, no PTY, no port forwarding.
 * Agent forwarding is supported ONLY for the forwarding audit
 * (battery LX-018/LX-019, `sshAgentAudit` in executor.ts): the runner
 * passes the operator's local agent socket through, and the audit commands
 * only OBSERVE the forwarded socket on the target. The socket is never used
 * for onward authentication — that is analysis-only by design, documented
 * at both the transport and executor layers.
 */
import { type HostCredentials } from "./common.js";
export interface SshExecArgs {
    host: string;
    port?: number;
    creds: HostCredentials;
    command: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    /**
     * Forward the local SSH agent to the target. Only the forwarding audit
     * sets this — ordinary command execution never forwards the agent.
     */
    agentForward?: boolean;
    /** Local agent socket path, passed to ssh2's `agent` connect option. */
    agentSocketPath?: string;
}
export interface SshExecResult {
    stdout: string;
    stderr: string;
    code: number;
    ms: number;
}
/** Structural interface so tests inject a fake (no network). */
export interface SshTransport {
    exec(args: SshExecArgs): Promise<SshExecResult>;
    close(): Promise<void>;
}
/**
 * Resolve the local SSH agent socket for the forwarding audit.
 * Fails fast with an actionable error when no agent is available —
 * the audit cannot run without a socket to forward.
 */
export declare function resolveAgentSocketPath(env?: NodeJS.ProcessEnv): string;
/**
 * FIXED audit commands (battery LX-018/LX-019). Not agent-supplied — the
 * executor runs exactly these strings, and they still pass through the
 * destructive-command denylist as a mechanical backstop.
 */
export declare const SSH_AGENT_AUDIT_SOCKET_CHECK: string;
/**
 * ANALYSIS ONLY: reports who could reach the forwarded socket. The socket
 * itself is never used for onward auth — this command only reads `id`,
 * `ls`, and `stat` output.
 */
export declare const SSH_AGENT_AUDIT_ABUSE_PATH = "id; ls -l \"$SSH_AUTH_SOCK\"; stat -c '%U %G %a' \"$SSH_AUTH_SOCK\"";
export declare function createSshTransport(): SshTransport;
