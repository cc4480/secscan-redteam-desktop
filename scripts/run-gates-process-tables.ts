/**
 * Process-table parsing and Windows tree termination: the descendant walk over `pid ppid` rows and
 * the taskkill arguments that follow it.
 */
import { describe, expect, it } from 'vitest'
import { collectDescendants, parsePidPpidLines, taskkillArgs } from './run-gates.ts'

describe('process-table parsing', () => {
  it('excludes the root when a parent link returns to it', () => {
    expect(collectDescendants(100, [[200, 100], [100, 200], [300, 200]]))
      .toEqual([200, 300])
  })

  it('visits duplicate and cyclic descendant links only once', () => {
    expect(collectDescendants(100, [
      [200, 100], [200, 100], [300, 100], [200, 200], [400, 200], [200, 400], [500, 300], [900, 800],
    ])).toEqual([200, 300, 400, 500])
  })

  it('returns no descendants for an isolated or self-parented root', () => {
    expect(collectDescendants(100, [])).toEqual([])
    expect(collectDescendants(100, [[100, 100]])).toEqual([])
  })

  it('walks a wide child set without spreading it into call arguments', () => {
    const children = Array.from({ length: 150_000 }, (_, i): [number, number] => [i + 3, 2])
    const descendants = collectDescendants(1, [[2, 1], ...children])
    expect(descendants).toHaveLength(children.length + 1)
    expect(descendants[0]).toBe(2)
    expect(descendants.at(-1)).toBe(150_002)
  })

  it('parses `pid ppid` rows from a POSIX ps dump', () => {
    expect(parsePidPpidLines('  123   1\n456 123\n  789 456\n')).toEqual([[123, 1], [456, 123], [789, 456]])
  })

  it('parses Windows PowerShell Get-CimInstance output of the same shape', () => {
    expect(parsePidPpidLines(' 123 1\r\n456 123\r\n')).toEqual([[123, 1], [456, 123]])
  })

  it('drops blank and malformed lines', () => {
    expect(parsePidPpidLines('  123   1\n\ncommand not found\n999 abc\n')).toEqual([[123, 1]])
  })
})

describe('Windows tree termination', () => {
  it('targets the root first and each captured descendant after it', () => {
    expect(taskkillArgs(100, [201, 302, 403])).toEqual([
      ['/PID', '100', '/T', '/F'],
      ['/PID', '201', '/T', '/F'],
      ['/PID', '302', '/T', '/F'],
      ['/PID', '403', '/T', '/F'],
    ])
  })

  it('terminates the root alone when no descendant was captured', () => {
    expect(taskkillArgs(100, [])).toEqual([['/PID', '100', '/T', '/F']])
  })
})
