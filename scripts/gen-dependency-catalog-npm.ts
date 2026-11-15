/** Refresh the recorded npm resolution and rewrite the catalog artifacts. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { runCommandWithTimeout } from './benchmark-npm-resolution.ts'
import { renderCatalog, type ResolutionMetadata } from './gen-dependency-catalog-catalog.ts'
import { LOCK, METADATA, OUT, PACKAGE, REGISTRY, ROOT } from './gen-dependency-catalog-paths.ts'

/**
 * Isolate npm configuration and cache from the maintainer and invoking package manager.
 * @param temporary - Private consumer directory owned by the caller.
 * @param inherited - Environment whose non-npm settings remain available to the child.
 * @returns Complete child environment, including isolated user/global configuration and cache paths.
 */
export function createNpmResolutionEnvironment(
  temporary: string,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const userConfig = join(temporary, '.npmrc-user')
  const globalConfig = join(temporary, '.npmrc-global')
  writeFileSync(userConfig, '')
  writeFileSync(globalConfig, '')
  writeFileSync(join(temporary, '.npmrc'), `registry=${REGISTRY}\n@deepseek-ai:registry=${REGISTRY}\ninstall-strategy=hoisted\n`)
  return {
    ...Object.fromEntries(Object.entries(inherited).filter(([name]) => !name.toLowerCase().startsWith('npm_config_'))),
    npm_config_userconfig: userConfig,
    npm_config_globalconfig: globalConfig,
    npm_config_cache: join(temporary, '.npm-cache'),
    npm_config_update_notifier: 'false',
  }
}

async function runNpm(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  const result = await runCommandWithTimeout(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd, env, timeoutMs: 300_000,
  })
  if (result.timedOut || result.status !== 0) {
    throw new Error(`dependency-catalog: npm failed (timedOut=${result.timedOut}, status=${String(result.status)}): ${result.output}`)
  }
  return result.output.trim()
}

/**
 * Resolve the published CLI from the public registry in a private consumer and record it.
 * @returns Nothing; the lockfile, capture metadata, and catalog are rewritten in the repository.
 */
export async function refreshResolution(): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-dependency-catalog-'))
  try {
    writeFileSync(join(temporary, 'package.json'), `${JSON.stringify({
      name: 'dsh-dependency-catalog', version: '0.0.0', private: true, dependencies: { [PACKAGE]: 'latest' },
    }, null, 2)}\n`)
    const environment = createNpmResolutionEnvironment(temporary)
    const npm = await runNpm(['--version'], temporary, environment)
    await runNpm([
      'install', '--package-lock-only', '--lockfile-version=3', '--ignore-scripts', '--no-audit', '--no-fund',
      '--include=prod', '--include=optional', '--include=peer', '--legacy-peer-deps=false',
      '--install-strategy=hoisted', '--loglevel=error', `--registry=${REGISTRY}`,
    ], temporary, environment)
    const lock = readFileSync(join(temporary, 'package-lock.json'), 'utf8')
    const metadata: ResolutionMetadata = {
      capturedAt: new Date().toISOString(), npm, node: process.versions.node,
      platform: process.platform, arch: process.arch, registry: REGISTRY, installStrategy: 'hoisted',
    }
    const catalog = renderCatalog(JSON.parse(lock), metadata)
    mkdirSync(resolve(ROOT, dirname(LOCK)), { recursive: true })
    writeFileSync(resolve(ROOT, LOCK), lock)
    writeFileSync(resolve(ROOT, METADATA), `${JSON.stringify(metadata, null, 2)}\n`)
    writeFileSync(resolve(ROOT, OUT), catalog)
  } finally {
    await rm(temporary, { recursive: true, force: true, maxRetries: 3 })
  }
}
