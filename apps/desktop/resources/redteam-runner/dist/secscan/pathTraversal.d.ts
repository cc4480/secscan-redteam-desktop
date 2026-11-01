/**
 * Path traversal / Local File Inclusion (LFI) active probing.
 *
 * Strategy:
 *  1. Collect candidate (path, param) pairs from:
 *     a. File-related query params already on the target URL.
 *     b. File-related params found in in-page links (first 50 KB of HTML).
 *     c. Common file-serving endpoint patterns probed with known param names.
 *  2. For each candidate, send a small set of traversal payloads.
 *  3. Confirm a finding only when the response body contains definitive
 *     file content (e.g. /etc/passwd root entry or win.ini section markers).
 *
 * Only runs on deep-tier scans. Non-fatal — all errors return [].
 */
import type { ScanVulnerability } from "./scanner.js";
export declare function checkPathTraversal(targetUrl: string, html: string): Promise<ScanVulnerability[]>;
