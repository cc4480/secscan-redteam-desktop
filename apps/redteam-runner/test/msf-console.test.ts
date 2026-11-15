/**
 * The native msfconsole transport.
 *
 * The unit cases are pure. The last case runs the REAL console, because the whole
 * point of this module is that a `.bat` spawned through `cmd.exe /c` with `-x`
 * actually answers — a faked child would prove nothing about that. It self-skips
 * when no console is installed, and it is slow by nature: a warm Metasploit boot
 * is around half a minute.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import {
  DEFAULT_CONSOLE_TIMEOUT_MS,
  cleanConsoleOutput,
  resolveMsfConsoleBinary,
  runConsoleOnce,
} from '../src/msf/console.js'

describe('cleanConsoleOutput', () => {
  it('strips ANSI colour codes', () => {
    assert.equal(cleanConsoleOutput('\x1b[31mred\x1b[0m text'), 'red text')
  })

  it('drops Ruby deprecation chatter the operator does not need', () => {
    const raw = [
      'ruby: warning: Win32API is deprecated after Ruby 1.9.1; use fiddle directly instead',
      'You can add fiddle to your Gemfile or gemspec to silence this warning.',
      'Framework: 6.5.3-dev',
    ].join('\n')
    assert.equal(cleanConsoleOutput(raw), 'Framework: 6.5.3-dev')
  })
})

describe('resolveMsfConsoleBinary', () => {
  it('prefers the explicit override', () => {
    assert.equal(resolveMsfConsoleBinary({ REDTEAM_MSF_CONSOLE_BIN: ' D:\\msf\\msfconsole.bat ' }), 'D:\\msf\\msfconsole.bat')
  })

  it('falls back to a name when nothing is configured or present', () => {
    const resolved = resolveMsfConsoleBinary({})
    assert.equal(typeof resolved, 'string')
    assert.ok(resolved.length > 0)
  })
})

const available = existsSync(resolveMsfConsoleBinary(process.env))

describe('runConsoleOnce against the real console', () => {
  it('runs a command and captures its answer', { skip: !available ? 'no msfconsole installed' : false, timeout: 240_000 }, async () => {
    const result = await runConsoleOnce(resolveMsfConsoleBinary(process.env), 'version')
    assert.equal(result.ok, true, result.failure ?? 'console run failed')
    assert.match(result.output, /Framework:/)
    assert.equal(result.code, 0)
  })

  it('reports a timeout instead of hanging when the budget is too small', { skip: !available ? 'no msfconsole installed' : false, timeout: 60_000 }, async () => {
    // A budget shorter than the boot: the transport must give up, not stall.
    const result = await runConsoleOnce(resolveMsfConsoleBinary(process.env), 'version', 300)
    assert.equal(result.ok, false)
    assert.match(result.failure ?? '', /timed out after 0s|failed to start|exited/)
  })
})

describe('timeout default', () => {
  it('is generous enough to absorb a cold boot', () => {
    // Measured: 147s cold, ~29s warm. The default must clear the cold case.
    assert.ok(DEFAULT_CONSOLE_TIMEOUT_MS >= 150_000)
  })
})
