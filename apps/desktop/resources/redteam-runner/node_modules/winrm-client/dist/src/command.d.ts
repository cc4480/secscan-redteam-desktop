import { CommandParams, SendInputParams, ReceiveOutputResult } from './types';
export declare function doExecuteCommand(params: CommandParams): Promise<string>;
export declare function doSendInput(params: SendInputParams): Promise<void>;
export declare function doExecutePowershell(params: CommandParams, interactive?: boolean): Promise<string>;
export declare function doReceiveOutput(params: CommandParams): Promise<string>;
export declare function doReceiveOutputNonBlocking(params: CommandParams): Promise<ReceiveOutputResult>;
