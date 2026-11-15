/** End-of-line column canonicalization as the partition blobs merge it. */

import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  END_OF_LINE_COLUMN,
  canonicalizeEndOfLineColumns,
} from './coverage-canonical-locations.ts'

/**
 * One source statement as two Vite environments spell it: the ssr map ends the
 * declaration at its identifier, the jsdom/client map at the nested call, and
 * both stop at their own line's end.
 */
const CRASH_LOOP = { start: { line: 36, column: 2 }, end: { line: 54, column: Infinity } }

/** File path the canonicalization fixtures share. */
const CANONICALIZED_FILE = 'packages/util/home-paths/src/index.ts'

/** Istanbul statement location in the fixture's own terms. */
interface StatementLocation {
  start: { line: number; column: number }
  end: { line: number; column: number }
}

/** Statement hits and locations read back from a merged istanbul map. */
interface MergedStatements {
  s: Record<string, number>
  statementMap: Record<string, StatementLocation>
}

/** The istanbul entry points the merge assertions use. */
interface CoverageLibrary {
  createCoverageMap: (data: unknown) => {
    merge: (data: unknown) => void
    fileCoverageFor: (file: string) => MergedStatements
  }
}

/**
 * istanbul-lib-coverage is the merge implementation the partition blobs feed.
 * It arrives as a dependency of the declared istanbul-lib-report devDependency,
 * so this spec resolves it through that owner instead of declaring its own copy.
 */
const coverageLibrary = createRequire(
  createRequire(import.meta.url).resolve('istanbul-lib-report'),
)('istanbul-lib-coverage') as CoverageLibrary

/** One file's statement coverage, shaped as a partition blob carries it. */
function statementRecord(statements: StatementLocation[], hits: number[]): Record<string, unknown> {
  return {
    [CANONICALIZED_FILE]: {
      path: CANONICALIZED_FILE,
      statementMap: Object.fromEntries(statements.map((location, index) => [index, location])),
      s: Object.fromEntries(hits.map((hit, index) => [index, hit])),
      fnMap: {},
      f: {},
      branchMap: {},
      b: {},
    },
  }
}

/**
 * Merge partition records the way the coordinator's merge command does. The
 * blob serializer's JSON hop turns a non-finite end column into `null`, which
 * is what strips istanbul of the range containment it reconciles records with.
 * Canonicalization runs on the `CoverageMap` the reporter hook receives, whose
 * `data` holds the raw per-file records merged here.
 */
function mergePartitionRecords(
  records: Array<Record<string, unknown>>,
  canonicalize: boolean,
): MergedStatements {
  const map = coverageLibrary.createCoverageMap({})
  for (const record of records) {
    if (canonicalize) canonicalizeEndOfLineColumns({ data: record })
    const serializedRecord: unknown = JSON.parse(JSON.stringify(record))
    map.merge(serializedRecord)
  }
  return map.fileCoverageFor(CANONICALIZED_FILE)
}

/** Start positions of the statements the merged map still reports as unhit. */
function uncoveredStarts(coverage: MergedStatements): Array<{ line: number; column: number }> {
  return Object.entries(coverage.s)
    .filter(([, hits]) => hits === 0)
    .map(([index]) => coverage.statementMap[index])
    .filter((location): location is StatementLocation => location !== undefined)
    .map(location => location.start)
}

describe('coverage location canonicalization', () => {
  // index.ts:48 as the ssr environment spells it (at `parent`) and as the
  // client environment spells it (at `dirname(current)`); the loop holding
  // both spellings ran in each, and only the client record never took the
  // catch branch that owns the statement.
  const ssrRecord = statementRecord(
    [CRASH_LOOP, { start: { line: 48, column: 12 }, end: { line: 48, column: Infinity } }],
    [3, 2],
  )
  const clientRecord = statementRecord(
    [CRASH_LOOP, { start: { line: 48, column: 21 }, end: { line: 48, column: Infinity } }],
    [5, 0],
  )

  it('drops the phantom statement a client-only spelling leaves after the blob merge', () => {
    // 33 statements, 32 covered: the ssr spelling is hit while the client
    // spelling of the same source statement stays unhit, so a file whose every
    // statement ran fails the per-file 100% gate.
    expect(uncoveredStarts(mergePartitionRecords([ssrRecord, clientRecord], false)))
      .toEqual([{ line: 48, column: 21 }])

    expect(uncoveredStarts(mergePartitionRecords([ssrRecord, clientRecord], true))).toEqual([])
  })

  it('canonicalizes line-end columns in statement, function, and branch locations', () => {
    const lineEnd = (line: number): StatementLocation => ({
      start: { line, column: 4 },
      end: { line, column: Infinity },
    })
    const record = {
      [CANONICALIZED_FILE]: {
        path: CANONICALIZED_FILE,
        statementMap: { 0: lineEnd(10), 1: { start: { line: 11, column: 4 }, end: { line: 11, column: 9 } } },
        s: { 0: 1, 1: 1 },
        fnMap: { 0: { name: 'probe', decl: lineEnd(10), loc: lineEnd(10) } },
        f: { 0: 1 },
        branchMap: { 0: { type: 'if', loc: lineEnd(12), locations: [lineEnd(12), lineEnd(13)] } },
        b: { 0: [1, 1] },
      },
    }

    canonicalizeEndOfLineColumns({ data: record })

    const file = record[CANONICALIZED_FILE]
    expect(file.statementMap[0]?.end.column).toBe(END_OF_LINE_COLUMN)
    expect(file.statementMap[1]?.end.column).toBe(9)
    expect(file.fnMap[0]?.decl.end.column).toBe(END_OF_LINE_COLUMN)
    expect(file.fnMap[0]?.loc.end.column).toBe(END_OF_LINE_COLUMN)
    expect(file.branchMap[0]?.loc.end.column).toBe(END_OF_LINE_COLUMN)
    expect(file.branchMap[0]?.locations[0]?.end.column).toBe(END_OF_LINE_COLUMN)
    expect(file.branchMap[0]?.locations[1]?.end.column).toBe(END_OF_LINE_COLUMN)
  })

  it('rejects a payload that carries no istanbul coverage data', () => {
    // Vitest types the reporter hook as `unknown`, so a payload without the
    // istanbul `data` record must fail the partition loudly rather than leave
    // every location uncanonicalized.
    expect(() => {
      canonicalizeEndOfLineColumns(undefined)
    }).toThrow(/not an istanbul CoverageMap/)
    expect(() => {
      canonicalizeEndOfLineColumns({})
    }).toThrow(/not an istanbul CoverageMap/)
  })
})
