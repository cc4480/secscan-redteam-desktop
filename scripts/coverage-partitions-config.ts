/** Per-partition Vitest config source and the canonicalizing coverage reporter. */

/**
 * Reporter that canonicalizes a partition's coverage locations before its blob
 * is serialized (see scripts/coverage-canonical-locations.ts). Root-relative in
 * POSIX spelling because every child runs with the repository root as its
 * working directory on every platform.
 */
export const CANONICAL_LOCATIONS_REPORTER = './scripts/coverage-canonical-locations.ts'

/**
 * Source of one partition's temporary Vitest config: the workspace config
 * with `test.include` narrowed to the partition's file list, per project.
 * The config sits under `coverage/.partitioned/`, so the workspace config is
 * two directories up, and the partition processes run with cwd at the
 * repository root (Vite resolves the relative include patterns against it).
 * Each project keeps only the files that belong to it: the projects are
 * mutually exclusive, so handing the whole partition list to every project
 * would run plain files twice (once per project).
 */
export function partitionConfigSource(
  files: readonly string[],
  projectOf: ReadonlyMap<string, string>,
): string {
  const threadSafe = JSON.stringify(files.filter(file => projectOf.get(file) !== 'process-bound').map(file => file.split('\\').join('/')))
  const processBound = JSON.stringify(files.filter(file => projectOf.get(file) === 'process-bound').map(file => file.split('\\').join('/')))
  return [
    "import base from '../../vitest.config.ts'",
    'export default {',
    '  ...base,',
    '  test: {',
    '    ...base.test,',
    '    projects: (base.test.projects ?? []).map(project => ({',
    '      ...project,',
    '      test: {',
    '        ...project.test,',
    '        include: project.test.name === \'process-bound\' ? ' + processBound + ' : ' + threadSafe + ',',
    '      },',
    '    })),',
    '  },',
    '}',
    '',
  ].join('\n')
}
