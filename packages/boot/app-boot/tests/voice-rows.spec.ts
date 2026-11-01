/**
 * The RedTeam desktop bundle carries the voice input rows itself, mirroring
 * the experimental voice-input bundle's own patch: the desktop profile is
 * composed from shipped templates only, and the voice bundle is an optional
 * bundle no shipped template selects, so without these rows the desktop
 * product has no dictation at all - no composer microphone control and no
 * speech-to-text Settings. This spec parses the real patch files and checks
 * the mirror, then composes the shipped desktop layer order and reads the
 * winning rows.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries } from '../src/profile.ts'

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

/** The plugin ids the voice input composition mounts. */
const VOICE_IDS = ['speech-to-text', 'speech-to-text-sensevoice', 'api-speech-to-text', 'ui-voice-input'] as const

function readPatches(relativePath: string): PatchOptions[] {
  const parsed = yaml.load(readFileSync(resolve(ROOT, relativePath), 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error(`${relativePath} did not parse as a patch list`)
  return parsed as PatchOptions[]
}

function insertedRows(patches: PatchOptions[]): NonNullable<PatchOptions['insert']> {
  return patches.flatMap(patch => patch.insert ?? [])
}

describe('desktop bundle voice input rows', () => {
  const base = readPatches('packages/bundle/base/cordis.patch.yml')
  const webApp = readPatches('packages/bundle/web-app/cordis.patch.yml')
  const desktop = readPatches('packages/redteam/desktop-bundle/cordis.patch.yml')
  const voiceBundle = readPatches('packages/experimental/voice-input-bundle/cordis.patch.yml')

  it('mirrors the voice bundle rows exactly', () => {
    const own = insertedRows(voiceBundle)
    const mirrored = insertedRows(desktop).filter(row => VOICE_IDS.includes(row.id as typeof VOICE_IDS[number]))
    expect(mirrored.map(row => row.id)).toEqual([...VOICE_IDS])
    for (const row of mirrored) {
      const source = own.find(candidate => candidate.id === row.id)
      expect(source, `voice bundle row ${row.id}`).toBeDefined()
      expect(row.name).toBe(source?.name)
      expect(row.config).toEqual(source?.config)
    }
  })

  it('is the only shipped desktop layer inserting the voice rows', () => {
    for (const layer of [base, webApp]) {
      const ids = insertedRows(layer).map(row => row.id)
      for (const id of VOICE_IDS) expect(ids).not.toContain(id)
    }
  })

  it('resolves the voice rows in the shipped desktop layer order', () => {
    const entries = composeEntries([base, webApp, desktop])
    for (const id of VOICE_IDS) {
      const rows = entries.filter(entry => entry.id === id)
      expect(rows.length, `composed rows for ${id}`).toBeGreaterThan(0)
      // EntryGroup.update keeps the last row per id, so the last composed
      // row is the config the plugin is constructed with.
      const winning = rows[rows.length - 1]
      const source = insertedRows(voiceBundle).find(candidate => candidate.id === id)
      expect(winning?.name).toBe(source?.name)
      expect(winning?.config).toEqual(source?.config)
    }
  })
})
