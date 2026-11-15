/**
 * Boots each manifest entry on a fresh Context and harvests the model-facing
 * schemas, with the two guards that keep the result honest: the manifest covers
 * every on-disk `tool-*` package, and every booted package registered a tool.
 */

import { globSync } from 'node:fs'
import { basename } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { TOOL_PACKAGES } from './gen-tool-catalog-manifest.ts'
import { root } from './gen-tool-catalog-support.ts'
import type { ToolCatalog, ToolPackage } from './gen-tool-catalog-types.ts'

/**
 * Assert the boot manifest covers every shipped tool package on disk (a
 * `tool-*` leaf under `packages/`).
 * Booting has no source declaration to enumerate, so this glob restores the
 * "a new tool cannot be silently undocumented" guarantee: an unlisted package
 * fails the generator (and the freshness gate) until it is added to
 * {@link TOOL_PACKAGES}. Exported for a direct negative test.
 *
 * `scanRoot` defaults to the repo root; a test may point it at a fixture tree.
 */
export function assertManifestComplete(packages: ToolPackage[] = TOOL_PACKAGES, scanRoot: string = root): void {
  const onDisk = globSync('packages/*/tool-*', { cwd: scanRoot }).map(p => basename(p)).sort()
  const listed = new Set(packages.map(p => p.dir))
  const missing = onDisk.filter(dir => !listed.has(dir))
  if (missing.length > 0) {
    throw new Error(
      `gen-tool-catalog: ${missing.length} tool package(s) not in the boot manifest: ${missing.join(', ')}. `
      + 'Add each to TOOL_PACKAGES in scripts/gen-tool-catalog.ts so its schema is catalogued.',
    )
  }
}

/**
 * Assert one manifest entry actually registered a tool.
 *
 * A tool package that boots without registering anything is a broken boot, not
 * an empty catalog section. The usual cause is an `inject` the entry's `mount`
 * does not satisfy: cordis leaves the plugin PENDING, every step here still
 * succeeds, and the generator writes a catalog missing that package's tools.
 * The freshness gate stays green because regeneration reproduces the omission.
 * {@link assertManifestComplete} cannot see this: the
 * package IS listed, it just contributed nothing.
 * @param entry - the manifest entry that was booted.
 * @param harvested - how many schemas its boot registered.
 * @throws when the boot registered no tool at all.
 */
export function assertToolsHarvested(entry: ToolPackage, harvested: number): void {
  if (harvested > 0) return
  throw new Error(
    `gen-tool-catalog: ${entry.pkg} booted without registering a single tool. `
    + 'Its plugin is most likely PENDING on a service this manifest entry does not mount — '
    + `compare the plugin's inject with mount() and requires: ${entry.requires.join(', ')}.`,
  )
}

/**
 * Boot each tool package on a fresh Context and harvest its model-facing
 * schemas. A fresh Context per package keeps attribution clean (each entry's
 * schemas come from exactly that package) and isolates a boot failure to its
 * own entry. Disposed after harvest so no executor/provider outlives the run.
 */
export async function collectToolCatalog(packages: ToolPackage[] = TOOL_PACKAGES): Promise<ToolCatalog> {
  assertManifestComplete(packages)
  const catalog: ToolCatalog = []
  for (const entry of packages) {
    const ctx = new Context()
    // Dispose in `finally` so a throw from `mount`/`schemas()` after earlier
    // plugins mounted still tears the context down (no leaked executor/provider
    // fiber) — the repo's "dispose must reach quiescence" rule.
    try {
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime, entry.toolsConfig ?? {})
      await entry.mount(ctx)
      const schemas = ctx.tools.schemas(entry.scope?.(ctx)).sort((a, b) => a.name.localeCompare(b.name))
      assertToolsHarvested(entry, schemas.length)
      catalog.push({
        pkg: entry.pkg,
        sources: Object.fromEntries(schemas.map(schema => [
          schema.name,
          toolSource(entry, schema.name),
        ])),
        requires: entry.requires,
        writes: entry.writes,
        schemas,
        ...entry.shippedNames !== undefined ? { shippedNames: entry.shippedNames } : {},
        ...entry.note !== undefined ? { note: entry.note } : {},
      })
    } finally {
      await ctx.fiber.dispose()
    }
  }
  return catalog
}

/** Resolve one harvested tool to the plugin source that registered it. */
function toolSource(entry: ToolPackage, toolName: string): string {
  if (typeof entry.source === 'string') return entry.source
  const source = entry.source[toolName]
  if (source === undefined) {
    throw new Error(
      `gen-tool-catalog: ${entry.pkg} has no source mapping for harvested tool ${toolName}`,
    )
  }
  return source
}
