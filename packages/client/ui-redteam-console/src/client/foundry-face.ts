/**
 * The Foundry and Scope & Safety controllers. Neither polls: Foundry
 * state loads when the panel mounts (and on explicit refresh), its gate
 * actions fire only from the operator's click and settle when the
 * console's run settles; the Scope aggregate is a snapshot, refreshed on
 * mount and on demand. A panel that is not in front costs nothing.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConsoleApi } from './api.ts'
import type { FoundryActionKind, FoundryState, ScopeAggregate } from './library-model.ts'
import { createFoundryStore, createScopeStore } from './library-store.ts'
import type { FoundryPanelState, ScopePanelState } from './library-store.ts'

/* ------------------------------------------------------------------ */
/* Foundry                                                             */
/* ------------------------------------------------------------------ */

/** The face the Foundry page is injected with. */
export interface FoundryInjected {
  /** The panel's snapshot store, bound by the renderer as `useFoundry`. */
  readonly hooks: { readonly foundry: SnapshotStore<FoundryPanelState> }
  /** The page mounted: load the state. */
  start(): void
  /** The page unmounted: ignore in-flight answers. */
  stop(): void
  /** Reload the state now. */
  refresh(): void
  /**
   * Fire one gate action (verify / run-gold / loop).
   * @param kind - which action.
   */
  act(kind: FoundryActionKind): void
}

/** The controller: the face to inject, and its disposal. */
export interface FoundryController {
  readonly face: FoundryInjected
  /** The panel is going away. */
  dispose(): void
}

/**
 * Build the Foundry controller over a console API.
 * @param api - the console calls.
 * @returns the controller.
 */
export function createFoundryController(api: ConsoleApi): FoundryController {
  const instance = createFoundryStore().create()
  const actions = instance.actions
  let started = false
  let generation = 0
  let acting = false

  const load = async (): Promise<void> => {
    const mine = ++generation
    actions.loading()
    const result = await api.foundry(new AbortController().signal)
    if (!started || mine !== generation) return
    if (result.ok) actions.loaded(result.value)
    else actions.failed(result.message)
  }

  const stop = (): void => {
    started = false
    generation++
  }

  const face: FoundryInjected = {
    hooks: { foundry: instance.store },
    start() {
      if (started) return
      started = true
      void load()
    },
    stop,
    refresh() {
      void load()
    },
    act(kind) {
      if (acting) return
      acting = true
      actions.actionRunning(kind)
      void api.foundryAction(kind).then((result) => {
        acting = false
        if (!started) return
        if (!result.ok) {
          actions.actionFailed(kind, result.message)
          return
        }
        const value = result.value as { readonly ok?: boolean; readonly error?: string }
        if (value.ok === false) {
          actions.actionFailed(kind, value.error ?? 'the gate run failed')
          return
        }
        actions.actionDone(kind, result.value)
        // The loop writes store state; verify re-reads the snapshot —
        // either way the state card refreshes after a settled action.
        void load()
      })
    },
  }
  return { face, dispose: stop }
}

/* ------------------------------------------------------------------ */
/* Scope & Safety                                                      */
/* ------------------------------------------------------------------ */

/** The face the Scope & Safety page is injected with. */
export interface ScopeInjected {
  /** The panel's snapshot store, bound by the renderer as `useScope`. */
  readonly hooks: { readonly scope: SnapshotStore<ScopePanelState> }
  /** The page mounted: load the aggregate. */
  start(): void
  /** The page unmounted: ignore in-flight answers. */
  stop(): void
  /** Reload the aggregate now. */
  refresh(): void
}

/** The controller: the face to inject, and its disposal. */
export interface ScopeController {
  readonly face: ScopeInjected
  /** The panel is going away. */
  dispose(): void
}

/**
 * Build the Scope & Safety controller over a console API.
 * @param api - the console calls.
 * @returns the controller.
 */
export function createScopeController(api: ConsoleApi): ScopeController {
  const instance = createScopeStore().create()
  const actions = instance.actions
  let started = false
  let generation = 0

  const load = async (): Promise<void> => {
    const mine = ++generation
    actions.loading()
    const result = await api.scope(new AbortController().signal)
    if (!started || mine !== generation) return
    if (result.ok) actions.loaded(result.value)
    else actions.failed(result.message)
  }

  const stop = (): void => {
    started = false
    generation++
  }

  const face: ScopeInjected = {
    hooks: { scope: instance.store },
    start() {
      if (started) return
      started = true
      void load()
    },
    stop,
    refresh() {
      void load()
    },
  }
  return { face, dispose: stop }
}

export type { FoundryState, ScopeAggregate }
