/**
 * Doctrine section tests.
 *
 * The plugin's contract with the desktop chat is the pair of sections it
 * registers: apply() must install the auth gate hook and publish the
 * 'secscan-redteam' doctrine with the engagement-fulfilment hard rule in
 * it — a scan request starts a runner engagement via engagement_launch,
 * never a service scan, and the report lands in the thread — followed by
 * the 'secscan-redteam-soul' section carrying the fleet SOUL, loaded from
 * the llm-router's one asset. These tests pin that wording and that text
 * so an edit cannot quietly drop the rule or the SOUL.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { defaultSoulText } from '@secscan/redteam-llm-router'
import { apply } from '../src/index.js'

interface Section {
  name: string
  order: number
  text: string
}

function captureApply(): { sections: Section[]; hooks: string[] } {
  const sections: Section[] = []
  const hooks: string[] = []
  const ctx = {
    on: (event: string) => {
      hooks.push(event)
      return () => {}
    },
    systemPrompt: {
      section: (s: Section) => {
        sections.push(s)
      },
    },
  }
  apply(ctx as never)
  return { sections, hooks }
}

const flat = (text: string): string => text.replace(/\s+/g, ' ')

describe('apply', () => {
  it('installs the auth gate hook and publishes the doctrine and SOUL sections', () => {
    const { sections, hooks } = captureApply()
    assert.deepEqual(hooks, ['tools/pre-execute'])
    assert.equal(sections.length, 2)
    assert.equal(sections[0]!.name, 'secscan-redteam')
    assert.equal(sections[0]!.order, 117)
    assert.equal(sections[1]!.name, 'secscan-redteam-soul')
    assert.equal(sections[1]!.order, 118)
  })

  it('carries the loaded SOUL text in the soul section, not a copy', () => {
    const { sections } = captureApply()
    assert.equal(sections[1]!.text, defaultSoulText())
    assert.ok(sections[1]!.text.length > 0)
  })

  it('teaches the engagement fulfilment path and the never-services hard rule', () => {
    const { sections } = captureApply()
    const text = flat(sections[0]!.text)
    assert.match(text, /mcp__redteam__engagement_launch/)
    assert.match(text, /mcp__redteam__engagement_status/)
    assert.match(text, /mcp__redteam__engagement_report/)
    assert.match(text, /never fulfilled by the SecScan or Seclayer live services/)
    assert.match(text, /do not substitute a service scan/)
    assert.match(text, /delivers the report IN THIS THREAD/)
    assert.match(text, /A scan request starts a runner engagement via `mcp__redteam__engagement_launch`/)
  })

  it('inventories the Seclayer tools as an operator-keyed surface, not an engagement path', () => {
    const { sections } = captureApply()
    const text = flat(sections[0]!.text)
    assert.match(text, /### Seclayer tools \(native MCP, namespaced mcp__seclayer__\*\)/)
    assert.match(text, /seclayer_scan/)
    assert.match(text, /seclayer_list_scans/)
    assert.match(text, /seclayer_get_report/)
    assert.match(text, /Present only when the operator has seated a Seclayer API key/)
    assert.match(text, /spends a credit on the operator's Seclayer account/)
    assert.match(text, /not how an engagement scans; the HARD RULE governs that/)
    // The Seclayer inventory sits between the SecScan inventory and the
    // engagement-engine inventory, mirroring the bundle's row order.
    const secscanAt = text.indexOf('### SecScan tools')
    const seclayerAt = text.indexOf('### Seclayer tools')
    const engineAt = text.indexOf('### Engagement engine')
    assert.ok(secscanAt !== -1 && seclayerAt > secscanAt && engineAt > seclayerAt,
      'the Seclayer inventory follows the SecScan inventory and precedes the engine inventory')
  })

  it('governs Seclayer service use: native first, credit discipline, labeled evidence, honest absence', () => {
    const { sections } = captureApply()
    const text = flat(sections[0]!.text)
    // Placement: the qualification sits with the rule it qualifies — after the
    // fulfilment passage, before the team roster passage.
    assert.match(text, /### The Seclayer service: a second opinion, never the engine/)
    const serviceAt = text.indexOf('### The Seclayer service')
    const fulfilAt = text.indexOf('delivers the report IN THIS THREAD')
    const teamAt = text.indexOf('### The team')
    assert.ok(fulfilAt !== -1 && serviceAt > fulfilAt && teamAt > serviceAt,
      'the Seclayer service doctrine follows the fulfilment passage and precedes the team passage')
    // Native first; the service is never a substitute or a coverage filler.
    assert.match(text, /the native battery runs first, inside the runner/)
    assert.match(text, /A service scan never replaces the native pass, never fills a coverage gap/)
    assert.match(text, /Naming Seclayer makes it an operator request against their own account/)
    // Credit discipline.
    assert.match(text, /`seclayer_scan` spends one credit on the operator's Seclayer account, every call/)
    assert.match(text, /an independent second opinion on a target the engagement has already covered/)
    assert.match(text, /Say in the thread that the call spends a credit before you make it/)
    assert.match(text, /One scan per target per request/)
    assert.match(text, /`seclayer_list_scans` and `seclayer_get_report` spend nothing/)
    assert.match(text, /specialists do not spend credits/)
    // Service output is labeled external evidence, never graded.
    assert.match(text, /labeled as Seclayer service output, with its scan identifier/)
    assert.match(text, /It never enters the anchored grade, the coverage record or the findings count/)
    assert.match(text, /becomes a finding only when the engagement re-proves it with its own two observations/)
    // Absence and auth failure are stated plainly, once, with no hunting or retrying.
    assert.match(text, /Do not look for the tools under another name, do not ask for a key in chat/)
    assert.match(text, /say the key is not seated and point at the MCP setup step/)
    assert.match(text, /report the error as it came back, once, and stop/)
  })

  it('rosters four spawned teammates, the architect among them', () => {
    const { sections } = captureApply()
    const text = flat(sections[0]!.text)
    assert.match(text, /lead \+ recon \+ exploiter \+ reporter \+ architect/)
    assert.match(text, /Spawn all four with `spawn_teammate`/)
    // The generated roster lists every member except the coordinator (the
    // Lead's own brief), each with its verbatim execution prompt as Brief.
    assert.doesNotMatch(text, /- `coordinator` —/)
    assert.match(text, /- `architect` — Consistency layer/)
    assert.match(text, /Brief: You are the consistency layer/)
    // The generated DAG seats the architect's review between the exploiter's
    // findings and the reporter's final assembly.
    assert.match(text, /`review` — Architecture and consistency review \(owner: architect; after recon, exploit\)/)
    assert.match(text, /`report` — Client report \(owner: reporter; after exploit, review\)/)
  })

  it('no longer teaches the service scan as the recon baseline', () => {
    const { sections } = captureApply()
    const text = flat(sections[0]!.text)
    assert.doesNotMatch(text, /baseline `mcp__secscan__scan_url` scan/)
    assert.match(text, /baseline scan the runner engagement runs in its recon phase/)
  })
})
