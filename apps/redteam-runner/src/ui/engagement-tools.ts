/**
 * Chat-shaped engagement tools for the RedTeam console (v0.31.0).
 *
 * start_engagement (mcp-tools.ts) is the CLI-shaped launch: the caller must
 * construct target, mode, objective and scope exactly, the way a CLI user
 * would. That shape is why a chat agent, handed "run a full deep scan",
 * improvised with other tools instead — the launch it needed was one it had
 * to assemble perfectly before it could start anything.
 *
 * These three tools are the conversation-shaped surface over the SAME route
 * handlers, so the safety core, launch validation and tier rules apply
 * unchanged:
 *
 *   engagement_launch  — target as the user gave it (sentence punctuation
 *                        cleaned, scope derived from its host, mode red by
 *                        default), objective in the user's words, and a
 *                        named operator on the record — the attestation the
 *                        authorize phase consumes.
 *   engagement_status  — one snapshot reshaped for narration in a thread:
 *                        status, phase, event and finding counts, and the
 *                        halt/block reason when there is one.
 *   engagement_report  — the finished report's content for delivery in the
 *                        thread, plus the in-app artifact paths. Returns
 *                        ready:false while the run is still going.
 *
 * The console chat and the desktop host's chat consume one MCP tool list
 * (mcp-endpoint.ts), so these tools appear on both surfaces at once.
 */

import { join } from "node:path";
import { capture, type Captured, type ToolDef } from "./mcp-tools.js";
import { handleDetail, handleLaunch } from "./routes/engagements.js";
import { engagementDir } from "./store.js";
import { readState, type LiveState } from "../events.js";
import type { UiLaunchRequest } from "./types.js";

const str = (d: string): Record<string, unknown> => ({ type: "string", description: d });
const req = (d: string): Record<string, unknown> => ({ type: "string", description: d });

/**
 * Clean a target as typed in conversation: trim, drop surrounding quotes,
 * and strip trailing sentence punctuation. A target typed at the end of a
 * sentence carries its punctuation with it — the keeper's first console
 * launch (eng-2026-10-28-df5a1c0d) took "https://secscan.us," verbatim and
 * the comma became part of the host the scope check saw. Inner characters
 * are never touched: a port or path keeps its punctuation.
 *
 * @param raw - The target exactly as given.
 * @returns The cleaned target.
 */
