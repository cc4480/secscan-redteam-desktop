/**
 * Bridge client against an in-process stub MCP server (node:http).
 *
 * The stub's tools/list fixture deliberately includes the bridge's
 * destructive ops (shell_pwsh, delete_file, type_text, power): on Carlos's
 * order (2026-10-31) there is no client-side allowlist, so the tests prove
 * FULL EXPOSURE — everything the bridge offers is listed and callable
 * through the client — plus the denial state (the bridge's own consent
 * dialog saying no) and the unavailable states. The token is a fixture
 * string the test writes itself.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createBridgeClient, isStaleSessionFailure } from "../src/bridge/client.js";
import { snapshotBridgeRegistry } from "../src/bridge/registry.js";
import { BridgeError, type BridgeClient } from "../src/bridge/types.js";

const FIXTURE_TOKEN = "fixture-token-0123456789abcdef";

const FIXTURE_TOOLS = [
  "cdp_navigate",
  "screenshot",
  "submit_job",
  "shell_pwsh",
  "delete_file",
  "type_text",
  "power",
].map((name) => ({
  name,
  description: `stub ${name}`,
  inputSchema: { type: "object", properties: {} },
}));

interface SeenRequest {
  method: string;
  authorization: string | undefined;
  sessionId: string | undefined;
}

let server: Server;
let baseUrl = "";
let tokenFile = "";
let fixtureDir = "";
const seen: SeenRequest[] = [];

function rpcReply(id: unknown, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

before(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), "bridge-client-"));
  tokenFile = join(fixtureDir, "token");
  writeFileSync(tokenFile, `${FIXTURE_TOKEN}\n`, "utf8");
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      const parsed = JSON.parse(body) as {
        id?: unknown;
        method?: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      seen.push({
        method: parsed.method ?? "",
        authorization: req.headers.authorization,
        sessionId: req.headers["mcp-session-id"] as string | undefined,
      });
      if (req.headers.authorization !== `Bearer ${FIXTURE_TOKEN}`) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      if (parsed.method === "initialize") {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "stub-session" });
        res.end(rpcReply(parsed.id, { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "stub", version: "0" } }));
        return;
      }
      if (parsed.method === "notifications/initialized") {
        res.writeHead(202);
        res.end();
        return;
      }
      if (parsed.method === "tools/list") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(rpcReply(parsed.id, { tools: FIXTURE_TOOLS }));
        return;
      }
      if (parsed.method === "tools/call") {
        const name = parsed.params?.name ?? "";
        const args = parsed.params?.arguments ?? {};
        if (name === "delete_file") {
          // The bridge's consent dialog denied this call.
          res.writeHead(200, { "content-type": "application/json" });
          res.end(rpcReply(parsed.id, {
            isError: true,
            content: [{ type: "text", text: "denied by local approval (or timed out)" }],
          }));
          return;
        }
        if (name === "screenshot") {
          // SSE-framed reply: the client must parse the data: line.
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end(`data: ${rpcReply(parsed.id, { content: [{ type: "text", text: "shot-bytes" }] })}\n\n`);
          return;
        }
        const detail = name === "shell_pwsh" ? `ran:${String(args["command"] ?? "")}` : `called:${name}`;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(rpcReply(parsed.id, { content: [{ type: "text", text: detail }] }));
        return;
      }
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id ?? null, error: { code: -32601, message: "unknown method" } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(fixtureDir, { recursive: true, force: true });
});

function client(overrides: { url?: string; tokenFile?: string } = {}): BridgeClient {
  return createBridgeClient({
    url: overrides.url ?? baseUrl,
    tokenFile: overrides.tokenFile ?? tokenFile,
    env: {},
  });
}

describe("bridge client — full exposure", () => {
  it("reports available when the paired bridge answers initialize", async () => {
    assert.equal(await client().available(), true);
  });

  it("lists EVERY tool the bridge offers, destructive ops included, schemas passed through", async () => {
    const tools = await client().listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      [...FIXTURE_TOOLS.map((tool) => tool.name)].sort(),
    );
    const shell = tools.find((tool) => tool.name === "shell_pwsh");
    assert.deepEqual(shell?.inputSchema, { type: "object", properties: {} });
  });

  it("calls a destructive op through, carrying the bearer token and the session id", async () => {
    seen.length = 0;
    const result = await client().call("shell_pwsh", { command: "whoami" });
    assert.equal(result.text, "ran:whoami");
    const callSeen = seen.find((entry) => entry.method === "tools/call");
    assert.equal(callSeen?.authorization, `Bearer ${FIXTURE_TOKEN}`);
    assert.equal(callSeen?.sessionId, "stub-session");
    assert.ok(seen.some((entry) => entry.method === "initialize"));
  });

  it("forwards the remaining destructive fixture ops too (power, type_text)", async () => {
    assert.equal((await client().call("power", { action: "status" })).text, "called:power");
    assert.equal((await client().call("type_text", { text: "hi" })).text, "called:type_text");
  });

  it("parses SSE-framed replies", async () => {
    const result = await client().call("screenshot");
    assert.equal(result.text, "shot-bytes");
  });

  it("surfaces the bridge's consent denial as its own distinct error code", async () => {
    await assert.rejects(client().call("delete_file", { path: "x" }), (error: unknown) => {
      assert.ok(error instanceof BridgeError);
      assert.equal(error.code, "bridge-denied");
      return true;
    });
  });

  it("snapshots the full registry as a record", async () => {
    const snapshot = await snapshotBridgeRegistry(client());
    assert.equal(snapshot.available, true);
    assert.equal(snapshot.endpoint, `${baseUrl}/mcp`);
    assert.ok(snapshot.toolNames.includes("power"));
    assert.ok(snapshot.toolNames.includes("shell_pwsh"));
    assert.deepEqual(snapshot.toolNames, [...snapshot.toolNames].sort());
  });
});

describe("bridge client — unavailable states", () => {
  it("no token file: unavailable, and zero requests reach the bridge", async () => {
    seen.length = 0;
    const unconfigured = client({ tokenFile: join(fixtureDir, "absent-token") });
    assert.equal(await unconfigured.available(), false);
    await assert.rejects(unconfigured.listTools(), (error: unknown) => {
      assert.ok(error instanceof BridgeError);
      assert.equal(error.code, "unavailable");
      return true;
    });
    assert.equal(seen.length, 0);
  });

  it("bridge down: available reads false and calls reject as unavailable", async () => {
    const down = client({ url: "http://127.0.0.1:1" });
    assert.equal(await down.available(), false);
    await assert.rejects(down.call("screenshot"), (error: unknown) => {
      assert.ok(error instanceof BridgeError);
      assert.equal(error.code, "unavailable");
      return true;
    });
  });

  it("token rejected by the bridge: a bridge-error, distinct from unavailable", async () => {
    const wrongTokenFile = join(fixtureDir, "wrong-token");
    writeFileSync(wrongTokenFile, "wrong-token-0123456789abcdef\n", "utf8");
    const rejected = client({ tokenFile: wrongTokenFile });
    assert.equal(await rejected.available(), false);
    await assert.rejects(rejected.call("screenshot"), (error: unknown) => {
      assert.ok(error instanceof BridgeError);
      assert.equal(error.code, "bridge-error");
      return true;
    });
  });
});

describe('retry policy — only a proven stale session may be retried', () => {
  it('a consent denial is never retried', () => {
    assert.equal(isStaleSessionFailure(new BridgeError('bridge-denied', '[bridge] denied by local approval')), false)
  })

  it('an unpaired bridge is never retried', () => {
    assert.equal(isStaleSessionFailure(new BridgeError('unavailable', '[bridge] no paired token')), false)
  })

  it('a stale-session error is the one retryable case', () => {
    assert.equal(isStaleSessionFailure(new BridgeError('bridge-error', '[bridge] unknown session abc')), true)
    assert.equal(isStaleSessionFailure(new BridgeError('bridge-error', '[bridge] session expired')), true)
  })

  it('an ordinary tool error is not retried', () => {
    // This is the dangerous one: a reply that failed to parse after the server
    // already executed. shell_pwsh/delete_file/exec must not run twice.
    assert.equal(isStaleSessionFailure(new BridgeError('bridge-error', '[bridge] unexpected end of JSON input')), false)
  })

  it('a non-bridge failure is not retried', () => {
    assert.equal(isStaleSessionFailure(new Error('socket hang up')), false)
  })
})
