/**
 * Web prober tool definitions.
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";

export const PROBE_TOOL: JsonSchemaTool = {
  name: "http_probe",
  description:
    "Send ONE HTTP request to an in-scope host to test a specific hypothesis. In-scope hosts only (runner-enforced), non-destructive. Include attackId (ATT&CK, e.g. T1190), category (logic|functionality|validation), and a one-sentence hypothesis. Full-battery engagements: also include targetProfile (secscan|seclayer|webapp|windows|linux) — host targets are never inferred from the URL, tag them explicitly. Use webapp for a client web application.",
  parameters: {
    type: "object",
    properties: {
      method: { type: "string" },
      url: { type: "string" },
      headers: { type: "object" },
      body: { type: "string" },
      attackId: { type: "string" },
      category: { type: "string", enum: ["logic", "functionality", "validation"] },
      targetProfile: { type: "string", enum: ["secscan", "seclayer", "webapp", "windows", "linux"] },
      hypothesis: { type: "string" },
    },
    required: ["method", "url", "category"],
  },
};

export const BURST_PROBE_TOOL: JsonSchemaTool = {
  name: "burst_probe",
  description:
    "Resilience/rate-limit check — NOT a flood or DoS tool. Fires one FIXED-size batch of concurrent GET/HEAD requests (size is not adjustable) to observe whether the target rate-limits at all. One-shot per endpoint per engagement; calling it again on the same path is refused. DoS/resource exhaustion stays off regardless of mode or target.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
      method: { type: "string", enum: ["GET", "HEAD"] },
      attackId: { type: "string" },
      hypothesis: { type: "string" },
    },
    required: ["url"],
  },
};
