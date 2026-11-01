import { InjectableTarget } from "./crawler.js";
export declare function probeStoredXss(formTargets: InjectableTarget[], headers: Record<string, string>, opts?: {
    maxForms?: number;
}): Promise<any[]>;
