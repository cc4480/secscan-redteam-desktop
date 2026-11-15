/** Shared temporary fixture trees and root-digest accessors for the persistence-schema suite. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach } from 'vitest'
import type { PersistenceSchemaInventory } from './persistence-schema-model.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 })
})

/** Write one source file, creating its parent directories, beneath `root`. */
export function put(root: string, file: string, source: string): void {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, source)
}

/** Create a compilable persistence fixture tree for `payload` and register it for teardown. */
export function fixture(payload: string, options: { surface?: string; event?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-persistence-schema-'))
  roots.push(root)
  put(root, 'tsconfig.host.json', JSON.stringify({ compilerOptions: {
    target: 'es2024', module: 'esnext', moduleResolution: 'bundler', strict: true, skipLibCheck: true,
    types: [], paths: {
      '@deepseek-ai/dsh-session/types': ['./packages/core/session/src/types.ts'],
      '@fixture/payload': ['./packages/domain/payload/src/types.ts'],
    },
  }, include: ['packages/**/src/**/*.ts'] }))
  put(root, 'packages/core/session/package.json', '{"name":"@deepseek-ai/dsh-session"}')
  put(root, 'packages/domain/payload/package.json', '{"name":"@fixture/payload"}')
  put(root, 'packages/session/session-persistence-jsonl/src/format.ts', "interface HeaderLine {type: 'session'; version: number; id: string; delegationDepth: number}\nexport {}\n")
  put(root, 'packages/domain/payload/src/types.ts', payload)
  put(root, 'packages/core/session/src/types.ts', `
import type { Payload } from '@fixture/payload'
export interface SessionHeader { version: 3; id: string; createdAt: number }
export interface SessionEventMap {
  /** One recorded payload. */
  'test/record': Payload
  ${options.event ?? ''}
}
export type SurfaceEventType = ${options.surface ?? 'never'}
export type SessionEvent<T extends keyof SessionEventMap = keyof SessionEventMap> = {
  [K in keyof SessionEventMap]: { type: K; seq: number; time: number; data: SessionEventMap[K] }
    & (K extends SurfaceEventType ? { surfaceOp: 'append' | { replace: number } } : { surfaceOp?: never })
}[T]
`)
  return root
}

/** Read the digest of the `name` event root in `inventory`. */
export function event(inventory: PersistenceSchemaInventory, name = 'test/record'): string {
  const root = inventory.roots.find(root => root.event === name)
  if (root === undefined) throw new Error(`missing test event ${name}`)
  return root.digest
}
