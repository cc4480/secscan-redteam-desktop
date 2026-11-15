/**
 * scoped-slots-binding-cache — contiguous range of the former scoped-slots.tsx, moved verbatim.
 * Public entry point stays ./scoped-slots.tsx.
 */

import {
  type FC, type ReactNode,
} from 'react'
import {
  SlotOwnershipError, StaleAuthorizationError, standardHookPropName, type ChainRenderOpts, type HostObservable, type KeyedStandardSource, type RenderFactorySlot, type RenderOpts, type SlotRendererHost, type StandardSourceBinding, type StoredEntry, type StoredFactory,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  keyedObservableHook, observableHook,
} from './bindings.tsx'
import {
  FactoryOutlet, SlotOutlet,
} from './scoped-slots-outlets.tsx'


export type InjectedProps = Record<string, unknown>

export type SlotHookFactory = (standard: InjectedProps, hookContext: unknown) => unknown
export type SlotHookFactories = Readonly<Record<string, SlotHookFactory>>

export interface BoundSlotInject {
  readonly props: InjectedProps
  readonly slotHookFactories?: SlotHookFactories | undefined
}

export type RenderSlotBinding = (key: string, owner: object, opts?: RenderOpts) => ReactNode

export type RenderSlotChainBinding = (key: string, owner: object, opts?: ChainRenderOpts) => ReactNode

export type FactoryRenderOwner = StoredEntry | StoredFactory
export const factoryRenderCache = new WeakMap<FactoryRenderOwner, RenderFactorySlot>()

export function boundRenderFactorySlot(caller: FactoryRenderOwner): RenderFactorySlot {
  let render = factoryRenderCache.get(caller)
  if (render !== undefined) return render
  render = ((name: string, props: object, options?: {
    slots?: Readonly<Record<string, FC<InjectedProps>>>
    fallback?: ReactNode
  }) => (
    <FactoryOutlet
      name={name}
      inputProps={props}
      slots={options?.slots}
      fallback={options?.fallback}
      caller={caller}
    />
  )) as RenderFactorySlot
  factoryRenderCache.set(caller, render)
  return render
}

/**
 * Per-entry renderSlot bindings. The binding is identity-stable per entry
 * (memoized components must not resubscribe on unrelated re-renders) and dies
 * with the entry: a retained closure calling after the entry's disposal hits
 * the in-ledger check and throws.
 */
export const renderSlotCache = new WeakMap<StoredEntry, RenderSlotBinding>()

export function boundRenderSlot(host: SlotRendererHost, entry: StoredEntry): RenderSlotBinding {
  let binding = renderSlotCache.get(entry)
  if (!binding) {
    binding = (key, owner, opts) => {
      if (!host.isLive(entry)) {
        throw new StaleAuthorizationError(`renderSlot('${key}') from a disposed registration`)
      }
      // Plain-JS backstop; typed callers are narrowed to the declared keys.
      const declared = entry.children?.[key]
      if (declared === undefined) {
        throw new SlotOwnershipError(`slot '${key}' is not declared by this entry's children`)
      }
      if (declared.kind === 'chain') {
        throw new SlotOwnershipError(`slot '${key}' is declared 'chain' — use renderSlotChain`)
      }
      return <SlotOutlet slotKey={key} ownerProps={owner} opts={opts} />
    }
    renderSlotCache.set(entry, binding)
  }
  return binding
}

/**
 * Per-entry renderSlotChain bindings: identity-stable per entry (same cache
 * axis as renderSlot — a per-frame dispatch must not rebuild the binding) and
 * dead with the entry. The chain-kind check is the plain-JS backstop twin of
 * the declaration check; typed callers are narrowed to chain keys.
 */
export const renderSlotChainCache = new WeakMap<StoredEntry, RenderSlotChainBinding>()

export function boundRenderSlotChain(host: SlotRendererHost, entry: StoredEntry): RenderSlotChainBinding {
  let binding = renderSlotChainCache.get(entry)
  if (!binding) {
    binding = (key, owner, opts) => {
      if (!host.isLive(entry)) {
        throw new StaleAuthorizationError(`renderSlotChain('${key}') from a disposed registration`)
      }
      const declared = entry.children?.[key]
      if (declared === undefined) {
        throw new SlotOwnershipError(`slot '${key}' is not declared by this entry's children`)
      }
      if (declared.kind !== 'chain') {
        throw new SlotOwnershipError(`slot '${key}' is declared '${declared.kind}', not 'chain' — use renderSlot`)
      }
      return <SlotOutlet slotKey={key} ownerProps={owner} opts={opts} />
    }
    renderSlotChainCache.set(entry, binding)
  }
  return binding
}

export const factoryRenderSlotCache = new WeakMap<StoredFactory, RenderSlotBinding>()
export const factoryRenderSlotChainCache = new WeakMap<StoredFactory, RenderSlotChainBinding>()

