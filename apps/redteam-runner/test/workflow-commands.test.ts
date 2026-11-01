/**
 * Operator command protocol + autonomous engagement protocol.
 *
 * Pins the operator surface the model and the CLI share: every command parses,
 * resolves its target families, expands into an ordered phase plan, and the
 * protocol data every agent reads carries the rules and the report contract.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  COMMANDS, commandHelp, findCommand, parseCommand, planCommand,
} from '../src/workflows/commands.js'
import {
  PROTOCOL_PHASES, PROTOCOL_ROLES, PROTOCOL_RULES, REPORT_CONTRACT, protocolViolations,
} from '../src/workflows/protocol.js'

describe('operator commands', () => {
  it('exposes the full command set', () => {
    const names = COMMANDS.map(command => command.name).sort()
    assert.deepEqual(names, ['/deepscan', '/metasploit', '/nmap', '/nuclei', '/pcscan', '/report', '/scan'])
  })

  it('parses /pcscan as the LOCAL workstation assessment (Q-RP-11)', () => {
    const parsed = parseCommand('/pcscan full')
    assert.notEqual(typeof parsed, 'string')
    if (typeof parsed === 'string') return
    assert.equal(parsed.command.name, '/pcscan')
    assert.deepEqual(parsed.targets, ['windows'])
    // Local mode collects on-host: the remote battery executors and the
    // act/run tools are NOT in the local tool family (the pre-RP-11 spec
    // re-aimed them at the machine's own hostname — the audited defect).
    assert.equal(parsed.command.local, true)
    assert.ok(parsed.command.tools.includes('pc_observe'))
    assert.ok(!parsed.command.tools.includes('nmap_exec'))
    assert.ok(!parsed.command.tools.includes('nuclei_exec'))
    assert.ok(!parsed.command.tools.includes('pc_act'))
    assert.ok(parsed.command.artifacts.includes('report.html'))
    assert.ok(parsed.command.artifacts.includes('host-inventory.json'))
  })

  it('resolves target families from arguments and defaults otherwise', () => {
    const deep = parseCommand('/deepscan app.example.com cloud,api')
    assert.notEqual(typeof deep, 'string')
    if (typeof deep === 'string') return
    assert.deepEqual(deep.targets, ['cloud', 'api'])

    const nmap = parseCommand('/nmap 10.0.0.5')
    assert.notEqual(typeof nmap, 'string')
    if (typeof nmap === 'string') return
    assert.deepEqual(nmap.targets, ['windows', 'linux'])
  })

  it('rejects unknown commands and non-command lines', () => {
    assert.match(String(parseCommand('/bogus')), /unknown command/u)
    assert.match(String(parseCommand('scan everything')), /not a command/u)
  })

  it('finds commands with or without the slash, case-insensitively', () => {
    assert.equal(findCommand('/REPORT')?.name, '/report')
    assert.equal(findCommand('report')?.name, '/report')
    assert.equal(findCommand('nope'), undefined)
  })

  it('plans an ordered phase list and a complete help text', () => {
    const parsed = parseCommand('/pcscan')
    assert.notEqual(typeof parsed, 'string')
    if (typeof parsed === 'string') return
    const plan = planCommand(parsed)
    assert.deepEqual(plan.map(entry => entry.phase), ['recon', 'exploit', 'report'])
    const help = commandHelp()
    for (const command of COMMANDS) assert.ok(help.includes(command.name), `${command.name} in help`)
  })
})

describe('autonomous engagement protocol', () => {
  it('has the four roles and five gated phases', () => {
    assert.deepEqual(PROTOCOL_ROLES.map(role => role.id), ['coordinator', 'recon', 'exploiter', 'reporter'])
    assert.deepEqual(PROTOCOL_PHASES.map(phase => phase.phase), ['authorize', 'plan', 'recon', 'exploit', 'report'])
    assert.equal(PROTOCOL_PHASES.filter(phase => phase.approvalGate).length, 2)
  })

  it('encodes the ten non-negotiable rules', () => {
    assert.equal(PROTOCOL_RULES.length, 10)
    assert.ok(PROTOCOL_RULES.some(rule => rule.includes('Two independent observations')))
    assert.ok(PROTOCOL_RULES.some(rule => rule.includes('Authorize first')))
  })

  it('requires the professional report sections and the full deliverable formats', () => {
    const required = REPORT_CONTRACT.sections.filter(section => section.required).map(section => section.id)
    for (const id of ['executive-summary', 'authorization', 'scope', 'findings', 'honest-limits', 'appendix-coverage']) {
      assert.ok(required.includes(id), `${id} is required`)
    }
    assert.deepEqual(REPORT_CONTRACT.formats, ['report.html', 'report.md', 'report.json', 'report.txt', 'findings.csv', 'report.docx', 'report-package.zip'])
    assert.equal(REPORT_CONTRACT.severityScale[0], 'critical')
  })

  it('flags a finding without two observations and a report phase without a report', () => {
    assert.deepEqual(protocolViolations({ phase: 'exploit', findingsWithoutEvidence: 1 }), ['finding without two independent observations'])
    assert.deepEqual(protocolViolations({ phase: 'report', reportWritten: false }), ['report phase ended without report.html'])
    assert.deepEqual(protocolViolations({ phase: 'report', reportWritten: true }), [])
  })
})
