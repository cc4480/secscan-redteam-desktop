/**
 * Q-LOCKOUT — credential-attempt interlock, unit + classifier suite
 * (spec: lockout-spec-2026-10-31.md §7.1–7.9; pair build, Agent B).
 *
 * Pins the budget arithmetic (limit = lockoutThreshold − 1, spend-before-run
 * reservations, success resets the key, the 25-failure campaign ceiling),
 * the classification tables (every Class A tool, every exemption, the
 * HOST_TOOLS tripwire that keeps a future auth tool from shipping
 * uncounted), the Class B opaque-run budget, the §5.3 lockout-signal
 * fixtures with their negative controls, and the recorded-decision resume.
 * Dispatch-level wiring lives in lockout-dispatch.test.ts; config plumbing
 * in lockout-config.test.ts.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CredentialAttemptGuard,
  classifyAuthOutcome,
  classifyCredentialAttempt,
  DEFAULT_LOCKOUT_CONFIG,
  LOCKOUT_LEDGER_CAP,
  type CredentialClassification,
} from '../src/safety/lockout.js'
import { HOST_TOOLS } from '../src/tools/host.js'

const H = 'dc01.lab'
const H2 = 'ws02.lab'

function cls(name: string, args: Record<string, unknown> = { host: H }): CredentialClassification {
  return classifyCredentialAttempt({ name, arguments: args })
}

/** One admitted Class A call that fails validation; returns the outcome info. */
function failOnce(g: CredentialAttemptGuard, host: string, name: string) {
  const c = cls(name, { host })
  const v = g.check(host, c, name)
  assert.equal(v.allowed, true, `${name} against ${host} should be admitted`)
  return g.recordOutcome(host, c, name, 'failed-validation')
}

/** One admitted Class A call that succeeds. */
function succeedOnce(g: CredentialAttemptGuard, host: string, name: string) {
  const c = cls(name, { host })
  const v = g.check(host, c, name)
  assert.equal(v.allowed, true, `${name} against ${host} should be admitted`)
  return g.recordOutcome(host, c, name, 'success')
}

function mustRefusal(g: CredentialAttemptGuard, host: string, name: string, args: Record<string, unknown> = { host }) {
  const v = g.check(host, cls(name, args), name)
  assert.equal(v.allowed, false, `${name} against ${host} should be refused`)
  assert.equal(typeof v.refusal, 'string')
  return v
}

