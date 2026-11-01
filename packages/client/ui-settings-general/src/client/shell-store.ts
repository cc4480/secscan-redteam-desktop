/**
 * Settings shell viewing state, shared by this package's two registrations
 * for the settings surface: the sidebar trigger row (`sidebar.settings`) and
 * the panel (`shell.overlay`). Open state and the active section id live in
 * a store rather than in either component because three seats write them —
 * the trigger opens, the onboarding coordinator opens to a named section,
 * and the panel selects and closes — from different registrations.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** The settings panel's viewing state. */
type SettingsShellState = {
  /** Whether the settings panel is open in the shell overlay layer. */
  open: boolean
  /** The nav-selected section id; undefined lets the panel fall back to the first section. */
  activeId: string | undefined
}

/** Annotation twin of the actions literal below; drift fails assignability at the defineStore call. */
type SettingsShellActions = {
  setOpen: (draft: SettingsShellState, open: boolean) => void
  select: (draft: SettingsShellState, id: string) => void
  openSection: (draft: SettingsShellState, id: string) => void
  close: (draft: SettingsShellState) => void
}

/**
 * Create the settings shell store handle. One handle is constructed in
 * apply and passed to both registrations, so the framework's per-handle
 * instance cache gives the trigger and the panel the same live instance.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createSettingsShellStore(): EngineStoreHandle<SettingsShellState, SettingsShellActions> {
  return defineStore({
    init: (): SettingsShellState => ({ open: false, activeId: undefined }),
    actions: {
      setOpen: (draft, open) => { draft.open = open },
      select: (draft, id) => { draft.activeId = id },
      openSection: (draft, id) => {
        draft.activeId = id
        draft.open = true
      },
      close: (draft) => {
        draft.open = false
        draft.activeId = undefined
      },
    },
  })
}
