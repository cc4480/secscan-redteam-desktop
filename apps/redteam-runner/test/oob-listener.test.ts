/**
 * Loopback out-of-band collaborator wiring (blueprint v2 item 2, OOB outcomes).
 *
 * Outcome coverage here:
 *  - a remote target gets no collaborator (the blind class is not run);
 *  - a loopback target gets the automatic collaborator;
 *  - an engagement-supplied callback URL binds the collaborator instead.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withLoopbackOob } from "../src/net/oob-listener.js";

describe("oob listener — collaborator attachment", () => {
  it("offers no collaborator to a remote target", async () => {
    let sawOob: unknown
    const out = await withLoopbackOob("http://10.0.0.5/", async (oob) => { sawOob = oob; return "ran" })
    assert.equal(out, "ran")
    assert.equal(sawOob, undefined)
  })

  it("offers a loopback collaborator to a loopback target", async () => {
    let sawOob: unknown
    const out = await withLoopbackOob("http://127.0.0.1:9/", async (oob) => { sawOob = oob; return "ran" })
    assert.equal(out, "ran")
    assert.ok(sawOob, "loopback target gets a collaborator")
  })

  it("binds the engagement-supplied callback URL when one is supplied", async () => {
    let sawOob: { baseUrl: string } | undefined
    const out = await withLoopbackOob("http://10.0.0.5/", async (oob) => { sawOob = oob; return "ran" }, "http://127.0.0.1:9471/oob")
    assert.equal(out, "ran")
    assert.ok(sawOob, "supplied callback URL attaches a collaborator even to a remote-shaped target")
    assert.equal(sawOob.baseUrl, "http://127.0.0.1:9471")
  })
});