describe('CredentialAttemptGuard — budget arithmetic (spec §7.1–7.5)', () => {
  it('limit is max(1, lockoutThreshold − 1); defaults are threshold 5 / ceiling 25 / opaque 1', () => {
    assert.deepEqual(DEFAULT_LOCKOUT_CONFIG, { lockoutThreshold: 5, totalFailureCeiling: 25, opaqueRunsPerHost: 1 })
    assert.deepEqual(new CredentialAttemptGuard().config, DEFAULT_LOCKOUT_CONFIG)
    for (const [threshold, limit] of [[1, 1], [2, 1], [3, 2], [5, 4], [10, 9]] as const) {
      assert.equal(new CredentialAttemptGuard({ lockoutThreshold: threshold }).failureLimit, limit, `threshold ${threshold}`)
    }
  })

  it('§7.1 lockout 5 → limit 4: four failed validations admitted, the fifth refused before it runs', () => {
    const g = new CredentialAttemptGuard()
    for (let i = 0; i < 4; i++) {
      const info = failOnce(g, H, 'ssh_exec')
      assert.equal(info.trippedNow, undefined, `failure ${i + 1} must not trip anything`)
    }
    assert.equal(g.failuresFor(H, 'ssh'), 4)
    assert.equal(g.totalFailures(), 4)
    const v = mustRefusal(g, H, 'ssh_exec')
    assert.equal(v.refusalKind, 'budget')
    assert.match(v.refusal!, /credential lockout interlock/)
    assert.match(v.refusal!, /dc01\.lab/)
    assert.match(v.refusal!, /threshold − 1 = 4/)
    // Spend-before-run: the refusal itself spent nothing.
    assert.equal(g.failuresFor(H, 'ssh'), 4)
    assert.equal(g.totalFailures(), 4)
    // And it stays refused — a spent budget does not quietly reopen.
    assert.equal(mustRefusal(g, H, 'ssh_exec').refusalKind, 'budget')
  })

  it('§7.2 lockout 1 → limit max(1, 0) = 1: exactly one failed validation is permitted', () => {
    const g = new CredentialAttemptGuard({ lockoutThreshold: 1 })
    assert.equal(g.failureLimit, 1)
    failOnce(g, H, 'smb_pth')
    assert.equal(g.failuresFor(H, 'smb'), 1)
    assert.equal(mustRefusal(g, H, 'smb_pth').refusalKind, 'budget')
  })

  it('spend-before-run: admission reserves an in-flight slot; the outcome releases it', () => {
    const g = new CredentialAttemptGuard() // limit 4
    const c = cls('ssh_exec')
    for (let i = 0; i < 4; i++) assert.equal(g.check(H, c, 'ssh_exec').allowed, true)
    // No outcomes recorded yet — four reservations alone exhaust admission,
    // so parallel calls cannot collectively overshoot the limit.
    assert.equal(g.check(H, c, 'ssh_exec').allowed, false)
    assert.equal(g.failuresFor(H, 'ssh'), 0, 'reservations are not failures')
    g.recordOutcome(H, c, 'ssh_exec', 'failed-validation')
    assert.equal(g.check(H, c, 'ssh_exec').allowed, false, '1 failure + 3 in flight + 1 > 4')
    g.recordOutcome(H, c, 'ssh_exec', 'success')
    g.recordOutcome(H, c, 'ssh_exec', 'success')
    g.recordOutcome(H, c, 'ssh_exec', 'success')
    assert.equal(g.failuresFor(H, 'ssh'), 0, 'success reset the key')
    assert.equal(g.check(H, c, 'ssh_exec').allowed, true, 'all slots released')
  })

  it("§7.3 a success resets that key's failures only; the campaign total is cumulative", () => {
    const g = new CredentialAttemptGuard()
    failOnce(g, H, 'ssh_exec')
    failOnce(g, H, 'ssh_exec')
    failOnce(g, H, 'ssh_exec')
    failOnce(g, H, 'smb_exec')
    failOnce(g, H, 'smb_exec')
    failOnce(g, H2, 'ssh_exec')
    succeedOnce(g, H, 'ssh_exec')
    assert.equal(g.failuresFor(H, 'ssh'), 0)
    assert.equal(g.failuresFor(H, 'smb'), 2, 'other keys on the host are unaffected')
    assert.equal(g.failuresFor(H2, 'ssh'), 1, 'other hosts are unaffected')
    assert.equal(g.totalFailures(), 6, 'the campaign total never decrements — it is the backstop count')
  })

  it('§7.4 campaign ceiling: failures across keys sum; the ceiling-th failure trips all hosts', () => {
    const g = new CredentialAttemptGuard({ lockoutThreshold: 50, totalFailureCeiling: 3 })
    assert.equal(failOnce(g, H, 'ssh_exec').trippedNow, undefined)
    assert.equal(failOnce(g, H, 'smb_exec').trippedNow, undefined)
    const third = failOnce(g, H2, 'ad_enum')
    assert.equal(third.trippedNow, 'campaign')
    assert.match(third.reason ?? '', /campaign ceiling/)
    assert.equal(g.campaignTripped(), true)
    assert.equal(g.totalFailures(), 3)
    assert.deepEqual(g.trippedHosts(), [], 'the ceiling is an engagement trip, not a host trip')
    const fresh = mustRefusal(g, 'fs03.lab', 'rdp_auth')
    assert.equal(fresh.refusalKind, 'ceiling')
    assert.equal(mustRefusal(g, H, 'ssh_exec').refusalKind, 'ceiling', 'already-used hosts refuse on the ceiling too')
  })

  it('§7.5 reads never count: exempt tools consume nothing; krb_ptt is event-only', () => {
    const g = new CredentialAttemptGuard()
    for (const name of ['winrm_probe', 'nfs_enum', 'john_exec']) {
      assert.equal(cls(name).kind, 'none', name)
      assert.equal(g.check(H, cls(name), name).allowed, true)
    }
    assert.equal(g.totalFailures(), 0)
    assert.equal(g.ledger().length, 0, 'exempt checks leave no trace in the ledger')

    const krb = cls('krb_ptt')
    assert.equal(krb.kind, 'event-only')
    assert.equal(krb.protocolClass, 'kerberos-events')
    for (let i = 0; i < 3; i++) {
      assert.equal(g.check(H, krb, 'krb_ptt').allowed, true, 'event-only admission never exhausts')
      g.recordOutcome(H, krb, 'krb_ptt', 'failed-validation')
    }
    assert.equal(g.failuresFor(H, 'kerberos-events'), 0, 'a bad ticket is not a failed password validation')
    assert.equal(g.totalFailures(), 0)
    const entries = g.ledger()
    assert.equal(entries.length, 3, 'krb_ptt appears in the ledger as event-only')
    assert.ok(entries.every(e => e.kind === 'event-only' && e.protocolClass === 'kerberos-events' && e.tool === 'krb_ptt'))
  })

  it('the attempt ledger is bounded at LOCKOUT_LEDGER_CAP', () => {
    const g = new CredentialAttemptGuard()
    const krb = cls('krb_ptt')
    for (let i = 0; i < LOCKOUT_LEDGER_CAP + 10; i++) {
      g.check(H, krb, 'krb_ptt')
      g.recordOutcome(H, krb, 'krb_ptt', 'other')
    }
    assert.equal(g.ledger().length, LOCKOUT_LEDGER_CAP)
  })

  it('constructor rejects non-positive lockout numbers, loudly', () => {
    assert.throws(() => new CredentialAttemptGuard({ lockoutThreshold: 0 }), /positive number/)
    assert.throws(() => new CredentialAttemptGuard({ totalFailureCeiling: -1 }), /positive number/)
    assert.throws(() => new CredentialAttemptGuard({ opaqueRunsPerHost: Number.NaN }), /positive number/)
  })
})

