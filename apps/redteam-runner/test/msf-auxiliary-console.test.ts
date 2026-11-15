/**
 * The console fallback's eligibility and result shape.
 *
 * The branch must never take work away from a seated daemon and must never carry an
 * exploit run, so those two refusals are the assertions that matter. The third case
 * drives the run path with a console that cannot start, which exercises the result
 * shape without a half-minute boot.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tryAuxiliaryConsole } from '../src/msf/executor/auxiliary-console.js'
import type { MsfDeps } from '../src/msf/executor/executor.js'

const depsWith = (env: NodeJS.ProcessEnv): MsfDeps => ({ env }) as unknown as MsfDeps
const opts = { RHOSTS: 'cho-zen1', RHOST: 'cho-zen1', PORTS: '135' }

describe('tryAuxiliaryConsole', () => {
  it('never carries an exploit run, which opens a session a one-shot console would drop', async () => {
    const result = await tryAuxiliaryConsole(
      depsWith({ REDTEAM_MSF_CONSOLE_BIN: 'C:\\metasploit\\framework\\bin\\msfconsole.bat' }),
      { host: 'cho-zen1', moduleType: 'exploit', module: 'exploit/windows/smb/ms17_010_eternalblue' },
      opts,
    )
    assert.equal(result, null)
  })

  it('stands aside when a daemon is seated, because it answers in milliseconds', async () => {
    const result = await tryAuxiliaryConsole(
      depsWith({
        REDTEAM_MSFRPC_USER: 'msf',
        REDTEAM_MSFRPC_PASS: 'secret',
        REDTEAM_MSF_CONSOLE_BIN: 'C:\\metasploit\\framework\\bin\\msfconsole.bat',
      }),
      { host: 'cho-zen1', moduleType: 'auxiliary', module: 'auxiliary/scanner/portscan/tcp' },
      opts,
    )
    assert.equal(result, null)
  })

  it('reports a console that cannot start instead of throwing', async () => {
    const result = await tryAuxiliaryConsole(
      depsWith({ REDTEAM_MSF_CONSOLE_BIN: 'C:\\no-such-dir\\msfconsole.bat' }),
      { host: 'cho-zen1', moduleType: 'auxiliary', module: 'auxiliary/scanner/portscan/tcp', timeoutMs: 4000 },
      opts,
    )
    assert.ok(result, 'an eligible run returns a result, not null')
    assert.equal(result.ok, false)
    assert.equal(result.transport, 'msf')
    assert.equal(result.host, 'cho-zen1')
    assert.match(result.summary, /msf console auxiliary\/scanner\/portscan\/tcp vs cho-zen1/)
    assert.ok(typeof result.output === 'string' && result.output.length > 0)
  })
})
