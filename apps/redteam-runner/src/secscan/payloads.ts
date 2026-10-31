/**
 * Payload catalog — structured library of active probe payloads used by the scanner.
 *
 * Each entry carries metadata so callers can:
 *   - Filter by type or safety level (safe_by_default / requires_consent)
 *   - Reference the payload by stable ID in evidence strings (reproducible reports)
 *   - Gate aggressive payloads behind explicit consent
 *
 * Design principles (from the VibeScan safety policy):
 *   - All payloads shipped in this file are NON-DESTRUCTIVE by default.
 *   - Payloads that write data, execute code, or trigger external callbacks are
 *     marked requires_consent=true and will not run in default scans.
 *   - Filesystem read payloads target well-known read-only files (/etc/passwd,
 *     win.ini) that have no write side-effects.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PayloadType =
  | "path-traversal"
  | "open-redirect"
  | "xss-reflected"
  | "sqli-boolean"
  | "ssrf-canary";

export type PayloadEncoding =
  | "plain"
  | "url-encoded"
  | "double-url-encoded"
  | "filter-bypass";

export interface Payload {
  /** Stable identifier referenced in evidence strings for reproducibility */
  id: string;
  type: PayloadType;
  /** Raw template — substituted directly into query params, headers, or body */
  template: string;
  description: string;
  /** True when safe to send to any target without explicit written consent */
  safe_by_default: boolean;
  /** True when target owner must explicitly opt in before this payload runs */
  requires_consent: boolean;
  /** Target OS for filesystem traversal payloads */
  os?: "linux" | "windows" | "any";
  encoding?: PayloadEncoding;
  /** Regex confirming a response body indicates a real finding */
  indicator?: RegExp;
}

// ─── Path Traversal ───────────────────────────────────────────────────────────
// Non-destructive: only attempts to read /etc/passwd and win.ini (read-only files).
// These files are unmodifiable via LFI — worst case is information disclosure.

export const PATH_TRAVERSAL_PAYLOADS: Payload[] = [
  // Linux — direct sequences
  {
    id: "pt-linux-3",
    type: "path-traversal",
    template: "../../../etc/passwd",
    description: "Three-level Unix traversal to /etc/passwd",
    safe_by_default: true,
    requires_consent: false,
    os: "linux",
    encoding: "plain",
    indicator: /root:x:0:0:|daemon:[x*]:\d+:\d+:|nobody:[x*]:\d+:\d+:/,
  },
  {
    id: "pt-linux-4",
    type: "path-traversal",
    template: "../../../../etc/passwd",
    description: "Four-level Unix traversal to /etc/passwd",
    safe_by_default: true,
    requires_consent: false,
    os: "linux",
    encoding: "plain",
    indicator: /root:x:0:0:|daemon:[x*]:\d+:\d+:|nobody:[x*]:\d+:\d+:/,
  },
  {
    id: "pt-linux-6",
    type: "path-traversal",
    template: "../../../../../../etc/passwd",
    description: "Six-level Unix traversal to /etc/passwd",
    safe_by_default: true,
    requires_consent: false,
    os: "linux",
    encoding: "plain",
    indicator: /root:x:0:0:|daemon:[x*]:\d+:\d+:|nobody:[x*]:\d+:\d+:/,
  },
  // Linux — filter-bypass variants
  {
    id: "pt-linux-dotdotslash",
    type: "path-traversal",
    template: "....//....//....//etc/passwd",
    description: "Dot-dot-slash filter bypass (stripped ../ reassembles to ../)",
    safe_by_default: true,
    requires_consent: false,
    os: "linux",
    encoding: "filter-bypass",
    indicator: /root:x:0:0:|daemon:[x*]:\d+:\d+:|nobody:[x*]:\d+:\d+:/,
  },
  {
    id: "pt-linux-url-encoded",
    type: "path-traversal",
    template: "..%2F..%2F..%2Fetc%2Fpasswd",
    description: "URL-encoded forward slashes bypass naive slash blocking",
    safe_by_default: true,
    requires_consent: false,
    os: "linux",
    encoding: "url-encoded",
    indicator: /root:x:0:0:|daemon:[x*]:\d+:\d+:|nobody:[x*]:\d+:\d+:/,
  },
  {
    id: "pt-linux-hex-encoded",
    type: "path-traversal",
    template: "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    description: "Hex-encoded dot and slash — bypasses character-level filters",
    safe_by_default: true,
    requires_consent: false,
    os: "linux",
    encoding: "url-encoded",
    indicator: /root:x:0:0:|daemon:[x*]:\d+:\d+:|nobody:[x*]:\d+:\d+:/,
  },
  {
    id: "pt-linux-double-encoded",
    type: "path-traversal",
    template: "..%252f..%252f..%252fetc%252fpasswd",
    description: "Double URL-encoded slash — server-side double-decode bypass",
    safe_by_default: true,
    requires_consent: false,
    os: "linux",
    encoding: "double-url-encoded",
    indicator: /root:x:0:0:|daemon:[x*]:\d+:\d+:|nobody:[x*]:\d+:\d+:/,
  },
  // Windows
  {
    id: "pt-windows-3",
    type: "path-traversal",
    template: "../../../windows/win.ini",
    description: "Three-level Windows traversal to win.ini",
    safe_by_default: true,
    requires_consent: false,
    os: "windows",
    encoding: "plain",
    indicator: /\[fonts\]|\[extensions\]|\[mci extensions\]|\[files\]/i,
  },
  {
    id: "pt-windows-4",
    type: "path-traversal",
    template: "../../../../windows/win.ini",
    description: "Four-level Windows traversal to win.ini",
    safe_by_default: true,
    requires_consent: false,
    os: "windows",
    encoding: "plain",
    indicator: /\[fonts\]|\[extensions\]|\[mci extensions\]|\[files\]/i,
  },
  {
    id: "pt-windows-hex-encoded",
    type: "path-traversal",
    template: "%2e%2e%2f%2e%2e%2f%2e%2e%2fwindows%2fwin.ini",
    description: "Hex-encoded Windows traversal to win.ini",
    safe_by_default: true,
    requires_consent: false,
    os: "windows",
    encoding: "url-encoded",
    indicator: /\[fonts\]|\[extensions\]|\[mci extensions\]|\[files\]/i,
  },
];

