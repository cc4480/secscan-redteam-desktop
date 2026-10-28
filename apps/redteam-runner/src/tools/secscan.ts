/**
 * Native SecScan engine tool definition.
 *
 * The SecScan check suite is embedded in the runner (src/secscan/, a
 * byte-frozen vendored copy of the service's engine) and runs in-process
 * through this tool — the MCP `scan_url` wrapper is the fallback until
 * the native module passes parity, per the embed spec. One tool, one
 * scan: the engine's probes already run in parallel internally, and the
 * scope gate, autonomy-tier ladder, rate limiter, and duplicate guard
 * all apply at dispatch exactly as they do for the other bridges.
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";

export const SECSCAN_EXEC_TOOL: JsonSchemaTool = {
  name: "secscan_exec",
  description:
    "Run the embedded SecScan scan engine against ONE in-scope URL (native, in-process — not the MCP service). " +
    "depth=passive (default) runs the passive suite on engagement scope alone: security headers and cookies, TLS configuration, DNS and email authentication, exposed sensitive paths, source maps, BaaS (Supabase/Firebase) exposure, JWT analysis, GraphQL and API-doc exposure, technology and CVE fingerprinting. " +
    "depth=deep adds the verification-gated WEB APP TESTS: active path traversal, JavaScript secret scanning, and the deep crawl. Those tests are verification-gated — they require owner verification on the engagement record (the authorize phase records it after the owner proves the target is theirs). The runner REFUSES depth=deep when no verification is on record, so get verification from the owner before proceeding with deep; passive needs no verification. " +
    "Every finding the engine returns is recorded to shared state and the registry by the runner. Include attackId (a real ATT&CK ID such as 'T1190'), category, targetProfile ('secscan' for the SecScan battery, 'webapp' for a client web application), and a one-sentence hypothesis.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
      depth: { type: "string", enum: ["passive", "deep"], description: "Scan depth. 'passive' = passive suite, scope alone. 'deep' = verification-gated active web app tests; refused without owner verification on the engagement record." },
      attackId: { type: "string" },
      category: { type: "string", enum: ["logic", "functionality", "validation"] },
      targetProfile: { type: "string", enum: ["secscan", "seclayer", "webapp", "windows", "linux"] },
      hypothesis: { type: "string" },
    },
    required: ["url", "category"],
  },
};
