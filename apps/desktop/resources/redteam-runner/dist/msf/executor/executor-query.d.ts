import { type MsfExecutor } from './executor.js';
import { type MsfResult } from './executor-types.js';
export interface MsfSearchArgs {
    host: string;
    scopeHosts: string[];
    query?: string;
    cve?: string;
    service?: string;
    platform?: string;
    signal?: AbortSignal;
}
export interface MsfSuggestArgs {
    host: string;
    scopeHosts: string[];
    service?: string;
    version?: string;
    cve?: string;
    platform?: string;
    signal?: AbortSignal;
}
export declare function msfSearch(exec: MsfExecutor, args: MsfSearchArgs): Promise<MsfResult>;
export declare function msfSuggest(exec: MsfExecutor, args: MsfSuggestArgs): Promise<MsfResult>;
