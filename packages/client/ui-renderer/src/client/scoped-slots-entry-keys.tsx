/**
 * scoped-slots-entry-keys — contiguous range of the former scoped-slots.tsx, moved verbatim.
 * Public entry point stays ./scoped-slots.tsx.
 */

import {
  Component, type ReactNode,
} from 'react'
import {
  standardHookPropName, type HostObservable, type ScopedStandardSourceBinding, type StandardSourceBinding, type StoredEntry,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  keyedObservableHook, maybeObservableHook, observableHook,
} from './bindings.tsx'
import {
  SlotAssemblyError,
} from './errors.ts'
import {
  InjectedProps,
} from './scoped-slots-binding-cache.tsx'

/**
 * Entry-identity React keys for entry boundaries. An outlet renders one
 * winner per position (single/keyed/list cell head, chain election) through
 * an error boundary; without a key, a boundary that failed on entry A would
 * survive a winner change (re-election, shadowing fallback after an
 * abdication, HMR re-registration) and keep a healthy entry B blacked out.
 * Keying by entry identity remounts the boundary fresh whenever the winner
 * changes (entries are identity-stable per registration, so the key is
 * stable while the same entry stays the winner).
 */
export let nextEntryKey = 0
export const entryKeys = new WeakMap<StoredEntry, number>()

export function entryKeyOf(entry: StoredEntry): number {
  let key = entryKeys.get(entry)
  if (key === undefined) {
    key = nextEntryKey++
    entryKeys.set(entry, key)
  }
  return key
}

export let nextSessionGenerationKey = 0
export const sessionGenerationKeys = new WeakMap<object, number>()

export function sessionGenerationKeyOf(binding: ScopedStandardSourceBinding): number {
  let key = sessionGenerationKeys.get(binding.ctx)
  if (key === undefined) {
    key = nextSessionGenerationKey++
    sessionGenerationKeys.set(binding.ctx, key)
  }
  return key
}

/**
 * Per-entry isolation: one registrant crashing (component render or inject
 * factory) must not take down siblings. Assembly errors (missing providers)
 * rethrow — a miswired shell must fail loud, not degrade into fallbacks.
 * Every catch reports through `onEntryError` (the ledger's supervision
 * seam); for shadowing kinds the report abdicates the entry, the outlet
 * re-renders onto the cell's next survivor, and this boundary's crash face
 * only shows until that re-render lands (permanently once the cell is dry —
 * the outlet then owns the crash face).
 */
export class SlotErrorBoundary extends Component<
  { slotKey: string; onEntryError: (error: unknown) => void; children: ReactNode }, { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError(error: unknown): { failed: boolean } {
    if (error instanceof SlotAssemblyError) throw error
    return { failed: true }
  }
  override componentDidCatch(error: unknown): void {
    console.error(`slot entry crashed in '${this.props.slotKey}':`, error)
    this.props.onEntryError(error)
  }
  override render(): ReactNode {
    if (this.state.failed) return <div data-slot-error={this.props.slotKey} />
    return this.props.children
  }
}

/** Contain one Factory occurrence without retiring the shared definition. */
/* jscpd:ignore-start */
export class FactoryErrorBoundary extends Component<
  { name: string; onEntryError: (error: unknown) => void; children: ReactNode }, { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError(error: unknown): { failed: boolean } {
    if (error instanceof SlotAssemblyError) throw error
    return { failed: true }
  }
  override componentDidCatch(error: unknown): void {
    console.error(`slot factory occurrence crashed in '${this.props.name}':`, error)
    this.props.onEntryError(error)
  }
  override render(): ReactNode {
    if (this.state.failed) return <div data-factory-error={this.props.name} />
    return this.props.children
  }
}
/* jscpd:ignore-end */

export const rootStandardCache = new WeakMap<StandardSourceBinding, InjectedProps>()
export const sessionStandardCache = new WeakMap<StandardSourceBinding, WeakMap<StandardSourceBinding, InjectedProps>>()
export const sessionMaybeStandardCache = new WeakMap<StandardSourceBinding, WeakMap<StandardSourceBinding, InjectedProps>>()

/** Materialize one binding into stable framework Hook and plain-prop seats. */
export function materializeStandardBinding(
  binding: StandardSourceBinding,
  optional: boolean,
  defaultKey?: string,
): InjectedProps {
  const standard: InjectedProps = { ...binding.props }
  for (const [name, source] of Object.entries(binding.hooks)) {
    if (source === undefined && !optional) {
      throw new SlotAssemblyError(`strict standard hook '${name}' has no source`)
    }
    standard[standardHookPropName(name)] = optional
      ? maybeObservableHook(source)
      : observableHook(source as HostObservable<unknown>)
  }
  for (const [name, source] of Object.entries(binding.keyedHooks)) {
    if (source === undefined && !optional) {
      throw new SlotAssemblyError(`strict keyed standard hook '${name}' has no source resolver`)
    }
    standard[standardHookPropName(name)] = keyedObservableHook(source, defaultKey)
  }
  return standard
}
