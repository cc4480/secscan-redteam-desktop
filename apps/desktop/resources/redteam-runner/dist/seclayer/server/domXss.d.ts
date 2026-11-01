export interface DomXssHit {
    payload: string;
    token: string;
    html: string;
}
export declare function buildDomXssPayloads(token: string): string[];
export declare function domXssFinding(url: string, hit: DomXssHit): any;
export type DomXssDriver = (url: string, headers: Record<string, string>, payloads: string[], token: string) => Promise<DomXssHit | null>;
export declare function probeDomXss(url: string, headers: Record<string, string>, driver?: DomXssDriver): Promise<any | null>;