describe('CredentialAttemptGuard — Class B opaque budget (spec §5.4)', () => {
  const msfLogin = () =>
    cls('msf_exec', { action: 'run', moduleType: 'auxiliary', module: 'scanner/ssh/ssh_login', host: H })
  const nmapBrute = () => cls('nmap_exec', { action: 'scan', host: H, scriptCategories: ['brute'] })

  it('default 1 opaque run per host, drawn from one combined Class B budget', () => {
    const g = new CredentialAttemptGuard()
    assert.equal(g.check(H, msfLogin(), 'msf_exec').allowed, true)
    assert.equal(g.opaqueRunsUsed(H), 1)
    const v = g.check(H, nmapBrute(), 'nmap_exec')
    assert.equal(v.allowed, false, "msf login scanners and nmap brute scripts share the host's budget")
    assert.equal(v.refusalKind, 'opaque')
    assert.match(v.refusal ?? '', /single-validation tools/, 'the refusal steers the fleet to the countable surface')
    assert.equal(g.opaqueRunsUsed(H), 1, 'a refused run consumes nothing')
    assert.equal(g.check(H2, msfLogin(), 'msf_exec').allowed, true, 'the budget is per host')
    assert.equal(g.totalFailures(), 0, 'opaque runs never touch the failure budget')
    assert.equal(g.failuresFor(H, 'ssh'), 0)
  })

  it('opaqueRunsPerHost is configurable', () => {
    const g = new CredentialAttemptGuard({ opaqueRunsPerHost: 2 })
    assert.equal(g.check(H, msfLogin(), 'msf_exec').allowed, true)
    assert.equal(g.check(H, msfLogin(), 'msf_exec').allowed, true)
    assert.equal(g.check(H, msfLogin(), 'msf_exec').allowed, false)
    assert.equal(g.opaqueRunsUsed(H), 2)
  })

  it('Class B outcomes never burn the failure budget, but a Class B lockout signal trips the host', () => {
    const g = new CredentialAttemptGuard()
    assert.equal(g.check(H, msfLogin(), 'msf_exec').allowed, true)
    g.recordOutcome(H, msfLogin(), 'msf_exec', 'failed-validation')
    assert.equal(g.totalFailures(), 0, 'attempts inside an opaque call are uncountable — no per-attempt claim')
    const info = g.recordOutcome(H2, msfLogin(), 'msf_exec', 'lockout-signal')
    assert.equal(info.trippedNow, 'host')
    assert.equal(g.isTripped(H2), true)
  })

  it('a Class B call against a tripped host refuses on the trip, not the opaque budget', () => {
    const g = new CredentialAttemptGuard()
    g.recordOutcome(H, cls('smb_pth'), 'smb_pth', 'lockout-signal')
    const v = g.check(H, msfLogin(), 'msf_exec')
    assert.equal(v.allowed, false)
    assert.equal(v.refusalKind, 'tripped')
  })
})

