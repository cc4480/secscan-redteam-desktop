/**
 * Device templates — the contract that every device class has a template and
 * that no tool in the catalogue is orphaned.
 *
 * "Use all of the toolset for each device" is only true if something fails
 * when it stops being true. This is that something.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEVICE_ORDER,
  DEVICE_TEMPLATES,
  TOOL_CATALOGUE,
  type DeviceId,
} from '../src/device-templates/catalog.js'
import { validateDeviceTemplates } from '../src/device-templates/validate.js'

describe('device templates — completeness', () => {
  it('every template set validates with zero violations', () => {
    const violations = validateDeviceTemplates(DEVICE_TEMPLATES)
    assert.deepEqual(
      violations,
      [],
      `device-template violations:\n${violations.map(v => `  [${v.rule}] ${v.detail}`).join('\n')}`,
    )
  })

  it('there is exactly one template per device class, in a stable order', () => {
    assert.deepEqual(Object.keys(DEVICE_TEMPLATES).sort(), [...DEVICE_ORDER].sort())
  })

  it('no tool in the catalogue is orphaned by the templates', () => {
    const claimed = new Set(DEVICE_ORDER.flatMap(id => DEVICE_TEMPLATES[id].tools))
    const orphans = TOOL_CATALOGUE.map(t => t.name).filter(n => !claimed.has(n))
    assert.deepEqual(orphans, [], `orphaned tools: ${orphans.join(', ')}`)
  })

  it('every device runs recon, exploit and report in that order', () => {
    for (const id of DEVICE_ORDER) {
      assert.deepEqual(
        DEVICE_TEMPLATES[id].phases,
        ['recon', 'exploit', 'report'],
        `device ${id} phase order`,
      )
    }
  })

  it('every device states an evidence bar and its prerequisites', () => {
    for (const id of DEVICE_ORDER) {
      const t = DEVICE_TEMPLATES[id]
      assert.ok(t.evidence.length >= 2, `${id} needs a real evidence bar`)
      assert.ok(t.prerequisites.length >= 1, `${id} must name what gates its items`)
    }
  })
})

describe('device templates — host tools are scoped to host devices', () => {
  const windowsOnly = ['winrm_exec', 'winrm_probe', 'smb_exec', 'smb_pth', 'rdp_auth', 'rdp_shadow_prep', 'ad_enum', 'krb_ptt']
  const linuxOnly = ['ssh_exec', 'ssh_agent_audit', 'nfs_enum']

  it('Windows host tools appear on the Windows template, never on a web template', () => {
    for (const tool of windowsOnly) {
      assert.ok(DEVICE_TEMPLATES.windows.tools.includes(tool), `windows must carry ${tool}`)
      for (const web of ['webapp', 'secscan', 'seclayer'] as DeviceId[]) {
        assert.ok(!DEVICE_TEMPLATES[web].tools.includes(tool), `${web} must not carry ${tool}`)
      }
    }
  })

  it('Linux host tools appear on the Linux template, never on a web template', () => {
    for (const tool of linuxOnly) {
      assert.ok(DEVICE_TEMPLATES.linux.tools.includes(tool), `linux must carry ${tool}`)
      for (const web of ['webapp', 'secscan', 'seclayer'] as DeviceId[]) {
        assert.ok(!DEVICE_TEMPLATES[web].tools.includes(tool), `${web} must not carry ${tool}`)
      }
    }
  })

  it('the web devices carry the full web toolset', () => {
    const webTools = TOOL_CATALOGUE.filter(t => t.group === 'web').map(t => t.name)
    for (const id of ['webapp', 'secscan', 'seclayer'] as DeviceId[]) {
      for (const tool of webTools) {
        assert.ok(DEVICE_TEMPLATES[id].tools.includes(tool), `${id} must carry ${tool}`)
      }
    }
  })

  it('host families do not inherit each other\'s tools', () => {
    // Caught a real defect in the first draft of these templates: spreading the
    // whole `host` group gave Linux the Windows tools and vice versa.
    for (const tool of linuxOnly) {
      assert.ok(!DEVICE_TEMPLATES.windows.tools.includes(tool), `windows must not carry ${tool}`)
    }
    for (const tool of windowsOnly) {
      assert.ok(!DEVICE_TEMPLATES.linux.tools.includes(tool), `linux must not carry ${tool}`)
    }
  })

  it('the validator actually catches an orphaned tool and a missing phase', () => {
    const broken = {
      ...DEVICE_TEMPLATES,
      windows: {
        ...DEVICE_TEMPLATES.windows,
        // drop every windows-only tool
        tools: DEVICE_TEMPLATES.windows.tools.filter(t => !windowsOnly.includes(t)),
        phases: ['recon', 'exploit'] as const,
      },
    }
    const violations = validateDeviceTemplates(broken)
    assert.ok(violations.some(v => v.rule === 'orphan-tool' && v.detail.includes('winrm_exec')))
    assert.ok(violations.some(v => v.rule === 'phase-missing'))
  })
})
