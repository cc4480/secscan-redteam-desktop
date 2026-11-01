import type { RedTeamFinding } from "./scanTypes.js";
export declare function probePriceManipulation(rootUrl: string, postUrls: string[], headers: Record<string, string>): Promise<RedTeamFinding | null>;