describe('CredentialAttemptGuard — signal trip, cross-protocol (spec §7.8–7.9)', () => {
  it('§7.9 a lockout signal on one class trips every class on the host — and no other host', () => {
    const g = new CredentialAttemptGuard()
    const info = g.recordOutcome(H, cls('smb_pth'), 'smb_pth', 'lockout-signal')
    assert.equal(info.trippedNow, 'host')
    assert.match(info.reason ?? '', /lockout signal/)
    assert.equal(g.isTripped(H), true)
    assert.deepEqual(g.trippedHosts(), [H])
    assert.match(g.tripReason(H) ?? '', /lockout signal/)
    for (const name of ['ad_enum', 'rdp_auth', 'winrm_exec', 'ssh_exec', 'smb_exec', 'krb_ptt']) {
      const v = g.check(H, cls(name), name)
      assert.equal(v.allowed, false, `${name} must refuse on the tripped host`)
      assert.equal(v.refusalKind, 'tripped', name)
    }
    assert.equal(g.check(H2, cls('smb_pth', { host: H2 }), 'smb_pth').allowed, true, 'other hosts continue')
  })

  it('a signal trips immediately — no failures need to precede it', () => {
    const g = new CredentialAttemptGuard()
    const info = g.recordOutcome(H, cls('krb_ptt'), 'krb_ptt', 'lockout-signal')
    assert.equal(info.trippedNow, 'host', "even an event-only outcome's signal trips the host (spec §4)")
    assert.equal(g.isTripped(H), true)
    assert.equal(g.totalFailures(), 0, 'a signal is not also a counted failure')
  })

  it('ordinary failures at the budget limit do NOT trip the host — budget refusal is not a trip', () => {
    const g = new CredentialAttemptGuard()
    for (let i = 0; i < 4; i++) failOnce(g, H, 'ssh_exec')
    assert.equal(g.isTripped(H), false)
    assert.deepEqual(g.trippedHosts(), [])
    assert.equal(mustRefusal(g, H, 'ssh_exec').refusalKind, 'budget')
  })

  it('watch tools are never refused by the guard — but their signals still trip', () => {
    const g = new CredentialAttemptGuard()
    g.recordOutcome(H, cls('smb_pth'), 'smb_pth', 'lockout-signal')
    // No shipped tool classifies as watch today (the class's only members
    // were the extracted Seclayer battery arms), so the classification is
    // constructed directly to pin the guard's watch semantics.
    const watch: CredentialClassification = { kind: 'watch', detail: 'server-side auth testing — call-level ledger + signal watch, no per-attempt claim' }
    assert.equal(g.check(H, watch, 'server_side_arm').allowed, true, 'server-side arms are signal-watched only, never refused (spec §4)')
    const info = g.recordOutcome(H2, watch, 'server_side_arm', 'lockout-signal')
    assert.equal(info.trippedNow, 'host', 'the watch is real: a signal in a watched result trips its host')
  })
})

