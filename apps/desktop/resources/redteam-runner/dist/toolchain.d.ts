/**
 * Toolchain resolution (v0.37.0) - ONE place that decides where an external
 * binary comes from, so the precedence cannot drift between the nmap, nuclei
 * and xtool bridges.
 *
 * Order, most specific first:
 *   1. the tool's explicit env override (REDTEAM_NMAP_BIN, REDTEAM_FFUF_BIN, ...).
 *      The operator named a binary, so that value wins even when the path is
 *      missing; the resolver still reports `exists: false` so a caller says
 *      "missing" instead of silently running a binary the operator did not name.
 *   2. <REDTEAM_TOOLS_DIR>/<subdir>/<exe> - the payload the desktop app bundles
 *      (the first candidate that actually exists).
 *   3. the neutral default: the bare command name for PATH-resolved tools, or
 *      the tool's historical directory for the script tools (sqlmap/nikto) and
 *      John's Metasploit bundle.
 *
 * Pure and synchronous: it reads the environment and stats paths, never spawns
 * a process. That is what makes it unit-testable, and it lets readiness report
 * not just WHETHER something was found but WHERE it came from.
 *
 * This file owns no policy. Handing the resolved path to spawn, and deciding
 * whether an engagement may run without it, stay with the callers.
 */
/** The environment variable the desktop supervisor exports for the payload. */
export declare const TOOLS_DIR_ENV = "REDTEAM_TOOLS_DIR";
export type ExternalToolId = "nmap" | "nuclei" | "ffuf" | "gobuster" | "john" | "sqlmap" | "nikto";
/** Where a resolved binary came from. */
export type ResolveSource = "explicit" | "tools-dir" | "path";
/**
 * John ships CPU-specific binaries and no generic john.exe on Windows, so the
 * most capable variant that exists wins. A machine without AVX2 must not
 * silently fail because the runner guessed AVX2 and the load error looked like
 * "the tool is broken".
 */
export declare const JOHN_VARIANTS: string[];
export interface ResolveOptions {
    /** Environment to read; injected by tests and by callers with a captured env. */
    env?: NodeJS.ProcessEnv;
    /** Override the env var naming the binary (defaults to the tool table). */
    envBin?: string;
    /** Override the env var naming the tool directory (defaults to the tool table). */
    envDir?: string;
    /** Injectable existence check, so tests need no real files where practical. */
    exists?: (path: string) => boolean;
    /** Platform for the executable-suffix rule; injected by tests. */
    platform?: NodeJS.Platform;
}
export interface ResolvedBinary {
    /** Executable path, or the directory a script tool (sqlmap/nikto) runs from. */
    path: string;
    source: ResolveSource;
    /** The env var that supplied an explicit value, when source is "explicit". */
    envVar?: string;
    /** True when `path` is a directory the tool runs from rather than an executable. */
    directory: boolean;
    /** Whether `path` (or, for a directory, its known file) exists right now. */
    exists: boolean;
}
/** The env vars that name one tool's binary and (optionally) its directory. */
export declare function toolEnvNames(tool: ExternalToolId): {
    envBin: string;
    envDir?: string;
};
/** The bundled tools directory, when the supervisor or operator provided one. */
export declare function toolsDir(env?: NodeJS.ProcessEnv): string | undefined;
/** Human label for a resolved source, used by readiness and probe output. */
export declare function describeSource(resolved: ResolvedBinary): string;
/** Add or strip the Windows executable suffix for the platform being resolved. */
export declare function platformExe(name: string, platform?: NodeJS.Platform): string;
/**
 * Resolve one external tool. Never throws: a missing tool resolves to a path
 * with `exists: false` plus the source that produced it, which is exactly what
 * a readiness report needs to show the operator.
 */
export declare function resolveExternalBinary(tool: ExternalToolId, opts?: ResolveOptions): ResolvedBinary;
