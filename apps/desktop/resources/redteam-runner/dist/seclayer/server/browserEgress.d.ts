import { guardedFetch } from "./ssrf.js";
export interface EgressRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: Buffer | null;
}
export interface EgressResponse {
    status: number;
    headers: Record<string, string>;
    body: Buffer;
}
export declare function fetchForBrowser(req: EgressRequest, fetchImpl?: typeof guardedFetch): Promise<EgressResponse | null>;
export declare function installEgressGuard(page: any): Promise<void>;
