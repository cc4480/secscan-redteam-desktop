/** Command-line surface: usage text and the command dispatch for the baseline pipeline. */

import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ReleaseBundle } from './publish-npm-baseline-bundle.ts'
import { CommandRunner } from './publish-npm-baseline-command.ts'
import { BaselinePackager } from './publish-npm-baseline-pack.ts'
import { RegistryPublication } from './publish-npm-baseline-registry.ts'

const DEFAULT_REGISTRY = 'https://registry.npm.harnessment.com'
const DEFAULT_OUTPUT_DIRECTORY = '.artifacts/npm-baseline'

function printUsage(): void {
  console.log(`Usage:
  pnpm exec tsx scripts/publish-npm-baseline.ts pack [options]
  pnpm exec tsx scripts/publish-npm-baseline.ts release [options] [--yes]
  pnpm exec tsx scripts/publish-npm-baseline.ts publish --manifest <path> [--yes]
  pnpm exec tsx scripts/publish-npm-baseline.ts verify --manifest <path>

Pack/release options:
  --ref <git-ref>       Git commit to stage (default: HEAD)
  --registry <url>      npm registry (default: ${DEFAULT_REGISTRY})
  --output-dir <path>   Artifact root (default: ${DEFAULT_OUTPUT_DIRECTORY})
  --yes                 pack/release without waiting for Enter`)
}

/** Dispatch the command named on the command line. */
export async function main(): Promise<void> {
  const command = process.argv[2]
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    printUsage()
    return
  }
  if (process.argv.slice(3).some(value => value === '--help' || value === '-h')) {
    printUsage()
    return
  }
  const runner = new CommandRunner()
  const repositoryRoot = runner.capture('git', ['rev-parse', '--show-toplevel'], process.cwd())

  if (command === 'pack' || command === 'release') {
    const { values } = parseArgs({
      args: process.argv.slice(3),
      options: {
        ref: { type: 'string', default: 'HEAD' },
        registry: { type: 'string', default: DEFAULT_REGISTRY },
        'output-dir': { type: 'string', default: resolve(repositoryRoot, DEFAULT_OUTPUT_DIRECTORY) },
        yes: { type: 'boolean', default: false },
      },
      strict: true,
    })
    const packager = new BaselinePackager(repositoryRoot, runner)
    const plan = packager.plan({
      ref: values.ref,
      registry: values.registry,
      outputDirectory: resolve(values['output-dir']),
    })
    await plan.confirm(values.yes)
    const bundle = packager.pack(plan)
    if (command === 'release') {
      await new RegistryPublication(bundle, runner).publish(values.yes)
    }
    return
  }

  if (command === 'publish' || command === 'verify') {
    const { values } = parseArgs({
      args: process.argv.slice(3),
      options: {
        manifest: { type: 'string' },
        yes: { type: 'boolean', default: false },
      },
      strict: true,
    })
    if (values.manifest === undefined) throw new Error(`${command} requires --manifest`)
    if (command === 'verify' && values.yes) throw new Error('verify does not accept --yes')
    const bundle = ReleaseBundle.load(values.manifest, runner)
    const publication = new RegistryPublication(bundle, runner)
    if (command === 'publish') await publication.publish(values.yes)
    else publication.verify()
    return
  }

  throw new Error(`unknown command: ${command}`)
}
