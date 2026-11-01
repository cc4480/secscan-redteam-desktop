import type { ExploitEvidence, OobEvent } from "../../src/types.js";
export declare const AGG_TIMEOUT_MS = 4000;
export declare function aggFetch(url: string, init: RequestInit, timeoutMs?: number): Promise<Response>;
export declare function aggFetchRaw(url: string, init: RequestInit, timeoutMs?: number): Promise<Response>;
export declare function buildHeaderEvidence(p: {
    method: ExploitEvidence["method"];
    reqMethod: string;
    attackUrl: string;
    requestHeaders: Record<string, string>;
    requestBody?: string;
    res: Response;
    proofHeaders: string[];
    quote: string;
    why: string;
    demonstration: string;
    reproduction?: string;
}): ExploitEvidence;
export declare function buildPostOobEvidence(p: {
    reqMethod: string;
    attackUrl: string;
    requestHeaders: Record<string, string>;
    requestBody: string;
    callbackUrl: string;
    token: string;
    event: OobEvent;
    why: string;
    demonstration: string;
}): ExploitEvidence;
