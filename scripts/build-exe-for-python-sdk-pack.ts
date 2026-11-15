/**
 * Target packaging and native sidecars for the Python SDK executable builder.
 */

import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { copyOfficeSidecar } from './build-exe-for-python-sdk-office.ts'
import { Target, type BuildCli } from './build-exe-for-python-sdk-cli.ts'
import { OUT_DIR, OUTPUT_BASENAME, root } from './build-exe-for-python-sdk-config.ts'
import { runPnpm } from './build-exe-for-python-sdk-pnpm.ts'
import { resolveLinuxNodePtyAddon, resolveWindowsNodePtyAddons } from './build-exe-for-python-sdk-native-pty.ts'
import { preparePrimaryRuntime, smokePrimaryRuntime, type PrimaryRuntimeTarget } from './primary-runtime/prepare.ts'

const outDir = resolve(root, OUT_DIR)

/**
 * Package one target; SEA mode accepts one target per invocation.
 * @param cli - the parsed configuration, which owns dry-run mode.
 * @param staging - the deployed closure to package.
 * @param target - the pkg target triple to build.
 * @returns the executable, resource directories, ripgrep, and required macOS spawn helper paths.
 */
export async function pack(cli: BuildCli, staging: string, target: Target): Promise<string[]> {
  const productBase = join(outDir, `${OUTPUT_BASENAME}-${target.platform}-${target.arch}`)
  const product = target.platform === 'win' ? `${productBase}.exe` : productBase
  await prepareNativePty(cli, staging, target)
  if (!cli.dryRun) await mkdir(outDir, { recursive: true })
  await runPnpm(cli, `pkg ${target.spec}`, [
    'exec',
    'pkg',
    staging,
    '--sea',
    '--targets',
    target.spec,
    '--output',
    product,
  ])
  if (!cli.dryRun && !existsSync(product)) {
    throw new Error(`build-exe-for-python-sdk: product ${product} is missing after the pkg run; inspect ${outDir}.`)
  }
  const office = `${productBase}-office`
  if (cli.dryRun) {
    console.log(`build-exe-for-python-sdk: [dry-run] copy Office dependency closure from ${staging} to ${office}`)
  } else {
    const platform = target.platform === 'macos' ? 'darwin' : target.platform === 'win' ? 'win32' : target.platform
    const packages = await copyOfficeSidecar(staging, office, { platform, arch: target.arch })
    console.log(`build-exe-for-python-sdk: copied ${packages.length} Office packages to ${office}`)
  }
  const ripgrep = await copyRipgrepSidecar(cli, staging, target, product)
  const resources = join(outDir, `${target.platform}-${target.arch}`)
  const runtimeTarget = `${target.platform === 'macos' ? 'mac' : target.platform}-${target.arch}` as PrimaryRuntimeTarget
  if (cli.dryRun) {
    console.log(`build-exe-for-python-sdk: [dry-run] prepare Python and Office skills for ${runtimeTarget} in ${resources}`)
  } else {
    const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string }
    await preparePrimaryRuntime({ target: runtimeTarget, output: resources,
      cache: join(tmpdir(), 'dsh-primary-runtime-downloads'), version })
    smokePrimaryRuntime(join(resources, 'primary-runtime'))
  }
  if (target.platform !== 'macos') return [product, ripgrep, office, resources]
  const spawnHelper = `${product}-spawn-helper`
  const source = join(staging, 'node_modules', 'node-pty', 'prebuilds', `darwin-${target.arch}`, 'spawn-helper')
  if (cli.dryRun) {
    console.log(`build-exe-for-python-sdk: [dry-run] cp ${source} ${spawnHelper}`)
  } else {
    await copyFile(source, spawnHelper)
    await chmod(spawnHelper, 0o755)
  }
  return [product, ripgrep, spawnHelper, office, resources]
}

/**
 * Copy the target ripgrep binary beside the executable so Node can spawn it outside pkg's virtual filesystem.
 * @param cli - the parsed configuration, which owns dry-run mode.
 * @param staging - the deployed closure holding the ripgrep package.
 * @param target - the pkg target whose ripgrep binary is copied.
 * @param product - the packaged executable path.
 * @returns the ripgrep sidecar path.
 */
async function copyRipgrepSidecar(cli: BuildCli, staging: string, target: Target, product: string): Promise<string> {
  const platform = target.platform === 'macos' ? 'darwin' : target.platform === 'win' ? 'win32' : target.platform
  const executable = target.platform === 'win' ? 'rg.exe' : 'rg'
  const source = join(
    staging,
    'node_modules',
    '@vscode',
    `ripgrep-${platform}-${target.arch}`,
    'bin',
    executable,
  )
  const destination = target.platform === 'win'
    ? `${product.slice(0, -'.exe'.length)}-rg.exe`
    : `${product}-rg`
  if (cli.dryRun) {
    console.log(`build-exe-for-python-sdk: [dry-run] cp ${source} ${destination}`)
    return destination
  }
  if (!existsSync(source)) {
    throw new Error(`build-exe-for-python-sdk: target ripgrep binary is missing at ${source}.`)
  }
  await copyFile(source, destination)
  await chmod(destination, 0o755)
  return destination
}

/**
 * Put the target node-pty addon in the staged closure. The release workflow
 * provides a manylinux build; ordinary installs use node-pty's target prebuild.
 * @param cli - the parsed configuration, which owns dry-run mode.
 * @param staging - the deployed closure holding node-pty.
 * @param target - the pkg target whose native addon is being staged.
 */
async function prepareNativePty(cli: BuildCli, staging: string, target: Target): Promise<void> {
  const stagedBuild = join(staging, 'node_modules', 'node-pty', 'build')
  if (cli.dryRun) console.log(`build-exe-for-python-sdk: [dry-run] rm -rf ${stagedBuild}`)
  else await rm(stagedBuild, { recursive: true, force: true })
  const packageDirectory = join(
    root,
    'packages',
    'subprocess',
    'subprocess-local',
    'node_modules',
    'node-pty',
  )
  if (target.platform === 'win') {
    if (target.arch !== 'x64') {
      throw new Error('build-exe-for-python-sdk: Windows supports x64 only.')
    }
    const host = Target.host()
    if (target.platform !== host.platform || target.arch !== host.arch) {
      throw new Error(
        'build-exe-for-python-sdk: build the Windows runtime under x64 Node on its target host; '
        + `target ${target.platform}-${target.arch} does not match host ${host.platform}-${host.arch}.`,
      )
    }
    resolveWindowsNodePtyAddons(join(staging, 'node_modules', 'node-pty'), target.arch)
    return
  }
  if (target.platform !== 'linux') return
  const destination = join(stagedBuild, 'Release', 'pty.node')
  const source = resolveLinuxNodePtyAddon(packageDirectory, target.arch)
  if (cli.dryRun) {
    console.log(`build-exe-for-python-sdk: [dry-run] cp ${source} ${destination}`)
    return
  }
  const host = Target.host()
  if (target.platform !== host.platform || target.arch !== host.arch) {
    throw new Error(
      'build-exe-for-python-sdk: build the Linux runtime on its target architecture; '
      + `target ${target.platform}-${target.arch} does not match host ${host.platform}-${host.arch}.`,
    )
  }
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(source, destination)
}
