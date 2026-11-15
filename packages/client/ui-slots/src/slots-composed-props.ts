/**
 * The composed props a registered component receives, the inject parameter
 * projection, and the collision and child-mismatch checks that reject a bad
 * registration at compile time.
 */
import type { BoundActions, HandleOf, PropsStore, StoreDecl } from '@deepseek-ai/dsh-client-store'
import type { SlotFactoryDef, SlotFactoryMap, SlotMap, SlotSpec } from './slots-definition-types.ts'
import type { EntryKeyOf, ScopeOf } from './slots-key-types.ts'
import type { PropsRuntime, ScopeStandardProps, SessionIdOf } from './slots-standard-props.ts'
import type { MatchedShare, PropsRenderSlots } from './slots-render-props.ts'
import type {
  FactoryChildrenOf, FactoryDefOf, FactoryInjectOf, FactoryInputPropsOf,
  FactoryLocalDefOf, FactoryLocalInputPropsOf, FactoryLocalNameOf, FactoryLocaleOf,
  FactoryRegistrationPropsOf, FactoryRenderPropsOf, FactoryStoreOf, PropsRenderFactories,
  UseFactorySlot,
} from './slots-factory-types.ts'
import type { InjectFace } from './slots-hook-types.ts'
import type { PropsLocale } from './slots-locale-types.ts'

/**
 * The composed component props intersection: runtime share (SlotMap) +
 * child-render share (children declaration) + store share (declared handle) +
 * the registrant's injected business face (its hooks compartment bound, see
 * {@link InjectFace}) + the locale `t` seat (declared namespace, see
 * {@link PropsLocale}). Each share derives from its single source of truth;
 * components reference this composition, never re-type it.
 */
export type ComposedProps<
  K extends keyof SlotMap & string,
  EntryKey extends EntryKeyOf<K>,
  S extends keyof SlotMap & string,
  H,
  I extends object,
  M = never,
  N = undefined,
> = PropsRuntime<K, EntryKey> & PropsRenderSlots<S> & PropsRenderFactories
  & PropsStore<H> & InjectFace<I> & MatchedShare<SlotMap[K], M> & PropsLocale<N>

/**
 * Inject factory parameter list, derived from the registration's declaration:
 * strict session slots receive a definite framework-resolved `sessionId`;
 * session-maybe slots receive the current id or `undefined`; a declared store
 * appends the baked `actions` (the same callbacks the component receives).
 * Business data access happens through the apply closure's ctx — no binding
 * object parameter exists.
 */
export type InjectParams<K extends keyof SlotMap & string, H> =
  ScopeOf<K> extends 'session'
    ? ([H] extends [StoreDecl] ? [sessionId: SessionIdOf, actions: BoundActions<HandleOf<H>>] : [sessionId: SessionIdOf])
    : ScopeOf<K> extends 'session-maybe'
      ? ([H] extends [StoreDecl]
        ? [sessionId: SessionIdOf | undefined, actions: BoundActions<HandleOf<H>> | undefined]
        : [sessionId: SessionIdOf | undefined])
      : ([H] extends [StoreDecl] ? [actions: BoundActions<HandleOf<H>>] : [])

/** Factory inject parameters use the same scope/store matrix as ordinary registrations. */
export type FactoryInjectParams<F extends keyof SlotFactoryMap & string> =
  FactoryDefOf<F>['scope'] extends 'session'
    ? ([FactoryStoreOf<F>] extends [StoreDecl]
      ? [sessionId: SessionIdOf, actions: BoundActions<FactoryStoreOf<F>>]
      : [sessionId: SessionIdOf])
    : FactoryDefOf<F>['scope'] extends 'session-maybe'
      ? ([FactoryStoreOf<F>] extends [StoreDecl]
        ? [sessionId: SessionIdOf | undefined, actions: BoundActions<FactoryStoreOf<F>> | undefined]
        : [sessionId: SessionIdOf | undefined])
      : ([FactoryStoreOf<F>] extends [StoreDecl]
        ? [actions: BoundActions<FactoryStoreOf<F>>]
        : [])

export type FactoryField<
  F extends keyof SlotFactoryMap & string,
  K extends keyof SlotFactoryDef,
  Value,
> = K extends keyof SlotFactoryMap[F] ? { [P in K]-?: Value } : { [P in K]?: never }

export type RuntimeFactorySlots<F extends keyof SlotFactoryMap & string> = {
  [N in FactoryLocalNameOf<F>]: { scope: FactoryLocalDefOf<F, N>['scope'] }
}

type FactoryInjectCollisionKeys<F extends keyof SlotFactoryMap & string> = Extract<
  keyof InjectFace<FactoryInjectOf<F>>,
  keyof (
    FactoryRenderPropsOf<F>
    & PropsStore<FactoryStoreOf<F>>
    & PropsLocale<FactoryLocaleOf<F>>
    & PropsRenderFactories
    & ScopeStandardProps<FactoryDefOf<F>['scope']>
    & { useFactorySlot: UseFactorySlot<F> }
  )
>

type FactoryInputCollisionKeys<F extends keyof SlotFactoryMap & string> = Extract<
  keyof FactoryInputPropsOf<F>,
  keyof (
    FactoryRegistrationPropsOf<F>
    & ScopeStandardProps<FactoryDefOf<F>['scope']>
    & { useFactorySlot: UseFactorySlot<F> }
  )
>

type FactoryLocalCollisionKeys<F extends keyof SlotFactoryMap & string> = {
  [N in FactoryLocalNameOf<F>]: Extract<
    keyof FactoryLocalInputPropsOf<F, N>,
    keyof (FactoryRegistrationPropsOf<F> & ScopeStandardProps<FactoryLocalDefOf<F, N>['scope']>)
  >
}[FactoryLocalNameOf<F>]

type FactoryRegistrationLocalScopeCollisionKeys<F extends keyof SlotFactoryMap & string> = {
  [N in FactoryLocalNameOf<F>]: Extract<
    keyof FactoryRegistrationPropsOf<F>,
    keyof ScopeStandardProps<FactoryLocalDefOf<F, N>['scope']>
  >
}[FactoryLocalNameOf<F>]

export type FactoryCollisionCheck<F extends keyof SlotFactoryMap & string> = [
  FactoryInjectCollisionKeys<F>
  | FactoryInputCollisionKeys<F>
  | FactoryLocalCollisionKeys<F>
  | FactoryRegistrationLocalScopeCollisionKeys<F>,
] extends [never]
  ? unknown
  : {
    'Factory declaration has overlapping prop ownership':
      FactoryInjectCollisionKeys<F>
      | FactoryInputCollisionKeys<F>
      | FactoryLocalCollisionKeys<F>
      | FactoryRegistrationLocalScopeCollisionKeys<F>
  }

type FactoryChildMismatchKeys<F extends keyof SlotFactoryMap & string> = {
  [K in keyof FactoryChildrenOf<F>]: K extends keyof SlotMap
    ? FactoryChildrenOf<F>[K] extends SlotSpec<SlotMap[K]> ? never : K
    : K
}[keyof FactoryChildrenOf<F>]

export type FactoryChildrenCheck<F extends keyof SlotFactoryMap & string> =
  [FactoryChildMismatchKeys<F>] extends [never]
    ? unknown
    : { 'Factory children must match SlotMap': FactoryChildMismatchKeys<F> }
