/**
 * The two shipped layers that insert the `agent-team` service row - the
 * RedTeam desktop bundle and the experimental agent-team-profile bundle -
 * carry identical fleet bounds, so the effective Team config is the same in
 * either layer order. Composition resolves a repeated plugin id to the LAST
 * layer that inserts it (the composed entry list feeds one EntryGroup whose
 * update keeps the last row per id), so this spec composes the real patch
 * files both ways and reads the winning row.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries } from '../src/profile.ts'

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

/** The fleet bounds both shipped patch layers declare for the Team service. */
const FLEET_CONFIG = {
  maxMembers: 100,
  maxMemberDepth: 4,
  maxTasks: 4096,
  maxPendingMessagesPerMember: 64,
  maxMessageBytes: 65536,
  disposalTimeoutMs: 5000,
}

function readPatches(relativePath: string): PatchOptions[] {
  const parsed = yaml.load(readFileSync(resolve(ROOT, relativePath), 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error(`${relativePath} did not parse as a patch list`)
  return parsed as PatchOptions[]
}

function insertedTeamConfig(patches: PatchOptions[]): Record<string, unknown> | undefined {
  const inserted = patches.flatMap(patch => patch.insert ?? [])
  return inserted.find(entry => entry.id === 'agent-team')?.config as Record<string, unknown> | undefined
}

describe('shipped agent-team fleet bounds', () => {
  const base = readPatches('packages/bundle/base/cordis.patch.yml')
  const product = readPatches('packages/redteam/desktop-bundle/cordis.patch.yml')
  const generic = readPatches('packages/experimental/agent-team-profile/cordis.patch.yml')

  it('declares the same fleet bounds in each shipped layer', () => {
    expect(insertedTeamConfig(product)).toEqual(FLEET_CONFIG)
    expect(insertedTeamConfig(generic)).toEqual(FLEET_CONFIG)
  })

  it('resolves to the fleet bounds in either layer order', () => {
    for (const layers of [[base, product, generic], [base, generic, product]]) {
      const entries = composeEntries(layers)
      const teamRows = entries.filter(entry => entry.id === 'agent-team')
      expect(teamRows.length).toBeGreaterThan(0)
      // EntryGroup.update keeps the last row per id, so the last composed
      // agent-team row is the config the service is constructed with.
      expect(teamRows[teamRows.length - 1]?.config).toEqual(FLEET_CONFIG)
      // dsh-base inserts the subagent service bare (default
      // maxActiveSubagents 8); both later layers override it to the roster
      // width, so the active-turn cap cannot throttle the fleet either.
      const subagentRows = entries.filter(entry => entry.id === 'subagent')
      expect(subagentRows).toHaveLength(1)
      expect(subagentRows[0]?.config).toEqual({ maxActiveSubagents: 100 })
    }
  })
})
