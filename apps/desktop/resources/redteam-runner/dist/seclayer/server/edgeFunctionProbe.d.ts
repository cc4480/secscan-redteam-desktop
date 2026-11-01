import type { RedTeamFinding } from "./scanTypes.js";
export declare function extractEdgeFunctionUrls(texts: string[]): string[];
export declare function probeEdgeFunctionAuth(scannedTexts: string[], headers: Record<string, string>): Promise<RedTeamFinding | null>;
