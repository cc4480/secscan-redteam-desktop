/**
 * SMB operations (Windows targets): session setup, share reachability, file listing.
 *
 * Split into submodules (public export surface unchanged — this file is the barrel):
 *  - smb/library.ts       — @marsaud/smb2 transport (share probing, listDir, stat)
 *  - smb/pth.ts           — pass-the-hash SMB2 wire builders (battery WS-023)
 *  - smb/pth-transport.ts — pass-the-hash transport (raw-socket session setup)
 */
export { createSmbTransport, WELL_KNOWN_SHARES, } from "./smb/library.js";
export { createSmbPthTransport, } from "./smb/pth-transport.js";
//# sourceMappingURL=smb.js.map