describe('CredentialAttemptGuard — resume is a recorded decision or nothing (spec §7.12, guard level)', () => {
  const DECISION = { by: 'human', rationale: 'AD admin confirmed the test account is unlocked; retest approved' }

  it('reset refuses without who + rationale; with both it clears the trip and keeps the ledger', () => {
    const g = new CredentialAttemptGuard()
    failOnce(g, H, 'smb_pth')
    g.recordOutcome(H, cls('smb_exec'), 'smb_exec', 'lockout-signal')
    assert.equal(g.isTripped(H), true)
    assert.throws(() => g.reset(H, { by: '', rationale: 'operator said so' }), /no decider/)
    assert.throws(() => g.reset(H, { by: 'human', rationale: '   ' }), /no rationale/)
    assert.equal(g.isTripped(H), true, 'a refused resume changes nothing')
    const ledgerBefore = g.ledger().length
    assert.ok(ledgerBefore > 0)
    g.reset(H, DECISION)
    assert.equal(g.isTripped(H), false)
    assert.equal(g.failuresFor(H, 'smb'), 0)
    assert.equal(g.ledger().length, ledgerBefore, 'the ledger is never erased by a reset')
    assert.ok(g.ledger().some(e => e.outcome === 'lockout-signal'), 'the pre-trip attempts stay on record')
    failOnce(g, H, 'smb_pth')
    assert.equal(g.failuresFor(H, 'smb'), 1, 'counting resumes from a clean key')
  })

  it('reset also clears a spent (untripped) budget — there is no other way back', () => {
    const g = new CredentialAttemptGuard()
    for (let i = 0; i < 4; i++) failOnce(g, H, 'ssh_exec')
    assert.equal(mustRefusal(g, H, 'ssh_exec').refusalKind, 'budget')
    g.reset(H, DECISION)
    assert.equal(g.check(H, cls('ssh_exec'), 'ssh_exec').allowed, true)
  })

  it('a decision-recorded reset re-arms a tripped campaign ceiling from the current total', () => {
    const g = new CredentialAttemptGuard({ lockoutThreshold: 50, totalFailureCeiling: 2 })
    failOnce(g, H, 'ssh_exec')
    failOnce(g, H2, 'ssh_exec')
    assert.equal(g.campaignTripped(), true)
    g.reset(H, DECISION)
    assert.equal(g.campaignTripped(), false, 'the operator saw the real numbers and chose to proceed')
    assert.equal(g.check('fs03.lab', cls('rdp_auth', { host: 'fs03.lab' }), 'rdp_auth').allowed, true)
    failOnce(g, 'fs03.lab', 'rdp_auth')
    assert.equal(g.campaignTripped(), false, 'one failure since the re-arm')
    failOnce(g, 'fs03.lab', 'rdp_auth')
    assert.equal(g.campaignTripped(), true, 'the re-armed ceiling trips again at its count')
    assert.equal(g.totalFailures(), 4, 'the raw total stays cumulative across re-arms')
  })
})

