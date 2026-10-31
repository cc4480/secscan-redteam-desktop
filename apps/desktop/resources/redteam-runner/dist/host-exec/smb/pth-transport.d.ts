/**
 * Pass-the-hash SMB2 transport: NTLMv2 session setup keyed by a precomputed
 * NT hash over a raw socket (battery WS-023). Wire builders live in pth.ts.
 */
import { type Socket as SmbSocket } from "node:net";
import { type SmbPthTransport } from "./pth.js";
export declare function createSmbPthTransport(connectImpl?: (host: string, port: number) => Promise<SmbSocket>): SmbPthTransport;
export type { SmbPthArgs, SmbPthResult, SmbPthTransport } from "./pth.js";
