/**
 * scoped-slots-factory-runtime — contiguous range of the former scoped-slots.tsx, moved verbatim.
 * Public entry point stays ./scoped-slots.tsx.
 */

import {
  createContext, useContext, useMemo, useState, type FC, type ReactNode,
} from 'react'
import {
  SlotOwnershipError, StaleAuthorizationError, type ScopedStandardSourceBinding, type SlotRendererHost, type StandardSourceBinding, type StoredEntry, type StoredFactory,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  useHost, useRootBinding, useScopeBinding,
} from './bindings.tsx'
import {
  SlotAssemblyError,
} from './errors.ts'
import {
  InjectedProps, BoundSlotInject, FactoryRenderOwner, boundRenderFactorySlot,
} from './scoped-slots-binding-cache.tsx'
import {
  cachedRootInject,
} from './scoped-slots-inject.tsx'
import {
  sessionGenerationKeyOf, FactoryErrorBoundary,
} from './scoped-slots-entry-keys.tsx'
import {
  standardProps, standardKit,
} from './scoped-slots-standard.tsx'
import {
  renderEntry,
} from './scoped-slots-entry-render.tsx'
import {
  assertNoPropOverlap,
} from './scoped-slots-factory-kit.tsx'

/** Adoption bookkeeping of one session-maybe outlet (see SessionMaybeEntry). */
export interface MaybeIncarnation {
  /** Session generation this incarnation adopted; undefined while born blank and unadopted. */
  readonly adopted: object | undefined
  /** Incarnation counter — the child key; bumps exactly when an incarnation dies. */
  readonly epoch: number
}

export const FIRST_INCARNATION: MaybeIncarnation = { adopted: undefined, epoch: 0 }

export function useMaybeIncarnation(binding: StandardSourceBinding): number {
  const identity = binding.key === undefined
    ? undefined
    : (binding as ScopedStandardSourceBinding).ctx
  // The child key is an incarnation counter, NOT the session id: adoption
  // must keep the key constant across undefined → first id. Bookkeeping
  // lives in this stable (unkeyed) wrapper via the render-phase setState
  // form (React's sanctioned derived-state pattern: setState during render
  // of the same component re-renders once before children mount, and the
  // guard conditions make it convergent — StrictMode-safe).
  const [state, setState] = useState<MaybeIncarnation>(FIRST_INCARNATION)
  let { adopted, epoch } = state
  if (identity !== undefined && adopted === undefined) {
    // Adoption: same epoch — no remount.
    adopted = identity
    setState({ adopted, epoch })
  } else if (adopted !== undefined && identity !== undefined && identity !== adopted) {
    // Post-adoption session switch: next incarnation, born already adopted.
    adopted = identity
    epoch += 1
    setState({ adopted, epoch })
  } else if (adopted !== undefined && identity === undefined) {
    // Back to no-session: next incarnation, born blank (adopts anew later).
    adopted = undefined
    epoch += 1
    setState({ adopted, epoch })
  }
  return epoch
}

export function RootEntry({ entry, ownerProps, slotKey, slotInjected, hookContext, hasHookContext }: {
  entry: StoredEntry
  ownerProps: object
  slotKey: string
  slotInjected: BoundSlotInject
  hookContext: unknown
  hasHookContext: boolean
}) {
  const host = useHost()
  const rootBinding = useRootBinding()
  const Comp = entry.component as FC<InjectedProps>
  const { kit, standard, actions } = standardKit(host, entry, 'root', rootBinding, undefined)
  const injected = cachedRootInject(entry, actions)
  return renderEntry(slotKey, Comp, kit, standard, injected, slotInjected, ownerProps, hookContext, hasHookContext)
}

export interface FactoryOccurrenceValue {
  readonly host: SlotRendererHost
  readonly definition: StoredFactory
  readonly selected: Readonly<Record<string, FC<InjectedProps>>>
  readonly registrationKit: InjectedProps
  readonly rootBinding: StandardSourceBinding
  readonly caller: FactoryRenderOwner
}

export const FactoryOccurrenceContext = createContext<FactoryOccurrenceValue | null>(null)
export const FactoryAncestryContext = createContext<ReadonlySet<string>>(new Set())
export const EMPTY_FACTORY_SELECTION: Readonly<Record<string, FC<InjectedProps>>> = {}

export function useFactorySlotRuntime(name: string, fallback: FC<InjectedProps>): FC<InjectedProps> {
  const occurrence = useContext(FactoryOccurrenceContext)
  if (occurrence === null) throw new SlotAssemblyError('useFactorySlot() called outside a Factory occurrence')
  if (!occurrence.host.isFactoryLive(occurrence.definition)) {
    throw new StaleAuthorizationError(`useFactorySlot('${name}') from a disposed Factory`)
  }
  const declared = occurrence.definition.slots?.[name]
  if (declared === undefined) {
    throw new SlotOwnershipError(`local slot '${name}' is not declared by factory '${occurrence.definition.name}'`)
  }
  const selected = occurrence.selected[name]
  const Selected = selected ?? fallback
  const usesFallback = selected === undefined
  const { definition, host } = occurrence
  return useMemo(function bindFactoryLocalComponent() {
    return function BoundFactoryLocalComponent(localProps: InjectedProps): ReactNode {
      const current = useContext(FactoryOccurrenceContext)
      const localScopeBinding = useScopeBinding()
      const localMaybeEpoch = useMaybeIncarnation(localScopeBinding)
      if (!host.isFactoryLive(definition)) {
        throw new StaleAuthorizationError(`local slot '${name}' from a disposed Factory`)
      }
      if (current === null || current.definition !== definition) {
        throw new SlotOwnershipError(`local slot '${name}' rendered outside factory '${definition.name}'`)
      }
      if (declared.scope === 'session' && localScopeBinding.key === undefined) {
        throw new SlotAssemblyError(
          `strict session local slot '${name}' from factory '${definition.name}' rendered without a scope binding`)
      }
      const localOwner = usesFallback ? definition : current.caller
      const localScopeIdentity = declared.scope === 'root'
        ? 'root'
        : declared.scope === 'session'
          ? `session:${sessionGenerationKeyOf(localScopeBinding as ScopedStandardSourceBinding)}`
          : `session-maybe:${localMaybeEpoch}`
      const localStandard = standardProps(declared.scope, current.rootBinding, localScopeBinding)
      const localRegistrationKit = {
        ...current.registrationKit,
        renderFactorySlot: boundRenderFactorySlot(localOwner),
      }
      assertNoPropOverlap(`factory '${definition.name}' local slot '${name}'`, localRegistrationKit, localStandard)
      const provided = { ...localRegistrationKit, ...localStandard }
      assertNoPropOverlap(`factory '${definition.name}' local slot '${name}'`, provided, localProps)
      return (
        <FactoryErrorBoundary
          key={`${definition.name}:${name}:${localScopeIdentity}`}
          name={`${definition.name}:${name}`}
          onEntryError={(error) => { host.reportFactoryError(definition.name, localOwner, error) }}
        >
          <Selected {...provided} {...localProps} />
        </FactoryErrorBoundary>
      )
    }
  }, [Selected, declared.scope, definition, host, name, usesFallback])
}
