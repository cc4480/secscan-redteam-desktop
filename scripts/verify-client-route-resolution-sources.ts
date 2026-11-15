/** Browser-face discovery: every browser-side TypeScript file the Client aggregate compiles. */

import { existsSync, globSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { faceConfigs } from './ts-project.ts'
import { GATE, repositoryRoot } from './verify-client-route-resolution-rules.ts'

/**
 * Source files of every browser-side TypeScript project in the Client aggregate.
 *
 * A browser half belongs to `src/client`; a package that keeps its whole UI in
 * plain `src` is found through the project itself, which carries the Client
 * compiler shape (DOM libraries). A config the Host aggregate also compiles has
 * a host half rather than a browser-only surface, so its plain `src/` is
 * scanned only when it has no `src/client` half; that half arrives below. Every
 * such face must contribute at least one source file: a face that contributes
 * none means the aggregate's layout moved out from under this discovery, which
 * must fail loud rather than scan less.
 * @param projectRoot - repository root to discover from.
 * @returns sorted repository-relative source paths.
 */
export function browserFaceSources(projectRoot: string = repositoryRoot): string[] {
  const sources = new Set<string>()
  const add = (file: string): void => {
    const normalized = file.replaceAll('\\', '/')
    if (normalized.endsWith('.d.ts')) return
    sources.add(normalized)
  }
  const hostConfigs = faceConfigs(projectRoot, 'host').byPath

  for (const [configPath, parsed] of faceConfigs(projectRoot, 'client').byPath) {
    if (parsed.options.lib?.includes('lib.dom.d.ts') !== true) continue
    const configRoot = dirname(configPath).replaceAll('\\', '/')
    const sourceRoot = `${configRoot}/src/`
    // An aggregate or app shell (the root Client program) carries the compiler
    // shape but no `src/` tree of its own; its browser sources arrive through
    // the references and `src/client` discovery below.
    if (!existsSync(sourceRoot)) continue
    // A package the Host aggregate also compiles has a host half; when its
    // browser half is `src/client`, plain `src/` may hold the node half, and
    // `src/client` alone is scanned below. Without that half, all of `src/` is
    // the browser surface.
    if (hostConfigs.has(configPath) && existsSync(`${configRoot}/src/client`)) continue
    const faceSources = parsed.fileNames.filter((file) => {
      const normalized = file.replaceAll('\\', '/')
      return normalized.startsWith(sourceRoot) && /\.tsx?$/.test(normalized)
    })
    if (faceSources.length === 0) {
      throw new Error(
        `${GATE}: browser face ${relative(projectRoot, configPath).split(sep).join('/')} has DOM libraries but contributes no source file; discovery is broken.`,
      )
    }
    for (const file of faceSources) add(relative(projectRoot, file).split(sep).join('/'))
  }

  for (const file of globSync('packages/*/*/src/client/**/*.{ts,tsx}', { cwd: projectRoot })) {
    add(relative(projectRoot, resolve(projectRoot, file)).split(sep).join('/'))
  }

  return [...sources].sort()
}
