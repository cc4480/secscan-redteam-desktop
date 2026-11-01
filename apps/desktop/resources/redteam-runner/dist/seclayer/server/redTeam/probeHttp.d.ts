export declare const PROBE_TIMEOUT_MS = 4000;
export declare function probeFetch(url: string, headers: Record<string, string>, timeoutMs?: number): Promise<Response>;
