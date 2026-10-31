/**
 * The fleet surface's seam to Builder A's bridge client (src/bridge).
 *
 * B consumes A structurally through {@link BridgeClientLike} so the fleet
 * wiring never imports src/bridge at compile time: tests inject fakes
 * through `ctx.deps.bridgeClient` or a handler argument, and the default
 * client is built lazily by dynamic import on first use. Until A's module
 * is importable — or whenever the bridge is absent — resolution degrades
 * to an always-unavailable client, because bridge absence is a normal
 * state, never an error (the Seclayer-key doctrine).
 *
 * ALLOWLIST ENFORCEMENT LIVES HERE. A's client (landed 65cb1fde) exposes
 * the bridge's full registry by its own design; the fleet design's
 * allowlist is the surface boundary, so this wrapper filters tools/list
 * to {@link BRIDGE_ALLOWLISTED_OPS} and rejects any other call locally,
 * before A's client — and therefore the bridge — is touched. Widening the
 * fleet's reach is a one-constant change in this file, made deliberately.
 */
import type { Ctx } from "../context.js";

/**
 * The only bridge ops the fleet may ever see: the CDP browser family,
 * the job layer, and the two read-only observation ops. Everything else
 * the bridge offers (shell, synthetic input, file writes/deletes,
 * process and power control) is not exposed — not present-but-erroring,
 * absent.
 */
export const BRIDGE_ALLOWLISTED_OPS: ReadonlySet<string> = new Set([
  "cdp_launch",
  "cdp_connect",
  "cdp_targets",
  "cdp_navigate",
  "cdp_snapshot",
  "cdp_click",
  "cdp_type",
  "cdp_evaluate",
  "cdp_readback",
  "cdp_close",
  "submit_job",
  "job_status",
  "job_result",
  "job_cancel",
  "screenshot",
  "uia_find",
]);

/** Whether a bridge op name is inside the fleet allowlist. */
export function isAllowlistedBridgeOp(name: string): boolean {
  return BRIDGE_ALLOWLISTED_OPS.has(name);
}

/** One tool as A's client reports it (the MCP tools/list shape). */
export interface BridgeToolInfo {
  /** Bridge op name, unprefixed (e.g. "cdp_navigate"). */
  name: string;
  /** The bridge's own description, when it sent one. */
  description?: string;
  /** MCP input schema (A's field name). */
  inputSchema?: unknown;
  /** Alternate schema field name some MCP servers use. */
  parameters?: unknown;
}

/** The honest failure states a bridge call can end in. */
export type BridgeErrorKind = "unavailable" | "not-allowlisted" | "bridge-denied" | "bridge-error";

/** A classified bridge failure; `kind` is what callers branch on. */
export class BridgeCallError extends Error {
  readonly kind: BridgeErrorKind;

  constructor(kind: BridgeErrorKind, message: string) {
    super(message);
    this.name = "BridgeCallError";
    this.kind = kind;
  }
}

/**
 * The structural shape B consumes from a bridge client. A's real client
 * returns richer results ({@link wrapBridgeClient} normalizes them); the
 * fleet only ever needs text back.
 */
export interface BridgeClientLike {
  /** Whether a paired bridge answers on this machine right now. Never throws. */
  available(): Promise<boolean>;
  /**
   * The allowlisted tools the bridge offers (A's client returns the full
   * registry; the wrapper filters).
   * @throws {BridgeCallError} unavailable / bridge-error.
   */
  listTools(): Promise<BridgeToolInfo[]>;
  /**
   * Call one allowlisted op; resolves with the result as text.
   * @throws {BridgeCallError} with the kind naming the failed state.
   */
  call(name: string, args: Record<string, unknown>): Promise<string>;
}

/** The client every seam falls back to: the bridge is simply not there. */
export const UNAVAILABLE_BRIDGE_CLIENT: BridgeClientLike = {
  async available() {
    return false;
  },
  async listTools() {
    throw new BridgeCallError("unavailable", "no bridge client is available on this machine");
  },
  async call(name: string) {
    throw new BridgeCallError("unavailable", `bridge tool ${name} cannot run: no bridge client is available on this machine`);
  },
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Flatten any client result shape to the text the fleet consumes. */
function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  const record = asRecord(result);
  if (record) {
    // A's BridgeCallResult already carries the joined text.
    if (typeof record.text === "string") return record.text;
    if (Array.isArray(record.content)) {
      const parts: string[] = [];
      for (const item of record.content) {
        const part = asRecord(item);
        if (part && part.type === "text" && typeof part.text === "string") parts.push(part.text);
      }
      if (parts.length > 0) return parts.join("\n");
    }
  }
  return JSON.stringify(result) ?? String(result);
}

