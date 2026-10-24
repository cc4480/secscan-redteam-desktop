#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { runGate } from './gate.js'
import { defaultSnapshotDir, listBundles, loadManifest, verifySnapshot } from './loader.js'
import type { BundleGateReport } from './types.js'

const USAGE = `usage:
  foundry-gate verify [--snapshot <dir>]
  foundry-gate run [--gold-only | --slug <slug>] [--out <file.json>] [--python <cmd>] [--snapshot <dir>]`

interface CliOptions {
  goldOnly: boolean
  slug: string | null
  out: string | null
  python: string | undefined
  snapshotDir: string
}

/**
 * Parse the flags shared by both subcommands.
 *
 * @param args - the arguments after the subcommand
 * @returns the parsed options
 */
function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    goldOnly: false,
    slug: null,
    out: null,
    python: undefined,
    snapshotDir: defaultSnapshotDir(),
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    const next = (): string => {
      const value = args[++i]
      if (value === undefined) throw new Error(`flag ${arg} needs a value`)
      return value
    }
    if (arg === '--gold-only') options.goldOnly = true
    else if (arg === '--slug') options.slug = next()
    else if (arg === '--out') options.out = next()
    else if (arg === '--python') options.python = next()
    else if (arg === '--snapshot') options.snapshotDir = next()
    else throw new Error(`unknown flag ${arg}`)
  }
  return options
}

/**
 * Print one bundle's gate report as a table row.
 *
 * @param report - the gate report to print
 * @returns nothing; writes to stdout
 */
function printRow(report: BundleGateReport): void {
  if (!report.panel || !report.score) {
    console.log(`${report.slug.padEnd(28)} ERROR ${report.error ?? 'unknown failure'}`)
    return
  }
  const vector = `[${report.panel.vector.join(',')}]`
  const observed = report.panel.observed_tier === null ? '-' : String(report.panel.observed_tier)
  const gate = report.score.gate_pass ? 'PASS' : 'FAIL'
  console.log(
    `${report.slug.padEnd(28)} ${vector} pass ${report.panel.pass_rate.toFixed(2)} ` +
    `tier ${observed} vs T${report.assigned_tier} F ${report.score.fitness.toFixed(4)} gate ${gate}`,
  )
}

/**
 * The verify subcommand: hash-check the whole snapshot.
 *
 * @param options - the parsed CLI options
 * @returns the process exit code
 */
function verify(options: CliOptions): number {
  const results = verifySnapshot(options.snapshotDir)
  let failures = 0
  for (const result of results) {
    if (result.ok) {
      console.log(`${result.slug.padEnd(28)} OK ${result.actual.slice(0, 12)}`)
    } else {
      failures++
      console.log(`${result.slug.padEnd(28)} MISMATCH expected ${result.expected} got ${result.actual}`)
    }
  }
  console.log(`verified ${results.length - failures}/${results.length} bundles OK`)
  return failures === 0 ? 0 : 1
}

/**
 * The run subcommand: panel and score the selected bundles.
 *
 * @param options - the parsed CLI options
 * @returns the process exit code; non-zero when a selected GOLD bundle
 * fails its gate or lands outside its tier band
 */
async function run(options: CliOptions): Promise<number> {
  const manifest = loadManifest(options.snapshotDir)
  let entries = listBundles(manifest)
  if (options.goldOnly) entries = entries.filter(entry => entry.loop_tier === 'GOLD')
  if (options.slug !== null) {
    entries = entries.filter(entry => entry.slug === options.slug)
    if (entries.length === 0) throw new Error(`no bundle with slug ${options.slug}`)
  }
  console.log(`snapshot ${manifest.snapshot}: running ${entries.length} bundle(s)`)
  const reports = await runGate(options.snapshotDir, entries, { python: options.python }, printRow)
  let goldFailures = 0
  for (const report of reports) {
    if (report.loop_tier !== 'GOLD') continue
    const gateFailed = !report.score?.gate_pass
    const outOfBand = !report.panel || report.panel.observed_tier !== report.assigned_tier
    if (gateFailed || outOfBand) goldFailures++
  }
  const gold = reports.filter(report => report.loop_tier === 'GOLD').length
  console.log(`bundles: ${reports.length}, gold: ${gold}, gold gate/tier failures: ${goldFailures}`)
  if (options.out !== null) {
    writeFileSync(options.out, JSON.stringify({
      snapshot: manifest.snapshot,
      generated_at: new Date().toISOString(),
      results: reports,
    }, null, 2) + '\n')
    console.log(`report written to ${options.out}`)
  }
  return goldFailures === 0 ? 0 : 1
}

/**
 * CLI entry point.
 *
 * @returns the process exit code
 */
async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2)
  if (command === 'verify') return verify(parseOptions(rest))
  if (command === 'run') return run(parseOptions(rest))
  console.error(USAGE)
  return 2
}

main().then(
  (code) => { process.exitCode = code },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  },
)
