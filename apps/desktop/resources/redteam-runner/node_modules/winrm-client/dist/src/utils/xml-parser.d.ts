import { CreateShellResponse, SendInputResponse } from '../types';
export declare function extractValue(obj: unknown, path: string): unknown;
export declare function extractText(obj: unknown): string;
export declare function extractAttribute(obj: unknown, attrName: string): string;
export declare function checkForSoapFault(response: unknown): void;
export declare function extractShellId(response: CreateShellResponse): string;
export declare function extractCommandId(response: unknown): string;
export declare function extractStreams(response: unknown): Array<{
    name: string;
    content: string;
    end?: boolean;
}>;
export declare function extractSendResult(response: SendInputResponse): void;
