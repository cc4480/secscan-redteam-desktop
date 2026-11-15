/**
 * Render one application composition graph by parsing its cordis patch rows and
 * mapping each declared plugin to the package that provides it.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { escapeMermaidLabel as escLabel, graphNodeId as nodeId } from './package-graph.ts'
import { generatedHeader, linkFromDoc, maintenanceFooter } from './gen-doc-graphs-format.ts'
import { root, type ExamplePlugin } from './gen-doc-graphs-shared.ts'

/** Read one composition's cordis patch and return the plugin rows it declares. */
export function parseExampleCordis(rel: string): ExamplePlugin[] {
  const text = readFileSync(resolve(root, rel), 'utf8')
  const plugins: ExamplePlugin[] = []
  let current: { id: string; name?: string } | null = null
  const flush = (): void => {
    if (current?.name) plugins.push({ id: current.id, name: current.name })
  }
  for (const line of text.split('\n')) {
    // Top-level rows (`- id:`) and bundle-patch insert rows (`    - id:`).
    const id = /^\s*-\s+id:\s+(.+?)\s*$/.exec(line)
    if (id?.[1] !== undefined) {
      flush()
      current = { id: stripYamlScalar(id[1]) }
      continue
    }
    const name = /^\s+name:\s+(.+?)\s*$/.exec(line)
    if (name?.[1] !== undefined && current) current.name = stripYamlScalar(name[1])
  }
  flush()
  return plugins
}

/** Drop surrounding quotes from one YAML scalar. */
export function stripYamlScalar(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '')
}

/** Application compositions that render as their own graph page. */
export const APP_EXAMPLES = [
  {
    id: 'dsh_base',
    rel: 'apps/cli/composition.md',
    title: 'DSH Base Composition',
    label: 'packages/bundle/base/cordis.patch.yml',
    config: 'packages/bundle/base/cordis.patch.yml',
    summary: 'The dsh-base bundle patch shared by the web, headless, sdk, and acp profiles; their mode bundles and user layers patch over it, while sdk-minimal owns a separate standalone tree.',
  },
]

type AppExample = typeof APP_EXAMPLES[number]

/** Render one application composition page. */
export function renderAppComposition(example: AppExample): string {
  const plugins = parseExampleCordis(example.config)
  const maintenance = 'hybrid: the patch row list is parsed from its `cordis.yml`; app package expansion is curated from package source'
  const lines = generatedHeader(example.title)
  lines.push(
    example.summary,
    '',
    '```mermaid',
    'flowchart LR',
    `  cfg["${escLabel(example.label)}<br/>cordis.yml"]`,
  )
  for (const plugin of plugins) {
    const pluginNode = nodeId(`plugin_${example.id}`, plugin.id)
    lines.push(`  ${pluginNode}["${escLabel(plugin.id)}<br/>${escLabel(plugin.name)}"]`)
    lines.push(`  cfg --> ${pluginNode}`)
  }
  lines.push(
    '```',
    '',
    '| Plugin id | Package / module |',
    '| --- | --- |',
    ...plugins.map(plugin => `| \`${plugin.id}\` | \`${plugin.name}\` |`),
    '',
    `Source config: [\`${example.config}\`](${linkFromDoc(example.rel, example.config)}).`,
  )
  lines.push('', ...maintenanceFooter(maintenance))
  return lines.join('\n')
}
