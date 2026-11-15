/**
 * The dynamic-import cases: how the preset compiles `import()` inside a dynamic
 * Client bundle.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { build, type TsdownBundle } from 'tsdown'
import { describe, expect, it, onTestFinished } from 'vitest'
import { clientConfigs, REQUESTING_PACKAGE } from './client-bundle-purity.harness-cases.ts'

describe('client bundle dynamic imports', () => {
  it('compiles import() to the module loader asynchronous operation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-client-dynamic-import-'))
    onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
    const entry = join(root, 'lib/types/client/index.js')
    mkdirSync(dirname(entry), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: REQUESTING_PACKAGE, type: 'module' }))
    writeFileSync(entry, 'export const load = () => import("./terminal.js")\n')
    writeFileSync(join(dirname(entry), 'terminal.js'), 'export const marker = "terminal"\n')
    const config = clientConfigs()[0]
    if (config === undefined) throw new Error('client config missing')

    let builds: TsdownBundle[] = []
    try {
      builds = await build({
        ...config, cwd: root, config: false, tsconfig: false,
        write: false, clean: false, exports: false, report: false, logLevel: 'silent',
      })
      const chunks = builds.flatMap(bundle => bundle.chunks).filter(chunk => chunk.type === 'chunk')
      const output = chunks.find(chunk => chunk.fileName === 'client.js')?.code
      expect(output).toContain('require.async("./client.terminal.js")')
      expect(output).not.toContain('Promise.resolve().then(() => require("./client.terminal.js"))')
    } finally {
      for (const bundle of builds) await bundle[Symbol.asyncDispose]()
    }
  })
})
