/**
 * Technology fingerprint detection.
 * Inspects HTTP response headers and HTML to identify the frameworks,
 * CDNs, and platforms the target site uses.
 *
 * Extracted from scanner.ts to keep the main scanner file focused on
 * orchestration and vulnerability analysis.
 */
export declare function detectTechnologies(headers: Record<string, string>, html: string): string[];
