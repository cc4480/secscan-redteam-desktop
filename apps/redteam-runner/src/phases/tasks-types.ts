/**
 * Coordinator task shapes (split from tasks.ts — the 300-line budget).
 */
import { type BatteryCategory } from '../battery.js'

export interface TaskDef {
  id: string
  kind: 'probe' | 'recon'
  brief: string
  attackId?: string
  category?: BatteryCategory
  /** Battery item ID this task covers (v0.18.0) — surfaced to the specialist via taskPrompt. */
  batteryItem?: string
  /**
   * Declared custom-code need (fleet audit M1): a payload, exploit script,
   * or encoder this task must GENERATE rather than fetch. When present on a
   * probe task, runTask requests the artifact from the coder (TANK) seat
   * (exploit-cell/coder.ts) before the exploiter loop starts and hands the
   * returned artifact to the exploiter in its task prompt. Probe tasks only,
   * for the same reason batteryItem is: recon never crafts payloads.
   */
  codeNeed?: string
  maxTurns: number
}

export interface TaskResult {
  task: TaskDef
  summary: string
  /** The coder (TANK) artifact this task consumed, when it declared a codeNeed. */
  coderArtifact?: string
  probesBefore: number
  probesAfter: number
  findingsBefore: number
  findingsAfter: number
  killedBefore: number
  killedAfter: number
  /** "shared" when these numbers are the parallel chunk delta, not this task own work. */
  attribution?: 'exact' | 'shared'
}
