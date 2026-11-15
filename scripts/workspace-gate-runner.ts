/** Assembly of the workspace constraint gate's checks. */

import { collectProjectReferenceFaceViolations } from './project-reference-faces.ts'
import {
  checkExperimentalDependencyIsolation,
  checkHierarchyShape,
  checkRepositoryVersion,
  checkWorkspaceProtocol,
} from './workspace-gate-checks.ts'
import { readWorkspaceManifests, root, workspaceManifests } from './workspace-manifest-discovery.ts'
import { checkWorkspaceManifest } from './workspace-release-checks.ts'

/** Run the repository constraint gate. */
export function main(): void {
  const manifests = readWorkspaceManifests(root)
  const errors = [
    ...checkRepositoryVersion(),
    ...workspaceManifests().flatMap(checkWorkspaceManifest),
    ...checkWorkspaceProtocol(manifests),
    ...checkExperimentalDependencyIsolation(manifests),
    ...checkHierarchyShape(),
    ...collectProjectReferenceFaceViolations(root),
  ]
  if (errors.length > 0) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  }
}
