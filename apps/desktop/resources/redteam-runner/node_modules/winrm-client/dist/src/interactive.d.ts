import { CommandParams, InteractiveCommandParams, InteractivePromptOutput, ReceiveOutputResult } from './types';
/**
 * Monitor the output of an interactive command, detect prompts, and send responses as needed.
 */
export declare function monitorCommandOutput(params: InteractiveCommandParams): Promise<string>;
export declare function detectPromptPattern(output: string, prompts: InteractivePromptOutput[]): Promise<InteractivePromptOutput | null>;
export declare function pollCommandWithTimeout(params: CommandParams, executionTimeout: number, pollInterval: number): AsyncGenerator<ReceiveOutputResult>;
