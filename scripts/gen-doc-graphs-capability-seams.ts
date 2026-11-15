/**
 * Render the capability-seams graph: each ctx service with its owning package,
 * known implementations, and direct consumers, plus the role table.
 */

import type { ServiceEntry } from '@deepseek-ai/dsh-typert-generator'
import { escapeMermaidLabel as escLabel, graphNodeId as nodeId } from './package-graph.ts'
import { generatedHeader, maintenanceFooter, pkgLink, pkgList, tableCell } from './gen-doc-graphs-format.ts'
import { assertServiceRolesComplete, SERVICE_ROLES } from './gen-doc-graphs-service-roles.ts'
import type { Pkg } from './gen-doc-graphs-shared.ts'

/** Render the capability-seams page from the package graph and discovered services. */
export function renderCapabilitySeams(pkgs: Pkg[], services: readonly ServiceEntry[]): string {
  assertServiceRolesComplete(services)
  const pkgsByShort = new Map(pkgs.map(pkg => [pkg.short, pkg]))
  const maintenance = 'hybrid: services are discovered from Cordis declarations; interface/implementation/consumer roles are classified in `scripts/gen-doc-graphs.ts` with a completeness guard'
  const nodes = new Map<string, string>()
  const edges = new Set<string>()
  const companionEdges = new Set<string>()
  const addNode = (id: string, label: string): void => {
    if (!nodes.has(id)) nodes.set(id, `  ${id}["${escLabel(label)}"]`)
  }
  const addEdge = (from: string, to: string): void => { edges.add(`  ${from} --> ${to}`) }
  const lines = generatedHeader('Capability Seams And Core Services')
  lines.push(
    'A service can be a core spine service, a swappable capability seam, a bundle/composition point, or a standalone service. The graph shows the package that owns the service declaration, known implementation packages, and packages that consume the service directly.',
    '',
    '```mermaid',
    'flowchart LR',
  )
  for (const role of SERVICE_ROLES) {
    const svc = nodeId('svc', role.key)
    const owner = nodeId('pkg', role.pkg)
    addNode(owner, role.pkg)
    addNode(svc, `ctx.${role.key}<br/>${role.title}`)
    addEdge(owner, svc)
    for (const impl of role.implementations ?? []) {
      addNode(nodeId('pkg', impl), impl)
      addEdge(nodeId('pkg', impl), svc)
    }
    for (const consumer of role.consumers ?? []) {
      addNode(nodeId('pkg', consumer), consumer)
      addEdge(svc, nodeId('pkg', consumer))
    }
    for (const companion of role.companions ?? []) {
      addNode(nodeId('pkg', companion), companion)
      companionEdges.add(`  ${svc} -. event gate .-> ${nodeId('pkg', companion)}`)
    }
  }
  lines.push(...nodes.values(), ...[...edges].sort(), ...[...companionEdges].sort())
  lines.push('```', '', '| ctx key | Role | Owner | Implementations | Direct consumers | Companion plugins | Note |', '| --- | --- | --- | --- | --- | --- | --- |')
  for (const role of SERVICE_ROLES) {
    lines.push(`| \`ctx.${role.key}\` | \`${role.mode}\` | ${pkgLink(pkgsByShort.get(role.pkg), role.pkg)} | ${pkgList(role.implementations, pkgsByShort)} | ${pkgList(role.consumers, pkgsByShort)} | ${pkgList(role.companions, pkgsByShort)} | ${tableCell(role.note)} |`)
  }
  lines.push('', ...maintenanceFooter(maintenance))
  return lines.join('\n')
}