describe('classifyCredentialAttempt — Class A table + exemptions (spec §7.6)', () => {
  it('every Class A tool classifies to its §4 protocol class', () => {
    const table: Record<string, string> = {
      rdp_auth: 'rdp',
      smb_pth: 'smb',
      smb_exec: 'smb',
      ad_enum: 'ldap',
      ssh_exec: 'ssh',
      ssh_agent_audit: 'ssh',
      winrm_exec: 'winrm',
      // Build-time verify (spec §4): rdp_shadow_prep opens an authenticated
      // WinRM session with the test credential — classified by its transport.
      rdp_shadow_prep: 'winrm',
    }
    for (const [name, protocolClass] of Object.entries(table)) {
      const c = cls(name)
      assert.equal(c.kind, 'class-a', name)
      assert.equal(c.protocolClass, protocolClass, name)
    }
  })

  it('every §4 exemption classifies out — reads never count', () => {
    const exempt = [
      'winrm_probe', // unauthenticated scheme probe
      'nfs_enum', // no credentials
      'john_exec', // offline cracking
      'sqlmap_exec',
      'nikto_exec',
      'nuclei_exec',
      'ffuf_exec', // a POST to /login is indistinguishable from content discovery (spec §8)
      'gobuster_exec',
      'http_probe',
      'burst_probe',
      'secscan_exec',
      'pc_observe', // the operator's own PC, never an engagement target
      'pc_act',
      'pc_run',
      'record_finding', // bookkeeping
      'record_killed',
      'record_item_verdict',
    ]
    for (const name of exempt) {
      assert.equal(cls(name).kind, 'none', name)
    }
  })

  it('TRIPWIRE: every tool in HOST_TOOLS carries an explicit classification in this table', () => {
    // The mechanical prevention of a repeat of this gap (spec §7.6): a new
    // host tool added to HOST_TOOLS fails THIS test until a human classifies
    // it here and in safety/lockout.ts — it cannot ship silently uncounted.
    const expected: Record<string, { kind: string; protocolClass?: string }> = {
      ssh_exec: { kind: 'class-a', protocolClass: 'ssh' },
      smb_exec: { kind: 'class-a', protocolClass: 'smb' },
      winrm_exec: { kind: 'class-a', protocolClass: 'winrm' },
      winrm_probe: { kind: 'none' },
      rdp_auth: { kind: 'class-a', protocolClass: 'rdp' },
      rdp_shadow_prep: { kind: 'class-a', protocolClass: 'winrm' },
      smb_pth: { kind: 'class-a', protocolClass: 'smb' },
      ad_enum: { kind: 'class-a', protocolClass: 'ldap' },
      krb_ptt: { kind: 'event-only', protocolClass: 'kerberos-events' },
      ssh_agent_audit: { kind: 'class-a', protocolClass: 'ssh' },
      nfs_enum: { kind: 'none' },
    }
    assert.equal(HOST_TOOLS.length, Object.keys(expected).length, 'HOST_TOOLS grew or shrank — re-pin this table')
    for (const tool of HOST_TOOLS) {
      const want = expected[tool.name]
      assert.ok(want, `${tool.name} is in HOST_TOOLS but has NO classification here — classify it before it ships`)
      const c = cls(tool.name)
      assert.equal(c.kind, want.kind, tool.name)
      assert.equal(c.protocolClass, want.protocolClass, tool.name)
    }
  })

  it("an unknown future auth tool classifies conservatively IN (the donor's 'cannot tell — counted' rule)", () => {
    const future = classifyCredentialAttempt({ name: 'ldap_brute_exec', arguments: { host: H } })
    assert.equal(future.kind, 'class-a')
    assert.equal(future.protocolClass, 'ldap')
    const generic = classifyCredentialAttempt({ name: 'future_auth_tool', arguments: {} })
    assert.equal(generic.kind, 'class-a')
    assert.equal(generic.protocolClass, 'web', 'no protocol hint in the name — the web catch-all key')
    assert.equal(classifyCredentialAttempt({ name: 'note_write', arguments: {} }).kind, 'none', 'a plainly non-auth unknown tool stays out')
  })
})

describe('classifyCredentialAttempt — Class B shapes (spec §7.7)', () => {
  it("msf login-scanner modules classify Class B with the module's protocol", () => {
    const cases: Array<[string, string]> = [
      ['scanner/ssh/ssh_login', 'ssh'],
      ['scanner/smb/smb_login', 'smb'],
      ['scanner/http/http_login', 'web'],
      ['scanner/winrm/winrm_login', 'winrm'],
    ]
    for (const [module, protocolClass] of cases) {
      const c = cls('msf_exec', { action: 'run', moduleType: 'auxiliary', module, host: H })
      assert.equal(c.kind, 'class-b', module)
      assert.equal(c.protocolClass, protocolClass, module)
    }
  })

  it('a password-file option key makes ANY auxiliary run Class B — a spray whatever its name', () => {
    for (const key of ['USERPASS_FILE', 'USER_FILE', 'PASS_FILE', 'USERPASS', 'pass_file']) {
      const c = cls('msf_exec', {
        action: 'run',
        moduleType: 'auxiliary',
        module: 'auxiliary/gather/hashdump',
        options: { [key]: '/tmp/words.txt' },
        host: H,
      })
      assert.equal(c.kind, 'class-b', key)
    }
  })

  it('auxiliary runs without login shape or password files stay out; search/suggest never fire', () => {
    assert.equal(
      cls('msf_exec', { action: 'run', moduleType: 'auxiliary', module: 'auxiliary/gather/hashdump', options: { SESSION: '1' }, host: H }).kind,
      'none',
    )
    assert.equal(cls('msf_exec', { action: 'search', moduleType: 'auxiliary', module: 'scanner/ssh/ssh_login' }).kind, 'none')
    assert.equal(cls('msf_exec', { action: 'suggest', moduleType: 'auxiliary', module: 'scanner/ssh/ssh_login' }).kind, 'none')
  })

  it('msf exploit runs are watch-only in v1 (coordinator-gated; no call budget — spec §8 named gap)', () => {
    const c = cls('msf_exec', { action: 'run', moduleType: 'exploit', module: 'exploit/windows/smb/ms17_010_eternalblue', host: H })
    assert.equal(c.kind, 'watch')
  })

  it('nmap auth/brute script categories classify Class B; ordinary scans stay out', () => {
    for (const cats of [['brute'], ['auth'], ['http-brute'], ['auth', 'brute']]) {
      assert.equal(cls('nmap_exec', { action: 'scan', host: H, scriptCategories: cats }).kind, 'class-b', cats.join(','))
    }
    assert.equal(cls('nmap_exec', { action: 'scan', host: H, scriptCategories: 'auth,brute' }).kind, 'class-b', 'comma-string form')
    assert.equal(cls('nmap_exec', { action: 'scan', host: H, script: 'smb-brute' }).kind, 'class-b', 'single-script form')
    assert.equal(cls('nmap_exec', { action: 'scan', host: H, scriptCategories: ['default'] }).kind, 'none')
    assert.equal(cls('nmap_exec', { action: 'scan', host: H, scriptCategories: ['vuln'] }).kind, 'none')
    assert.equal(cls('nmap_exec', { action: 'profiles', host: H }).kind, 'none')
  })
})

