/**
 * Nuclei bridge policy — the mechanical backstop for nuclei_exec (v0.21.0).
 *
 * What MAY run through the bridge:
 *  - template SELECTION (list/select by id, tag, severity, CVE) — recon-safe,
 *    touches no target, only reads the operator's local template checkout
 *  - template EXECUTION against a single scope-checked host, with the
 *    runner-built argv (never agent-supplied shell text), JSONL output,
 *    rate limit inherited from the safety config
 *
 * What may NEVER run:
 *  - dos-tagged templates (denial of service stays excluded per standing
 *    ROE, no exceptions) — refused if requested, always passed as
 *    -exclude-tags dos on every run
 *  - template updates mid-engagement (`-update-templates` is never passed;
 *    updating templates is an operator act, done before the engagement)
 *  - any flag the argv builder doesn't know (unknown options are dropped,
 *    never forwarded)
 *
 * All pure functions — tested directly, no subprocess.
 */
export declare const NUCLEI_ENV_BIN = "REDTEAM_NUCLEI_BIN";
export declare const NUCLEI_ENV_TEMPLATES = "REDTEAM_NUCLEI_TEMPLATES";
export declare const NUCLEI_ENV_TIMEOUT = "REDTEAM_NUCLEI_TIMEOUT_S";
export declare const NUCLEI_SETUP_INSTRUCTIONS: string;
/** Template tags that are always excluded — DoS stays excluded in every mode. */
export declare const NUCLEI_DENIED_TAGS: string[];
/**
 * Resolve the nuclei binary through the shared toolchain resolver: explicit env
 * wins, then the payload bundled at REDTEAM_TOOLS_DIR, then PATH. The operator's
 * explicit value is authoritative even when it is missing (readiness reports
 * that honestly); only when none is set does the bundled copy get a turn.
 */
export declare function resolveNucleiBinary(env?: NodeJS.ProcessEnv): string;
/** Run timeout in seconds — env override, sane default. */
export declare function resolveNucleiTimeoutS(env?: NodeJS.ProcessEnv): number;
/** Optional operator template directory override. */
export declare function resolveNucleiTemplateDir(env?: NodeJS.ProcessEnv): string | undefined;
export interface NucleiTemplateFilter {
    ids?: string[];
    tags?: string[];
    severities?: string[];
    cve?: string;
}
/**
 * Refuses denied tags (dos). Returns the refusal label, or null when allowed.
 * The dos exclusion is ALSO enforced on every run argv via -exclude-tags.
 */
export declare function checkNucleiTags(tags: string[] | undefined): string | null;
/** Refuses unknown/unsafe extra flags — the builder only emits known flags. */
export declare function checkNucleiExtraFlags(flags: string[] | undefined): string | null;
export interface NucleiRunOptions {
    /** Fully-formed target URL, already scope-checked (e.g. https://host). */
    target: string;
    filter: NucleiTemplateFilter;
    /** Requests per second — inherited from the engagement safety config. */
    rateLimit: number;
    timeoutS: number;
    templateDir?: string;
    /** Max templates to execute in one run (operator sanity bound). */
    maxTemplates?: number;
}
/**
 * Build the nuclei argv from structured options — no shell, no interpolation.
 * The agent never supplies raw flags; unknown fields are dropped, not passed.
 */
export declare function buildNucleiRunArgv(binary: string, opts: NucleiRunOptions): string[];
/** argv for the recon-safe template listing (no target touched). */
export declare function buildNucleiListArgv(binary: string, templateDir?: string): string[];
/** Values that must never appear in logs, errors, or events. */
export declare function nucleiSecrets(): string[];
