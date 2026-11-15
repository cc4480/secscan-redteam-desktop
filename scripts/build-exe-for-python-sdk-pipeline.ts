/**
 * Sequential build pipeline for the Python SDK executable builder.
 */

import { resolve } from 'node:path'
import type { BuildCli, Target } from './build-exe-for-python-sdk-cli.ts'
import { PYTHON_NODE_SUBDIR, PYTHON_RUNTIME_DIR, root } from './build-exe-for-python-sdk-config.ts'
import { deployStaging as deployClosure, injectPkgConfig as patchStagedManifest } from './build-exe-for-python-sdk-deploy.ts'
import { printProducts as printProductList, syncToPythonRuntime as syncProducts } from './build-exe-for-python-sdk-output.ts'
import { pack as packTarget } from './build-exe-for-python-sdk-pack.ts'
import { runPnpm } from './build-exe-for-python-sdk-pnpm.ts'

/**
 * Sequential build pipeline. Subprocesses inherit stdio and errors include
 * the command; dry runs print commands and filesystem changes.
 */
export class SingleExeBuild {
  /**
   * The cleared deploy target, pkg input, and Python node-mode carrier.
   */
  readonly staging = resolve(root, PYTHON_RUNTIME_DIR, PYTHON_NODE_SUBDIR)

  constructor(private readonly cli: BuildCli) {}

  /** Verify the closure before compiling or packaging. */
  async verifyClosure(): Promise<void> {
    await runPnpm(this.cli, 'runtime dependency closure', ['run', 'verify-runtime-closure'])
  }

  /** Build all package artifacts unless `--skip-build` was passed. */
  async build(): Promise<void> {
    if (this.cli.skipBuild) {
      console.log('build-exe-for-python-sdk: skipping pnpm run build (--skip-build)')
      return
    }
    await runPnpm(this.cli, 'build', ['run', 'build'])
  }

  /** Clear and deploy the runtime closure into the node carrier. */
  async deployStaging(): Promise<void> {
    await deployClosure(this.cli, this.staging)
  }

  /** Add the executable entry and pkg assets to the staged manifest. */
  async injectPkgConfig(): Promise<void> {
    await patchStagedManifest(this.cli, this.staging)
  }

  /**
   * Package one target; SEA mode accepts one target per invocation.
   * @param target - the pkg target triple to build.
   * @returns the executable, resource directories, ripgrep, and required macOS spawn helper paths.
   */
  async pack(target: Target): Promise<string[]> {
    return packTarget(this.cli, this.staging, target)
  }

  /**
   * Print each product path and, outside dry-run mode, its size.
   * @param products - the product paths returned by {@link pack}.
   */
  printProducts(products: string[]): void {
    printProductList(this.cli, products)
  }

  /**
   * Copy each product into the Python runtime package. The deployed node
   * carrier is already in place, and `dist-exe/` retains upload copies.
   * @param products - the product paths returned by {@link pack}.
   */
  async syncToPythonRuntime(products: string[]): Promise<void> {
    await syncProducts(this.cli, products)
  }
}
