/**
 * Product reporting and Python runtime synchronization for the Python SDK executable builder.
 */

import { statSync } from 'node:fs'
import { chmod, copyFile, cp, mkdir, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { BuildCli } from './build-exe-for-python-sdk-cli.ts'
import { PYTHON_RUNTIME_DIR, root } from './build-exe-for-python-sdk-config.ts'

/**
 * Print each product path and, outside dry-run mode, its size.
 * @param cli - the parsed configuration, which owns dry-run mode.
 * @param products - the product paths returned by {@link pack}.
 */
export function printProducts(cli: BuildCli, products: string[]): void {
  console.log(cli.dryRun ? 'build-exe-for-python-sdk: [dry-run] would produce:' : 'build-exe-for-python-sdk: products:')
  for (const path of products) {
    if (cli.dryRun) {
      console.log(`  ${path}`)
      continue
    }
    if (statSync(path).isDirectory()) {
      console.log(`  ${path}  (resource directory)`)
      continue
    }
    const megabytes = statSync(path).size / (1024 * 1024)
    console.log(`  ${path}  (${megabytes.toFixed(1)} MB)`)
  }
}

/**
 * Copy each product into the Python runtime package. The deployed node
 * carrier is already in place, and `dist-exe/` retains upload copies.
 * @param cli - the parsed configuration, which owns dry-run mode.
 * @param products - the product paths returned by {@link pack}.
 */
export async function syncToPythonRuntime(cli: BuildCli, products: string[]): Promise<void> {
  const destDir = resolve(root, PYTHON_RUNTIME_DIR)
  if (cli.dryRun) {
    for (const path of products) {
      console.log(`build-exe-for-python-sdk: [dry-run] cp ${path} ${join(destDir, basename(path))}`)
    }
    return
  }
  await mkdir(destDir, { recursive: true })
  for (const path of products) {
    const destination = join(destDir, basename(path))
    if (statSync(path).isDirectory()) {
      await rm(destination, { recursive: true, force: true })
      await cp(path, destination, { recursive: true })
    } else await copyFile(path, destination)
    await chmod(destination, statSync(path).mode & 0o777)
    console.log(`build-exe-for-python-sdk: synced ${destination}`)
  }
}
