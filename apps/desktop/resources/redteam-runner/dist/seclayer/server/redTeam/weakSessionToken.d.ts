import type { InjectableTarget } from "../crawler.js";
import type { ExploitEvidence, LoginCredentials, Severity } from "../../src/types.js";
export declare function findLoginTarget(targets: InjectableTarget[]): InjectableTarget | null;
export declare function extractToken(bodyText: string, contentType: string, setCookie: string[]): string | null;
export declare function probeWeakSessionToken(loginTarget: InjectableTarget, credentials: LoginCredentials, headers: Record<string, string>): Promise<{
    testName: string;
    payload: string;
    severity: Severity;
    description: string;
    fix: string;
    evidence: ExploitEvidence;
} | null>;
