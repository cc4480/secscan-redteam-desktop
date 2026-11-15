/**
 * Collect the scanned package sources of one project and the event relations
 * resolved from them.
 */

import { EventRelationCollector } from './gen-doc-graphs-event-collector.ts'
import { root, type EventRelation, type PackageSource } from './gen-doc-graphs-shared.ts'
import { TypeScriptProject } from './ts-project.ts'

/**
 * Select the package source files of one project in deterministic order.
 * @param project - the loaded repository TypeScript project.
 * @returns `packages/<group>/<pkg>/src` files tagged with their package name.
 */
export function collectPackageSources(project: TypeScriptProject): PackageSource[] {
  return project.sourceFiles().flatMap((sourceFile): PackageSource[] => {
    const rel = project.relativePath(sourceFile)
    const match = /^packages\/[^/]+\/([^/]+)\/src\/.+\.ts$/.exec(rel)
    return match?.[1] ? [{ rel, pkg: match[1], sourceFile }] : []
  }).sort((left, right) => left.rel.localeCompare(right.rel))
}

/** Resolve every event relation from one program seeded at the repository root. */
export function collectEventRelations(): Map<string, EventRelation> {
  const project = new TypeScriptProject(root)
  return new EventRelationCollector(project, collectPackageSources(project)).collect()
}
