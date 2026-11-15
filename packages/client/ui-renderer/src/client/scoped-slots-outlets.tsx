/**
 * scoped-slots-outlets — contiguous range of the former scoped-slots.tsx, moved verbatim.
 * Public entry point stays ./scoped-slots.tsx.
 */

import {
  useContext, useSyncExternalStore, type FC, type ReactNode,
} from 'react'
import {
  SlotOwnershipError, type ChainRenderOpts, type RenderOpts, type ScopedStandardSourceBinding, type StoredEntry,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  useHost, useScopeBinding,
} from './bindings.tsx'
import {
  SlotAssemblyError,
} from './errors.ts'
import {
  InjectedProps, BoundSlotInject, FactoryRenderOwner,
} from './scoped-slots-binding-cache.tsx'
import {
  useLocaleRevision,
} from './scoped-slots-inject.tsx'
import {
  sessionGenerationKeyOf, SlotErrorBoundary, FactoryErrorBoundary,
} from './scoped-slots-entry-keys.tsx'
import {
  SessionEntry,
} from './scoped-slots-entry-render.tsx'
import {
  useMaybeIncarnation, FactoryAncestryContext, EMPTY_FACTORY_SELECTION,
} from './scoped-slots-factory-runtime.tsx'
import {
  FactoryOccurrence,
} from './scoped-slots-factory-kit.tsx'
import {
  renderOutletContent,
} from './scoped-slots-outlet-content.tsx'


export function FactoryOutlet({ name, inputProps, slots: selected = EMPTY_FACTORY_SELECTION, fallback, caller }: {
  name: string
  inputProps: object
  slots?: Readonly<Record<string, FC<InjectedProps>>> | undefined
  fallback?: ReactNode
  caller: FactoryRenderOwner
}) {
  const host = useHost()
  const ancestors = useContext(FactoryAncestryContext)
  const binding = useScopeBinding()
  const maybeEpoch = useMaybeIncarnation(binding)
  const version = useSyncExternalStore(
    listener => host.subscribeFactory(name, listener),
    () => host.getFactoryVersion(name),
  )
  const definition = host.factoryOf(name)
  if (definition === undefined) return <>{fallback ?? null}</>
  if (ancestors.has(name)) throw new SlotOwnershipError(`recursive render of factory '${name}'`)
  for (const localName of Object.keys(selected)) {
    if (definition.slots?.[localName] === undefined) {
      throw new SlotOwnershipError(`local slot '${localName}' is not declared by factory '${name}'`)
    }
  }
  const nextAncestors = new Set(ancestors).add(name)
  const scopeIdentity = definition.scope === 'root'
    ? 'root'
    : definition.scope === 'session'
      ? binding.key === undefined
        ? 'session:absent'
        : `session:${sessionGenerationKeyOf(binding as ScopedStandardSourceBinding)}`
      : `session-maybe:${maybeEpoch}`
  return (
    <FactoryErrorBoundary
      key={`${name}:${version}:${scopeIdentity}`}
      name={name}
      onEntryError={(error) => { host.reportFactoryError(name, definition, error) }}
    >
      <FactoryAncestryContext.Provider value={nextAncestors}>
        <FactoryOccurrence
          definition={definition}
          inputProps={inputProps}
          selected={selected}
          caller={caller}
          binding={binding}
          maybeEpoch={maybeEpoch}
        />
      </FactoryAncestryContext.Provider>
    </FactoryErrorBoundary>
  )
}

export function StrictSessionEntry({ slotKey, entry, ownerProps, slotInjected, hookContext, hasHookContext, onEntryError }: {
  slotKey: string
  entry: StoredEntry
  ownerProps: object
  slotInjected: BoundSlotInject
  hookContext: unknown
  hasHookContext: boolean
  onEntryError: (error: unknown) => void
}) {
  const binding = useScopeBinding()
  if (binding.key === undefined) {
    throw new SlotAssemblyError(`strict session slot '${slotKey}' rendered without a scope binding`)
  }
  const scopedBinding = binding as ScopedStandardSourceBinding
  // Per-session remount rides this key; per-entry remount rides the outer
  // element's entry-identity key (the outlet's guarded() call).
  return (
    <SlotErrorBoundary slotKey={slotKey} key={sessionGenerationKeyOf(scopedBinding)} onEntryError={onEntryError}>
      <SessionEntry
        entry={entry}
        ownerProps={ownerProps}
        binding={scopedBinding}
        slotKey={slotKey}
        slotInjected={slotInjected}
        hookContext={hookContext}
        hasHookContext={hasHookContext}
      />
    </SlotErrorBoundary>
  )
}

/**
 * Anchor style shared by every outlet wrapper: `display:contents` keeps the
 * wrapper out of layout (grid/flex parents see the slot's own children), so
 * the anchor is purely addressable surface. Module-level constant — a stable
 * reference so the wrapper never diffs its style prop.
 */
export const ANCHOR_STYLE = { display: 'contents' } as const

export function SlotOutlet({ slotKey, ownerProps, opts }: {
  slotKey: string
  ownerProps: object
  opts?: (RenderOpts & ChainRenderOpts) | undefined
}) {
  const host = useHost()
  // Version tick drives entries() re-read; the host batches per microtask.
  useSyncExternalStore(
    fn => host.subscribe(slotKey, fn),
    () => host.getVersion(slotKey),
  )
  // Locale revision tick: a locale switch re-renders every outlet, and entry
  // bodies re-derive their `t` seat at the new revision (fresh identity).
  useLocaleRevision(host.locale)
  const scopeBinding = useScopeBinding()
  // Anchor contract: every slot render site exposes a stable
  // `[data-slot="<key>"]` wrapper — the addressable seam dynamic styles
  // target — and `display:contents` keeps it layout-neutral. The wrapper
  // rides the outlet, not the dispatch outcome: fallback, crash-face, and
  // undeclared-empty states all render inside it, so the anchor's presence
  // never flickers with registration churn.
  return (
    <div data-slot={slotKey} style={ANCHOR_STYLE}>
      {renderOutletContent(host, slotKey, ownerProps, opts, scopeBinding)}
    </div>
  )
}
