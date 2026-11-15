/**
 * Assemble every graph document from the package graph, the Cordis catalog, and
 * the renderers beside this module, then index them for the atlas page.
 */

import { projectCordisCatalog } from '@deepseek-ai/dsh-typert-generator'
import { CORDIS_CATALOG_POLICY } from './gen-cordis-catalog.ts'
import { collectPackageGraph } from './package-graph.ts'
import { APP_EXAMPLES, renderAppComposition } from './gen-doc-graphs-app-composition.ts'
import { renderCapabilitySeams } from './gen-doc-graphs-capability-seams.ts'
import { renderEventRelations } from './gen-doc-graphs-event-relations.ts'
import { generatedHeader, graphIndexLink, maintenanceFooter } from './gen-doc-graphs-format.ts'
import { renderLifecycle } from './gen-doc-graphs-lifecycle.ts'
import { GROUP_ORDER, root, type GraphDoc } from './gen-doc-graphs-shared.ts'
import { renderToolPipeline } from './gen-doc-graphs-tool-pipeline.ts'

/** Render every graph document, index first. */
export function renderDocs(): GraphDoc[] {
  const pkgs = collectPackageGraph(root, GROUP_ORDER, 'gen-doc-graphs')
  const { model } = projectCordisCatalog(root, CORDIS_CATALOG_POLICY)
  const docs: GraphDoc[] = [
    { rel: 'docs/capability-seams.md', content: renderCapabilitySeams(pkgs, model.services) },
    ...APP_EXAMPLES.map(example => ({ rel: example.rel, content: renderAppComposition(example) })),
    { rel: 'docs/event-producer-consumer.md', content: renderEventRelations(pkgs, model.events) },
    { rel: 'docs/agent-lifecycle.md', content: renderLifecycle() },
    { rel: 'docs/tool-execution-pipeline.md', content: renderToolPipeline() },
  ]
  docs.unshift({ rel: 'docs/graph-atlas.md', content: renderIndex(docs) })
  return docs
}

/** Render the graph atlas index over the other pages. */
export function renderIndex(docs: GraphDoc[]): string {
  const labels: Record<string, string> = {
    'docs/capability-seams.md': 'capability seams and core services',
    'apps/cli/composition.md': 'dsh shared base composition',
    'docs/event-producer-consumer.md': 'event producer/consumer matrix',
    'docs/agent-lifecycle.md': 'agent turn and step lifecycle',
    'docs/tool-execution-pipeline.md': 'tool execution pipeline',
  }
  const modes: Record<string, string> = {
    'docs/capability-seams.md': 'hybrid generated',
    'apps/cli/composition.md': 'hybrid generated',
    'docs/event-producer-consumer.md': 'hybrid generated',
    'docs/agent-lifecycle.md': 'curated',
    'docs/tool-execution-pipeline.md': 'curated',
  }
  const rows = [
    '| [module dependency graph](module-graph.md) | `generated` |',
    '| [tool schema catalog and package map](tool-catalog.md) | `generated` |',
    ...docs.map((doc) => {
      const link = graphIndexLink(doc.rel)
      return `| [${labels[doc.rel] ?? link}](${link}) | \`${modes[doc.rel] ?? 'generated'}\` |`
    }),
  ]
  const maintenance = 'mixed: each linked page declares generated, hybrid, or curated mode'
  return [
    ...generatedHeader('Documentation Graph Index'),
    'These diagrams show relationships that the generated catalogs do not. Use them to find package relationships, capability seams, event flow, model-facing tools, app composition, and runtime lifecycle paths. Exact signatures and type definitions still live in the [subsystem pages](subsystems/core.md) (types + the generated Cordis API regions) and [tool-catalog.md](tool-catalog.md).',
    '',
    'The process decision behind this index is recorded in [the documentation graph Agent Note](../.agents/notes/archived/process/2026-07-03-documentation-graph-atlas.md).',
    '',
    '| Graph | Mode |',
    '| --- | --- |',
    ...rows,
    '',
    'Regenerate with `pnpm run gen-doc-graphs`; verify freshness with `pnpm run verify-doc-graphs`.',
    '',
    ...maintenanceFooter(maintenance),
  ].join('\n')
}
