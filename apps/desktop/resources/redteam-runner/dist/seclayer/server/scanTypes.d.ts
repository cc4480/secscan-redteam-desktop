import type { ChallengeVerdict } from "./challengePage.js";
import type { Finding, Severity, ExploitEvidence, BolaIdentity, LoginCredentials, ScanCoverage } from "../src/types.js";
import type { OobCollaborator } from "./oob.js";
import type { EmitFn } from "./scanEvents.js";
import type { TlsObservation } from "./tlsProbe.js";
export interface RedTeamFinding {
    testName: string;
    payload: string;
    severity: Severity;
    description: string;
    fix: string;
    evidence?: ExploitEvidence;
    confidence?: "low" | "medium" | "high";
}
export interface DiagnosticResult {
    url: string;
    scannedAt: string;
    responseStatus: number;
    finalUrl?: string;
    sslSecure: boolean;
    tls?: TlsObservation;
    headers: Record<string, string>;
    metaCsp?: string;
    missingHeaders: string[];
    techLeaked: string[];
    probedPaths: Array<{
        path: string;
        status: number;
        exposed: boolean;
        body?: string;
        meta?: {
            title: string;
            severity: Severity;
            description: string;
            fix: string;
        };
    }>;
    cookieIssues: string[];
    setCookies?: string[];
    cookieEvidence: Record<string, string>;
    sastFindings: Array<{
        file: string;
        issue: string;
        severity: Severity;
        confidence: "low" | "medium" | "high";
        type: string;
        fix: string;
        description: string;
        masked?: string;
    }>;
    scaLibraries: Array<{
        name: string;
        version: string;
        status: "vuln" | "safe";
        advisories: string[];
        severity: Severity;
        description: string;
        fix: string;
    }>;
    easmPerimeter: {
        subdomains: Array<{
            domain: string;
            status: "live" | "inactive";
            port: string;
        }>;
        ip: string;
        nameserver: string;
        protocol: string;
    };
    redTeamFindings?: RedTeamFinding[];
    crawl?: {
        pagesVisited: number;
        endpointsDiscovered: number;
        paramsTested: number;
        sampleEndpoints: string[];
    };
    templateFindings?: Finding[];
    apiSecFindings?: Array<{
        testName: string;
        severity: Severity;
        description: string;
        fix: string;
        endpoint: string;
        evidence?: ExploitEvidence;
        confidence?: "low" | "medium" | "high";
        verification?: string;
    }>;
    activeProbesSkipped?: boolean;
    /**
     * Set when the target's edge answered with a challenge or block page instead
     * of the site. Every content-derived check then describes that interstitial,
     * so findings read from it are withheld rather than attributed to the target.
     */
    challenge?: ChallengeVerdict;
    /**
     * True when the plain HTTP client was challenged and the page was recovered
     * with the headless browser instead (see runPassiveScan). The scan is a full
     * one — the browser reached the origin — this only records how.
     */
    renderedWithBrowser?: boolean;
    coverage?: ScanCoverage;
}
export interface ScanOptions {
    allowActiveProbes?: boolean;
    allowAggressiveProbes?: boolean;
    bolaIdentities?: [BolaIdentity, BolaIdentity];
    loginCredentials?: LoginCredentials;
    apiSchemaUrl?: string;
    oob?: OobCollaborator;
    scanId?: string;
    emit?: EmitFn;
}
