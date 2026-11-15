/** Synchronous cycle detection over the declared browser-module edges. */

import type { ClientDeclaration } from './verify-client-package-declarations.ts'

/** One declared external request between two dynamic rows. */
export interface ModuleEdge {
  readonly from: string
  readonly to: string
  readonly specifier: string
}

/**
 * Report every distinct cycle among the declared external edges.
 * @param edges - Edges whose `to` row supplies the specifier.
 * @param byName - Declarations keyed by package name, used for manifests.
 * @returns One diagnostic per distinct cycle.
 */
export function collectModuleCycles(
  edges: readonly ModuleEdge[],
  byName: ReadonlyMap<string, ClientDeclaration>,
): string[] {
  const outgoing = new Map<string, ModuleEdge[]>()
  for (const edge of [...edges].sort((left, right) => left.specifier.localeCompare(right.specifier))) {
    outgoing.set(edge.from, [...outgoing.get(edge.from) ?? [], edge])
  }
  const finished = new Set<string>()
  const onPath = new Set<string>()
  const path: ModuleEdge[] = []
  const reported = new Map<string, string>()

  const walk = (name: string): void => {
    onPath.add(name)
    for (const edge of outgoing.get(name) ?? []) {
      if (onPath.has(edge.to)) {
        const start = path.findIndex(entry => entry.from === edge.to)
        const cycle = start === -1 ? [edge] : [...path.slice(start), edge]
        const key = cycleKey(cycle)
        if (!reported.has(key)) reported.set(key, formatCycle(cycle, byName))
      } else if (!finished.has(edge.to)) {
        path.push(edge)
        walk(edge.to)
        path.pop()
      }
    }
    onPath.delete(name)
    finished.add(name)
  }

  for (const name of [...outgoing.keys()].sort()) {
    if (!finished.has(name)) walk(name)
  }
  return [...reported.values()]
}

function cycleKey(cycle: readonly ModuleEdge[]): string {
  const labels = cycle.map(edge => edge.from + ' ' + edge.specifier)
  const first = [...labels].sort()[0]
  const offset = first === undefined ? 0 : labels.indexOf(first)
  return [...labels.slice(offset), ...labels.slice(0, offset)].join(' -> ')
}

function formatCycle(
  cycle: readonly ModuleEdge[],
  byName: ReadonlyMap<string, ClientDeclaration>,
): string {
  const entry = cycle[0]
  const chain = cycle.map(edge => edge.from + ' --(' + edge.specifier + ')-->').join(' ')
  const manifest = entry === undefined ? 'packages/client' : byName.get(entry.from)?.manifest ?? entry.from
  return manifest + ': synchronous dsh.client.external cycle: ' + chain + ' ' + (entry?.from ?? '')
}