export function cleanTarget(raw: string): string {
  let t = raw.trim().replace(/^["'`]+/, "");
  // Sentence punctuation and the closing quote travel together — `"…".` —
  // so strip both classes until the tail is stable, never just one pass.
  while (/[.,;:"'`]$/.test(t)) t = t.slice(0, -1);
  return t.trim();
}

/**
 * The host a cleaned target names — the default single-host scope.
 *
 * @param cleaned - A target after {@link cleanTarget}.
 * @returns The hostname, or null when no host can be read from the target.
 */
export function targetHost(cleaned: string): string | null {
  try {
    const host = new URL(cleaned).hostname;
    if (host) return host;
    // "secscan.us:8443" parses as a URL with scheme "secscan.us:" and an
    // empty host — fall through to the bare-host reading below.
  } catch {
    // Not a URL at all: also the bare-host reading below.
  }
  // A bare host ("secscan.us", optionally with a port) is a normal way to
  // name a target in chat.
  if (/^[A-Za-z0-9.-]+(:\d+)?$/.test(cleaned)) return cleaned.replace(/:\d+$/, "");
  return null;
}

/**
 * Build the launch request an engagement_launch call hands to the launch
 * handler: cleaned target, red mode unless black was asked for, scope
 * defaulted to the target's host, and a named operator on the record.
 *
 * The operator name matters beyond bookkeeping: authorizePhase attests
 * ownership from the engagement record (operatorName ?? client), so a chat
 * launch always names the person asking — falling back to a plain
 * "the desktop user" when the caller supplied neither — and the record
 * never carries a nameless attestation.
 *
 * @param a - The tool arguments as the agent supplied them.
 * @returns The launch request, or the error the caller should be told.
 */
export function buildLaunchBody(a: Record<string, unknown>): { body: UiLaunchRequest } | { error: string } {
  const target = cleanTarget(typeof a["target"] === "string" ? a["target"] : "");
  if (!target) return { error: "target is required: name the site or host to test" };
  const objective = typeof a["objective"] === "string" ? a["objective"].trim() : "";
  if (!objective) return { error: "objective is required: the user's ask, in their words" };
  const host = targetHost(target);
  if (!host) return { error: `could not read a host from target ${JSON.stringify(a["target"])} — give a URL or a bare host` };

  let scope: string[];
  if (Array.isArray(a["scope"]) && a["scope"].length > 0 && a["scope"].every((s) => typeof s === "string" && s.trim())) {
    scope = (a["scope"] as string[]).map((s) => s.trim());
  } else {
    scope = [host];
  }

  const body: UiLaunchRequest = { target, mode: a["mode"] === "black" ? "black" : "red", objective, scope };
  const operatorName = typeof a["operatorName"] === "string" && a["operatorName"].trim() ? a["operatorName"].trim() : undefined;
  const client = typeof a["client"] === "string" && a["client"].trim() ? a["client"].trim() : undefined;
  if (operatorName) body.operatorName = operatorName;
  else if (!client) body.operatorName = "the desktop user";
  if (client) body.client = client;
  if (typeof a["fullBattery"] === "boolean") body.fullBattery = a["fullBattery"];
  if (a["tier"] === 0 || a["tier"] === 1 || a["tier"] === 2) body.tier = a["tier"];
  if (a["environment"] === "staging" || a["environment"] === "production") body.environment = a["environment"];
  if (typeof a["confirmProduction"] === "boolean") body.confirmProduction = a["confirmProduction"];
  if (typeof a["confirmTier2Production"] === "boolean") body.confirmTier2Production = a["confirmTier2Production"];
  if (typeof a["maxActions"] === "number" && Number.isFinite(a["maxActions"])) body.maxActions = a["maxActions"];
  if (a["dryRun"] === true) body.dryRun = true;
  return { body };
}

const ID_ONLY = (): Record<string, unknown> => ({
  type: "object",
  properties: { id: req("Engagement id") },
  required: ["id"],
  additionalProperties: false,
});

/** engagement_launch — see the module doc for the design. */
const launchTool: ToolDef = {
  name: "engagement_launch",
  description:
    "Start a security engagement on a target the user named, inside this app. This is the tool that fulfils a scan or test request: " +
    "it runs the in-house pipeline (authorize from the engagement record, recon, exploit, report) and returns the engagement id. " +
    "Give target as the user gave it — a URL or a bare host; trailing sentence punctuation is cleaned and the scope defaults to the " +
    "target's host. objective is the user's ask in their words. After launching, poll engagement_status and narrate each phase change; " +
    "when the run completes, call engagement_report and deliver the report in the thread.",
  inputSchema: {
    type: "object",
    properties: {
      target: req("Target as the user gave it: a URL or a bare host"),
      objective: req("The user's ask, in their words"),
      mode: { type: "string", enum: ["red", "black"], description: "red = full knowledge (default), black = no prior knowledge" },
      operatorName: str("The user asking, by name — the operator the engagement record attests"),
      client: str("Client name for the report; also attests when no operator is named"),
      scope: { type: "array", items: { type: "string" }, description: "Exact in-scope hosts. Default: the target's host only." },
      fullBattery: { type: "boolean", description: "Run the full battery (default true)" },
      tier: { type: "integer", enum: [0, 1, 2], description: "Autonomy tier; production defaults to 1" },
      environment: { type: "string", enum: ["staging", "production"] },
      confirmProduction: { type: "boolean", description: "Required to run against production" },
      confirmTier2Production: { type: "boolean", description: "Required for Tier 2 on production" },
      maxActions: { type: "integer", description: "Cap on agent actions for the whole engagement (default 60)" },
      dryRun: { type: "boolean", description: "Plan only; touch nothing" },
    },
    required: ["target", "objective"],
    additionalProperties: false,
  },
  run: async (store, a) => {
    const built = buildLaunchBody(a);
    if ("error" in built) return { status: 400, body: { error: built.error } };
    const c = capture();
    await handleLaunch(store, {} as never, c.res, built.body);
    const out = c.result();
    if (out.status !== 202) return out;
    const id = (out.body as { id?: string }).id ?? "";
    return {
      status: 202,
      body: {
        id,
        target: built.body.target,
        mode: built.body.mode,
        scope: built.body.scope,
        summary:
          `Engagement ${id} launched against ${built.body.target} (mode ${built.body.mode}). It runs in this app — ` +
          "authorize, recon, exploit, report. Poll engagement_status with this id and narrate each phase change in the thread; " +
          "when it completes, call engagement_report and deliver the report here.",
      },
    };
  },
};

/** engagement_status — one detail snapshot reshaped for narration. */
const statusTool: ToolDef = {
  name: "engagement_status",
  description:
    "Progress snapshot for one engagement, shaped for narrating in chat: status, current phase, event count, findings so far, " +
    "whether it is live, and the reason when it blocked or halted. Poll this after engagement_launch and report each phase change.",
  inputSchema: ID_ONLY(),
  run: async (store, a): Promise<Captured> => {
    const id = String(a["id"] ?? "");
    const c = capture();
    handleDetail(store, c.res, id);
    const out = c.result();
    if (out.status !== 200) return out;
    const b = out.body as Record<string, unknown>;
    if (b["state"] == null) {
      // Still starting, or died before writing state: the in-memory record
      // is all there is, and its error field is the reason.
      const status = typeof b["status"] === "string" ? b["status"] : "starting";
      const error = typeof b["error"] === "string" ? b["error"] : undefined;
      return {
        status: 200,
        body: {
          id,
          status,
          phase: "starting",
          live: b["live"] === true,
          target: b["target"] ?? null,
          findings: 0,
          eventCount: 0,
          ...(error ? { error } : {}),
          summary: error
            ? `Engagement ${id} halted before it started: ${error}`
            : `Engagement ${id} is starting — no state written yet.`,
        },
      };
    }
    const s = b["state"] as LiveState;
    const findings = Array.isArray(s.findings) ? s.findings.length : 0;
    const summary =
      s.status === "complete"
        ? `Engagement ${id} is complete: ${findings} findings over ${s.eventCount} events. Call engagement_report to deliver the report.`
        : s.status === "halted" || s.status === "blocked"
          ? `Engagement ${id} ${s.status}${s.blockedReason ? `: ${s.blockedReason}` : ""}. ${findings} findings recorded.`
          : `Engagement ${id} is ${s.status} — phase: ${s.phase}, ${s.eventCount} events, ${findings} findings so far.`;
    return {
      status: 200,
      body: {
        id,
        status: s.status,
        phase: s.phase,
        live: b["live"] === true,
        verified: s.verified === true,
        target: s.target,
        findings,
        eventCount: s.eventCount,
        startedAt: s.startedAt,
        updatedAt: s.updatedAt,
        ...(s.blockedReason ? { blockedReason: s.blockedReason } : {}),
        artifacts: b["artifacts"],
        summary,
      },
    };
  },
};

/** engagement_report — the finished report, for delivery in the thread. */
const reportTool: ToolDef = {
  name: "engagement_report",
  description:
    "The finished report for an engagement: the report content for delivery in the thread, plus the in-app artifact paths. " +
    "Returns ready:false while the run is still going — keep polling engagement_status instead of treating that as an error.",
  inputSchema: ID_ONLY(),
  run: async (store, a): Promise<Captured> => {
    const id = String(a["id"] ?? "");
    const content = store.readTextArtifact(id, "report.md");
    if (content === null) {
      // No report file: distinguish a run that has not finished from an id
      // nothing knows. The store record or a state file proves existence.
      const dir = engagementDir(store.engagementsDir, id);
      const st = dir ? readState(dir) : null;
      const rec = store.get(id);
      if (!st && !rec) return { status: 404, body: { error: "unknown engagement" } };
      const status = st?.status ?? rec?.status ?? "starting";
      return {
        status: 200,
        body: {
          id,
          ready: false,
          status,
          ...(st ? { phase: st.phase } : {}),
          summary: `Engagement ${id} has no report yet (status: ${status}). Keep polling engagement_status; the report lands when the run completes.`,
        },
      };
    }
    // report.md exists, so state.json does too (engagementDir requires it)
    // and the directory join is safe.
    const dir = engagementDir(store.engagementsDir, id)!;
    const html = store.readTextArtifact(id, "report.html");
    return {
      status: 200,
      body: {
        id,
        ready: true,
        reportPath: join(dir, "report.md"),
        ...(html !== null ? { reportHtmlPath: join(dir, "report.html") } : {}),
        content,
        summary: `Report for engagement ${id} is ready. Deliver it in this thread — it lives in the app; do not link out to any external report.`,
      },
    };
  },
};

/** The chat-shaped engagement trio, appended to the cockpit list. */
export const ENGAGEMENT_TOOLS: ToolDef[] = [launchTool, statusTool, reportTool];
