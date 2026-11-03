export interface NmapSpawnOpts {
    file: string;
    args: string[];
    timeoutMs: number;
    signal?: AbortSignal;
}
export interface NmapSpawnResult {
    stdout: string;
    stderr: string;
    /** Exit code, or null when killed by timeout/signal. */
    code: number | null;
    timedOut: boolean;
}
export type SpawnFn = (opts: NmapSpawnOpts) => Promise<NmapSpawnResult>;
export interface NmapPort {
    port: number;
    protocol: string;
    state: string;
    service: string;
    product: string;
    version: string;
    /** NSE script id → output, when scripts ran. */
    scripts: Record<string, string>;
}
export interface NmapHostResult {
    address: string;
    hostnames: string[];
    state: string;
    ports: NmapPort[];
    osMatches: string[];
}
export interface NmapRunResult {
    hosts: NmapHostResult[];
    /** nmap's own summary line, echoed for the audit log. */
    summary: string;
    /** Hosts that were up but produced nothing, kept for honest counting. */
    upHostCount: number;
    elapsedS: number;
}
/**
 * Real spawn. Uses child_process directly with an argv array — never a shell —
 * so no argument can be reinterpreted as a command.
 */
export declare const realNmapSpawn: SpawnFn;
/**
 * Parse nmap's XML.
 *
 * A hand-rolled scan rather than a DOM dependency: nmap's schema is small and
 * fixed, and pulling an XML library into the runner to read six attributes
 * would be a supply-chain cost for no gain. It is deliberately tolerant —
 * unparseable input yields no hosts rather than throwing, because a scan that
 * ran and produced odd output must still be recorded as having run.
 */
export declare function parseNmapXml(xml: string): NmapRunResult;
