/** Public entry point that renders the generated scoped-event resolver module. */

import { resolve } from 'node:path'
import { ScopedEventGenerator } from './gen-scoped-events-analysis.ts'
import { TypeScriptProject } from './ts-project.ts'

/** Repository root carrying `tsconfig.host.json`. */
export const repositoryRoot = resolve(import.meta.dirname, '..')

/**
 * Render the generated scoped-event resolver module for one repository root.
 * @param projectRoot - repository root carrying tsconfig.host.json.
 * @returns complete generated TypeScript source.
 */
export function renderScopedEvents(projectRoot: string = repositoryRoot): string {
  return new ScopedEventGenerator(new TypeScriptProject(projectRoot)).render()
}
