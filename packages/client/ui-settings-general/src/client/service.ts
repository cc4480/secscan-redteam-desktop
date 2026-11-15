/**
 * `ctx.settingsNavigation`: what other plugins may ask of the settings shell.
 *
 * The face delegates to the shell store's declared actions over the one
 * instance the shell's two registrations render from, so a programmatic
 * open lands on the same open/active state the trigger row and the panel
 * already share. No state lives here.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createSettingsShellStore } from './shell-store.ts'

/** The shell store's bound action set (framework-baked, draft params peeled). */
type ShellActions = BoundActions<ReturnType<typeof createSettingsShellStore>>

/** Settings navigation actions exposed through ctx.settingsNavigation. */
export interface ISettingsNavigation {
  /** Open the settings panel, leaving the active section unchanged. */
  open(): void
  /**
   * Open the settings panel at a named section; an id no section registers
   * degrades to the panel's first section at render.
   * @param id - the section id to activate.
   */
  openSection(id: string): void
}

/** Cross-plugin settings navigation face (ctx.settingsNavigation). */
export class SettingsNavigationController implements ISettingsNavigation {
  /**
   * @param shell - actions of the shell store instance shared with the shell's registrations.
   */
  constructor(private readonly shell: ShellActions) {}

  /** Open the settings panel, leaving the active section unchanged. */
  open(): void {
    this.shell.setOpen(true)
  }

  /**
   * Open the settings panel at a named section.
   * @param id - the section id to activate.
   */
  openSection(id: string): void {
    this.shell.openSection(id)
  }
}
