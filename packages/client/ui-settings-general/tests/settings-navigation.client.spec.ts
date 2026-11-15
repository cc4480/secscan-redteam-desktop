// @vitest-environment jsdom
/**
 * ctx.settingsNavigation inside the assembled web client: apply provides
 * the face, and its calls land on the same shell store instance both
 * shell registrations render from — the trigger row's registration and
 * the panel's — so a programmatic open is the panel's own open state.
 */
import { describe, expect } from 'vitest'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import type { ISettingsNavigation } from '../src/client/index.ts'
import { SettingsNavigationController } from '../src/client/service.ts'
import type { createSettingsShellStore } from '../src/client/shell-store.ts'

type ShellHandle = ReturnType<typeof createSettingsShellStore>

const SELF = '@deepseek-ai/dsh-client-ui-settings-general'
const it = createClientTest({ roster: webApp })
/**
 * The whole roster's first boot pays the cold module transform of every
 * plugin package; measured 46s warm and 83s cold in this workspace while
 * sibling suites run concurrently, so this file allows 120s.
 */
const COLD_BOOT_TIMEOUT_MS = 120_000

describe('ui-settings-general settingsNavigation', () => {
  it('is provided by apply over the shell store instance both registrations share', async ({ start }) => {
    const c = await start()
    const navigation: ISettingsNavigation = c.ctx.settingsNavigation
    expect(navigation).toBeInstanceOf(SettingsNavigationController)
    expect(c.ctx.get('settingsNavigation')).toBe(navigation)

    // Both registrations carry the one handle, and its create() returns
    // the one instance the service delegates to (ui-layout's pattern).
    const triggerEntry = c.ctx.slots.entries('sidebar.settings')[0]!
    const panelEntry = c.ctx.slots.entries('shell.overlay').find(entry => entry.options.id === 'settings.panel')!
    expect(panelEntry.store).toBe(triggerEntry.store)
    const shell = (triggerEntry.store as ShellHandle).create()
    expect((panelEntry.store as ShellHandle).create()).toBe(shell)
    expect(shell.getSnapshot()).toEqual({ open: false, activeId: undefined })

    navigation.openSection('local-models')
    expect(shell.getSnapshot()).toEqual({ open: true, activeId: 'local-models' })

    // open() reopens with the current section unchanged.
    shell.actions.setOpen(false)
    expect(shell.getSnapshot()).toEqual({ open: false, activeId: 'local-models' })
    navigation.open()
    expect(shell.getSnapshot()).toEqual({ open: true, activeId: 'local-models' })

    await c.unload(SELF)
    await c.flush()
    expect(c.ctx.get('settingsNavigation')).toBeUndefined()
  }, COLD_BOOT_TIMEOUT_MS)
})
