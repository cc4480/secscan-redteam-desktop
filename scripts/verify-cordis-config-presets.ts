/** Preset-plane separation and browser-half declaration checks over the shipped compositions. */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DshBundleManifest } from '../packages/util/package-manifest/src/types.ts'
import { bundlePatchFiles } from '../packages/boot/app-boot/src/profile.ts'
import { isCordisGroupEntry, loadCordisYaml, presetDefinitions } from './cordis-yaml.ts'
import type { PackageManifest } from './verify-cordis-config-types.ts'
import { isRecord, isUnknownArray, readManifest, root } from './verify-cordis-config-shared.ts'

/**
 * A browser plugin must declare the browser half it ships.
 *
 * The browser roster is discovered by scanning composed packages for a
 * `dsh.client` block, and the node half of a surface plugin is an empty
 * `apply`. A `packages/client` package that exports `./client` without that
 * block therefore composes, activates, and contributes nothing — its bundle is
 * never served and no error is raised anywhere. The mismatch is invisible in
 * the composition file, so it is checked against the manifests instead. Only
 * this group is checked: a Host package's `./client` export is the typed wire
 * face its browser consumers import, not a plugin the roster serves.
 * @returns one violation per client package whose `./client` export and
 * `dsh.client` declaration disagree.
 */
export function validateClientHalvesDeclared(): string[] {
  return globSync('packages/client/*/package.json', { cwd: root }).flatMap((manifestPath) => {
    const manifest = readManifest(manifestPath) as PackageManifest & {
      exports?: Record<string, unknown>
      dsh?: { client?: unknown }
    }
    const shipsClient = manifest.exports !== undefined && Object.hasOwn(manifest.exports, './client')
    const declaresClient = manifest.dsh?.client !== undefined
    if (shipsClient === declaresClient) return []
    return [shipsClient
      ? `${manifestPath}: exports "./client" but declares no dsh.client, so its browser half is never served`
      : `${manifestPath}: declares dsh.client but exports no "./client" entry to serve`]
  })
}

/**
 * No shipped agent preset may repeat a row the host composition still runs.
 *
 * A preset contributes what ONE session adds to the host's registries. A row
 * active on both planes is therefore mounted twice — once per process and once
 * per session — and what that costs depends on what the row does: a provider
 * behind an `isolate` realm shadows the host's for its own consumers, so a host
 * contributor to that service reaches nobody; a row that registers into a host
 * singleton registers once per live session, so the second one collides.
 *
 * Both failure modes have occurred. A preset-local provider once shadowed the
 * host route that its consumer needed, and a host-registry contribution once
 * registered again for every live session until the second registration threw.
 * Neither changes a tool catalog, so no catalog assertion can see them — and the
 * shipped presets are near-copies of each other, so a fix applied to three of
 * four is the normal failure.
 * @returns one diagnostic per preset row that is also active on the host plane.
 */
export function validatePresetPlaneSeparation(): string[] {
  const problems: string[] = []
  // The shipped Web surface is two bundle layers over an empty root; the web
  // layer is its host patch followed by one patch file per shipped preset.
  const hostFile = 'packages/bundle/base/cordis.patch.yml'
  const overlayDir = 'packages/bundle/web-app'
  const overlayManifest = JSON.parse(readFileSync(resolve(root, overlayDir, 'package.json'), 'utf8')) as { dsh: { bundle: DshBundleManifest } }
  const overlayFiles = bundlePatchFiles(overlayManifest.dsh.bundle).map(file => `${overlayDir}/${file.replace(/^\.\//, '')}`)
  const disabled = new Set<string>()
  const overlayRows = new Set<string>()
  for (const file of overlayFiles) {
    for (const entry of loadEntries(file)) {
      if (!isRecord(entry)) continue
      if (entry.disabled === true && typeof entry.id === 'string') disabled.add(entry.id)
    }
    for (const id of rowIds(file)) overlayRows.add(id)
  }
  // The overlay's own inserts are host-plane too; its disables take them back out.
  const active = new Set([...rowIds(hostFile), ...overlayRows].filter(id => !disabled.has(id)))
  for (const file of overlayFiles) {
    for (const definition of presetDefinitions(loadEntries(file))) {
      for (const id of collectRowIds(definition.plugins)) {
        if (active.has(id)) problems.push(`${file}#${definition.id}: row "${id}" is also active in the host composition; a row belongs to exactly one plane`)
      }
    }
  }
  return problems
}

/** Every entry of one config file, or an empty list when it is not an entry array. */
function loadEntries(file: string): unknown[] {
  const document = loadCordisYaml(readFileSync(resolve(root, file), 'utf8'))
  return isUnknownArray(document) ? document : []
}

/**
 * Row ids declared anywhere in one config file, including inside group `config`
 * lists — a preset nests most of its rows in `isolate` groups.
 * @param file - repository-relative config path.
 * @returns the declared ids.
 */
function rowIds(file: string): Set<string> {
  return collectRowIds(loadEntries(file))
}

function collectRowIds(rows: unknown): Set<string> {
  const ids = new Set<string>()
  const walk = (value: unknown): void => {
    if (isUnknownArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (!isRecord(value)) return
    if (typeof value.id === 'string' && typeof value.name === 'string') ids.add(value.id)
    walk(value.insert)
    if (isCordisGroupEntry(value)) walk(value.config)
  }
  walk(rows)
  return ids
}
