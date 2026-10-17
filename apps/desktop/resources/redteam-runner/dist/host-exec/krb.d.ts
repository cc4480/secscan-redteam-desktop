/**
 * Pass-the-ticket: replay the test account's OWN Kerberos tickets — battery
 * WS-064 (v0.10.0).
 *
 * HEADLESS PATH (the realistic one): the runner never had a Kerberos client
 * stack in Node (no maintained library does AP-REQ against Windows services),
 * so this module orchestrates the OPERATING SYSTEM's MIT krb5 user tools,
 * which are the standard headless Kerberos client:
 *
 *   ticket source -> ccache file (0600) -> KRB5CCNAME=<file> ->
 *     klist (is the ticket present/valid/unexpired?) ->
 *     kvno <in-scope SPN> (does the KDC accept the TGT and issue a service
 *                           ticket? — the actual replay proof)
 *
 * Ticket sources, in order:
 *   1. REDTEAM_KRB_CCACHE_B64 — base64-encoded ccache bytes (Secure Vault).
 *   2. REDTEAM_KRB_CCACHE_PATH — path to an existing ccache (copied, never mutated).
 *   3. REDTEAM_KRB_KIRBI_B64 — kirbi bytes; converted with impacket's
 *      ticketConverter.py when available. HONEST LIMITATION: a kirbi's
 *      enc-part is encrypted and general kirbi->ccache conversion needs the
 *      encryption key; the runner does not implement a KRB-CRED decryptor —
 *      it delegates to the standard tool or asks the operator for a ccache.
 *   4. kinit fallback — REDTEAM_SMB_USER / REDTEAM_SMB_PASSWORD /
 *      REDTEAM_SMB_DOMAIN (or REDTEAM_KRB_* overrides): obtain a TGT as the
 *      test account itself ("legitimately obtained"), then replay it
 *      ccache-only. The tool reports which source was used.
 *
 * Only the test account's own tickets. No forging, no silver/golden tickets.
 * Temp files are 0600, cleaned up best-effort (including on abort).
 * Requires MIT krb5 user tools (klist, kvno, kinit for fallback) on the
 * runner host — checked at runtime with an actionable error otherwise.
 */
export interface KrbPttArgs {
    /** Scope-checked host (KDC or target; the SPN's hostname is scope-checked too). */
    host: string;
    /** Target SPN for the kvno replay proof, e.g. "cifs/fileserver.corp.example". */
    spn?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}
export interface KrbPttResult {
    ok: boolean;
    ticketSource: "ccache-env" | "ccache-path" | "kirbi-converted" | "kinit" | "none";
    principal?: string;
    validUntil?: string;
    /** True when the KDC issued a service ticket from the replayed TGT. */
    kdcAccepted?: boolean;
    note: string;
}
/** Structural interface so tests inject a fake (no krb5 tools needed). */
export interface KrbTransport {
    ptt(args: KrbPttArgs): Promise<KrbPttResult>;
    close(): Promise<void>;
}
export interface KrbRunDeps {
    run(cmd: string, args: string[], env: NodeJS.ProcessEnv, input?: string, timeoutMs?: number): Promise<{
        stdout: string;
        stderr: string;
        code: number;
    }>;
    env: NodeJS.ProcessEnv;
}
/** Extract the hostname part of an SPN: service/host[@REALM] or service/host:port. */
export declare function spnHostname(spn: string): string | undefined;
export declare function createKrbTransport(deps?: Partial<KrbRunDeps>): KrbTransport;
/** Credential note for docs: the ticket/password inputs this capability reads. */
export declare function krbCredentialNames(): string[];
