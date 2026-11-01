import type { ScanVulnerability } from "./scanner.js";
export interface PathProbe {
    suffix: string;
    name: string;
    severity: ScanVulnerability["severity"];
    category: string;
    cweId: string;
    cvssScore?: number;
    wstgId?: string;
    description: (path: string) => string;
    solution: string;
    validate: (body: string, ct: string, status: number) => boolean;
}
export declare const PATH_PROBES: PathProbe[];
