import type { RedTeamFinding } from "./scanTypes.js";
export declare function probePrototypePollution(rootUrl: string, postUrls: string[], headers: Record<string, string>): Promise<RedTeamFinding | null>;
