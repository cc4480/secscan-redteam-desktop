/**
 * Target-protocol law: one family bound before any seat acts, every family's
 * protocol owned step-by-step, and the default webapp binding never leaking a
 * web toolset into a Windows/Linux/mobile engagement.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  bindTargetFamily,
  PROTOCOL_LAW,
  protocolPromptBlock,
  skillsForRole,
  TARGET_PROTOCOLS,
  type TargetFamily } from '../src/prompts/target-protocol.js'
import { gateTool, nextStep, stepById } from '../src/protocol/step-gate.js'
import {
  advanceProtocol,
  openProtocolState,
  protocolSummary,
  recordException } from '../src/protocol/state.js'

const FAMILIES: TargetFamily[] = ['webapp', 'windows', 'linux', 'android', 'ios', 'network']

describe('bindTargetFamily — the family is decided before the first action', () => {
  it('an operator-declared family wins over any target shape', () => {
    const b = bindTargetFamily({ target: 'https://example.com', declared: ['windows'] })
    assert.equal(b.family, 'windows')
    assert.equal(b.confidence, 'declared')
  })

  it('maps the declared vocabulary onto protocol families', () => {
    assert.equal(bindTargetFamily({ target: 'x', declared: ['api'] }).family, 'webapp')
    assert.equal(bindTargetFamily({ target: 'x', declared: ['linux'] }).family, 'linux')
    assert.equal(bindTargetFamily({ target: 'x', declared: ['android'] }).family, 'android')
  })

  it('infers from the target when nothing is declared', () => {
    assert.equal(bindTargetFamily({ target: 'https://acme.test/login' }).family, 'webapp')
    assert.equal(bindTargetFamily({ target: '10.0.0.5:445' }).family, 'windows')
    assert.equal(bindTargetFamily({ target: '10.0.0.5:5985' }).family, 'windows')
    assert.equal(bindTargetFamily({ target: '10.0.0.5:22' }).family, 'linux')
    assert.equal(bindTargetFamily({ target: 'acme-release.apk' }).family, 'android')
    assert.equal(bindTargetFamily({ target: 'acme-release.ipa' }).family, 'ios')
  })

  it('binds discovery-first rather than guessing a family on a bare host', () => {
    const b = bindTargetFamily({ target: '10.0.0.5' })
    assert.equal(b.family, 'network')
    assert.equal(b.confidence, 'default')
    // The classification step is the first act, and it belongs to the lead.
    assert.equal(TARGET_PROTOCOLS.network.steps[0]!.id, 'NET-01')
    assert.equal(TARGET_PROTOCOLS.network.steps[1]!.owner, 'coordinator')
  })

  it('an empty target still yields a safe binding', () => {
    assert.equal(bindTargetFamily({ target: '   ' }).family, 'network')
  })
})

describe('TARGET_PROTOCOLS — every family is a plan, not a vibe', () => {
  it('every family has steps with a unique id, one owner, and evidence', () => {
    for (const family of FAMILIES) {
      const protocol = TARGET_PROTOCOLS[family]
      assert.ok(protocol.steps.length > 0, `${family} has no steps`)
      const ids = new Set<string>()
      for (const step of protocol.steps) {
        assert.match(step.id, /^[A-Z]{3}-\d{2}$/, `${family} step id ${step.id}`)
        assert.ok(!ids.has(step.id), `${family} duplicate step id ${step.id}`)
        ids.add(step.id)
        assert.ok(step.owner.length > 0, `${family} ${step.id} has no owner`)
        assert.ok(step.evidence.length > 0, `${family} ${step.id} has no evidence`)
        assert.ok(step.done.length > 0, `${family} ${step.id} has no exit criteria`)
      }
    }
  })

  it('every family states what is wrong for it', () => {
    for (const family of FAMILIES) {
      assert.ok(TARGET_PROTOCOLS[family].forbidden.length > 0, `${family} states no guardrails`)
    }
  })

  it('a family never binds another family\'s tooling to recon', () => {
    assert.ok(skillsForRole('recon', 'windows').includes('scanning-network-with-nmap-advanced'))
    assert.ok(skillsForRole('recon', 'android').includes('performing-android-app-static-analysis-with-mobsf'))
    assert.ok(skillsForRole('recon', 'ios').includes('performing-ios-app-security-assessment'))
    assert.ok(skillsForRole('recon', 'webapp').includes('webapp-scan'))
    // The regression this layer exists for: a host/mobile engagement must not
    // hand the recon seat web-application scanning as its primary skill.
    assert.ok(!skillsForRole('recon', 'windows').includes('webapp-scan'))
    assert.ok(!skillsForRole('recon', 'android').includes('webapp-scan'))
  })

  it('every seat binds at least one skill in every family', () => {
    for (const family of FAMILIES) {
      for (const role of ['coordinator', 'recon', 'exploiter', 'reporter', 'coder', 'publisher'] as const) {
        assert.ok(skillsForRole(role, family).length > 0, `${family}/${role} binds no skill`)
      }
    }
  })
})

describe('protocolPromptBlock — what the seats actually receive', () => {
  it('carries the law, the binding reason, and every step id', () => {
    const block = protocolPromptBlock(bindTargetFamily({ target: '10.0.0.5:445' }))
    assert.match(block, /TARGET PROTOCOL/)
    assert.match(block, /family: windows/)
    assert.match(block, /Bound because: /)
    assert.match(block, /WIN-01/)
    assert.match(block, /WIN-03/)
    assert.match(block, /Wrong for this family/)
    assert.match(block, /Your seat in this protocol/)
  })

  it('the law forbids silent skips and single-observation findings', () => {
    assert.match(PROTOCOL_LAW, /Act inside the current step only/)
    assert.match(PROTOCOL_LAW, /Never silent/)
    assert.match(PROTOCOL_LAW, /Two independent observations/)
  })
})

describe('seat tasks — no seat is left without an assignment', () => {
  it('every seat has a written task in every family', () => {
    for (const family of FAMILIES) {
      for (const role of ['coordinator', 'recon', 'exploiter', 'reporter', 'coder', 'publisher'] as const) {
        const task = TARGET_PROTOCOLS[family].seatTasks[role]
        assert.equal(typeof task, 'string', `${family}/${role} has no task`)
        assert.ok(task.length > 20, `${family}/${role} task is not a real assignment`)
      }
    }
  })

  it('the prompt block carries every seat assignment', () => {
    const block = protocolPromptBlock(bindTargetFamily({ target: '10.0.0.5:22' }))
    assert.match(block, /Assigned task per seat/)
    for (const role of ['coordinator', 'recon', 'exploiter', 'reporter', 'coder', 'publisher']) {
      assert.match(block, new RegExp(`\\*\\*${role}\\*\\* — `), `block is missing ${role}'s task`)
    }
  })

  it('the explorer is explicitly idle on the discovery protocol', () => {
    assert.match(TARGET_PROTOCOLS.network.seatTasks.exploiter, /Stay idle/)
  })
})

describe('step gate — a task is a rule, not a suggestion', () => {
  it('allows a tool that is in the current step', () => {
    const verdict = gateTool({ family: 'windows', stepId: 'WIN-01', tool: 'nmap_exec' })
    assert.equal(verdict.allowed, true)
    assert.match(verdict.reason, /WIN-01/)
  })

  it('refuses a tool outside the step, naming the step and its allowlist', () => {
    const verdict = gateTool({ family: 'windows', stepId: 'WIN-01', tool: 'ad_enum' })
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /outside step WIN-01/)
    assert.match(verdict.reason, /nmap_exec/)
    assert.match(verdict.reason, /advance to the step that allows it/)
  })

  it('never blocks evidence bookkeeping', () => {
    // read_spill is bookkeeping too: it reads output the runner itself produced.
    for (const tool of ['record_finding', 'update_target_map', 'record_item_verdict', 'read_spill']) {
      assert.equal(gateTool({ family: 'linux', stepId: 'LNX-02', tool }).allowed, true, tool)
    }
  })

  it('admits an HTTP tool somewhere in the Windows family', () => {
    // Regression: no WIN step allowed `http_probe`, so a Windows host with an open
    // web port had no step that could read its headers or TLS certificate. A seat
    // holding such a task was refused before a packet left and blocked, while the
    // plan and the protocol disagreed. Discovery is the correct home: reading a
    // banner is fingerprinting, not exploitation.
    const steps = TARGET_PROTOCOLS.windows.steps
    const admitsHttp = steps.some(step => gateTool({ family: 'windows', stepId: step.id, tool: 'http_probe' }).allowed)
    assert.ok(admitsHttp, 'the Windows family must admit http_probe in some step')
  })

  it('refuses target work on a decision step', () => {
    const verdict = gateTool({ family: 'network', stepId: 'NET-02', tool: 'nmap_exec' })
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /decision step/)
  })

  it('refuses an unknown step id', () => {
    const verdict = gateTool({ family: 'ios', stepId: 'WIN-01', tool: 'http_probe' })
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /unknown step/)
  })

  it('walks the family order to the end', () => {
    assert.equal(nextStep('windows', 'WIN-01')?.id, 'WIN-02')
    // Five Windows steps, then the three shared seat steps (A5).
    assert.equal(nextStep('windows', 'WIN-05')?.id, 'WIN-06')
    assert.equal(nextStep('windows', 'WIN-08'), undefined)
    assert.equal(stepById('android', 'AND-02')?.owner, 'recon')
  })
})

describe('protocol state — the engagement has a position', () => {
  it('opens on the first step of the bound family', () => {
    const state = openProtocolState({ target: '10.0.0.5:445' })
    assert.equal(state.family, 'windows')
    assert.equal(state.stepId, 'WIN-01')
    assert.match(state.reason, /Windows service port/)
  })

  it('advances only to a real step of the bound family', () => {
    const state = openProtocolState({ target: 'https://acme.test' })
    assert.equal(advanceProtocol(state, 'WEB-03').id, 'WEB-03')
    assert.equal(state.stepId, 'WEB-03')
    assert.throws(() => advanceProtocol(state, 'WIN-02'), /is not a step of family webapp/)
  })

  it('records a live-vulnerability exception with a real reason, and refuses a lazy one', () => {
    const state = openProtocolState({ target: 'https://acme.test' })
    const exception = recordException(state, {
      tool: 'sqlmap_exec',
      reason: 'live SQLi seen on /search while enumerating WEB-02',
      at: '2026-11-08T11:00:00.000Z' })
    assert.equal(exception.stepId, 'WEB-01')
    assert.equal(state.exceptions.length, 1)
    assert.throws(() => recordException(state, { tool: 'x', reason: 'because' }), /real reason/)
  })

  it('summarises position, allowlist and order', () => {
    const summary = protocolSummary(openProtocolState({ target: 'https://acme.test' }))
    assert.match(summary, /Protocol family: webapp/)
    assert.match(summary, /Current step: WEB-01/)
    assert.match(summary, /WEB-01 <- current/)
    // A3: the retired `scan_url` wrapper is gone; the live tool is secscan_exec.
    assert.match(summary, /Allowed in this step: `secscan_exec`/)
  })
})

describe('A5 — every seat owns steps', () => {
  it('coder, reporter and publisher own real steps in every family', () => {
    for (const family of FAMILIES) {
      for (const seat of ['coder', 'reporter', 'publisher'] as const) {
        const owned = TARGET_PROTOCOLS[family].steps.filter(step => step.owner === seat)
        assert.ok(owned.length > 0, `${family}: ${seat} owns no step`)
        for (const step of owned) {
          assert.ok(step.done.length > 0, `${family}/${seat}/${step.id} has no done-criteria`)
          assert.ok(step.evidence.length > 0, `${family}/${seat}/${step.id} has no evidence`)
        }
      }
    }
  })

  it('no seat is at zero across the whole plan', () => {
    const seats = ['coordinator', 'recon', 'exploiter', 'reporter', 'coder', 'publisher'] as const
    for (const seat of seats) {
      const total = FAMILIES.reduce(
        (sum, family) => sum + TARGET_PROTOCOLS[family].steps.filter(step => step.owner === seat).length,
        0,
      )
      assert.ok(total > 0, `${seat} owns zero steps across every family`)
    }
  })

  it('A3/A4: every protocol tool name is a live catalog name', () => {
    // Declared here as the single naming set the protocol may use: static
    // catalog tools, the bridge-offered `bridge_*` names, and the PC analysis
    // host. `scan_url` (retired) and `local-analysis-host` (no executor) must
    // never reappear.
    const live = new Set([
      'secscan_exec', 'http_probe', 'burst_probe', 'nmap_exec', 'msf_exec', 'nuclei_exec',
      'ssh_exec', 'smb_exec', 'winrm_exec', 'winrm_probe', 'rdp_auth', 'smb_pth',
      'ad_enum', 'krb_ptt', 'ssh_agent_audit', 'nfs_enum', 'net_exec',
      'pc_observe', 'pc_act', 'pc_run', 'load_skill', 'protocol_step',
      'record_finding', 'record_item_verdict', 'query_registry', 'update_target_map',
      'read_spill', 'record_killed', 'ffuf_exec', 'nikto_exec', 'sqlmap_exec',
      'bridge_http_headers', 'bridge_tls_info', 'bridge_dns_query', 'bridge_tcp_check',
      'bridge_file_info' ])
    for (const family of FAMILIES) {
      for (const step of TARGET_PROTOCOLS[family].steps) {
        for (const tool of step.tools) {
          assert.ok(live.has(tool), `${family}/${step.id} names dead tool "${tool}"`)
        }
      }
    }
    for (const family of FAMILIES) {
      for (const step of TARGET_PROTOCOLS[family].steps) {
        assert.ok(!step.tools.includes('scan_url'), `${family}/${step.id} still uses retired scan_url`)
        assert.ok(!step.tools.includes('local-analysis-host'), `${family}/${step.id} still uses the missing host`)
      }
    }
  })
})
