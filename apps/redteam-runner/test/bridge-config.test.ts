/**
 * Bridge configuration: env resolution, endpoint formation, the platform
 * token-file default, and token-file reading. The token is a fixture string
 * written by the test itself — no real credential appears here.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  defaultBridgeTokenFile, readBridgeToken, resolveBridgeConfig, resolveBridgeEndpoint,
} from "../src/bridge/config.js";

describe("bridge token file default", () => {
  it("resolves under the home directory with posix separators", () => {
    assert.equal(
      defaultBridgeTokenFile("linux", "/home/op"),
      "/home/op/.config/pc-bridge/token",
    );
  });

  it("resolves under the Windows user profile with Windows separators", () => {
    assert.equal(
      defaultBridgeTokenFile("win32", "C:\\Users\\op"),
      "C:\\Users\\op\\.config\\pc-bridge\\token",
    );
  });
});

describe("bridge endpoint resolution", () => {
  it("appends /mcp to a bare origin", () => {
    assert.equal(resolveBridgeEndpoint("http://127.0.0.1:8765"), "http://127.0.0.1:8765/mcp");
    assert.equal(resolveBridgeEndpoint("http://127.0.0.1:8765/"), "http://127.0.0.1:8765/mcp");
  });

  it("keeps a URL that already carries a path", () => {
    assert.equal(resolveBridgeEndpoint("http://127.0.0.1:8765/mcp"), "http://127.0.0.1:8765/mcp");
  });
});

describe("resolveBridgeConfig", () => {
  it("defaults to the loopback bridge and the default token file", () => {
    const config = resolveBridgeConfig({});
    assert.equal(config.url, "http://127.0.0.1:8765");
    assert.equal(config.endpoint, "http://127.0.0.1:8765/mcp");
    assert.equal(config.tokenFile, defaultBridgeTokenFile());
  });

  it("reads url and token file from the environment", () => {
    const config = resolveBridgeConfig({
      PC_BRIDGE_URL: "https://pc.example.test",
      PC_BRIDGE_TOKEN_FILE: "/tmp/somewhere/token",
    });
    assert.equal(config.url, "https://pc.example.test");
    assert.equal(config.endpoint, "https://pc.example.test/mcp");
    assert.equal(config.tokenFile, "/tmp/somewhere/token");
  });

  it("lets explicit overrides win over the environment", () => {
    const config = resolveBridgeConfig(
      { PC_BRIDGE_URL: "https://env.example.test", PC_BRIDGE_TOKEN_FILE: "/env/token" },
      { url: "http://override.example.test:9000", tokenFile: "/override/token" },
    );
    assert.equal(config.endpoint, "http://override.example.test:9000/mcp");
    assert.equal(config.tokenFile, "/override/token");
  });

  it("falls back to the default when the env URL is malformed", () => {
    const config = resolveBridgeConfig({ PC_BRIDGE_URL: "not a url" });
    assert.equal(config.url, "http://127.0.0.1:8765");
  });
});

describe("readBridgeToken", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bridge-token-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns undefined when the token file does not exist", () => {
    const config = resolveBridgeConfig({}, { tokenFile: join(dir, "absent") });
    assert.equal(readBridgeToken(config), undefined);
  });

  it("returns the trimmed token the file holds", () => {
    const file = join(dir, "token");
    writeFileSync(file, "fixture-token-0123456789\n", "utf8");
    const config = resolveBridgeConfig({}, { tokenFile: file });
    assert.equal(readBridgeToken(config), "fixture-token-0123456789");
  });

  it("returns undefined for an empty token file", () => {
    const file = join(dir, "token");
    writeFileSync(file, "  \n", "utf8");
    const config = resolveBridgeConfig({}, { tokenFile: file });
    assert.equal(readBridgeToken(config), undefined);
  });
});
