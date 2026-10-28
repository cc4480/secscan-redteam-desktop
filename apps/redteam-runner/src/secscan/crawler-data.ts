import type { ScanVulnerability } from "./scanner";

export interface PathProbe {
  suffix: string;
  name: string;
  severity: ScanVulnerability["severity"];
  category: string;
  cweId: string;
  cvssScore?: number;
  wstgId?: string;
  description: (path: string) => string;
  solution: string;
  validate: (body: string, ct: string, status: number) => boolean;
}

export const PATH_PROBES: PathProbe[] = [
  {
    suffix: "/swagger.json",
    name: "API Documentation Exposed on Inner Route (Swagger)",
    severity: "medium",
    category: "Information Disclosure",
    cweId: "CWE-200",
    cvssScore: 5.3,
    wstgId: "WSTG-CONF-04",
    description: (path) =>
      `Swagger/OpenAPI documentation is publicly accessible at "${path}swagger.json". This gives attackers a complete blueprint of every API endpoint, parameters, authentication schemes, and data models — without needing to reverse-engineer the application.`,
    solution: "Require authentication to access API docs in production, or restrict them to internal networks.",
    validate: (body) => /"swagger"|"openapi"/.test(body.slice(0, 500)),
  },
  {
    suffix: "/openapi.json",
    name: "API Documentation Exposed on Inner Route (OpenAPI)",
    severity: "medium",
    category: "Information Disclosure",
    cweId: "CWE-200",
    cvssScore: 5.3,
    wstgId: "WSTG-CONF-04",
    description: (path) =>
      `OpenAPI documentation is publicly accessible at "${path}openapi.json". This exposes a complete map of your API surface to unauthenticated users.`,
    solution: "Restrict API documentation to authenticated users or internal network access.",
    validate: (body) => /"openapi"|"swagger"/.test(body.slice(0, 500)),
  },
  {
    suffix: "/api-docs",
    name: "API Documentation Exposed on Inner Route",
    severity: "medium",
    category: "Information Disclosure",
    cweId: "CWE-200",
    cvssScore: 5.3,
    wstgId: "WSTG-CONF-04",
    description: (path) =>
      `API documentation is publicly accessible at "${path}api-docs". This may expose internal endpoint details and data structures.`,
    solution: "Restrict API documentation to authenticated users.",
    validate: (body) => /"swagger"|"openapi"|"paths"/.test(body.slice(0, 1000)),
  },
  {
    suffix: "/.env",
    name: "Environment File Exposed on Inner Route",
    severity: "critical",
    category: "Credential Exposure",
    cweId: "CWE-312",
    cvssScore: 9.1,
    wstgId: "WSTG-CONF-04",
    description: (path) =>
      `A .env file is publicly accessible at "${path}.env". This file typically contains database passwords, API keys, JWT secrets, and third-party tokens that can immediately compromise all connected services.`,
    solution: "Block .env* files at the web server level. Rotate all exposed credentials immediately.",
    validate: (body, ct) => !ct.includes("text/html") || /^[A-Z_][A-Z0-9_]*\s*=.+/m.test(body),
  },
  {
    suffix: "/.git/HEAD",
    name: "Git Repository Exposed on Inner Route",
    severity: "high",
    category: "Source Code Exposure",
    cweId: "CWE-538",
    cvssScore: 8.1,
    wstgId: "WSTG-CONF-04",
    description: (path) =>
      `A Git repository is accessible at "${path}.git/HEAD". Attackers can reconstruct source code, deleted files, and any credentials ever committed using git-dumper.`,
    solution: "Block /.git directory access at the web server. Never deploy VCS directories to a public web root.",
    validate: (body) => /^ref: refs\/heads\/\S+/.test(body.trim()) || /^[0-9a-f]{40}$/m.test(body.trim()),
  },
  {
    suffix: "/config.json",
    name: "Configuration File Exposed on Inner Route",
    severity: "high",
    category: "Information Disclosure",
    cweId: "CWE-200",
    cvssScore: 6.5,
    wstgId: "WSTG-CONF-04",
    description: (path) =>
      `A configuration file is publicly accessible at "${path}config.json". It may contain connection strings, API keys, or internal endpoint URLs.`,
    solution: "Remove config.json from web-accessible paths. Use environment variables for runtime configuration.",
    validate: (body, ct) => (ct.includes("json") || body.trim().startsWith("{")) && !ct.includes("text/html") && body.length > 20,
  },
  {
    suffix: "/graphql",
    name: "GraphQL Endpoint Exposed on Inner Route",
    severity: "medium",
    category: "Information Disclosure",
    cweId: "CWE-200",
    cvssScore: 5.3,
    wstgId: "WSTG-CONF-04",
    description: (path) =>
      `A GraphQL endpoint appears accessible at "${path}graphql". If introspection is enabled, attackers can enumerate your entire schema including all queries, mutations, types, and fields.`,
    solution: "Disable GraphQL introspection in production. Add depth limiting and query complexity analysis.",
    validate: (body) => /\"__schema\"|\"__type\"|graphql|GraphQL/i.test(body),
  },
  {
    suffix: "/debug.log",
    name: "Debug Log Exposed on Inner Route",
    severity: "medium",
    category: "Information Disclosure",
    cweId: "CWE-532",
    cvssScore: 5.3,
    wstgId: "WSTG-CONF-04",
    description: (path) =>
      `A debug log file is publicly accessible at "${path}debug.log". Logs can contain sensitive request data, stack traces, and application internals.`,
    solution: "Store logs outside the web root. Block .log files at the web server.",
    validate: (body) => body.length > 100 && /error|warn|debug|exception|trace/i.test(body.slice(0, 3000)),
  },
];
