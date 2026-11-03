import type { DiffOp } from './types.js';
export declare function requireOperator(operator: string): string;
/** True when the op's stored trust block disagrees with a fresh derivation (apply-time re-derivation, §7.3). */
export declare function trustDisagrees(op: Extract<DiffOp, {
    unit: unknown;
}>): boolean;
