import { type HostCredentials } from "../common.js";
import type { RdpTransport } from "./channel.js";
export interface RdpValidateArgs {
    host: string;
    port?: number;
    creds: HostCredentials;
    timeoutMs?: number;
    signal?: AbortSignal;
}
export interface RdpValidateResult {
    reachable: boolean;
    nlaRequired: boolean;
    /** Set only when the NLA handshake ran to a verdict. */
    credentialValid?: boolean;
    selectedProtocol?: string;
    note: string;
}
export declare function rdpValidateCredentials(transport: RdpTransport, args: RdpValidateArgs): Promise<RdpValidateResult>;
