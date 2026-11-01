export declare function formHasAntiCsrfToken(fieldNames: string[]): boolean;
export declare function redactCookieValue(setCookieLine: string): string;
export declare function sessionCookieSameSiteNone(setCookieLines: string[]): string | null;
export interface CsrfForm {
    url: string;
    method: string;
    params: string[];
    discoveredOnPage?: string;
}
export declare function assessCsrf(setCookieLines: string[], forms: CsrfForm[]): any | null;
