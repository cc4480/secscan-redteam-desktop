import type { AdEntry } from "./transport.js";
export interface AdcsTemplateFinding {
    template: string;
    esc: "ESC1" | "ESC2" | "ESC4";
    detail: string;
}
/** Flag ESC1/ESC2/ESC4-style misconfigurations on one template entry. Pure function. */
export declare function analyzeTemplate(e: AdEntry, domainSid: string): AdcsTemplateFinding[];
