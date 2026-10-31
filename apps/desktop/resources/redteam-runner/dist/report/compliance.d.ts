import { buildSafetyManifest } from "../safety/index.js";
import { type Ctx } from "../context.js";
import { type Finding } from "../types.js";
export declare function writeComplianceArtifacts(ctx: Ctx, findings: Finding[], batteryLine: string, safetyManifest: ReturnType<typeof buildSafetyManifest> | undefined): void;
