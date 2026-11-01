import { OobEvent } from "../src/types.js";
export interface OobProbe {
    token: string;
    url: string;
}
export interface OobCollaborator {
    baseUrl: string;
    issue(scanId?: string): Promise<OobProbe>;
    poll(token: string, timeoutMs: number): Promise<OobEvent | null>;
}
export interface OobStore {
    registerOobToken(token: string, scanId?: string): Promise<void>;
    getOobEvents(token: string): Promise<OobEvent[]>;
}
export declare function createOobCollaborator(store: OobStore, baseUrl: string): OobCollaborator;
