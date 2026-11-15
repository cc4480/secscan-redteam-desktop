/** The real workspace surface: every declared slot collected with a teachable contract. */

import { describe, expect, it } from 'vitest'
import { collectSlotEntries } from './gen-client-catalog.ts'

describe('the real workspace surface', () => {
  it('collects every declared slot with a teachable contract', { timeout: 30_000 }, () => {
    const entries = collectSlotEntries(process.cwd())
    expect(entries.length).toBeGreaterThan(30)
    for (const entry of entries) {
      expect(entry.summary, `${entry.key} has no summary`).not.toBe('')
      expect(['single', 'list', 'keyed', 'chain']).toContain(entry.kind)
      expect(['root', 'session', 'session-maybe']).toContain(entry.scope)
    }
    // The frame root is the canonical trap: occupied by the shipped app frame,
    // so a dynamic package registering there replaces the whole UI.
    const root = entries.find(entry => entry.key === 'root')
    expect(root?.replaceRisk).toBe('shadows-shipped-ui')
    expect(root?.occupants.join(' ')).toContain('AppFrame')
    expect(entries.find(entry => entry.key === 'conversation.session')?.declaredBy)
      .toContain("factory 'conversation.content' (client-ui-conversation)")
    const tool = entries.find(entry => entry.key === 'tool.call.toolview')!
    const owner = tool.ownerProps.join('\n')
    for (const field of ['callId', 'toolName', 'useDisclosure', 'cwd', 'home', 'openFile', 'loadImage', 'inspect']) {
      expect(owner).toMatch(new RegExp(`\\b${field}\\??:`))
    }
    for (const phase of ['preparing', 'start', 'result']) expect(owner).toContain(`phase: '${phase}'`)
    expect(owner).not.toContain('truncated')
    expect(tool.ownerPropsReferences).not.toContain('ToolCallCommonProps')
    expect(tool.ownerPropsReferences).not.toContain('ToolCallPhaseProps')
  })
})
