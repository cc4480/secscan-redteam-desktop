/**
 * redteam-runner CLI argument parsing: arg/argAll/flag helpers, the usage
 * text, and buildInput() which turns argv into an EngagementInput.
 */
import type { EngagementInput } from "../types.js";
export declare function arg(flag: string): string | undefined;
export declare function argAll(flag: string): string[];
export declare function flag(name: string): boolean;
/**
 * v0.26.0: --log-max-bytes <n> / --log-max-archives <n> â€” log-rotation
 * overrides for `start` and `watch`. Env REDTEAM_LOG_MAX_BYTES /
 * REDTEAM_LOG_MAX_ARCHIVES. Fail fast with a clear message on bad values.
 */
export declare function parseLogRotationArgs(): {
    maxLogBytes?: number;
    maxLogArchives?: number;
};
export declare function usage(): never;
export declare function parseBlackout(s: string): {
    start: string;
    end: string;
    tz?: string;
};
export declare function buildInput(): EngagementInput;