export function boundFactoryRenderSlot(host: SlotRendererHost, definition: StoredFactory): RenderSlotBinding {
  let binding = factoryRenderSlotCache.get(definition)
  if (binding !== undefined) return binding
  binding = (key, owner, opts) => {
    if (!host.isFactoryLive(definition)) {
      throw new StaleAuthorizationError(`renderSlot('${key}') from a disposed Factory`)
    }
    const declared = definition.children?.[key]
    if (declared === undefined) throw new SlotOwnershipError(`slot '${key}' is not declared by this Factory`)
    if (declared.kind === 'chain') throw new SlotOwnershipError(`slot '${key}' is declared 'chain' — use renderSlotChain`)
    return <SlotOutlet slotKey={key} ownerProps={owner} opts={opts} />
  }
  factoryRenderSlotCache.set(definition, binding)
  return binding
}

export function boundFactoryRenderSlotChain(host: SlotRendererHost, definition: StoredFactory): RenderSlotChainBinding {
  let binding = factoryRenderSlotChainCache.get(definition)
  if (binding !== undefined) return binding
  binding = (key, owner, opts) => {
    if (!host.isFactoryLive(definition)) {
      throw new StaleAuthorizationError(`renderSlotChain('${key}') from a disposed Factory`)
    }
    const declared = definition.children?.[key]
    if (declared === undefined) throw new SlotOwnershipError(`slot '${key}' is not declared by this Factory`)
    if (declared.kind !== 'chain') {
      throw new SlotOwnershipError(`slot '${key}' is declared '${declared.kind}', not 'chain' — use renderSlot`)
    }
    return <SlotOutlet slotKey={key} ownerProps={owner} opts={opts} />
  }
  factoryRenderSlotChainCache.set(definition, binding)
  return binding
}

/**
 * Inject results cache: root entries per entry, session entries per
 * (entry x scope binding). WeakMap keys are entry/binding objects (both
 * identity-stable per registration/session scope), so cache lifetime rides
 * the same axes as the values it memoizes.
 */
export const rootInjectCache = new WeakMap<StoredEntry, InjectedProps>()
export const sessionInjectCache = new WeakMap<StoredEntry, WeakMap<StandardSourceBinding, InjectedProps>>()
export const sessionMaybeInjectCache = new WeakMap<StoredEntry, WeakMap<StandardSourceBinding, InjectedProps>>()

export const EMPTY_INJECTED_PROPS: InjectedProps = {}

export function runInject(
  entry: Pick<StoredEntry, 'inject'>,
  binding: StandardSourceBinding | undefined,
  actions: object | undefined,
): InjectedProps {
  const inject = entry.inject
  if (!inject) return EMPTY_INJECTED_PROPS
  // Declaration-derived positional arguments: sessionId for session scope,
  // baked actions when a store is declared.
  const args: unknown[] = []
  if (binding !== undefined) args.push(binding.key)
  if (actions !== undefined) args.push(actions)
  return bindInjectSources((inject as (...args: unknown[]) => InjectedProps)(...args))
}

/** Bind one entry-owned inject face on its existing cache axis. */
export function bindInjectSources(face: InjectedProps): InjectedProps {
  const sources = face['hooks']
  const keyedSources = face['keyedHooks']
  if (sources === undefined && keyedSources === undefined) return face
  const { hooks: _hooks, keyedHooks: _keyedHooks, ...rest } = face
  const bound: InjectedProps = rest
  for (const [name, source] of Object.entries(
    (sources ?? {}) as Record<string, HostObservable<unknown>>,
  )) {
    const hookName = standardHookPropName(name)
    bound[hookName] = observableHook(source)
  }
  for (const [name, source] of Object.entries(
    (keyedSources ?? {}) as Record<string, KeyedStandardSource>,
  )) {
    const hookName = standardHookPropName(name)
    bound[hookName] = keyedObservableHook(source)
  }
  return bound
}

export const slotInjectCache = new WeakMap<object, BoundSlotInject>()
export const EMPTY_SLOT_INJECT: BoundSlotInject = { props: EMPTY_INJECTED_PROPS }

/** Normalize one dispatcher-owned inject face by its stable object identity. */
export function cachedSlotInject(face: object | undefined): BoundSlotInject {
  if (face === undefined) return EMPTY_SLOT_INJECT
  let bound = slotInjectCache.get(face)
  if (bound !== undefined) return bound
  const definitions = (face as InjectedProps)['hooks']
  if (definitions === undefined) {
    bound = { props: face as InjectedProps }
    slotInjectCache.set(face, bound)
    return bound
  }
  const { hooks: _hooks, ...rest } = face as InjectedProps
  const props: InjectedProps = rest
  let factories: Record<string, SlotHookFactory> | undefined
  for (const [name, definition] of Object.entries(definitions as Record<string, unknown>)) {
    const hookName = standardHookPropName(name)
    if (typeof definition === 'function') {
      factories ??= {}
      factories[name] = definition as SlotHookFactory
    } else {
      props[hookName] = observableHook(definition as HostObservable<unknown>)
    }
  }
  bound = factories === undefined
    ? { props }
    : { props, slotHookFactories: factories }
  slotInjectCache.set(face, bound)
  return bound
}
