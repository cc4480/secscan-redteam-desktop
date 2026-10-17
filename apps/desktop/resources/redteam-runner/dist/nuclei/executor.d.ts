import { type NucleiTemplateFilter } from "./policy.js";
import { type SpawnFn, type NucleiFinding } from "./runner.js";
export interface NucleiDeps {
    env?: NodeJS.ProcessEnv;
    spawn?: SpawnFn;
    /** Injectable binary probe for tests (default: run `<bin> -version`). */
    probeBinary?: (bin: string) => Promise<boolean>;
}
export interface NucleiTemplateInfo {
    id: string;
    path: string;
}
export interface NucleiExecResult {
    summary: string;
    output: string;
    ms: number;
    refused?: string;
    findings: NucleiFinding[];
    templatesListed?: NucleiTemplateInfo[];
    templatesExecuted?: number;
    timedOut?: boolean;
}
/** Max templates returned by the recon-safe listing (operator sanity bound). */
export declare const NUCLEI_LIST_CAP = 200;
export declare class NucleiExecutor {
    killSwitch: {
        aborted: boolean;
    };
    private deps;
    constructor(deps?: NucleiDeps);
    private get env();
    private get spawn();
    private binaryAvailable;
    private preflight;
    /**
     * Recon-safe template selection. Lists the operator's local templates and
     * filters by id/tag/CVE substring — no target touched, no packet sent.
     */
    templates(args: {
        filter?: NucleiTemplateFilter;
    }): Promise<NucleiExecResult>;
    /**
     * Execute templates against ONE scope-checked host. The target URL is
     * runner-built from the scope-checked host — never agent-supplied raw.
     */
    run(args: {
        host: string;
        scopeHosts: string[];
        scheme?: string;
        filter?: NucleiTemplateFilter;
        severity?: string[];
        rateLimit: number;
        signal?: AbortSignal;
    }): Promise<NucleiExecResult>;
    private refused;
}
/** Parse `nuclei -tl` output — one template path per line, lenient. */
export declare function parseTemplateList(stdout: string): NucleiTemplateInfo[];
/** Filter templates by id/tag/CVE substring — mechanical, case-insensitive. */
export declare function filterTemplates(list: NucleiTemplateInfo[], filter?: NucleiTemplateFilter): NucleiTemplateInfo[];
/** Runner-side bound on explicit template id lists (no silent mega-runs). */
export declare function truncateIds(ids: string[] | undefined, cap: number): string[] | undefined;
