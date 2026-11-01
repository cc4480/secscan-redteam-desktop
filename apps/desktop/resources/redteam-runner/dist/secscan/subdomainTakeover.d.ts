/**
 * Subdomain takeover detection.
 *
 * Resolves the target hostname's CNAME chain via Cloudflare DNS-over-HTTPS,
 * checks whether the final CNAME points to a known cloud service, then
 * fetches that target to verify it returns an "unclaimed resource" fingerprint.
 *
 * Covers: AWS S3, Heroku, GitHub Pages, Netlify, Vercel, Azure, Fastly,
 * Shopify, Ghost Pro, Surge.sh, Cargo, Readme.io, Pantheon, Squarespace,
 * Tumblr, WP Engine, Fly.io, Render, and Railway.
 */
import type { ScanVulnerability } from "./scanner.js";
export declare function checkSubdomainTakeover(targetUrl: string): Promise<ScanVulnerability[]>;
