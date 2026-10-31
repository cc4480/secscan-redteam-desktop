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
 * FULL SURFACE (Carlos's direct order, 2026-10-31 ~18:00 CDT, relayed
 * by the coordinator): there is no allowlist and no name filtering
 * anywhere in the fleet wiring — every tool the bridge offers is
 * offered and callable. A's client (landed 65cb1fde) exposes the full
 * registry; this wrapper passes it through unchanged, normalizing
 * result shapes and classifying errors. The only gate is bridge
 * availability (dispatch/bridge-gate.ts).
 */
import type { Ctx } from "../context.js";

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
export type BridgeErrorKind = "unavailable" | "bridge-denied" | "bridge-error";

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
   * Every tool the bridge offers — the full registry, unfiltered.
   * @throws {BridgeCallError} unavailable / bridge-error.
   */
  listTools(): Promise<BridgeToolInfo[]>;
  /**
   * Call any tool the bridge offers; resolves with the result as text.
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
 * consumes: results flattened to text, failures classified into
 * {@link BridgeErrorKind}. No filtering — the full registry passes
 * through (Carlos's order, 2026-10-31).
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
        return [...(await raw.listTools())];
      } catch (error) {
        throw toBridgeCallError(error);
      }
    },
    async call(name, args) {
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
 * the normalizing wrapper, or the always-unavailable fallback).
 */
export async function resolveBridgeClient(ctx: Ctx): Promise<BridgeClientLike> {
  if (ctx.deps.bridgeClient) return ctx.deps.bridgeClient;
  const pending = (defaultClient ??= loadDefaultBridgeClient());
  return pending;
}
