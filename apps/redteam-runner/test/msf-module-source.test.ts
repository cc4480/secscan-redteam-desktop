/**
 * Transport selection for module search.
 *
 * `msfrpcd` credentials win when seated; otherwise a local msfconsole answers. The
 * branch that matters here is the standalone one, because it is what lets
 * `msf_exec action=search|suggest` work on a host with no daemon.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { moduleSource } from '../src/msf/executor/auth.js'
import { MsfConsoleModuleSource } from '../src/msf/console-client.js'
import { resolveMsfConsoleBinary } from '../src/msf/console.js'
import type { MsfDeps } from '../src/msf/executor/executor.js'

/** Per-call budget for these branch tests; they never reach a console boot. */
const TIMEOUT = 180_000

/** Dependencies with no RPC request stub: the RPC branch must not be taken. */
const depsWith = (env: NodeJS.ProcessEnv): MsfDeps => ({ env }) as unknown as MsfDeps

describe('moduleSource', () => {
  it('uses the console when no msfrpcd credentials are seated', async () => {
    const { source, secrets } = await moduleSource(depsWith({ REDTEAM_MSF_CONSOLE_BIN: 'C:\\metasploit\\framework\\bin\\msfconsole.bat' }), TIMEOUT)
    assert.ok(source instanceof MsfConsoleModuleSource)
    // No RPC secret exists on this path, so there is nothing to redact.
    assert.deepEqual(secrets, [])
  })

  it('names both prerequisites when neither transport is available', async () => {
    const resolved = resolveMsfConsoleBinary({})
    if (existsSync(resolved)) {
      // A console is installed here, so the refusal branch cannot be reached
      // without faking the filesystem; the selection assertion above covers this host.
      return
    }
    await assert.rejects(() => moduleSource(depsWith({}), TIMEOUT), /REDTEAM_MSFRPC_USER\/PASS[\s\S]*REDTEAM_MSF_CONSOLE_BIN/)
  })

  it('treats blank credentials as absent rather than as an empty login', async () => {
    const { source } = await moduleSource(depsWith({
      REDTEAM_MSFRPC_USER: '   ',
      REDTEAM_MSFRPC_PASS: '',
      REDTEAM_MSF_CONSOLE_BIN: 'C:\\metasploit\\framework\\bin\\msfconsole.bat',
    }), TIMEOUT)
    assert.ok(source instanceof MsfConsoleModuleSource)
  })
})

describe('the console scope boundary', () => {
  it('says the console covers search only when it is the sole transport', async () => {
    // A console-only setup must not read as a plain misconfiguration: the refusal
    // explains that runs, sessions and dumps still need the daemon.
    const { resolveMsfCredentials } = await import('../src/msf/policy.js')
    assert.throws(
      () => resolveMsfCredentials({ REDTEAM_MSF_CONSOLE_BIN: 'C:\\metasploit\\framework\\bin\\msfconsole.bat' }),
      /covers module SEARCH only[\s\S]*still need msfrpcd/,
    )
  })

  it('does not mention the console when none is configured', async () => {
    const { resolveMsfCredentials } = await import('../src/msf/policy.js')
    assert.throws(() => resolveMsfCredentials({}), error =>
      !/covers module SEARCH only/.test(String((error as Error).message)))
  })
})