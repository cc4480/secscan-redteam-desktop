/**
 * Settings shell contract — the types of the `sidebar.settings` occupant this
 * package renders. They live here rather than in ui-settings because they
 * reference the sidebar's own slot type: ui-settings is the settings domain's
 * base layer and must not depend on any `ui-*` presentation package, or the
 * reference graph closes a cycle through ui-sidebar → ui-layout → ui-theme.
 * The settings SLOT types (what registrants contribute) stay in ui-settings.
 */
import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-sidebar's SlotMap merge (the 'sidebar.settings' entry)
// into every program that sees this contract.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls ui-layout's SlotMap merge (the 'shell.overlay' entry the
// panel registers into) into every program that sees this contract.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the settings slot declarations the shell renders into.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DesktopUpdateView } from '../types.ts'
import type { createSettingsShellStore } from './shell-store.ts'

/** One nav row projected from a settings.section registration's options. */
export interface SettingsSectionRow {
  id: string
  order: number
  label: string
}

/** One ordered onboarding step projected from a slot registration. */
export interface SettingsOnboardingStep {
  id: string
  order: number
}

/**
 * Registrant-private injected share of the settings shell (assembled in
 * apply): connection state and ledger projections arrive as hook-compartment
 * sources, while the reconnect command remains a plain callback.
 */
export type SettingsRootInjected = {
  /** Request the current shell-owned update action. */
  openDesktopUpdate: () => void
  /** Request a fresh logical generation and physical WebSocket immediately. */
  reconnect: () => void
  hooks: {
    /** Shared Electron status for both sidebar locations. */
    desktopUpdate: HostObservable<DesktopUpdateView>
    /** Connection-owned state for the current Host connection. */
    connectionState: HostObservable<ConnectionState | undefined>
    /** settings.section ledger projected into ordered nav rows. */
    sections: HostObservable<readonly SettingsSectionRow[]>
    /** settings.onboarding ledger projected into coordinator order. */
    onboardingSteps: HostObservable<readonly SettingsOnboardingStep[]>
  }
}

/**
 * Full component props of the settings shell root: the sidebar owner share
 * (wide/rail state) plus the declared render shares and the injected face
 * (hooks compartment bound to useSections). Open state and the active
 * section id are NOT local to this component: they live in the shell store
 * this registration shares with the panel's `shell.overlay` registration,
 * because the trigger, the onboarding coordinator, and the panel all write
 * them from different seats.
 */
export type SettingsRootComponentProps =
  PropsRuntime<'sidebar.settings'>
  & PropsRenderSlots<
    | 'settings.launcher'
    | 'settings.trigger'
    | 'settings.onboarding'
  >
  & InjectFace<SettingsRootInjected>
  & PropsStore<ReturnType<typeof createSettingsShellStore>>
  & PropsLocale<'settings'>

/**
 * Full component props of the settings panel: the shell overlay owner share
 * plus the render shares for the panel's own seats, the same injected face
 * as the root (the nav rows projection), and the shared shell store.
 */
export type SettingsOverlayComponentProps =
  PropsRuntime<'shell.overlay'>
  & PropsRenderSlots<
    | 'settings.header'
    | 'settings.action'
    | 'settings.close'
    | 'settings.section'
  >
  & InjectFace<SettingsRootInjected>
  & PropsStore<ReturnType<typeof createSettingsShellStore>>
