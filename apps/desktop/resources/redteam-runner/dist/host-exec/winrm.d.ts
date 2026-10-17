/**
 * WinRM command execution (Windows targets).
 *
 * LIBRARY CHOICE: `winrm-client` (v0.0.12, published 2026 — the most
 * recently maintained Node WinRM client found) — SOAP-based WinRM with
 * automatic auth detection: Basic for local usernames, NTLM for
 * domain-prefixed (DOMAIN\\user) or UPN (user@domain) formats. Evaluated
 * alternatives: `nodejs-winrm` (1.1.3, 2020, stale), hand-rolled SOAP
 * (NTLM handshake is error-prone to reimplement; the library's js-md4
 * based NTLM is the safer path).
 *
 * HONEST LIMITATION, stated plainly: the library exposes no abort handle
 * for in-flight requests. The kill switch therefore RACES the abort signal
 * against the request: on abort the runner abandons the promise and reports
 * termination, but the underlying HTTP request may run to the server-side
 * timeout. Commands are still bounded by timeoutMs, non-interactive, and
 * denylisted — the abandon is a runner-side guarantee, not a wire guarantee.
 *
 * Non-interactive commands only. Prefer `runPowershell` for structured
 * enumeration (Get-Service, Get-ScheduledTask, registry reads); plain
 * `runCommand` for cmd.exe builtins.
 */
import { type HostCredentials } from "./common.js";
export interface WinrmExecArgs {
    host: string;
    port?: number;
    creds: HostCredentials;
    command: string;
    /** PowerShell (true) vs cmd.exe (false). Default true — most battery items are PowerShell. */
    powershell?: boolean;
    useTls?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
}
export interface WinrmExecResult {
    stdout: string;
    stderr: string;
    code: number;
    ms: number;
}
/** Structural interface so tests inject a fake (no network). */
export interface WinrmTransport {
    exec(args: WinrmExecArgs): Promise<WinrmExecResult>;
    close(): Promise<void>;
}
export declare function createWinrmTransport(): WinrmTransport;
/** Default WinRM ports: 5985 (HTTP) and 5986 (HTTPS). */
export declare const WINRM_PROBE_PORTS: readonly [5985, 5986];
export interface WinrmProbeRequest {
    host: string;
    port: number;
    useTls: boolean;
    timeoutMs: number;
    signal?: AbortSignal;
}
export interface WinrmProbeResponse {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
}
/**
 * Injectable request seam: production uses {@link defaultWinrmProbeRequest}
 * (real HTTP/S); tests inject a fake. Never sends credentials.
 */
export type WinrmProbeRequestImpl = (req: WinrmProbeRequest) => Promise<WinrmProbeResponse>;
export interface WinrmProbeArgs {
    host: string;
    ports?: number[];
    timeoutMs?: number;
    signal?: AbortSignal;
    /** Test seam — production callers leave this unset. */
    requestImpl?: WinrmProbeRequestImpl;
}
export interface WinrmProbeResult {
    port: number;
    reachable: boolean;
    useTls: boolean;
    authSchemes: string[];
    serverHeader?: string;
    note: string;
}
/** Real HTTP/S implementation of the probe request. No credentials, no session. */
export declare function defaultWinrmProbeRequest(req: WinrmProbeRequest): Promise<WinrmProbeResponse>;
/**
 * Parse WWW-Authenticate headers into advertised scheme names.
 * HONEST LIMITATION: splitting on commas breaks on quoted parameters that
 * contain commas (rare in practice for auth schemes, e.g. `Basic
 * realm="a,b"`). Scheme names themselves never contain commas, so the
 * scheme list is still correct; only exotic parameter values could merge.
 */
export declare function parseWwwAuthenticate(headers: Record<string, string | string[] | undefined>): string[];
/**
 * Probe each port for a WinRM listener. Unauthenticated: sends one POST
 * /wsman and reads the status + headers. Ports are probed sequentially so
 * abort semantics stay simple; each port gets its own timeout.
 */
export declare function probeWinrmListener(args: WinrmProbeArgs): Promise<WinrmProbeResult[]>;
