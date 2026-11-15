import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  projectCordisCatalog,
  REGION_BEGIN,
  REGION_END,
  renderInheritedPage,
  renderPageRegion,
} from '@deepseek-ai/dsh-typert-generator'
import { contextKeyMap, contextMergeFiles, eventNameList } from './cordis-walk.ts'
import {
  EVENT_WALK_EXEMPTIONS,
  SERVICE_WALK_EXEMPTIONS,
} from './gen-cordis-catalog-exemptions.ts'
import { EVENT_SCOPE_PAGE, SERVICE_PAGE } from './gen-cordis-catalog-pages.ts'
import { localizePageRegion, walkPartitionProblems } from './gen-cordis-catalog-partition.ts'
import { CORDIS_CATALOG_POLICY } from './gen-cordis-catalog-policy.ts'
import { OUT_INHERITED, OUT_RUNTIME_API, root, SUBSYSTEMS_DIR } from './gen-cordis-catalog-root.ts'

/**
 * Splice a page's generated Cordis API region into its Markdown content.
 * The page must contain exactly one `cordis-surface` marker region (the markers are
 * part of the hand-owned page skeleton once, then owned by the generator);
 * zero or several is a partition error the caller reports with the page path.
 * The match is on THIS generator's exact markers, not the generic region
 * grammar, so a page carrying only some other generator's region fails loud
 * instead of having that region overwritten.
 * @param content - the page's current full Markdown text.
 * @param region - the freshly rendered marker-delimited region.
 * @returns the page text with the region replaced.
 */
export function spliceRegion(content: string, region: string): string {
  const lines = content.split('\n')
  const begins = lines.flatMap((line, index) => (line === REGION_BEGIN ? [index] : []))
  const ends = lines.flatMap((line, index) => (line === REGION_END ? [index] : []))
  if (begins.length !== 1 || ends.length !== 1) {
    throw new Error(`expected exactly 1 cordis-surface region, found ${begins.length} BEGIN/${ends.length} END; add the BEGIN/END cordis-surface markers once`)
  }
  const begin = begins[0] ?? -1
  const end = ends[0] ?? -1
  if (end < begin) throw new Error('cordis-surface END marker precedes its BEGIN')
  return [...lines.slice(0, begin), ...region.split('\n'), ...lines.slice(end + 1)].join('\n')
}

/**
 * Compute every generated artifact: the inherited-tier page, the model-facing
 * runtime API module, plus, per mapped subsystems page, the pair's two updated
 * documents with the injected region. Fail-loud partition checks live here: an
 * unmapped service/event scope, a mapping whose page file does not exist, a
 * curated entry whose key/scope the projection no longer discovers, a declared
 * Context key or Events member the projection cannot see without a named walk
 * exemption, and a mapped page missing its markers are all aggregated errors.
 * @returns `[repo-relative path, exact content]` for every generated artifact.
 */
export function computeOutputs(): [string, string][] {
  const { projector, model } = projectCordisCatalog(root, CORDIS_CATALOG_POLICY)
  const services = [...model.services]
  const events = [...model.events]

  const declaredKeys = new Map<string, string>()
  const declaredEvents = new Map<string, string>()
  for (const { rel, sf, body } of contextMergeFiles(root, ['packages/*/*/src/**/*.ts', 'packages/*/*/src/**/*.tsx'])) {
    for (const key of contextKeyMap(body, sf).keys()) {
      if (!declaredKeys.has(key)) declaredKeys.set(key, rel)
    }
    for (const name of eventNameList(body, sf)) {
      if (!declaredEvents.has(name)) declaredEvents.set(name, rel)
    }
  }
  const problems = walkPartitionProblems({
    renderedKeys: new Map(services.map(s => [s.key, s.source])),
    renderedScopes: new Set(events.map(e => e.scope)),
    renderedEventNames: new Set(events.map(e => e.name)),
    declaredKeys,
    declaredEvents,
  }, {
    servicePage: SERVICE_PAGE,
    serviceWalkExemptions: SERVICE_WALK_EXEMPTIONS,
    eventScopePage: EVENT_SCOPE_PAGE,
    eventWalkExemptions: EVENT_WALK_EXEMPTIONS,
  })
  if (problems.length > 0) throw new Error(`gen-cordis-catalog: ${problems.length} partition violation(s):\n${problems.map(p => `  ${p}`).join('\n')}`)

  const pages = [...new Set([...Object.values(SERVICE_PAGE), ...Object.values(EVENT_SCOPE_PAGE)])].sort()
  const outputs: [string, string][] = [
    [OUT_INHERITED, renderInheritedPage(CORDIS_CATALOG_POLICY)],
    [OUT_RUNTIME_API, projector.renderRuntimeApi(model)],
  ]
  for (const page of pages) {
    const region = renderPageRegion(
      page,
      services.filter(s => SERVICE_PAGE[s.key] === page),
      events.filter(e => EVENT_SCOPE_PAGE[e.scope] === page),
      CORDIS_CATALOG_POLICY,
    )
    for (const side of [page, page.replace(/\.md$/, '.zh.md')]) {
      const rel = `${SUBSYSTEMS_DIR}/${side}`
      const localizedRegion = localizePageRegion(region, rel)
      let current: string
      try {
        current = readFileSync(resolve(root, rel), 'utf8')
      } catch {
        // Both pair sides must exist before a region can be injected; the
        // pairing gate owns pair completeness, this generator names the miss.
        problems.push(`${rel}: mapped subsystems page does not exist.`)
        continue
      }
      try {
        outputs.push([rel, spliceRegion(current, localizedRegion)])
      } catch (error) {
        problems.push(`${rel}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  if (problems.length > 0) throw new Error(`gen-cordis-catalog: ${problems.length} page violation(s):\n${problems.map(p => `  ${p}`).join('\n')}`)
  return outputs
}
