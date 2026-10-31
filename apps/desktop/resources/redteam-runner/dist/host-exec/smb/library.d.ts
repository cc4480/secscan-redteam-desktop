/**
 * SMB operations (Windows targets): session setup, share reachability, file listing.
 *
 * LIBRARY CHOICE: `@marsaud/smb2` (v0.18.0) — the most complete Node SMB2
 * implementation available: SMB2/3 dialect negotiation, NTLMv2 auth, tree
 * connect, readdir/stat/readFile. Evaluated alternatives: `smb2` (0.2.11,
 * older, same lineage), `v9u-smb2` (1.0.6 fork, same 2022 vintage),
 * `samba-client` (shells out to a system smbclient binary — fragile, not
 * portable). The SMB2 wire protocol itself is stable, so the 2022 vintage
 * is a maintenance caveat, not a protocol risk.
 *
 * HONEST LIMITATION, stated plainly: the library has NO NetShareEnum
 * (SRVSVC) support, so true share enumeration is not possible through it.
 * `list_shares` therefore probes well-known administrative shares (C$,
 * ADMIN$, IPC$) plus any share names the agents supply from recon, and
 * reports which accept the session — share REACHABILITY probing, not full
 * enumeration. Permission mapping on discovered shares (readdir/stat) is
 * fully supported. If the library ever gains SRVSVC, this module grows a
 * real enumerate-shares path.
 *
 * Read-only surface: list_dir, stat, probe-shares. No writes, no deletes —
 * the runner never needs them for the battery, so the tool doesn't offer them.
 */
import { type HostCredentials } from "../common.js";
export interface SmbDirEntry {
    name: string;
    isDirectory: boolean;
    size?: number;
}
export interface SmbArgs {
    host: string;
    creds: HostCredentials;
    timeoutMs?: number;
    signal?: AbortSignal;
}
/** Structural interface so tests inject a fake (no network). */
export interface SmbTransport {
    /** Reachability probe: which of the candidate shares accept our session. */
    probeShares(args: SmbArgs, candidates: string[]): Promise<{
        share: string;
        accessible: boolean;
        note: string;
    }[]>;
    /** List a directory on a share. Path is relative, forward slashes. */
    listDir(args: SmbArgs, share: string, path?: string): Promise<SmbDirEntry[]>;
    /** Stat one path on a share. */
    stat(args: SmbArgs, share: string, path: string): Promise<{
        exists: boolean;
        isDirectory: boolean;
        size?: number;
    }>;
    close(): Promise<void>;
}
/** Well-known administrative shares probed by list_shares (plus recon-supplied names). */
export declare const WELL_KNOWN_SHARES: string[];
export declare function createSmbTransport(): SmbTransport;
