/**
 * JWT (JSON Web Token) analysis — passive, no extra HTTP requests.
 *
 * Extracts JWTs from response headers and HTML/JavaScript content,
 * then analyses their structure for:
 *   - alg:none (signature bypass)
 *   - Missing / far-future expiry
 *   - Sensitive data stored in the (readable) payload
 *   - Empty signature segment despite a non-none algorithm
 *   - HS256 without expiry (brute-force risk)
 */
import type { ScanVulnerability } from "./scanner.js";
export declare function analyzeJwts(headers: Record<string, string>, html: string): Promise<ScanVulnerability[]>;