describe('classifyAuthOutcome — the §5.3 signal table (spec §7.8)', () => {
  it('lockout signals trip — one canned executor summary per §5.3 row', () => {
    const signals = [
      'smb session-setup failed: STATUS_ACCOUNT_LOCKED_OUT (0xC0000234)', // SMB
      'ldap bind failed (error 49): data 775', // LDAP — account locked
      'ldap bind failed (error 49): data 533', // LDAP — account disabled
      'kerberos AS-REQ failed: KDC_ERR_CLIENT_REVOKED (err 18)', // Kerberos
      'kerberos error: err: 1909 (ERROR_ACCOUNT_LOCKED_OUT)', // Kerberos / Win32
      'ssh auth failed: account locked due to 5 failed logins (pam_faillock)', // SSH
      'HTTP 429', // WinRM / HTTP auth — throttling answer
      'winrm open failed: too many failed login attempts — account temporarily locked', // WinRM / HTTP auth
      'rdp NLA validation failed: the user account is locked', // RDP / CredSSP
    ]
    for (const text of signals) {
      assert.equal(classifyAuthOutcome(text, false), 'lockout-signal', text)
    }
  })

  it('negative controls: ordinary failures count exactly one failed validation and never trip', () => {
    const failures = [
      'smb session-setup failed: STATUS_LOGON_FAILURE (0xC000006D)',
      'ldap bind failed (error 49): data 52e',
      'kerberos AS-REQ failed: KDC_ERR_PREAUTH_FAILED (err 24)',
      'ssh dc01.lab failed: Permission denied (password)',
      'winrm open failed: HTTP 401',
      'rdp NLA validation dc01.lab: credential NOT valid',
      'authentication failed: invalid credentials',
    ]
    for (const text of failures) {
      assert.equal(classifyAuthOutcome(text, false), 'failed-validation', text)
    }
  })

  it("success is a session that opened; transport failures are 'other' — no validation ever happened", () => {
    assert.equal(classifyAuthOutcome('ssh session established on dc01.lab', true), 'success')
    assert.equal(classifyAuthOutcome('rdp NLA validation dc01.lab: CREDENTIAL VALID', true), 'success')
    assert.equal(classifyAuthOutcome('probe failed: connection refused', false), 'other')
    assert.equal(classifyAuthOutcome('ssh dc01.lab failed: timed out waiting for banner', false), 'other')
    assert.equal(
      classifyAuthOutcome('rdp NLA validation dc01.lab: no verdict — the target does not offer NLA', false),
      'other',
      'spec §4: no NLA means no validation occurred — not an attempt',
    )
    assert.equal(classifyAuthOutcome('http 500 from target', false), 'other')
    assert.equal(classifyAuthOutcome('some unrecognized executor complaint', false), 'other')
  })

  it('precedence: a lockout signal wins over a success flag and over failure text', () => {
    assert.equal(classifyAuthOutcome('STATUS_ACCOUNT_LOCKED_OUT (0xC0000234)', true), 'lockout-signal')
    assert.equal(
      classifyAuthOutcome('STATUS_LOGON_FAILURE — and the account is now locked out', false),
      'lockout-signal',
    )
  })
})
