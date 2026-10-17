export interface NucleiSpawnOpts {
    argv: string[];
    /** Milliseconds before the child is killed. */
    timeoutMs: number;
    /** AbortSignal from the coordinator kill switch — kills the child. */
    signal?: AbortSignal;
}
export interface SpawnFn {
    (argv: string[], opts: {
        timeoutMs: number;
        signal?: AbortSignal;
    }): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number | null;
        killed: boolean;
        timedOut: boolean;
    }>;
}
export interface NucleiFinding {
    templateId: string;
    name: string;
    severity: string;
    host: string;
    matchedAt: string;
    cve?: string;
    tags: string[];
    excerpt: string;
}
export interface NucleiRunResult {
    findings: NucleiFinding[];
    templatesExecuted: number;
    rawLines: number;
    parseErrors: number;
    timedOut: boolean;
    killed: boolean;
    stderr: string;
}
/** Extract a CVE from a template id or name (template ids embed CVEs). */
export declare function extractCveFromTemplate(templateId: string, name: string): string | undefined;
/** Real subprocess spawn — argv array, no shell, ever. */
export declare function realNucleiSpawn(): SpawnFn;
/** Parse nuclei -jsonl output into findings. Lenient — bad lines are counted, not fatal. */
export declare function parseNucleiJsonl(stdout: string, secrets?: string[]): {
    findings: NucleiFinding[];
    parseErrors: number;
    rawLines: number;
};
