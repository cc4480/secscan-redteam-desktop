/**
 * The device brief — agents must know which tools belong to which system.
 *
 * Two failures this guards: a device class that never reaches a prompt (the rules
 * and tool sets existed but nothing resolved a class at runtime), and a class whose
 * tools are listed without saying what they are for. The tests drive the real prompt
 * builders, so a silently-unwired brief fails here rather than surfacing as an agent
 * reaching for the wrong tool.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deviceBriefText, resolveDeviceClasses } from '../src/device-templates/brief.js'
import { DEVICE_TEMPLATES } from '../src/device-templates/catalog.js'
import { exploiterPrompt } from '../src/prompts/exploiter.js'
import { reconPrompt } from '../src/prompts/recon.js'
import { coordinatorPrompt } from '../src/prompts/coordinator.js'
import type { PromptContext } from '../src/prompts/shared.js'

function ctx(over: Partial<PromptContext> = {}): PromptContext {
  return {
    mode: 'red',
    objective: 'find the vulnerability',
    target: 'example.com',
    scopeHosts: ['example.com'],
    roe: { scope: ['example.com'] },
    ...over,
  } as PromptContext
}

describe('device class resolution', () => {
  it('a local sandbox is the machine it runs on', () => {
    const [device] = resolveDeviceClasses(ctx({ localSandbox: true }))
    assert.equal(device, process.platform === 'win32' ? 'windows' : 'linux')
  })

  it('a selected battery picks its class', () => {
    assert.deepEqual(resolveDeviceClasses(ctx({ targets: ['windows'] as never })), ['windows'])
  })

  it('a full-battery run covers every selected class, in a stable order', () => {
    const classes = resolveDeviceClasses(ctx({
      targets: ['linux', 'webapp', 'windows', 'secscan', 'seclayer'] as never,
    }))
    assert.deepEqual(classes, ['webapp', 'secscan', 'seclayer', 'windows', 'linux'])
  })

  it('a plain engagement is the webapp class', () => {
    assert.deepEqual(resolveDeviceClasses(ctx()), ['webapp'])
  })
})

describe('the brief tells an agent which tools go with which system', () => {
  it('lists every tool the template declares for that device, with a purpose', () => {
    for (const device of ['windows', 'linux', 'webapp'] as const) {
      const text = deviceBriefText(ctx({ targets: [device] as never }))
      for (const tool of DEVICE_TEMPLATES[device].tools) {
        assert.ok(text.includes(tool), `${device} brief omits its tool ${tool}`)
      }
      // The purpose text is what makes the list usable, not just present.
      assert.match(text, /— \S/, `${device} brief lists tools with no purpose`)
    }
  })

  it('carries the evidence bar and the rules for the device', () => {
    const text = deviceBriefText(ctx({ targets: ['windows'] as never }))
    assert.match(text, /Evidence that counts here/)
    assert.match(text, /Rules of engagement for this system/)
    assert.match(text, /denial of service/i, 'the one mechanical limit is not stated')
  })

  it('a full-battery brief covers every system the vulnerabilities may sit on', () => {
    const text = deviceBriefText(ctx({
      targets: ['windows', 'linux', 'webapp'] as never,
    }))
    for (const device of ['windows', 'linux', 'webapp'] as const) {
      assert.match(text, new RegExp(`\\(\\\`?${device}\\\`?\\)`), `${device} section missing`)
    }
  })
})

describe('the brief reaches the agents that act on it', () => {
  it('is in the exploiter prompt', () => {
    const prompt = exploiterPrompt(ctx({ targets: ['windows'] as never }))
    assert.match(prompt, /Systems in scope/)
    assert.match(prompt, /winrm_exec|smb_exec|ssh_exec/)
  })

  it('is in the recon prompt', () => {
    assert.match(reconPrompt(ctx()), /Systems in scope/)
  })

  it('is in the coordinator prompt', () => {
    assert.match(coordinatorPrompt(ctx()), /Systems in scope/)
  })
})
