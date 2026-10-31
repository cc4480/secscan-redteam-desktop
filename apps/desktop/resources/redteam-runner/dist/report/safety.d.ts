import { buildSafetyManifest } from "../safety/index.js";
import { type Ctx } from "../context.js";
export declare function writeSafetyArtifacts(ctx: Ctx): ReturnType<typeof buildSafetyManifest> | undefined;
