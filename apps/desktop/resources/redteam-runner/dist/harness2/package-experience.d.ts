import type { ExperienceEntry, TargetClass } from "./contract.js";
/** Canonical EXPERIENCE.md entry format, restated in the package constraints. */
export declare const EXPERIENCE_FORMAT_DOC: string;
/** Exact placeholder emitted when a class has no lessons yet (never an empty section). */
export declare const NO_EXPERIENCE_TEXT = "(no EXPERIENCE.md entries recorded for this class yet)";
/** H2-P3's filename sanitizer, mirrored so the read side finds the same file. */
export declare function sanitizeTargetClass(targetClass: TargetClass): string;
/** Canonical EXPERIENCE.md path for a class. */
export declare function experiencePath(experienceDir: string, targetClass: TargetClass): string;
/** Parse dated EXPERIENCE.md entries; malformed/incomplete entries are dropped. */
export declare function parseExperience(text: string, targetClass: TargetClass): ExperienceEntry[];
/** The class's EXPERIENCE.md: full text plus parsed entries; absence is tolerated. */
export interface ClassExperience {
    /** Canonical path the reader looked at (documented even when absent). */
    readonly path: string;
    /** True when the file exists and was read. */
    readonly hasFile: boolean;
    /** FULL file text, or NO_EXPERIENCE_TEXT when the class has no lessons yet. */
    readonly text: string;
    readonly entries: readonly ExperienceEntry[];
}
/** Read a class's full EXPERIENCE.md text; absent/unreadable means the placeholder. */
export declare function readClassExperienceText(experienceDir: string, targetClass: TargetClass): ClassExperience;
/** Read a class's lessons; absent/unreadable file means no lessons (tolerated). */
export declare function readClassExperience(experienceDir: string, targetClass: TargetClass): readonly ExperienceEntry[];
