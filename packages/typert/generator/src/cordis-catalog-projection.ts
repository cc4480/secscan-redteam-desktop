/**
 * The catalog entry points: analyze a workspace root once and project the
 * Cordis catalog, or collect just its events or services for consumers that
 * document relationships.
 *
 * @module @deepseek-ai/dsh-typert-generator/cordis-catalog-projection
 */

import { WorkspaceAnalyzer, WorkspaceCaches } from './analyzer.ts'
import { CordisCatalogProjector } from './cordis-catalog-projector.ts'
import type { CordisCatalogModel, CordisCatalogPolicy, EventEntry, ServiceEntry } from './cordis-catalog-model.ts'
import type { TypertFace } from './model.ts'

/**
 * Analyze the host project once and return both the model and its projection.
 * @param scanRoot - workspace root containing `tsconfig.host.json`.
 * @param policy - caller-owned type classifications and inherited Cordis data.
 * @param targetFace - Host or Client Typert face to project.
 * @returns the configured projector and its validated catalog model.
 */
export function projectCordisCatalog(scanRoot: string, policy: CordisCatalogPolicy, targetFace: TypertFace = 'host'): {
  readonly projector: CordisCatalogProjector
  readonly model: CordisCatalogModel
} {
  const caches = new WorkspaceCaches()
  const discovery = new WorkspaceAnalyzer({
    root: scanRoot,
    faces: [targetFace],
    checkDiagnostics: false,
    caches,
  }).discoverPackages()
  const packages = discovery.filter(candidate => candidate.faces.includes(targetFace))
    .map(candidate => candidate.package)
  const workspace = new WorkspaceAnalyzer({
    root: scanRoot,
    faces: [targetFace],
    packages,
    checkDiagnostics: false,
    caches,
  }).analyzeInBatches()
  const face = workspace.faces.find(candidate => candidate.face === targetFace)
  if (face === undefined) throw new Error(`gen-cordis-catalog: Typert produced no ${targetFace} face`)
  const sourceDeclarations = new WorkspaceAnalyzer({
    root: scanRoot,
    faces: [targetFace],
    checkDiagnostics: false,
    caches,
  }).indexSourceDeclarations()
  const projector = new CordisCatalogProjector(face, sourceDeclarations, policy)
  return { projector, model: projector.project() }
}

/**
 * Collect all modeled events for relationship-document consumers.
 * @param scanRoot - workspace root containing `tsconfig.host.json`.
 * @param policy - caller-owned Cordis catalog policy.
 * @returns all validated event entries.
 */
export function collectEvents(scanRoot: string, policy: CordisCatalogPolicy): EventEntry[] {
  return [...projectCordisCatalog(scanRoot, policy).model.events]
}

/**
 * Collect all modeled services for relationship-document consumers.
 * @param scanRoot - workspace root containing `tsconfig.host.json`.
 * @param policy - caller-owned Cordis catalog policy.
 * @returns all validated service entries.
 */
export function collectServices(scanRoot: string, policy: CordisCatalogPolicy): ServiceEntry[] {
  return [...projectCordisCatalog(scanRoot, policy).model.services]
}
