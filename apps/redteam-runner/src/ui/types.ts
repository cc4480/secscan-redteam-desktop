/**
 * Web UI types (v0.22.0) — the dashboard wired directly to the CLI's code
 * paths. Every API endpoint calls the same functions the CLI calls.
 */

import type { EngagementStatus } from "../types.js";

/** Validated launch request body for POST /api/engagements. */
export interface UiLaunchRequest {
  target: string;
  mode: "red" | "black";
  objective: string;
  scope: string[];
  /** Out-of-scope hosts/IPs/CIDRs that must never be touched, even when
   * they fall inside scope (roe.outOfScope; deny beats allow). */
  outOfScope?: string[];
  client?: string;
  operatorName?: string;
  fullBattery?: boolean;
  /** Q-RP-11 local-host engagement: target/scope are the app's own
   * machine; carried into EngagementInput.localHost at launch. */
  localHost?: boolean;
  /** Cap on agent actions; default 60. Raise for full-battery work. */
  maxActions?: number;
  targets?: string[];
  environment?: "staging" | "production";
  confirmProduction?: boolean;
  tier?: 0 | 1 | 2;
  confirmTier2Production?: boolean;
  excludedTechniques?: string[];
  dryRun?: boolean;
}

/** One tracked engagement, live or historical. */
export interface StoredEngagement {
  id: string;
  dir: string;
  status: "starting" | "running" | EngagementStatus;
  startedAt: string;
  /**
   * What was asked for. Recorded at register() time because a run that dies
   * before writing state.json has no other record of its target or mode — and
   * a failure the operator cannot identify is worse than no report at all.
   */
  target?: string;
  mode?: string;
  /** True while the engagement's run is in flight in this process. */
  running?: boolean;
  error?: string;
}

/** Background job (reverify-execute, watch trigger). */
export interface UiJob {
  id: string;
  kind: "reverify" | "watch-trigger";
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
}

export interface UiServerOptions {
  port?: number;
  /** Default 127.0.0.1. Any other value requires explicit operator intent. */
  listen?: string;
  engagementsDir?: string;
}
