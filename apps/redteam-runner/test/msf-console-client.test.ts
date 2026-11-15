/**
 * Parsing the console's read-only output.
 *
 * The fixtures below are recorded from the real console on this machine, so they
 * carry its real column widths, its `.` placeholders, and its own wording. Where a
 * shape could not be recorded — a session table needs a live session, and none
 * existed — the gap is stated rather than filled with invented text.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { parseModuleRun, parseModuleSearch, parseSessionList, searchModulesViaConsole } from '../src/msf/console-client.js'
import { resolveMsfConsoleBinary } from '../src/msf/console.js'

/** Recorded verbatim from `msfconsole -q -x "search portscan; exit"`. */
const SEARCH_TABLE = `
Matching Modules
================

   #  Full Name                                         Disclosure Date  Rank    Check  Name
   -  ---------                                         ---------------  ----    -----  ----
   0  auxiliary/scanner/portscan/ftpbounce              .                normal  No     FTP Bounce Port Scanner
   1  auxiliary/scanner/natpmp/natpmp_portscan          .                normal  No     NAT-PMP External Port Scanner
   2  auxiliary/scanner/sap/sap_router_portscanner      .                normal  No     SAPRouter Port Scanner
   3  auxiliary/scanner/portscan/xmas                   .                normal  No     TCP "XMas" Port Scanner
   4  auxiliary/scanner/portscan/ack                    .                normal  No     TCP ACK Firewall Scanner
   5  auxiliary/scanner/portscan/tcp                    .                normal  No     TCP Port Scanner
   6  auxiliary/scanner/portscan/syn                    .                normal  No     TCP SYN Port Scanner
   7  auxiliary/scanner/http/wordpress_pingback_access  .                normal  No     Wordpress Pingback Locator


Interact with a module by name or index. For example info 7, use 7 or use auxiliary/scanner/http/wordpress_pingback_access
`

/** Recorded verbatim from `search type:auxiliary name:portscan` on this build. */
const NO_RESULTS = '[-] No results from search\n'

/** Recorded verbatim from `msfconsole -q -x "sessions; exit"`. */
const NO_SESSIONS = `
Active sessions
===============

No active sessions.
`

describe('parseModuleSearch', () => {
  it('parses every row of a real module table', () => {
    const modules = parseModuleSearch(SEARCH_TABLE)
    assert.equal(modules.length, 8)
    assert.deepEqual(modules[0], {
      type: 'auxiliary',
      name: 'auxiliary/scanner/portscan/ftpbounce',
      fullname: 'auxiliary/scanner/portscan/ftpbounce',
      rank: 'normal',
      description: 'FTP Bounce Port Scanner',
    })
    // A description containing a quoted token and a space survives intact.
    assert.equal(modules[3]?.description, 'TCP "XMas" Port Scanner')
    assert.equal(modules[7]?.fullname, 'auxiliary/scanner/http/wordpress_pingback_access')
  })

  it('omits the disclosure date the console prints as a dot', () => {
    for (const module of parseModuleSearch(SEARCH_TABLE)) {
      assert.equal('disclosureDate' in module, false, module.fullname)
    }
  })

  it('returns nothing for a search that found nothing', () => {
    assert.deepEqual(parseModuleSearch(NO_RESULTS), [])
  })

  it('does not treat the trailing hint line as a module', () => {
    // "For example info 7, use 7 or use ..." must not become a module row.
    const names = parseModuleSearch(SEARCH_TABLE).map(module => module.fullname)
    assert.equal(new Set(names).size, names.length)
  })
})

describe('parseSessionList', () => {
  it('reports no sessions from the real "No active sessions." output', () => {
    assert.deepEqual(parseSessionList(NO_SESSIONS), {})
  })

  it('reports no sessions from empty output', () => {
    assert.deepEqual(parseSessionList(''), {})
  })

  // NOT TESTED: the row parser for a populated session table. Recording that
  // shape needs a live session, and the console on this machine had none. The
  // parser exists for the case; it is unverified until a session is opened.
})

const binary = resolveMsfConsoleBinary(process.env)
const available = existsSync(binary)

describe('searchModulesViaConsole against the real console', () => {
  it('searches and parses in one live round trip', { skip: !available ? 'no msfconsole installed' : false, timeout: 240_000 }, async () => {
    const { run, modules } = await searchModulesViaConsole(binary, 'portscan')
    assert.equal(run.ok, true, run.failure ?? 'console run failed')
    assert.ok(modules.length >= 1, 'a live portscan search must list modules')
    // The console's search is broader than a name substring: `search portscan`
    // also returns `auxiliary/scanner/http/wordpress_pingback_access`, so the
    // check is that the module we asked for is found, not that every row echoes
    // the query.
    assert.ok(
      modules.some(module => module.fullname === 'auxiliary/scanner/portscan/tcp'),
      'the TCP port scanner is found by its own name',
    )
    assert.ok(modules.every(module => module.fullname.length > 0 && module.type.length > 0), 'every row parsed')
  })
})

/** Recorded verbatim from a real auxiliary run that found nothing (PORTS 1-10). */
const RUN_MISS = `
RHOSTS => 127.0.0.1
PORTS => 1-10
THREADS => 1
[*] 127.0.0.1             - Scanned 1 of 1 hosts (100% complete)
[*] Auxiliary module execution completed
`

/** Recorded verbatim from a real auxiliary run that found the open port (135). */
const RUN_HIT = `
RHOSTS => 127.0.0.1
PORTS => 135
THREADS => 1
[+] 127.0.0.1             - 127.0.0.1:135 - TCP OPEN
[*] 127.0.0.1             - Scanned 1 of 1 hosts (100% complete)
[*] Auxiliary module execution completed
`

describe('parseModuleRun', () => {
  it('records the set echoes in order', () => {
    const report = parseModuleRun(RUN_MISS)
    assert.deepEqual(report.options, { RHOSTS: '127.0.0.1', PORTS: '1-10', THREADS: '1' })
  })

  it('reports completion and no hits when the run found nothing', () => {
    const report = parseModuleRun(RUN_MISS)
    assert.equal(report.completed, true)
    assert.deepEqual(report.hits, [])
    // Progress lines are kept: "scanned 1 of 1" is the evidence the run happened.
    assert.ok(report.info.some(line => /Scanned 1 of 1/.test(line)))
  })

  it('records a positive finding from a hit line', () => {
    const report = parseModuleRun(RUN_HIT)
    assert.equal(report.completed, true)
    assert.deepEqual(report.hits, ['127.0.0.1             - 127.0.0.1:135 - TCP OPEN'])
  })

  it('records a refusal without claiming completion', () => {
    const report = parseModuleRun('[-] Unknown module: nope\n')
    assert.deepEqual(report.failures, ['Unknown module: nope'])
    assert.equal(report.completed, false)
    assert.deepEqual(report.hits, [])
  })
})