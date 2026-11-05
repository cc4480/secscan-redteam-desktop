import { type ArsenalResolveFn, type ArsenalTransportFn } from './fetch-guard-types.js';
interface HopConfig {
    resolve: ArsenalResolveFn;
    transport: ArsenalTransportFn;
    timeoutMs: number;
    maxBodyBytes: number;
}
type HopOutcome = {
    kind: 'final';
    text: string;
} | {
    kind: 'redirect';
    location: string;
};
export declare function fetchOneHop(urlString: string, hop: number, cfg: HopConfig): Promise<HopOutcome>;
export {};
