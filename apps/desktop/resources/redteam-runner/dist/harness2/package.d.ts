import type { TargetClass } from "./contract.js";
import type { Harness2Store, StepRow } from "./store-model.js";
import type { ComponentFile, GuardrailFile } from "./package-component-map.js";
import type { PackageMetrics } from "./package-pairs.js";
import type { ClassExperience } from "./package-experience.js";
import type { PackagePart } from "./package-chunk.js";
/** Mode of the tuning cycle (spec section 9). */
export type PackageMode = "REPAIR" | "HARDEN" | "REPAIR-FOUNDATION";
/** Section 1: identity of the package and of the harness it was built against. */
export interface PackageHeader {
    readonly packageId: string;
    /** ISO date (YYYY-MM-DD) the package was built on. */
    readonly date: string;
    readonly formatVersion: string;
    /** Version of the tuner code that produced the package (the runner version). */
    readonly tunerVersion: string;
    readonly targetClass: TargetClass;
    readonly mode: PackageMode;
    /** dsh repository sha the harness was built from; "unknown" when not cheaply available. */
    readonly baseHarnessVersion: string;
    /** Ordered active dsh patch-layer ids (empty means the base layer only). */
    readonly activeLayerSet: readonly string[];
}
/** Section 3: one run as the package shows it - metrics plus FULL step log. */
export interface RunSnapshot {
    readonly runId: string;
    readonly ts: number;
    readonly targetClass: string;
    readonly targetSubclass?: string;
    readonly targetId?: string;
    readonly harnessVersion: string;
    readonly layerSet: readonly string[];
    readonly outcome: string;
    readonly success: boolean;
    readonly vulnsFound: number;
    readonly falsePositives: number;
    readonly claimsTotal: number;
    readonly steps: number;
    readonly tokens: number;
    readonly crashed: boolean;
    readonly failureMode: string;
}
export interface PackageRun {
    readonly snapshot: RunSnapshot;
    /** Every row of the section-5 steps table, ordered by seq, text never truncated. */
    readonly steps: readonly StepRow[];
}
/** One contrasted pair: a high-yield run against a low-yield run of the class. */
export interface ContrastedPair {
    readonly index: number;
    readonly runIdHigh: string;
    readonly runIdLow: string;
    readonly high: PackageRun;
    readonly low: PackageRun;
    /** Why this pair (cold-start/fallback note); empty when it is a plain quartile pair. */
    readonly note: string;
}
/** The tuner's mechanical selection-criteria statement (section 3). */
export interface SelectionCriteria {
    readonly windowSize: number;
    readonly windowDays: number;
    readonly windowMethod: string;
    readonly quartileMethod: string;
    readonly failureModeCoverage: readonly string[];
    readonly mode: PackageMode;
    readonly modeReason: string;
    readonly pairsFormed: number;
    readonly representativeRunIds: readonly string[];
}
/** Section 6: the four standing constraints. */
export interface PackageConstraints {
    readonly guardrailsPinned: boolean;
    readonly guardrails: readonly string[];
    readonly k: 1;
    readonly proposeOnly: boolean;
    readonly probeTokenBudget: number;
}
/** One machine-checkable checklist row (section 7). */
export interface ChecklistItem {
    readonly id: string;
    readonly section: number;
    readonly present: boolean;
    readonly nonEmpty: boolean;
    readonly detail: string;
}
/** Section 7: the machine-checkable completeness list. */
export interface PackageChecklist {
    readonly items: readonly ChecklistItem[];
    readonly complete: boolean;
    readonly delimitersBalanced: boolean;
    readonly beginCount: number;
    readonly endCount: number;
}
/** The complete section-6 package document. */
export interface ProposalPackageDocument {
    readonly formatVersion: string;
    readonly header: PackageHeader;
    readonly components: readonly ComponentFile[];
    readonly guardrails: readonly GuardrailFile[];
    readonly pairs: readonly ContrastedPair[];
    readonly selection: SelectionCriteria;
    readonly metrics: PackageMetrics;
    readonly experience: ClassExperience;
    readonly constraints: PackageConstraints;
    readonly checklist: PackageChecklist;
}
/** Empty checklist used before the rendered text exists; finalizePackage fills it. */
export declare const EMPTY_CHECKLIST: PackageChecklist;
export interface BuildProposalPackageInput {
    readonly store: Harness2Store;
    readonly targetClass: TargetClass;
    readonly environment?: NodeJS.ProcessEnv;
    /** Maximum contrasted pairs; the adapter clamps it to 2..3. */
    readonly maxPairs?: number;
    /** Repo root for component sources; discovered when omitted (tests pin it). */
    readonly repoRoot?: string;
    /** Runner package root (version stamp); derived from repoRoot when omitted. */
    readonly appRoot?: string;
    /** EXPERIENCE root override; defaults to resolveHarness2Paths(environment).experience. */
    readonly experienceDir?: string;
    /** Clock seam for tests; package date and window arithmetic use it. */
    readonly now?: Date | string;
}
/** Raised when a class has too few usable runs for a package (cold start). */
export declare class InsufficientDataError extends Error {
    readonly targetClass: TargetClass;
    readonly usableRuns: number;
    readonly windowSize: number;
    readonly windowDays: number;
    constructor(targetClass: TargetClass, usableRuns: number, windowSize: number, windowDays: number, method: string);
}
/** Deterministic package id from the date, class and contrasted run ids. */
export declare function makePackageId(date: string, targetClass: TargetClass, runIds: readonly string[]): string;
/** Assemble the self-contained section-6 package for one target class. */
export declare function buildProposalPackage(input: BuildProposalPackageInput): ProposalPackageDocument;
/** Section 10 serialize step: render the package text and split it on line boundaries. */
export declare function serializePackageParts(doc: ProposalPackageDocument): readonly PackagePart[];
export * from "./package-component-map.js";
export * from "./package-pairs.js";
export * from "./package-experience.js";
export * from "./package-instructions.js";
export * from "./package-parse.js";
export * from "./package-render.js";
export * from "./package-chunk.js";
export * from "./package-reply.js";
