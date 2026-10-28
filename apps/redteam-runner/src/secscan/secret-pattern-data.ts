/**
 * Data module: regex patterns used to detect secrets in JavaScript source.
 * Extracted from jsScanner.ts to reduce that file's line count.
 */

import type { ScanVulnerability } from "./scanner";

export interface SecretPattern {
  name: string;
  pattern: RegExp;
  severity: ScanVulnerability["severity"];
  cvssScore?: number;
  description: string;
  solution: string;
  cweId: string;
  // Return false to suppress a match (false positive filter)
  validate?: (match: string) => boolean;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  // ── AWS ───────────────────────────────────────────────────────────────────
  {
    name: "AWS Access Key ID Exposed",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    severity: "critical", cvssScore: 9.8, cweId: "CWE-798",
    description: "A live AWS Access Key ID was found in client-side JavaScript. Combined with the Secret Access Key (often nearby in the same file), this allows full AWS account access — exfiltrating S3 data, spinning up EC2 instances, accessing RDS databases, and incurring massive costs.",
    solution: "Immediately revoke this key in the AWS IAM console. Never hardcode AWS credentials in frontend code. Use IAM roles for server-side access. For client-side AWS use, use AWS Cognito Identity Pools with least-privilege scoped temporary credentials.",
    validate: (m) => !/(EXAMPLE|SAMPLE|FAKE|TEST|DEMO|PLACEHOLDER|REDACTED|XXXX)/i.test(m),
  },
  {
    name: "AWS Secret Access Key Exposed",
    pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY|secretAccessKey|secret_key)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/i,
    severity: "critical", cvssScore: 9.8, cweId: "CWE-798",
    description: "An AWS Secret Access Key was found in client-side JavaScript. This grants API-level access to AWS services.",
    solution: "Immediately revoke this key. Move AWS calls to a backend proxy that uses IAM roles. Never include AWS secrets in frontend bundles.",
    validate: (m) => !/EXAMPLE|SAMPLE|FAKE|TEST|PLACEHOLDER/i.test(m),
  },

  // ── Google ────────────────────────────────────────────────────────────────
  {
    name: "Google API Key Exposed",
    pattern: /AIza[0-9A-Za-z\-_]{35}/,
    severity: "high", cvssScore: 7.5, cweId: "CWE-798",
    description: "A Google API Key was found in client-side code. Depending on which APIs are enabled and whether the key has referrer/IP restrictions, attackers can abuse billing-metered APIs (Maps, Places, Vision, Translate), exfiltrate data, or run up large charges on your account.",
    solution: "Restrict the API key to specific HTTP referrers and APIs in the Google Cloud Console. For server-side APIs, move the key to the backend. Regularly audit key usage for anomalies in the Cloud Console.",
    validate: (m) => !/EXAMPLE|SAMPLE|YOUR.API.KEY/i.test(m),
  },
  {
    name: "Google OAuth Client Secret Exposed",
    pattern: /GOCSPX-[0-9A-Za-z\-_]{28}/,
    severity: "critical", cvssScore: 9.1, cweId: "CWE-798",
    description: "A Google OAuth Client Secret was found in client-side code. This allows attackers to impersonate your application in OAuth flows and potentially hijack user authentication.",
    solution: "Immediately rotate the OAuth client secret in Google Cloud Console. Client secrets must never be in frontend code — keep them server-side only.",
  },

  // ── Stripe ────────────────────────────────────────────────────────────────
  {
    name: "Stripe Live Secret Key Exposed",
    pattern: /\bsk_live_[0-9a-zA-Z]{24,}\b/,
    severity: "critical", cvssScore: 9.8, cweId: "CWE-798",
    description: "A Stripe live secret key was found in client-side JavaScript. This allows attackers to charge any payment method, access all customer data, issue refunds, create fraudulent transfers, and completely compromise your payment infrastructure.",
    solution: "Immediately revoke this key in the Stripe Dashboard. Stripe secret keys must ONLY be used server-side. Use Stripe.js (publishable key) for client-side payment collection.",
    validate: (m) => !/(test|EXAMPLE)/i.test(m),
  },
  {
    name: "Stripe Test Secret Key in Production",
    pattern: /\bsk_test_[0-9a-zA-Z]{24,}\b/,
    severity: "medium", cvssScore: 5.3, cweId: "CWE-798",
    description: "A Stripe test mode secret key was found in client-side JavaScript. While it cannot charge real cards, its presence indicates that secret keys are being improperly included in frontend bundles — suggesting the production secret key may also be exposed elsewhere.",
    solution: "Remove all secret keys from frontend code. Even test keys should not be exposed as they reveal your key pattern and confirm you're using Stripe.",
  },
  {
    name: "Stripe Webhook Secret Exposed",
    pattern: /\bwhsec_[0-9a-zA-Z]{32,}\b/,
    severity: "high", cvssScore: 8.1, cweId: "CWE-798",
    description: "A Stripe webhook signing secret was found in client-side code. This allows attackers to forge webhook events, potentially triggering payment confirmations, subscription activations, or other business logic without actual payments.",
    solution: "Rotate this webhook secret in the Stripe Dashboard. Webhook secrets are server-side only — they should never appear in frontend code.",
  },

  // ── GitHub ────────────────────────────────────────────────────────────────
  {
    name: "GitHub Personal Access Token Exposed",
    pattern: /\bgh[pousr]_[0-9a-zA-Z]{36,}\b/,
    severity: "critical", cvssScore: 9.1, cweId: "CWE-798",
    description: "A GitHub Personal Access Token (PAT) was found in client-side JavaScript. Depending on its scopes, this allows reading private repositories, modifying code, accessing secrets, and interacting with the entire GitHub API on behalf of the token owner.",
    solution: "Immediately revoke this token on GitHub (Settings → Developer settings → Personal access tokens). If this token had repo scope, assume all private repos it could access have been compromised.",
    validate: (m) => !/(EXAMPLE|TOKEN_HERE|YOUR_TOKEN)/i.test(m),
  },
  {
    name: "GitHub Fine-Grained Access Token Exposed",
    pattern: /\bgithub_pat_[0-9a-zA-Z_]{82,}\b/,
    severity: "critical", cvssScore: 9.1, cweId: "CWE-798",
    description: "A GitHub fine-grained access token was found in client-side JavaScript.",
    solution: "Immediately revoke this token in GitHub Settings. GitHub tokens must never be embedded in client-side code.",
  },

  // ── Slack ─────────────────────────────────────────────────────────────────
  {
    name: "Slack Bot/OAuth Token Exposed",
    pattern: /xox[baprs]-[0-9A-Za-z]{10,}-[0-9A-Za-z]{10,}/,
    severity: "high", cvssScore: 8.1, cweId: "CWE-798",
    description: "A Slack API token was found in client-side JavaScript. This allows reading all messages in accessible channels, sending messages as the bot/user, accessing files, and enumerating workspace members.",
    solution: "Immediately revoke this token in the Slack API console (api.slack.com/apps). Slack tokens must be used server-side only — never in frontend bundles.",
    validate: (m) => !/(EXAMPLE|YOUR.TOKEN|xoxb-000)/i.test(m),
  },
  {
    name: "Slack Incoming Webhook URL Exposed",
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[0-9A-Z]{8,}\/B[0-9A-Z]{8,}\/[0-9a-zA-Z]{24,}/,
    severity: "medium", cvssScore: 5.3, cweId: "CWE-798",
    description: "A Slack incoming webhook URL was found in client-side code. Anyone with this URL can post arbitrary messages to your Slack channel — enabling internal phishing, social engineering, and information injection attacks.",
    solution: "Rotate the webhook in Slack (delete and recreate). Move webhook calls to a backend proxy. If internal alerting is needed from the browser, use a server endpoint that validates and proxies the message.",
  },

  // ── Twilio ────────────────────────────────────────────────────────────────
  {
    name: "Twilio API Key Exposed",
    pattern: /SK[0-9a-fA-F]{32}/,
    severity: "high", cvssScore: 8.1, cweId: "CWE-798",
    description: "A Twilio API key was found in client-side JavaScript. This can be used to send SMS messages (billing abuse), make phone calls, access conversation data, and more.",
    solution: "Revoke this key in the Twilio console. Move all Twilio API calls to a backend service. Never include API keys in frontend JavaScript.",
    validate: (m) => !/SKXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/.test(m),
  },

  // ── SendGrid / Email ──────────────────────────────────────────────────────
  {
    name: "SendGrid API Key Exposed",
    pattern: /SG\.[0-9A-Za-z\-_]{22}\.[0-9A-Za-z\-_]{43}/,
    severity: "high", cvssScore: 8.1, cweId: "CWE-798",
    description: "A SendGrid API key was found in client-side code. This allows sending unlimited emails as your domain — ideal for spam campaigns, phishing attacks, and burning your sending reputation.",
    solution: "Immediately revoke this key in the SendGrid dashboard. Email sending keys belong server-side only.",
  },
  {
    name: "Mailchimp API Key Exposed",
    pattern: /[0-9a-f]{32}-us[0-9]{1,2}/,
    severity: "high", cvssScore: 7.5, cweId: "CWE-798",
    description: "A Mailchimp API key was found in client-side JavaScript. This provides full access to your email lists, campaigns, and subscriber data.",
    solution: "Rotate this API key in the Mailchimp account settings. Move all Mailchimp API calls to a backend service.",
    validate: (m) => !/EXAMPLE|SAMPLE|YOUR.KEY|PLACEHOLDER|TEST/i.test(m),
  },

  // ── Cryptographic Keys ────────────────────────────────────────────────────
  {
    name: "Private Key Exposed in JavaScript",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    severity: "critical", cvssScore: 10.0, cweId: "CWE-321",
    description: "A cryptographic private key was found in client-side JavaScript. This is an emergency. Private keys are used to sign JWTs, establish TLS connections, authenticate SSH sessions, and more. Anyone who downloads this page has your private key.",
    solution: "EMERGENCY: Immediately revoke and replace this key pair everywhere it is used. Audit all systems that accepted this key for unauthorized access. Private keys must NEVER exist in frontend code under any circumstances.",
  },

  // ── Supabase ──────────────────────────────────────────────────────────────
  {
    name: "Supabase Service Role Key Exposed in JavaScript",
    pattern: /(?:serviceRoleKey|service_role_key|SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY)\s*[:=]\s*["'](eyJ[A-Za-z0-9._-]{40,})["']/i,
    severity: "critical", cvssScore: 10.0, cweId: "CWE-522",
    description: "The Supabase service_role key was found in an external JavaScript file. Unlike the anon key — which is public by design — the service_role key bypasses ALL Row Level Security policies on every table, giving any visitor full admin read/write/delete access to your entire database. This is the most dangerous Supabase misconfiguration possible.",
    solution: "Immediately rotate this key in the Supabase dashboard (Project Settings → API → Reset service_role key). Remove it from all frontend code. The service_role key belongs exclusively in server-side code (Edge Functions, your own backend). For client-side use, the anon key is correct and safe to expose.",
  },

  // ── Firebase ─────────────────────────────────────────────────────────────
  {
    name: "Firebase API Key with Open Security Rules",
    pattern: /firebaseConfig\s*=\s*\{[^}]*apiKey:\s*["'][^"']+["'][^}]*\}/,
    severity: "info", cvssScore: 3.1, cweId: "CWE-798",
    description: "A Firebase configuration block was found in client-side JavaScript. Firebase API keys are public by design — they identify your project, not a secret credential. The real risk is permissive Firestore or Realtime Database security rules. See the Firebase security findings elsewhere in this report for live rule test results.",
    solution: "Review your Firestore and Realtime Database security rules to require authentication. Enable App Check to restrict API access to your own app clients. The API key itself is not a vulnerability — open rules are.",
  },

  // ── JSON Web Tokens ───────────────────────────────────────────────────────
  {
    name: "Hardcoded JWT Token in Source",
    pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/,
    severity: "high", cvssScore: 8.1, cweId: "CWE-798",
    description: "A JWT (JSON Web Token) was found hardcoded in JavaScript source code. If this is a long-lived or non-expiring token, anyone who views this code is authenticated as the associated user or service account.",
    solution: "Immediately invalidate this token (rotate the JWT signing secret, or if using a token allowlist, remove this token). Never hardcode JWTs in source code. Tokens should be dynamically obtained at runtime and stored in memory, not in code.",
    validate: (m) => {
      if (m.length <= 60) return false;
      try {
        const [, payloadB64] = m.split(".");
        if (!payloadB64) return false;
        const padded = payloadB64
          .replace(/-/g, "+").replace(/_/g, "/")
          .padEnd(payloadB64.length + (4 - (payloadB64.length % 4)) % 4, "=");
        const payload = JSON.parse(
          Buffer.from(padded, "base64").toString("utf8"),
        ) as Record<string, unknown>;
        // Supabase anon key (role:"anon") is intentionally public — not a credential.
        // Supabase service_role key is caught by a dedicated CVSS-10 check — skip here.
        if (payload.role === "anon" || payload.role === "service_role") return false;
      } catch {
        // Malformed base64 / JSON — not a real JWT
        return false;
      }
      return true;
    },
  },

  // ── Generic Secrets ───────────────────────────────────────────────────────
  {
    name: "Hardcoded Password in Source Code",
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*["'](?!.*(?:EXAMPLE|PLACEHOLDER|YOUR_|<|>|\*{3}|\.{3}|password))[^"']{8,}["']/i,
    severity: "high", cvssScore: 7.5, cweId: "CWE-259",
    description: "A hardcoded password was found in client-side JavaScript source code. Hardcoded credentials are accessible to anyone who views the source, persist forever unless code is redeployed, and cannot be rotated without a new deployment.",
    solution: "Remove all hardcoded credentials. Use environment variables on the server side. For client-side authentication, let users provide their own credentials — never hardcode service accounts in frontend code.",
    validate: (m) => {
      const bad = /password\s*[:=]\s*["'](password|admin|test|123|secret|changeme|letmein|abc123)["']/i.test(m);
      return !bad;
    },
  },
  {
    name: "Hardcoded Secret Key or Token in Source",
    pattern: /(?:secret|api_key|apikey|auth_token|access_token)\s*[:=]\s*["'](?!.*(?:EXAMPLE|PLACEHOLDER|YOUR_|<|>|\*{3}|\.{3}))[a-zA-Z0-9\-_+/]{16,}["']/i,
    severity: "medium", cvssScore: 6.5, cweId: "CWE-798",
    description: "A hardcoded secret key or token was found in client-side JavaScript. Keys and tokens embedded in frontend code are accessible to anyone who visits the site.",
    solution: "Move API keys and tokens to the backend. Use short-lived, scoped tokens issued by your backend for any client-side API calls.",
    validate: (m) => {
      // Filter obvious placeholders
      return !/your[_-]?(api[_-]?)?key|insert[_-]?key|replace[_-]?me|XXXXXXXX|1234567890/i.test(m);
    },
  },

  // ── Internal infrastructure ───────────────────────────────────────────────
  {
    name: "Internal IP Address Exposed",
    // Require the IP to be inside a string literal (quotes) — this eliminates false
    // positives from IPs in minified third-party library code, CSS/regex patterns,
    // and comment blocks that bundlers commonly include.
    pattern: /["'](?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})["']/,
    severity: "low", cvssScore: 3.1, cweId: "CWE-200",
    description: "An internal/private IP address was found hardcoded in a string literal in JavaScript source code. This reveals internal network topology, making it easier for attackers who gain any foothold to map and attack internal systems.",
    solution: "Remove internal IP references from client-side code. Use environment-based configuration to keep internal infrastructure details server-side. Review your build process to ensure internal config doesn't leak into production bundles.",
    validate: (m) => !/(localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(m),
  },

  // ── Mapbox ────────────────────────────────────────────────────────────────
  {
    name: "Mapbox Access Token Exposed",
    pattern: /pk\.ey[0-9A-Za-z._-]{50,}/,
    severity: "medium", cvssScore: 5.3, cweId: "CWE-798",
    description: "A Mapbox public access token was found in client-side JavaScript. While Mapbox tokens in frontend code are somewhat expected, an unrestricted token can be stolen and abused for mapping API usage billed to your account.",
    solution: "Restrict your Mapbox token to only the URLs of your production domains in the Mapbox access token settings. This prevents the token from being used from other domains even if stolen.",
  },
];
