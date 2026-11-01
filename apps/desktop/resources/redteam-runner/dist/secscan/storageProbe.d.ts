/**
 * Cloud storage misconfiguration probe.
 *
 * Detects publicly accessible cloud storage buckets referenced in the scanned page:
 * - AWS S3 buckets (s3.amazonaws.com, s3-<region>.amazonaws.com)
 * - Google Cloud Storage buckets (storage.googleapis.com)
 * - Azure Blob Storage accounts (blob.core.windows.net)
 * - Cloudflare R2 (r2.dev public buckets)
 *
 * Only tests buckets actually referenced in the page HTML — no guessing.
 * Checks for public LIST access (the worst case — full inventory enumeration).
 */
import type { ScanVulnerability } from "./scanner.js";
export declare function runStorageProbe(_baseUrl: string, html: string): Promise<ScanVulnerability[]>;
