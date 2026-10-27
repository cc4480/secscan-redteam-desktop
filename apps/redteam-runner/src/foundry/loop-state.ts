/**
 * Gold Loop persisted state (loop-state.json in the Foundry store):
 * the cycle counter, the latest cycle summary, and the fitness table.
 */

import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FitnessRecord } from './fitness.js'
import { atomicWriteFile } from './store.js'

/** One case-mutant attempt inside a cycle. */
export interface CaseMutantOutcome {
  seedId: string
  operator: string
  ok: boolean
  detail: string
  caseId: string | null
}

/** One bundle-mutant attempt inside a cycle. */
export interface BundleMutantOutcome {
  seedSlug: string
  operator: string
  slug: string | null
  ok: boolean
  detail: string
  gatePass: boolean | null
  fitness: number | null
}

/** The summary of one loop cycle. */
export interface LoopCycleSummary {
  cycle: number
  at: string
  casesScored: number
  mutantsGenerated: number
  survivorsRegistered: number
  caseMutants: CaseMutantOutcome[]
  bundleMutants: BundleMutantOutcome[]
  notes: string[]
  error: string | null
}

/** Persisted loop state. */
export interface LoopState {
  cyclesRun: number
  lastCycle: LoopCycleSummary | null
  fitness: Record<string, FitnessRecord & { at: string }>
}

/**
 * Load the loop state; absent state reads as zero cycles.
 *
 * @param storeDir - the foundry store directory
 * @returns the persisted loop state
 */
export function loadLoopState(storeDir: string): LoopState {
  try {
    const raw = JSON.parse(readFileSync(join(storeDir, 'loop-state.json'), 'utf8')) as Partial<LoopState>
    if (raw && typeof raw.cyclesRun === 'number') {
      return { cyclesRun: raw.cyclesRun, lastCycle: raw.lastCycle ?? null, fitness: raw.fitness ?? {} }
    }
  } catch {
    /* absent — a fresh loop */
  }
  return { cyclesRun: 0, lastCycle: null, fitness: {} }
}

/**
 * Persist the loop state atomically.
 *
 * @param storeDir - the foundry store directory
 * @param state - the state to write
 * @returns nothing
 */
export function saveLoopState(storeDir: string, state: LoopState): void {
  mkdirSync(storeDir, { recursive: true })
  atomicWriteFile(join(storeDir, 'loop-state.json'), JSON.stringify(state, null, 2) + '\n')
}
