/**
 * scoped-slots-standard — contiguous range of the former scoped-slots.tsx, moved verbatim.
 * Public entry point stays ./scoped-slots.tsx.
 */

import {
  useSyncExternalStore, type ReactNode,
} from 'react'
import {
  type ScopedStandardSourceBinding, type SessionAreaProps, type SessionProviderComponent, type SlotRendererHost, type SlotScope, type SlotScopeAdapter, type StandardSourceBinding, type StoredEntry,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  ScopeBindingProvider, observableHook, useScopeBinding,
} from './bindings.tsx'
import {
  SlotAssemblyError,
} from './errors.ts'
import {
  InjectedProps, boundRenderFactorySlot, boundRenderSlot, boundRenderSlotChain,
} from './scoped-slots-binding-cache.tsx'
import {
  localeSeat,
} from './scoped-slots-inject.tsx'
import {
  rootStandardCache, sessionStandardCache, sessionMaybeStandardCache, materializeStandardBinding,
} from './scoped-slots-entry-keys.tsx'

/** Stable official-props object used by contextual Hook factories. */
export function standardProps(
  scope: SlotScope,
  rootBinding: StandardSourceBinding,
  scopeBinding: StandardSourceBinding | undefined,
): InjectedProps {
  let root = rootStandardCache.get(rootBinding)
  if (root === undefined) {
    root = materializeStandardBinding(rootBinding, false)
    rootStandardCache.set(rootBinding, root)
  }
  if (scope === 'root') return root
  if (scopeBinding === undefined) throw new SlotAssemblyError(`scope '${scope}' rendered without a standard-source binding`)
  const cache = scope === 'session' ? sessionStandardCache : sessionMaybeStandardCache
  let perScope = cache.get(rootBinding)
  if (perScope === undefined) {
    perScope = new WeakMap()
    cache.set(rootBinding, perScope)
  }
  let standard = perScope.get(scopeBinding)
  if (standard !== undefined) return standard
  standard = {
    ...materializeStandardBinding(rootBinding, false, scopeBinding.key),
    ...materializeStandardBinding(scopeBinding, scope === 'session-maybe'),
  }
  perScope.set(scopeBinding, standard)
  return standard
}

export const scopeAreaCache = new WeakMap<SlotScopeAdapter, SessionProviderComponent>()

/** Bind one domain-owned scope area renderer to the current scope binding. */
export function scopeAreaProvider(adapter: SlotScopeAdapter): SessionProviderComponent {
  let Provider = scopeAreaCache.get(adapter)
  if (Provider !== undefined) return Provider
  if (adapter.renderArea === undefined) {
    throw new SlotAssemblyError("scope 'session' adapter does not provide its area renderer")
  }
  const renderArea = adapter.renderArea.bind(adapter)
  Provider = function ScopeAreaProvider(props: SessionAreaProps): ReactNode {
    const inherited = useScopeBinding()
    const explicit = Object.hasOwn(props, 'session')
    const source = adapter.bindingSource(props.session)
    const resolved = useSyncExternalStore(
      listener => source.subscribe(listener),
      () => source.getSnapshot(),
      () => source.getSnapshot(),
    )
    const binding = explicit ? resolved : inherited
    return (
      <ScopeBindingProvider binding={binding}>
        {renderArea(binding, props)}
      </ScopeBindingProvider>
    )
  }
  scopeAreaCache.set(adapter, Provider)
  return Provider
}

/**
 * Standard-kit synthesis shared by both scope branches: the global
 * useSessions/useWorkspaces hooks, the per-session provide bundle (every
 * `hooks` source becomes a `use<Name>` selector hook — useSession is the
 * runtime's own 'session' contribution, no special case — and `props` spread
 * verbatim), the store pair when declared, the renderSlot binding when
 * children are declared, and the SessionProvider seat when the children
 * declare a session-scope slot. Hosts hand out BARE observable sources
 * (hooks never cross the host contract); every hook is bound HERE, cached
 * per source (observableHook), so spreading a fresh kit object per render
 * never churns child subscriptions.
 */
export function standardKit(
  host: SlotRendererHost,
  entry: StoredEntry,
  scope: SlotScope,
  rootBinding: StandardSourceBinding,
  scopeBinding: StandardSourceBinding | undefined,
): {
  kit: InjectedProps
  standard: InjectedProps
  actions: object | undefined
} {
  const standard = standardProps(scope, rootBinding, scopeBinding)
  const kit: InjectedProps = { ...standard, renderFactorySlot: boundRenderFactorySlot(entry) }
  if (entry.locale !== undefined) {
    const face = host.locale
    // Loud assembly failure: locale is immediately-tier infrastructure; a
    // declared namespace with no installed face is a miswired composition.
    if (face === undefined) {
      throw new SlotAssemblyError(
        `entry declares locale namespace '${entry.locale}' but no locale face is installed (locale plugin missing from the composition?)`)
    }
    kit['t'] = localeSeat(face, entry.locale)
  }
  const scopedStoreBinding = scopeBinding?.key === undefined
    ? undefined
    : scopeBinding as ScopedStandardSourceBinding
  const store = host.storeOf(entry, scopedStoreBinding)
  if (store !== undefined) {
    // The instance IS an observable snapshot source (contract getSnapshot/
    // subscribe); the useStore hook binds here, cached per instance.
    kit['useStore'] = observableHook(store)
    kit['actions'] = store.actions
  }
  if (entry.children !== undefined) {
    kit['renderSlot'] = boundRenderSlot(host, entry)
    // renderSlotChain rides the same declaration source: only entries whose
    // children include a chain-kind slot receive the chain dispatch seat.
    if (Object.values(entry.children).some(spec => spec.kind === 'chain')) {
      kit['renderSlotChain'] = boundRenderSlotChain(host, entry)
    }
    // The session owner supplies area semantics; the renderer only binds its
    // adapter to the current generic scope source.
    if (Object.values(entry.children).some(spec => spec.scope !== 'root')) {
      const adapter = host.scope('session')
      if (adapter === undefined) {
        throw new SlotAssemblyError("entry declares a session child without an installed 'session' scope adapter")
      }
      kit['SessionProvider'] = scopeAreaProvider(adapter)
    }
  }
  return { kit, standard, actions: store?.actions }
}
