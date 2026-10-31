import { PocBundle } from '../proof/index.js';
import { type Finding } from '../types.js';
import { type Ctx } from '../context.js';
export declare function buildProofSection(ctx: Ctx, findings: Finding[], pocBundleMap: Map<string, PocBundle>): string;
