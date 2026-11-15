import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { root } from './gen-cordis-catalog-root.ts'
import {
  parseTranslationPairingManifest,
  translationPairSourcePredicate,
} from './translation-pairing.ts'
import { rewriteTranslationLinkLocales } from './translation-links.ts'

/** The declared-vs-rendered inputs {@link walkPartitionProblems} judges. */
export interface WalkPartitionInput {
  /** Service key → source pointer, as the rendering projection produced them. */
  readonly renderedKeys: ReadonlyMap<string, string>
  /** Event scopes the rendering projection produced. */
  readonly renderedScopes: ReadonlySet<string>
  /** Event names the rendering projection produced. */
  readonly renderedEventNames: ReadonlySet<string>
  /** Context key → first declaring file, from the independent AST scan. */
  readonly declaredKeys: ReadonlyMap<string, string>
  /** Event name → first declaring file, from the independent AST scan. */
  readonly declaredEvents: ReadonlyMap<string, string>
}

/** The curated partition maps {@link walkPartitionProblems} enforces. */
export interface WalkPartitionMaps {
  readonly servicePage: Readonly<Record<string, string>>
  readonly serviceWalkExemptions: Readonly<Record<string, string>>
  readonly eventScopePage: Readonly<Record<string, string>>
  readonly eventWalkExemptions: Readonly<Record<string, string>>
}

/** Project paired Markdown destinations in one generated region to the page's locale. */
export function localizePageRegion(region: string, pageRel: string, scanRoot: string = root): string {
  if (!pageRel.endsWith('.zh.md')) return region
  const manifest = parseTranslationPairingManifest(
    readFileSync(resolve(scanRoot, 'scripts/translation-pairing.manifest.json'), 'utf8'),
  )
  return rewriteTranslationLinkLocales(region, {
    repoRoot: scanRoot,
    sourcePath: pageRel,
    isTranslationPairSource: translationPairSourcePredicate(manifest),
  }).content
}

/**
 * Judge the rendered API and the independent AST scan against the curated
 * partition maps, fail-closed in both directions for services AND events: a
 * rendered key/scope must be mapped to a page, a mapped key/scope must still
 * render, and — the backstop — a DECLARED key/event the projection cannot see
 * must carry a named walk exemption (a rendered one must not). A third
 * direction guards the scan itself: everything rendered must also be declared
 * to the scan, so a scan blind spot cannot decay silently. Pure so the
 * acceptance paths are provable without running the projection.
 * @param input - rendered API plus the declared-key/event scans.
 * @param maps - the curated page maps and walk exemptions.
 * @returns one message per violation, empty when the partition holds.
 */
export function walkPartitionProblems(input: WalkPartitionInput, maps: WalkPartitionMaps): string[] {
  const problems: string[] = []
  for (const [key, source] of input.renderedKeys) {
    if (!Object.hasOwn(maps.servicePage, key)) problems.push(`service ctx.${key} (${source}) has no SERVICE_PAGE entry; every service maps to exactly one subsystems page.`)
  }
  for (const scope of [...input.renderedScopes].sort()) {
    if (!Object.hasOwn(maps.eventScopePage, scope)) problems.push(`event scope '${scope}/*' has no EVENT_SCOPE_PAGE entry; every event scope maps to exactly one subsystems page.`)
  }
  for (const key of Object.keys(maps.servicePage)) {
    if (!input.renderedKeys.has(key)) problems.push(`SERVICE_PAGE maps 'ctx.${key}' but the projection discovers no such service; remove the stale entry.`)
  }
  for (const scope of Object.keys(maps.eventScopePage)) {
    if (!input.renderedScopes.has(scope)) problems.push(`EVENT_SCOPE_PAGE maps '${scope}/*' but the projection discovers no such scope; remove the stale entry.`)
  }
  // The rendering projection only sees a Context key it can resolve to a
  // documented service class. The independent scan reads EVERY Context merge
  // so a key the projection cannot render must either be rendered (mapped) or
  // carry a named SERVICE_WALK_EXEMPTIONS reason — never vanish silently.
  for (const [key, rel] of input.declaredKeys) {
    const rendered = input.renderedKeys.has(key)
    const exempt = Object.hasOwn(maps.serviceWalkExemptions, key)
    if (!rendered && !exempt) {
      problems.push(`ctx.${key} (${rel}) is declared in a Context merge but invisible to the rendering projection; map it in SERVICE_PAGE (after making it renderable) or name it in SERVICE_WALK_EXEMPTIONS with its documentation owner.`)
    }
    if (rendered && exempt) problems.push(`ctx.${key} is rendered by the projection but still listed in SERVICE_WALK_EXEMPTIONS; remove the stale exemption.`)
  }
  for (const key of Object.keys(maps.serviceWalkExemptions)) {
    if (!input.declaredKeys.has(key)) problems.push(`SERVICE_WALK_EXEMPTIONS names 'ctx.${key}' but no Context merge declares it; remove the stale exemption.`)
  }
  // The event mirror of the service backstop: the projection walks only files
  // reachable from host-face package exports, so a client-face or unreachable
  // Events merge would otherwise vanish without a trace.
  for (const [name, rel] of input.declaredEvents) {
    const rendered = input.renderedEventNames.has(name)
    const exempt = Object.hasOwn(maps.eventWalkExemptions, name)
    if (!rendered && !exempt) {
      problems.push(`event '${name}' (${rel}) is declared in an Events merge but invisible to the rendering projection; make it renderable (mapped via EVENT_SCOPE_PAGE) or name it in EVENT_WALK_EXEMPTIONS with its documentation owner.`)
    }
    if (rendered && exempt) problems.push(`event '${name}' is rendered by the projection but still listed in EVENT_WALK_EXEMPTIONS; remove the stale exemption.`)
  }
  for (const name of Object.keys(maps.eventWalkExemptions)) {
    if (!input.declaredEvents.has(name)) problems.push(`EVENT_WALK_EXEMPTIONS names '${name}' but no Events merge declares it; remove the stale exemption.`)
  }
  // Self-check the scan itself: everything the projection renders is declared
  // in a Context/Events merge the scan must also reach, so a rendered key or
  // event the scan cannot see means the SCAN regressed (glob, prefilter, or
  // block walk) — a partial blind spot that exemption staleness alone would
  // never appear.
  for (const key of input.renderedKeys.keys()) {
    if (!input.declaredKeys.has(key)) problems.push(`ctx.${key} is rendered by the projection but the independent scan finds no Context merge declaring it; the scan has a blind spot (glob, prefilter, or module-block walk) — fix the scan, not the maps.`)
  }
  for (const name of input.renderedEventNames) {
    if (!input.declaredEvents.has(name)) problems.push(`event '${name}' is rendered by the projection but the independent scan finds no Events merge declaring it; the scan has a blind spot (glob, prefilter, or module-block walk) — fix the scan, not the maps.`)
  }
  return problems
}
