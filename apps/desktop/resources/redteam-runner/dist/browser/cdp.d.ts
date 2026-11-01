/**
 * Browser / CDP driver — INTERFACE CONTRACT (v0.34.0).
 *
 * Why: the web battery's highest-value items (cross-account IDOR, business
 * logic, JWT flows, authenticated crawling) need a real signed-in session. Today
 * the scanner can only send an `authHeader`, so anything behind a login form is
 * out of reach.
 *
 * This module defines the driver contract and the configuration gate. The CDP
 * *transport* (a WebSocket session to Chrome/Edge DevTools) is deliberately
 * injected rather than implemented here: a WebSocket client is a dependency
 * decision, and the transport is the part that must be smoke-tested on a real
 * host, not verified headless.
 *
 * Security posture: opt-in (env), loopback by default, and every operation is a
 * named, auditable step — no arbitrary script execution beyond `evalJs`, which
 * the caller records in the event log like any other tool call.
 */
export declare const BROWSER_ENV_CDP_URL = "REDTEAM_BROWSER_CDP_URL";
export interface BrowserConfig {
    /** DevTools endpoint, e.g. http://127.0.0.1:9222 or ws://127.0.0.1:9222/devtools/browser/<id> */
    endpoint: string;
}
export interface CdpTransport {
    /** Send one CDP method and resolve its result object. */
    send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
}
export interface BrowserDriver {
    /** Current page snapshot: URL, title, visible text (truncated). */
    snapshot(): Promise<{
        url: string;
        title: string;
        text: string;
    }>;
    /** Navigate the active page. */
    navigate(url: string): Promise<void>;
    /** Evaluate an expression in the page and return its stringified result. */
    evalJs(expression: string): Promise<string>;
    /** Type into the field whose label/placeholder matches. */
    fillField(label: string, value: string): Promise<void>;
}
/** Read the optional CDP configuration. Undefined when unset or malformed. */
export declare function browserConfig(env?: NodeJS.ProcessEnv): BrowserConfig | undefined;
export declare function browserConfigured(env?: NodeJS.ProcessEnv): boolean;
/** Guidance returned by doctor/readiness when the driver is not configured. */
export declare const BROWSER_SETUP_GUIDANCE: string;
/**
 * Build a driver over an injected CDP transport. The transport owns connection
 * lifecycle; this class owns the operations the runner is allowed to perform.
 */
export declare function createCdpDriver(transport: CdpTransport): BrowserDriver;
