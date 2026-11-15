/**
 * Render the event producer/consumer matrix from the resolved event relations,
 * and fail when a declared event has no discoverable dispatcher.
 */

import type { EventEntry } from '@deepseek-ai/dsh-typert-generator'
import { generatedHeader, maintenanceFooter, pkgLink, sourceLink } from './gen-doc-graphs-format.ts'
import type { Pkg } from './gen-doc-graphs-shared.ts'
import { collectEventRelations } from './gen-doc-graphs-sources.ts'

/** Render one event's dispatcher packages with the methods each one used. */
export function relationPackages(map: Map<string, Set<string>>, pkgsByShort: Map<string, Pkg>): string {
  if (map.size === 0) return '-'
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pkg, methods]) => `${pkgLink(pkgsByShort.get(pkg), pkg)} (${[...methods].sort().map(m => `\`${m}\``).join(', ')})`)
    .join(', ')
}

/** Render one event's listener packages. */
export function listenerPackages(listeners: Set<string>, pkgsByShort: Map<string, Pkg>): string {
  if (listeners.size === 0) return '-'
  return [...listeners].sort().map(pkg => pkgLink(pkgsByShort.get(pkg), pkg)).join(', ')
}

/** Render the event producer/consumer matrix page and fail on a dead declaration. */
export function renderEventRelations(pkgs: Pkg[], events: readonly EventEntry[]): string {
  const relations = collectEventRelations()
  const pkgsByShort = new Map(pkgs.map(pkg => [pkg.short, pkg]))
  const maintenance = 'generated: Cordis event declarations and producer/listener edges are resolved from the repository TypeScript Program'
  const lines = generatedHeader('Event Producer And Consumer Matrix')
  lines.push(
    'This matrix shows which packages dispatch each harness-owned event and which packages listen to it. Events are many-to-many, so the dense relation data is presented as a table rather than one large graph. Receiver and event-name types also cover contained dispatch sites that deliberately bypass `ctx.emit`, such as subagent lifecycle containment.',
    '',
    '| Event | Mode | Declared in | Dispatchers | Listeners |',
    '| --- | --- | --- | --- | --- |',
  )
  for (const event of [...events].sort((a, b) => a.name.localeCompare(b.name))) {
    const relation = relations.get(event.name) ?? { dispatchers: new Map<string, Set<string>>(), listeners: new Set<string>() }
    lines.push(`| \`${event.name}\` | \`${event.mode}\` | ${sourceLink(event.source)} | ${relationPackages(relation.dispatchers, pkgsByShort)} | ${listenerPackages(relation.listeners, pkgsByShort)} |`)
  }
  // Every declared event needs a dispatcher: zero means dead vocabulary or an
  // unrecognized semantic dispatch form. Listener-free extension points remain
  // valid. Client-declared events are exempt: the relation scan seeds the HOST
  // aggregate program only (host+client cannot share one program — the cordis
  // Context merges collide), so client dispatch sites are structurally
  // invisible here; their rows stay in the table for the declarations' sake.
  const undispatched = [...events]
    .filter(event => !event.source.startsWith('packages/client/'))
    .filter(event => (relations.get(event.name)?.dispatchers.size ?? 0) === 0)
    .map(event => event.name)
    .sort()
  if (undispatched.length > 0) {
    throw new Error(
      `event-producer-consumer matrix: no dispatcher found for declared event${undispatched.length > 1 ? 's' : ''} `
      + `${undispatched.map(name => `"${name}"`).join(', ')} — dead vocabulary, or a dispatch form the semantic scan misses `
      + '(teach scripts/gen-doc-graphs.ts that form)',
    )
  }
  const declared = new Set(events.map(event => event.name))
  const extra = [...relations.keys()].filter(event => !declared.has(event)).sort()
  if (extra.length > 0) {
    lines.push('', '## Non-harness or undeclared event strings seen in package source', '', '| Event string | Dispatchers | Listeners |', '| --- | --- | --- |')
    for (const event of extra) {
      const relation = relations.get(event)
      if (!relation) continue
      lines.push(`| \`${event}\` | ${relationPackages(relation.dispatchers, pkgsByShort)} | ${listenerPackages(relation.listeners, pkgsByShort)} |`)
    }
  }
  lines.push('', ...maintenanceFooter(maintenance))
  return lines.join('\n')
}
