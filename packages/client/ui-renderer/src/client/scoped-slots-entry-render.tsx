/**
 * scoped-slots-entry-render — contiguous range of the former scoped-slots.tsx, moved verbatim.
 * Public entry point stays ./scoped-slots.tsx.
 */

import {
  useMemo, type FC, type ReactNode,
} from 'react'
import {
  type StandardSourceBinding, type StoredEntry,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  useHost, useRootBinding, useScopeBinding,
} from './bindings.tsx'
import {
  SlotAssemblyError,
} from './errors.ts'
import {
  InjectedProps, SlotHookFactories, BoundSlotInject,
} from './scoped-slots-binding-cache.tsx'
import {
  bindSlotHookFactories, cachedSessionInject, cachedSessionMaybeInject,
} from './scoped-slots-inject.tsx'
import {
  standardKit,
} from './scoped-slots-standard.tsx'
import {
  useMaybeIncarnation,
} from './scoped-slots-factory-runtime.tsx'

/**
 * One rendered entry: standard kit + cached entry inject + common slot inject
 * + owner props (owner wins). The shares are erased at this render boundary;
 * the registration and renderSlot seams already proved their contracts.
 */
export function ContextualEntry({
  slotKey, Comp, kit, standard, injected, slotInjected, ownerProps, hookContext, hasHookContext,
}: {
  slotKey: string
  Comp: FC<InjectedProps>
  kit: InjectedProps
  standard: InjectedProps
  injected: InjectedProps
  slotInjected: BoundSlotInject & { readonly slotHookFactories: SlotHookFactories }
  ownerProps: object
  hookContext: unknown
  hasHookContext: boolean
}) {
  const contextual = useMemo(
    () => {
      if (!hasHookContext) {
        throw new SlotAssemblyError(`slot '${slotKey}' has contextual injected Hooks but no hookContext`)
      }
      return bindSlotHookFactories(slotInjected.slotHookFactories, standard, hookContext)
    },
    [hasHookContext, hookContext, slotInjected.slotHookFactories, slotKey, standard],
  )
  return <Comp {...kit} {...injected} {...slotInjected.props} {...contextual} {...ownerProps} />
}

export function renderEntry(
  slotKey: string,
  Comp: FC<InjectedProps>,
  kit: InjectedProps,
  standard: InjectedProps,
  injected: InjectedProps,
  slotInjected: BoundSlotInject,
  ownerProps: object,
  hookContext: unknown,
  hasHookContext: boolean,
): ReactNode {
  if (slotInjected.slotHookFactories === undefined) {
    return <Comp {...kit} {...injected} {...slotInjected.props} {...ownerProps} />
  }
  return (
    <ContextualEntry
      slotKey={slotKey}
      Comp={Comp}
      kit={kit}
      standard={standard}
      injected={injected}
      slotInjected={slotInjected as BoundSlotInject & { readonly slotHookFactories: SlotHookFactories }}
      ownerProps={ownerProps}
      hookContext={hookContext}
      hasHookContext={hasHookContext}
    />
  )
}

export function SessionEntry({ entry, ownerProps, binding, slotKey, slotInjected, hookContext, hasHookContext }: {
  entry: StoredEntry
  ownerProps: object
  binding: StandardSourceBinding & { readonly key: string }
  slotKey: string
  slotInjected: BoundSlotInject
  hookContext: unknown
  hasHookContext: boolean
}) {
  const host = useHost()
  const rootBinding = useRootBinding()
  const Comp = entry.component as FC<InjectedProps>
  const { kit, standard, actions } = standardKit(host, entry, 'session', rootBinding, binding)
  const injected = cachedSessionInject(entry, binding, actions)
  return renderEntry(slotKey, Comp, kit, standard, injected, slotInjected, ownerProps, hookContext, hasHookContext)
}

export function SessionMaybeEntryBody({ entry, ownerProps, binding, slotKey, slotInjected, hookContext, hasHookContext }: {
  entry: StoredEntry
  ownerProps: object
  binding: StandardSourceBinding
  slotKey: string
  slotInjected: BoundSlotInject
  hookContext: unknown
  hasHookContext: boolean
}) {
  const host = useHost()
  const rootBinding = useRootBinding()
  const Comp = entry.component as FC<InjectedProps>
  const { kit, standard, actions } = standardKit(host, entry, 'session-maybe', rootBinding, binding)
  const injected = cachedSessionMaybeInject(entry, binding, actions)
  return renderEntry(slotKey, Comp, kit, standard, injected, slotInjected, ownerProps, hookContext, hasHookContext)
}

/**
 * Session-maybe identity: adoption — the ONLY behavior (there is no
 * hold-identity-forever mode). An incarnation born session-less ADOPTS the
 * first session that arrives: identity holds across that one transition
 * (undefined → first id), so a blank shell's DOM survives the moment a
 * session appears. From then on the entry behaves exactly like a strict
 * session entry: switching to a DIFFERENT session remounts (component-local
 * state must not leak between sessions), and dropping back to no-session
 * remounts into a fresh blank incarnation, which will adopt again.
 * Component-local per-session state therefore clears by construction; state
 * that must SURVIVE a switch belongs in session-bound sources (machine,
 * store, hooks) — the existing layering rule, now load-bearing.
 */
export function SessionMaybeEntry({ entry, ownerProps, slotKey, slotInjected, hookContext, hasHookContext }: {
  entry: StoredEntry
  ownerProps: object
  slotKey: string
  slotInjected: BoundSlotInject
  hookContext: unknown
  hasHookContext: boolean
}) {
  const binding = useScopeBinding()
  const epoch = useMaybeIncarnation(binding)
  return (
    <SessionMaybeEntryBody
      key={epoch}
      entry={entry}
      ownerProps={ownerProps}
      binding={binding}
      slotKey={slotKey}
      slotInjected={slotInjected}
      hookContext={hookContext}
      hasHookContext={hasHookContext}
    />
  )
}
