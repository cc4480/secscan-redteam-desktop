import { type EngagementInput, type EngagementResult } from "../types.js";
import { type RunOptions } from "./run-options.js";
export type { RunOptions } from "./run-options.js";
export declare function runEngagement(input: EngagementInput, opts?: RunOptions): Promise<EngagementResult>;
