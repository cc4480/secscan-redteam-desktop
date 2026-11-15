/**
 * scoped-slots-inject — contiguous range of the former scoped-slots.tsx, moved verbatim.
 * Public entry point stays ./scoped-slots.tsx.
 */

import {
  useSyncExternalStore,
} from 'react'
import {
  standardHookPropName, type LocaleFace, type StandardSourceBinding, type StoredEntry, type Translate,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  InjectedProps, SlotHookFactories, rootInjectCache, sessionInjectCache, sessionMaybeInjectCache, runInject,
} from './scoped-slots-binding-cache.tsx'

/** Bind deferred slot-level factories for one stable renderSlot occurrence. */
export function bindSlotHookFactories(
  factories: SlotHookFactories,
  standard: InjectedProps,
  hookContext: unknown,
): InjectedProps {
  const hooks: InjectedProps = {}
  for (const [name, factory] of Object.entries(factories)) {
    const hookName = standardHookPropName(name)
    hooks[hookName] = factory(standard, hookContext)
  }
  return hooks
}

export function cachedRootInject(entry: StoredEntry, actions: object | undefined): InjectedProps {
  let props = rootInjectCache.get(entry)
  if (!props) {
    props = runInject(entry, undefined, actions)
    rootInjectCache.set(entry, props)
  }
  return props
}

export function cachedSessionInject(entry: StoredEntry, binding: StandardSourceBinding, actions: object | undefined): InjectedProps {
  let perBinding = sessionInjectCache.get(entry)
  if (!perBinding) {
    perBinding = new WeakMap()
    sessionInjectCache.set(entry, perBinding)
  }
  let props = perBinding.get(binding)
  if (!props) {
    props = runInject(entry, binding, actions)
    perBinding.set(binding, props)
  }
  return props
}

export function cachedSessionMaybeInject(
  entry: StoredEntry,
  binding: StandardSourceBinding,
  actions: object | undefined,
): InjectedProps {
  let perBinding = sessionMaybeInjectCache.get(entry)
  if (!perBinding) {
    perBinding = new WeakMap()
    sessionMaybeInjectCache.set(entry, perBinding)
  }
  let props = perBinding.get(binding)
  if (!props) {
    props = runInject(entry, binding, actions)
    perBinding.set(binding, props)
  }
  return props
}

/**
 * Locale `t` seat bindings, cached per (face, namespace, revision). The
 * revision is part of the cache key ON PURPOSE: a locale switch mints a NEW
 * function reference per namespace, so `React.memo` components taking `t`
 * re-render through ordinary shallow comparison — freshness rides identity,
 * no extra invalidation channel. Within one revision the reference is stable
 * (memoized children do not churn on unrelated re-renders).
 */
export const localeSeatCache = new WeakMap<LocaleFace, Map<string, { revision: number; t: Translate }>>()

export function localeSeat(face: LocaleFace, ns: string): Translate {
  let perNs = localeSeatCache.get(face)
  if (!perNs) {
    perNs = new Map()
    localeSeatCache.set(face, perNs)
  }
  const revision = face.getSnapshot().revision
  const cached = perNs.get(ns)
  if (cached && cached.revision === revision) return cached.t
  const bound = face.bind(ns)
  // Fresh wrapper per revision: bind() itself may return a stable reference.
  const t: Translate = (key, params) => bound(key, params)
  perNs.set(ns, { revision, t })
  return t
}

export const noopSubscribe = (): (() => void) => () => {}
export const zeroRevision = (): number => 0

/**
 * Per-face subscribe/getSnapshot closure pair. Cached by face identity: the
 * face is one global source shared by every outlet, and uSES resubscribes
 * whenever the subscribe reference changes — fresh closures per render would
 * churn one unsubscribe/resubscribe pair per outlet per render.
 */
export const localeSubscriptionCache = new WeakMap<LocaleFace, {
  subscribe: (fn: () => void) => () => void
  getRevision: () => number
}>()

export function localeSubscription(face: LocaleFace): { subscribe: (fn: () => void) => () => void; getRevision: () => number } {
  let cached = localeSubscriptionCache.get(face)
  if (!cached) {
    cached = {
      subscribe: fn => face.subscribe(fn),
      getRevision: () => face.getSnapshot().revision,
    }
    localeSubscriptionCache.set(face, cached)
  }
  return cached
}

/**
 * Subscribe an outlet to the installed locale face's revision (0 while none
 * is installed — exactly one uSES call either way, keeping hook order
 * stable). Every outlet re-renders on a locale switch; entry bodies then
 * re-derive their `t` seat at the new revision. The face must be installed
 * before the first render that needs it — a face appearing later has no
 * notification channel to already-mounted outlets.
 */
export function useLocaleRevision(face: LocaleFace | undefined): number {
  const subscription = face !== undefined ? localeSubscription(face) : undefined
  return useSyncExternalStore(
    subscription?.subscribe ?? noopSubscribe,
    subscription?.getRevision ?? zeroRevision,
  )
}
