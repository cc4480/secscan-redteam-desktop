export interface UrlKeyPair {
    prefix: string;
    url: string;
    key: string;
}
export declare function extractUrlKeyPairs(bodyText: string): UrlKeyPair[];
export declare function probeCredentialUrlPairs(pairs: UrlKeyPair[], appTables?: string[]): Promise<any | null>;
