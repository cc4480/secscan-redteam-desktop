/**
 * Doctrine section tests.
 *
 * The plugin's whole contract with the desktop chat is the section it
 * registers: apply() must install the auth gate hook and publish the
 * 'secscan-redteam' doctrine with the engagement-fulfilment hard rule in
 * it — a scan request starts a runner engagement via engagement_launch,
 * never a service scan, and the report lands in the thread. These tests
 * pin that wording so a doctrine edit cannot quietly drop the rule.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../src/index.js";

interface Section {
  name: string;
  order: number;
  text: string;
}

function captureApply(): { sections: Section[]; hooks: string[] } {
  const sections: Section[] = [];
  const hooks: string[] = [];
  const ctx = {
    on: (event: string) => {
      hooks.push(event);
      return () => {};
    },
    systemPrompt: {
      section: (s: Section) => {
        sections.push(s);
      },
    },
  };
  apply(ctx as never);
  return { sections, hooks };
}

const flat = (text: string): string => text.replace(/\s+/g, " ");

describe("apply", () => {
  it("installs the auth gate hook and publishes one doctrine section", () => {
    const { sections, hooks } = captureApply();
    assert.deepEqual(hooks, ["tools/pre-execute"]);
    assert.equal(sections.length, 1);
    assert.equal(sections[0]!.name, "secscan-redteam");
    assert.equal(sections[0]!.order, 117);
  });

  it("teaches the engagement fulfilment path and the never-services hard rule", () => {
    const { sections } = captureApply();
    const text = flat(sections[0]!.text);
    assert.match(text, /mcp__redteam__engagement_launch/);
    assert.match(text, /mcp__redteam__engagement_status/);
    assert.match(text, /mcp__redteam__engagement_report/);
    assert.match(text, /never fulfilled by the SecScan or Seclayer live services/);
    assert.match(text, /do not substitute a service scan/);
    assert.match(text, /delivers the report IN THIS THREAD/);
    assert.match(text, /A scan request starts a runner engagement via `mcp__redteam__engagement_launch`/);
  });

  it("no longer teaches the service scan as the recon baseline", () => {
    const { sections } = captureApply();
    const text = flat(sections[0]!.text);
    assert.doesNotMatch(text, /baseline `mcp__secscan__scan_url` scan/);
    assert.match(text, /baseline scan the runner engagement runs in its recon phase/);
  });
});
