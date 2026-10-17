export interface AdEntry {
    dn: string;
    attrs: Record<string, string[]>;
}
export interface AdTransport {
    connect(url: string): Promise<void>;
    bind(dn: string, password: string): Promise<void>;
    /** Search returning normalized entries (attribute names as returned by the server). */
    search(base: string, filter: string, attributes: string[], sizeLimit?: number): Promise<AdEntry[]>;
    /** Raw attribute names as returned (for ranged-retrieval markers). */
    searchRaw(base: string, filter: string, attributes: string[], sizeLimit?: number): Promise<{
        dn: string;
        attrs: Record<string, string[]>;
    }[]>;
    close(): Promise<void>;
}
export declare function createAdTransport(): AdTransport;