/**
 * Classify a thrown client error. A's BridgeError carries a `code`
 * ("unavailable" | "bridge-error" | "bridge-denied"); anything else's
 * kind/code/name/message is matched best-effort so an honestly-worded
 * failure still lands in the right bucket.
 */
function errorKind(error: unknown): BridgeErrorKind {
  const record = asRecord(error);
  const code = typeof record?.code === "string" ? record.code
    : typeof record?.kind === "string" ? record.kind
    : "";
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const haystack = `${code} ${name} ${message}`;
  if (/not[-_ ]?allowlist|not in the .*allowlist|not allowlisted/i.test(haystack)) return "not-allowlisted";
  if (/bridge-denied|denied by local approval|local approval.*(denied|timed out)/i.test(haystack)) return "bridge-denied";
  if (/unavailable|not configured|unreachable|ECONNREFUSED|fetch failed|timed? ?out/i.test(haystack)) return "unavailable";
  return "bridge-error";
}

function toBridgeCallError(error: unknown): BridgeCallError {
  if (error instanceof BridgeCallError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new BridgeCallError(errorKind(error), message);
}

/**
 * Normalize a raw client (A's, or a test's raw fake) into the shape B
 * consumes — AND enforce the allowlist: tools/list is filtered to
 * {@link BRIDGE_ALLOWLISTED_OPS}, and a call outside it is rejected
 * locally without the raw client being touched.
 */
export function wrapBridgeClient(raw: {
  available(): Promise<boolean>;
  listTools(): Promise<readonly BridgeToolInfo[]>;
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
}): BridgeClientLike {
  return {
    async available() {
      try {
        return await raw.available();
      } catch {
        return false;
      }
    },
    async listTools() {
      try {
        const tools = await raw.listTools();
        return tools.filter((t) => isAllowlistedBridgeOp(t.name));
      } catch (error) {
        throw toBridgeCallError(error);
      }
    },
    async call(name, args) {
      if (!isAllowlistedBridgeOp(name)) {
        throw new BridgeCallError("not-allowlisted", `${name} is not in the bridge allowlist`);
      }
      try {
        return resultText(await raw.call(name, args));
      } catch (error) {
        throw toBridgeCallError(error);
      }
    },
  };
}

type BridgeModuleShape = {
  createBridgeClient?: (config?: unknown) => {
    available(): Promise<boolean>;
    listTools(): Promise<readonly BridgeToolInfo[]>;
    call(name: string, args: Record<string, unknown>): Promise<unknown>;
  };
};

async function loadDefaultBridgeClient(): Promise<BridgeClientLike> {
  try {
    // Variable specifier on purpose: src/bridge is Builder A's module and
    // may not exist in a given tree state; a static import would fail this
    // module's compilation and tests whenever it is absent. A's barrel
    // (src/bridge/index.ts) is the confirmed entry point.
    const specifier: string = "../bridge/index.js";
    const mod = (await import(specifier)) as BridgeModuleShape;
    if (typeof mod.createBridgeClient !== "function") return UNAVAILABLE_BRIDGE_CLIENT;
    // A resolves its own configuration (bridge URL + paired token file)
    // from the environment; B passes nothing.
    return wrapBridgeClient(mod.createBridgeClient());
  } catch {
    return UNAVAILABLE_BRIDGE_CLIENT;
  }
}

let defaultClient: Promise<BridgeClientLike> | undefined;

/**
 * Resolve the bridge client for an engagement: the injected test seam
 * when present, otherwise the lazily-built default (A's client behind
 * the allowlist wrapper, or the always-unavailable fallback).
 */
export async function resolveBridgeClient(ctx: Ctx): Promise<BridgeClientLike> {
  if (ctx.deps.bridgeClient) return ctx.deps.bridgeClient;
  const pending = (defaultClient ??= loadDefaultBridgeClient());
  return pending;
}
