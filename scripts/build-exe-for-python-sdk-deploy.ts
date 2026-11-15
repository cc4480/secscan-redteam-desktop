/**
 * Closure deployment and staged-manifest preparation for the Python SDK executable builder.
 */

import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { OFFICE_ASSET_IGNORES } from './build-exe-for-python-sdk-office.ts'
import type { BuildCli } from './build-exe-for-python-sdk-cli.ts'
import {
  ASSET_GLOBS,
  DEPLOY_ONLY_DOCS,
  DEPLOY_ROOT_PACKAGE,
  DEPLOY_SOURCE_NODE_MODULES,
  ENTRY_BIN,
  root,
} from './build-exe-for-python-sdk-config.ts'
import { runPnpm } from './build-exe-for-python-sdk-pnpm.ts'

/**
 * Clear and deploy the runtime closure into the node carrier.
 * @param cli - the parsed configuration, which owns dry-run mode.
 * @param staging - the cleared deploy target and Python node-mode carrier.
 */
export async function deployStaging(cli: BuildCli, staging: string): Promise<void> {
  if (staging === root || root.startsWith(staging + sep)) {
    throw new Error(`build-exe-for-python-sdk: refusing to clear staging dir ${staging}: it contains the repo root.`)
  }
  if (cli.dryRun) console.log(`build-exe-for-python-sdk: [dry-run] rm -rf ${staging}`)
  else await rm(staging, { recursive: true, force: true })
  await runPnpm(cli, 'deploy', [
    '--filter',
    DEPLOY_ROOT_PACKAGE,
    'deploy',
    '--legacy',
    '--prod',
    // Production deployment omits workspace tooling such as Electron's patched signer.
    '--config.allow-unused-patches=true',
    '--config.node-linker=hoisted',
    '--config.auto-install-peers=false',
    '--config.link-workspace-packages=true',
    staging,
  ])
  await restoreLegacyHoists(cli, staging)
  await materializeStagedLinks(cli, staging)
  if (cli.dryRun) {
    for (const name of DEPLOY_ONLY_DOCS) console.log(`build-exe-for-python-sdk: [dry-run] rm -f ${join(staging, name)}`)
  } else {
    await Promise.all(DEPLOY_ONLY_DOCS.map(name => rm(join(staging, name), { force: true })))
  }
}

/**
 * Restore direct packages that pnpm's legacy hoister places beside the deploy
 * source instead of in the target. The runtime manifest supplies every peer,
 * so package-local node_modules trees are omitted to preserve one flat Cordis
 * instance and a symlink-free packaged payload.
 * @param cli - the parsed configuration, which owns dry-run mode.
 * @param staging - the deployed closure root.
 */
async function restoreLegacyHoists(cli: BuildCli, staging: string): Promise<void> {
  if (cli.dryRun) {
    console.log('build-exe-for-python-sdk: [dry-run] restore direct dependencies omitted by legacy deploy')
    return
  }
  const manifestPath = join(staging, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const sourceNodeModules = resolve(root, DEPLOY_SOURCE_NODE_MODULES)
  const restored: string[] = []
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(staging, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = join(sourceNodeModules, dependency)
    if (!existsSync(source)) {
      throw new Error(
        `build-exe-for-python-sdk: deployed dependency ${dependency} is absent from both ${destination} and ${source}.`,
      )
    }
    await mkdir(dirname(destination), { recursive: true })
    const nestedNodeModules = join(source, 'node_modules')
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
    restored.push(dependency)
  }
  const stillMissing = Object.keys(manifest.dependencies ?? {})
    .filter(dependency => !existsSync(join(staging, 'node_modules', dependency)))
  if (stillMissing.length > 0) {
    throw new Error(`build-exe-for-python-sdk: staged dependencies remain missing: ${stillMissing.join(', ')}.`)
  }
  if (restored.length > 0) {
    console.log(`build-exe-for-python-sdk: restored legacy deploy hoists: ${restored.join(', ')}`)
  }
}

/**
 * Replace deploy-time package links with files and reject any remaining link.
 * @param cli - the parsed configuration, which owns dry-run mode.
 * @param staging - the deployed closure root.
 */
async function materializeStagedLinks(cli: BuildCli, staging: string): Promise<void> {
  if (cli.dryRun) {
    console.log('build-exe-for-python-sdk: [dry-run] materialize staged package links')
    return
  }
  const nodeModules = join(staging, 'node_modules')
  let remaining = await findSymlink(nodeModules)
  while (remaining !== undefined) {
    const segments = remaining.slice(nodeModules.length + 1).split(sep)
    const binIndex = segments.lastIndexOf('.bin')
    if (binIndex >= 0) {
      await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
      remaining = await findSymlink(nodeModules)
      continue
    }
    const destination = remaining
    const source = await realpath(destination)
    const nestedNodeModules = join(source, 'node_modules')
    await rm(destination, { recursive: true, force: true })
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
    remaining = await findSymlink(nodeModules)
  }
}

/**
 * Return the first symbolic link below a directory, if one exists.
 * @param directory - the directory to walk.
 * @returns the symlink path, or `undefined` when the tree holds none.
 */
async function findSymlink(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/**
 * Add the executable entry and pkg assets to the staged manifest.
 * @param cli - the parsed configuration, which owns dry-run mode.
 * @param staging - the deployed closure root.
 */
export async function injectPkgConfig(cli: BuildCli, staging: string): Promise<void> {
  const patch = { bin: ENTRY_BIN, pkg: { assets: ASSET_GLOBS, ignore: OFFICE_ASSET_IGNORES } }
  const manifestPath = join(staging, 'package.json')
  if (cli.dryRun) {
    console.log(`build-exe-for-python-sdk: [dry-run] patch ${manifestPath} with ${JSON.stringify(patch)}`)
    return
  }
  if (!existsSync(manifestPath)) {
    throw new Error(`build-exe-for-python-sdk: ${manifestPath} missing — pnpm deploy did not produce a staged package.`)
  }
  if (!existsSync(join(staging, ENTRY_BIN))) {
    throw new Error(`build-exe-for-python-sdk: staged bootstrap ${join(staging, ENTRY_BIN)} is missing.`)
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
  await writeFile(manifestPath, `${JSON.stringify({ ...manifest, ...patch }, null, 2)}\n`)
  console.log(`build-exe-for-python-sdk: injected pkg config into ${manifestPath}`)
}
