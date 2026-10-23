/**
 * Operator console — shared path resolution and safe file readers.
 *
 * The console renders only what the artifacts on disk say. Every reader here
 * fails soft (null / empty) instead of throwing, and every path that cannot
 * be resolved comes back null so the route can answer
 * { available: false, reason } rather than fabricating data.
 *
 * Imports are limited to node builtins plus a type-only UiStore reference:
 * this module must stay loadable in isolation (see the package's pre-existing
 * src/coverage gap — runtime imports beyond the UI's own http helpers break
 * standalone verification of the console routes).
 */

import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { UiStore } from '../store.js'

/** Resolved data-source locations for the console API. Null = not present. */
export interface ConsolePaths {
  /** Engagement run dirs (run.json, events.jsonl, report.md, …). */
  engagementsDir: string
  /** Harness2 (TS) layers dir: per-layer meta.json + active.json. */
  layersDir: string | null
  /** Parent of layersDir — where EXPERIENCE.md / regression output live. */
  harness2Root: string | null
  /** Python harness2 layer_registry.json (on Looko), when configured. */
  pyRegistryPath: string | null
  /** Benchmark suite dir (HISTORY.md + scored run JSONs), when configured. */
  benchmarkDir: string | null
}

function envPath(name: string): string | null {
  const v = process.env[name]
  return v && v.trim() ? v : null
}

/**
 * Resolve the console's data sources from the store + environment.
 *
 * - engagementsDir always comes from the store.
 * - layersDir: REDTEAM_LAYERS_DIR, else <engagementsDir>/../harness2/layers
 *   when that directory exists, else null.
 * - harness2Root: REDTEAM_HARNESS2_ROOT, else the parent of layersDir.
 * - pyRegistryPath: REDTEAM_PY_REGISTRY (a layer_registry.json path), else null.
 * - benchmarkDir: REDTEAM_BENCHMARK_DIR, else null.
 */
export function consolePaths(store: UiStore): ConsolePaths {
  const engagementsDir = store.engagementsDir

  let layersDir = envPath('REDTEAM_LAYERS_DIR')
  if (!layersDir) {
    const guess = join(engagementsDir, '..', 'harness2', 'layers')
    if (existsSync(guess)) layersDir = guess
  }

  const harness2Root = envPath('REDTEAM_HARNESS2_ROOT') ?? (layersDir ? dirname(layersDir) : null)

  return {
    engagementsDir,
    layersDir,
    harness2Root,
    pyRegistryPath: envPath('REDTEAM_PY_REGISTRY'),
    benchmarkDir: envPath('REDTEAM_BENCHMARK_DIR'),
  }
}

/** existsSync that never throws (bad paths read as absent). */
export function existsSafe(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

/** Parse a JSON file; null when missing, unreadable, or invalid. */
export function readJsonSafe(path: string): unknown | null {
  const text = readTextSafe(path, 4_194_304)
  if (text === null) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/**
 * Read a text file, capped at maxBytes (the first maxBytes win — callers that
 * need the tail of a file use readJsonlTail). Null when missing/unreadable.
 */
export function readTextSafe(path: string, maxBytes: number): string | null {
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch {
    return null
  }
  try {
    const buf = Buffer.alloc(Math.max(0, maxBytes))
    const n = readSync(fd, buf, 0, buf.length, 0)
    return buf.subarray(0, n).toString('utf8')
  } catch {
    return null
  } finally {
    try {
      closeSync(fd)
    } catch {
      /* already closed */
    }
  }
}

/**
 * Parse a JSONL file and return the last maxLines objects. Lines that fail
 * to parse (e.g. a torn final line in a file still being written) are
 * skipped; a missing file reads as []. Reads at most the first 8 MiB — the
 * console only ever displays recent activity, and engagement event logs in
 * practice stay well under the cap.
 */
export function readJsonlTail(path: string, maxLines: number): unknown[] {
  const text = readTextSafe(path, 8_388_608)
  if (text === null) return []
  const out: unknown[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as unknown)
    } catch {
      /* skip an unparseable line rather than failing the whole tail */
    }
  }
  return out.slice(Math.max(0, out.length - Math.max(0, maxLines)))
}

/** Sorted names of the directories directly under path; [] when absent. */
export function listSubdirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()
  } catch {
    return []
  }
}

/** First 12 hex chars of the sha256 of a string — display-grade fingerprint. */
export function shortHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12)
}
