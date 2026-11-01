export type ScanStatus = 'queued' | 'scanning' | 'analyzing' | 'complete' | 'failed' | 'canceled';
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type LiveEventChannel = 'system' | 'recon' | 'probe' | 'result' | 'flash';
export interface LiveEvent {
    seq: number;
    ts: number;
    channel: LiveEventChannel;
    text: string;
}
export interface User {
    id: string;
    email: string;
    credits: number;
    notifyWebhook?: string;
    createdAt: string;
    emailDigest?: boolean;
    lastDigestAt?: string;
}
export interface RawExchange {
    request: string;
    response: string;
    identity?: string;
}
export interface ExploitEvidence {
    method: 'reflection' | 'error-signature' | 'oracle' | 'differential' | 'introspection' | 'out-of-band' | 'observation';
    attack: RawExchange;
    baseline?: RawExchange;
    control?: RawExchange;
    signal: {
        quote: string;
        offsetInResponse: number;
        why: string;
    };
    demonstration: string;
    reproduction: string;
    capturedAt: string;
    ownership?: {
        verificationId?: string;
        method?: 'dns' | 'file';
    };
}
export interface OobEvent {
    id: string;
    token: string;
    method: string;
    sourceIp: string;
    path: string;
    userAgent?: string;
    receivedAt: string;
}
export interface BolaIdentity {
    label: string;
    authHeader: string;
    ownResource: string;
    ownMarker?: string;
}
export interface LoginCredentials {
    username: string;
    password: string;
}
export interface Finding {
    id: string;
    title: string;
    description: string;
    severity: Severity;
    confidence?: 'low' | 'medium' | 'high';
    fix: string;
    category: string;
    owasp?: string;
    isFalsePositive?: boolean;
    suppressionReason?: string;
    suppressedAt?: string;
    endpoint?: string;
    evidence?: ExploitEvidence;
    impact?: string;
    agentPrompt?: string;
    verification?: string;
}
export interface SuppressionRule {
    id: string;
    userId: string;
    targetUrl: string;
    findingTitle: string;
    reason: string;
    createdAt: string;
}
export interface Scan {
    id: string;
    userId: string;
    url: string;
    authHeader?: string;
    /** Set on scans returned to a client, in place of authHeader, which never leaves the server. */
    hasAuthHeader?: boolean;
    status: ScanStatus;
    score?: number;
    severity?: Severity;
    findings?: Finding[];
    aiSummary?: string;
    aiReasoning?: string;
    narrationLog?: string[];
    executiveBreakdown?: ExecutiveBreakdown;
    evidence?: ScanEvidence;
    error?: string;
    createdAt: string;
    completedAt?: string;
    shareToken?: string;
}
export interface CreditTransaction {
    id: string;
    userId: string;
    amount: number;
    type: 'purchase' | 'scan_debit' | 'refund';
    stripeSessionId?: string;
    createdAt: string;
}
export interface MonitoredTarget {
    id: string;
    userId: string;
    url: string;
    frequencyDays: number;
    scheduleString?: string;
    scanHour?: number | null;
    scanMinute?: number | null;
    scanWeekday?: number | null;
    lastScannedAt?: string;
    nextScanAt?: string;
    createdAt: string;
    lastError?: string;
    paused?: boolean;
}
export interface ApiKey {
    id: string;
    userId: string;
    keyPreview: string;
    credits: number;
    active: boolean;
    createdAt: string;
}
export interface ScanCoverageItem {
    label: string;
    category: string;
    checks: number;
    ran: boolean;
    note?: string;
    failed?: boolean;
}
export interface ScanCoverage {
    totalChecks: number;
    activeProbesRun: boolean;
    aggressiveProbesRun: boolean;
    items: ScanCoverageItem[];
}
export interface ScanEvidence {
    scannedAt: string;
    responseStatus: number;
    protocol: string;
    resolvedIp?: string;
    nameserver?: string;
    serverHeader?: string;
    presentSecurityHeaders: string[];
    missingSecurityHeaders: string[];
    liveSubdomains: string[];
    subdomainsChecked: number;
    probedPaths: Array<{
        path: string;
        status: number;
        exposed: boolean;
    }>;
    detectedLibraries: Array<{
        name: string;
        version: string;
        vulnerable: boolean;
    }>;
    crawl?: {
        pagesVisited: number;
        endpointsDiscovered: number;
        paramsTested: number;
        sampleEndpoints: string[];
    };
    activeProbesRun: boolean;
    coverage?: ScanCoverage;
    screenshot?: TargetScreenshot;
    compliance?: ComplianceSummary;
}
export interface ComplianceSummary {
    frameworks: Array<{
        framework: {
            id: string;
            name: string;
            version: string;
            note: string;
        };
        controls: Array<{
            control: string;
            title: string;
            findings: number;
        }>;
    }>;
    disclaimer: string;
}
export interface TargetScreenshot {
    dataUri: string;
    capturedAt: string;
    width: number;
    height: number;
}
export interface ExecutiveRiskArea {
    area: string;
    detail: string;
}
export interface ExecutiveBreakdown {
    overview: string;
    riskAreas: ExecutiveRiskArea[];
    businessImpact: string;
    priorityActions: string[];
}
export interface DomainVerification {
    id: string;
    userId: string;
    domain: string;
    token: string;
    verified: boolean;
    createdAt: string;
    verifiedAt?: string;
    method?: 'dns' | 'file';
}
export type NmapScanStatus = 'queued' | 'scanning' | 'complete' | 'failed' | 'canceled';
export interface NmapPortScript {
    id: string;
    output: string;
}
export interface NmapPort {
    port: number;
    protocol: 'tcp' | 'udp';
    state: string;
    service?: string;
    product?: string;
    version?: string;
    extraInfo?: string;
    scripts: NmapPortScript[];
}
export interface NmapOsMatch {
    name: string;
    accuracy: number;
}
export type NmapScriptOutcome = 'finding' | 'negative' | 'error' | 'inconclusive' | 'informational';
export interface NmapVulnFinding {
    port?: number;
    scriptId: string;
    output: string;
    outcome: NmapScriptOutcome;
}
export interface NmapResult {
    scannedAt: string;
    targetHost: string;
    resolvedIp: string;
    state: 'up' | 'down';
    ports: NmapPort[];
    osMatches: NmapOsMatch[];
    vulnFindings: NmapVulnFinding[];
    nmapVersion: string;
    scanArgs: string[];
    durationMs: number;
}
export interface NmapScan {
    id: string;
    userId: string;
    url: string;
    resolvedIp?: string;
    status: NmapScanStatus;
    deep?: boolean;
    nmapVersion?: string;
    result?: NmapResult;
    rawXml?: string;
    error?: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
}
export type AutofixSessionStatus = 'active' | 'done' | 'expired';
export interface AutofixSession {
    id: string;
    userId: string;
    targetUrl: string;
    findingTitle: string;
    findingCategory: string;
    status: AutofixSessionStatus;
    turns: number;
    createdAt: string;
    updatedAt: string;
}
