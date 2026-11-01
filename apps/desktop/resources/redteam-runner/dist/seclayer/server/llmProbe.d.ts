import type { OobCollaborator } from "./oob.js";
export declare const LLM_PATH_HINT: RegExp;
export declare const LLM_FIELD_HINT: RegExp;
export interface Challenge {
    payload: string;
    expected: string;
}
export declare function makeChallenge(a: number, b: number): Challenge;
export declare function responseConfirms(responseText: string, expected: string): boolean;
export interface LlmCandidate {
    url: string;
    fields: string[];
}
export declare function buildLlmCandidates(discovered: Array<{
    url: string;
    method?: string;
    params?: string[];
}>, origin: string): LlmCandidate[];
export declare function probeLlmPromptInjection(discovered: Array<{
    url: string;
    method?: string;
    params?: string[];
}>, origin: string, headers: Record<string, string>): Promise<any | null>;
export declare function probeLlmMemoryPoisoning(discovered: Array<{
    url: string;
    method?: string;
    params?: string[];
}>, origin: string, headers: Record<string, string>): Promise<any | null>;
export declare function probeLlmInsecureToolUse(discovered: Array<{
    url: string;
    method?: string;
    params?: string[];
}>, origin: string, headers: Record<string, string>, oob?: OobCollaborator, scanId?: string): Promise<any | null>;
