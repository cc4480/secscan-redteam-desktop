/** The current-tree commands also run as a real CLI against an extracted source tree. */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractPersistenceSchema } from './persistence-schema.ts'
import { persistenceCatalogArtifacts } from './gen-persistence-catalog.ts'
import { verifyPersistenceChanges } from './persistence-changes.ts'
import { BASE_ID, NEXT_ID, commitCurrent, fixture, proseFile } from './persistence-changes.spec-helpers.ts'

describe('persistence changes current-tree commands', () => {
  // Six real CLI processes and TypeScript extraction share the Windows coverage test budget.
  it('executes the real CLI against a source-only temporary checkout without Git history', { timeout: 90_000 }, () => {
    const root = fixture()
    const physical = join(root, 'packages/session/session-persistence-jsonl/src')
    mkdirSync(physical, { recursive: true })
    writeFileSync(join(physical, 'format.ts'), "interface HeaderLine { type: 'session'; version: number; id: string; delegationDepth: number }; export {}\n")
    const session = join(root, 'packages/core/session/src')
    mkdirSync(session, { recursive: true })
    writeFileSync(join(session, '../package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-session' }))
    writeFileSync(join(root, 'tsconfig.host.json'), JSON.stringify({ compilerOptions: {
      target: 'ESNext', module: 'ESNext', moduleResolution: 'Bundler', types: [], skipLibCheck: true,
      paths: { '@deepseek-ai/dsh-session/types': ['./packages/core/session/src/types.ts'] },
    } }))
    const source = [
      '/** Stored header. */', 'export interface SessionHeader { version: 3; id: string }',
      '/** Stored event payloads. */', 'export interface SessionEventMap {', '/** Saved value. */',
      "'example/value': { value: string }", '}', '/** Surface event names. */', "export type SurfaceEventType = 'example/value'",
      '/** Persisted event names. */', 'export type SessionEventType = keyof SessionEventMap',
      '/** Surface placement. */', "export type SurfaceOp = 'append'", '/** Persisted event. */',
      'export type SessionEvent<K extends keyof SessionEventMap = keyof SessionEventMap> =',
      '  { [P in K]: { type: P; seq: number; data: SessionEventMap[P]; surfaceOp: SurfaceOp } }[K]', '',
    ].join('\n')
    writeFileSync(join(session, 'types.ts'), source)
    const script = resolve(import.meta.dirname, 'persistence-changes.ts')
    const cli = (...args: string[]): ReturnType<typeof spawnSync> => spawnSync(process.execPath, ['--import', import.meta.resolve('tsx/esm'), script, '--root', root, ...args], {
      cwd: root, encoding: 'utf8', timeout: 120_000,
    })
    const prose = proseFile(root)
    const initialized = cli('--baseline', BASE_ID, '--prose', prose)
    expect(initialized.error).toBeUndefined()
    expect(initialized.signal).toBeNull()
    expect(initialized.status, String(initialized.stderr)).toBe(0)
    const accepted = cli('--check')
    expect(accepted.error).toBeUndefined()
    expect(accepted.signal).toBeNull()
    expect(accepted.status, String(accepted.stderr)).toBe(0)
    const optional = source.replace('value: string', 'value: string; label?: string')
    writeFileSync(join(session, 'types.ts'), optional)
    const authored = cli('--record', NEXT_ID, '--prose', prose, '--json')
    expect(authored.error).toBeUndefined()
    expect(authored.signal).toBeNull()
    expect(authored.status, String(authored.stderr)).toBe(0)
    const authoredResult: unknown = JSON.parse(String(authored.stdout))
    expect(authoredResult).toMatchObject({ ok: true, operation: 'record' })
    const beforeUpdate = readFileSync(join(root, `docs/persistence-changes/${NEXT_ID}.md`), 'utf8')
    writeFileSync(join(session, 'types.ts'), optional.replace('label?: string', 'label?: string; extra?: number'))
    const updated = cli('--update', NEXT_ID, '--json')
    expect(updated.error).toBeUndefined()
    expect(updated.signal).toBeNull()
    expect(updated.status, String(updated.stderr)).toBe(0)
    const updatedResult: unknown = JSON.parse(String(updated.stdout))
    expect(updatedResult).toMatchObject({ ok: true, operation: 'update' })
    expect(readFileSync(join(root, `docs/persistence-changes/${NEXT_ID}.md`), 'utf8').replace(/```yaml persistence-change[\s\S]*?```/u, ''))
      .toBe(beforeUpdate.replace(/```yaml persistence-change[\s\S]*?```/u, ''))
    const generated = extractPersistenceSchema(root)
    for (const file of persistenceCatalogArtifacts(root, generated)) expect(readFileSync(join(root, file.path), 'utf8')).toBe(file.content)
    verifyPersistenceChanges(root, generated)
    writeFileSync(join(session, 'types.ts'), optional.replace('label?: string', 'label?: string; extra?: number').replace('value: string', 'value: number'))
    commitCurrent(root, extractPersistenceSchema(root))
    const rejected = cli('--check')
    expect(rejected.error).toBeUndefined()
    expect(rejected.signal).toBeNull()
    expect(rejected.status).toBe(1)
    expect(String(rejected.stderr)).toContain('version-bump required')
    const structured = cli('--check', '--json')
    expect(structured.error).toBeUndefined()
    expect(structured.signal).toBeNull()
    expect(structured.status).toBe(1)
    const structuredResult: unknown = JSON.parse(String(structured.stdout))
    expect(structuredResult).toMatchObject({
      ok: false, code: 'unacknowledged-changes', changes: [expect.objectContaining({ kind: 'type-changed', requiresVersionBump: true })],
    })
  })
})