/** All path traversal payload templates in insertion order (for loop compat) */
export const PATH_TRAVERSAL_TEMPLATES: string[] =
  PATH_TRAVERSAL_PAYLOADS.map((p) => p.template);

/** All success indicators in insertion order — parallel to PATH_TRAVERSAL_PAYLOADS */
export function classifyTraversalBody(body: string): "linux" | "windows" | null {
  const linuxIndicators = [
    /root:x:0:0:/,
    /daemon:[x*]:\d+:\d+:/,
    /nobody:[x*]:\d+:\d+:/,
    /bin:[x*]:\d+:\d+:/,
  ];
  const windowsIndicators = [
    /\[fonts\]/i,
    /\[extensions\]/i,
    /\[mci extensions\]/i,
    /\[files\]/i,
  ];
  if (linuxIndicators.some((rx) => rx.test(body))) return "linux";
  if (windowsIndicators.some((rx) => rx.test(body))) return "windows";
  return null;
}

// ─── Open Redirect ────────────────────────────────────────────────────────────
// Uses a domain we control for probe detection. The request is GET-only and
// follows no redirects on our end — we only observe the Location header.
// Non-destructive: we never actually follow the redirect to the probe domain.

export const OPEN_REDIRECT_PROBE: Payload = {
  id: "or-probe-evil-redirect",
  type: "open-redirect",
  template: "https://evil-redirect-probe.com",
  description:
    "Probe target for open redirect detection. Injected as the value of common " +
    "redirect parameters. A confirmed finding occurs only when the server " +
    "returns a 3xx response with a Location header pointing to this domain.",
  safe_by_default: true,
  requires_consent: false,
  os: "any",
  encoding: "plain",
  indicator: /evil-redirect-probe\.com/i,
};

/** Common redirect parameter names tested by the open redirect probe */
export const OPEN_REDIRECT_PARAMS: string[] = [
  "redirect", "url", "next", "goto", "return", "returnUrl", "returnTo",
  "r", "redirect_uri", "callback", "continue", "dest", "destination", "forward",
];
