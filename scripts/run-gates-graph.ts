/**
 * Dependency-graph validation for one aggregate: unknown ids, duplicate ids,
 * and dependency cycles.
 */
import type { Gate } from './run-gates-types.ts'

/**
 * Reject a gate list whose graph cannot be executed unambiguously.
 * @param gates - complete aggregate to validate.
 */
export function validateGateGraph(gates: readonly Gate[]): void {
  if (gates.length === 0) throw new Error('run-gates: gate graph has no gates.')

  const ids = new Set<string>()
  for (const gate of gates) {
    if (ids.has(gate.id)) throw new Error(`run-gates: duplicate gate id ${JSON.stringify(gate.id)}.`)
    ids.add(gate.id)
  }
  for (const gate of gates) {
    for (const dependency of gate.needs ?? []) {
      if (!ids.has(dependency)) {
        throw new Error(`run-gates: gate ${JSON.stringify(gate.id)} depends on unknown gate ${JSON.stringify(dependency)}.`)
      }
    }
    for (const predecessor of gate.after ?? []) {
      if (!ids.has(predecessor)) {
        throw new Error(`run-gates: gate ${JSON.stringify(gate.id)} waits for unknown gate ${JSON.stringify(predecessor)}.`)
      }
    }
  }

  const cycle = findDependencyCycle(gates)
  if (cycle !== undefined) throw new Error(`run-gates: dependency cycle: ${cycle.join(' -> ')}.`)
}

/**
 * Find the first dependency cycle reachable from any gate.
 * @param gates - aggregate whose needs/after edges are walked.
 * @returns the cycle as an id path, or undefined when the graph is acyclic.
 */
export function findDependencyCycle(gates: readonly Gate[]): string[] | undefined {
  const byId = new Map(gates.map(gate => [gate.id, gate]))
  const complete = new Set<string>()
  const active = new Map<string, number>()
  const path: string[] = []

  const visit = (id: string): string[] | undefined => {
    if (complete.has(id)) return undefined
    const cycleStart = active.get(id)
    if (cycleStart !== undefined) return [...path.slice(cycleStart), id]
    const gate = byId.get(id)
    if (gate === undefined) return undefined

    active.set(id, path.length)
    path.push(id)
    for (const predecessor of [...(gate.needs ?? []), ...(gate.after ?? [])]) {
      const cycle = visit(predecessor)
      if (cycle !== undefined) return cycle
    }
    path.pop()
    active.delete(id)
    complete.add(id)
    return undefined
  }

  for (const gate of gates) {
    const cycle = visit(gate.id)
    if (cycle !== undefined) return cycle
  }
  return undefined
}
