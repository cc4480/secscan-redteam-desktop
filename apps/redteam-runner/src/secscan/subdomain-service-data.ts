/**
 * Data module: subdomain takeover fingerprints for known cloud services.
 * Extracted from subdomainTakeover.ts to reduce that file's line count.
 */

import type { ScanVulnerability } from "./scanner";

export interface ServiceFingerprint {
  name: string;
  cnamePattern: RegExp;
  /** Patterns found in the HTTP body that confirm the resource is unclaimed. */
  bodyFingerprints: RegExp[];
  severity: ScanVulnerability["severity"];
  cvssScore: number;
}

export const SERVICES: ServiceFingerprint[] = [
  {
    name: "AWS S3",
    cnamePattern: /\.s3(?:-website(?:-[a-z0-9-]+)?)?\.amazonaws\.com$/i,
    bodyFingerprints: [/NoSuchBucket|The specified bucket does not exist/i],
    severity: "critical",
    cvssScore: 9.1,
  },
  {
    name: "Heroku",
    cnamePattern: /\.herokuapp\.com$|\.herokudns\.com$/i,
    bodyFingerprints: [/No such app|there is no app configured at that hostname/i],
    severity: "critical",
    cvssScore: 9.1,
  },
  {
    name: "GitHub Pages",
    cnamePattern: /\.github\.io$/i,
    bodyFingerprints: [/There isn.t a GitHub Pages site here|404 There is no GitHub Pages site/i],
    severity: "critical",
    cvssScore: 9.1,
  },
  {
    name: "Netlify",
    cnamePattern: /\.netlify\.app$|\.netlify\.com$/i,
    bodyFingerprints: [/Not Found - Request ID|Netlify.*404/i],
    severity: "critical",
    cvssScore: 9.1,
  },
  {
    name: "Vercel",
    cnamePattern: /\.vercel\.app$/i,
    bodyFingerprints: [/The deployment could not be found|404: NOT_FOUND/i],
    severity: "critical",
    cvssScore: 9.1,
  },
  {
    name: "Azure App Service",
    cnamePattern: /\.azurewebsites\.net$|\.cloudapp\.azure\.com$|\.cloudapp\.net$/i,
    bodyFingerprints: [/404 Web Site not found|Error 404.*Web app not found/i],
    severity: "critical",
    cvssScore: 9.1,
  },
  {
    name: "Fastly",
    cnamePattern: /\.fastly\.net$/i,
    bodyFingerprints: [/Fastly error: unknown domain|Please check that this domain has been added/i],
    severity: "critical",
    cvssScore: 9.1,
  },
  {
    name: "Shopify",
    cnamePattern: /\.myshopify\.com$|shops\.myshopify\.com$/i,
    bodyFingerprints: [/Sorry, this shop is currently unavailable|Only one step away/i],
    severity: "high",
    cvssScore: 8.1,
  },
  {
    name: "Ghost Pro",
    cnamePattern: /\.ghost\.io$/i,
    bodyFingerprints: [/The thing you were looking for is no longer here|404 Not found/i],
    severity: "high",
    cvssScore: 8.1,
  },
  {
    name: "Surge.sh",
    cnamePattern: /\.surge\.sh$/i,
    bodyFingerprints: [/project not found/i],
    severity: "high",
    cvssScore: 8.1,
  },
  {
    name: "Cargo",
    cnamePattern: /\.cargocollective\.com$/i,
    bodyFingerprints: [/If you.re moving your domain away from Cargo/i],
    severity: "high",
    cvssScore: 8.1,
  },
  {
    name: "Readme.io",
    cnamePattern: /\.readme\.io$|\.readmessl\.com$/i,
    bodyFingerprints: [/Project doesnt exist|404 Not found/i],
    severity: "high",
    cvssScore: 8.1,
  },
  {
    name: "Pantheon",
    cnamePattern: /\.pantheonsite\.io$/i,
    bodyFingerprints: [/404 error unknown site|The gods are wise/i],
    severity: "high",
    cvssScore: 8.1,
  },
  {
    name: "Squarespace",
    cnamePattern: /\.squarespace\.com$/i,
    bodyFingerprints: [/No Such Account|you may have followed a broken link/i],
    severity: "high",
    cvssScore: 8.1,
  },
  {
    name: "Tumblr",
    cnamePattern: /\.tumblr\.com$/i,
    bodyFingerprints: [/There.s nothing here|Whatever you were looking for doesn.t currently exist/i],
    severity: "medium",
    cvssScore: 6.5,
  },
  {
    name: "WP Engine",
    cnamePattern: /\.wpengine\.com$/i,
    bodyFingerprints: [/The site you were looking for couldn.t be found/i],
    severity: "high",
    cvssScore: 8.1,
  },
  {
    name: "Fly.io",
    cnamePattern: /\.fly\.dev$/i,
    bodyFingerprints: [/404 Not Found/i],
    severity: "high",
    cvssScore: 8.1,
  },
  {
    name: "Render",
    cnamePattern: /\.onrender\.com$/i,
    bodyFingerprints: [/There is no site here|Did you mean to access/i],
    severity: "high",
    cvssScore: 8.1,
  },
  {
    name: "Railway",
    cnamePattern: /\.up\.railway\.app$/i,
    bodyFingerprints: [/Application not found|No deployment found/i],
    severity: "high",
    cvssScore: 8.1,
  },
];
