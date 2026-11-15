/**
 * The provide/inject hook faces: bare observable sources, the bound use<Name>
 * hooks the renderer synthesises, and the inject face a registration returns.
 */
import type { HostObservable, KeyedStandardSource } from './renderer.ts'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { SlotMap } from './slots-definition-types.ts'
import type { HookContextOf, ScopeOf } from './slots-key-types.ts'
import type {
  GlobalStandardProps, SessionMaybeStandardProps, SessionStandardProps,
} from './slots-standard-props.ts'

/**
 * Registrant hooks compartment: bare observable sources (getSnapshot +
 * subscribe pairs) supplied under the reserved `hooks` key of an entry's
 * inject face. These retain the original source-to-selector binding and do
 * not participate in render-occurrence context.
 */
export type HooksSources = Record<string, HostObservable<unknown>>

/** Registrant keyed-hooks compartment: stable key-to-observable resolvers. */
export type KeyedHooksSources = Record<string, KeyedStandardSource>

/** Selector Hook over an open family of keyed observable sources. */
export type KeyedSnapshotSelectorHook<Snapshot> = {
  /** @param key - source key. @returns the current value, or absence when the source is unavailable. */
  (key: string): Snapshot | undefined
  /**
   * @param key - source key.
   * @param selector - projection over the current keyed value.
   * @param equal - optional selected-value equality.
   * @returns the selected value.
   */
  <Selected>(
    key: string,
    selector: (value: Snapshot | undefined) => Selected,
    equal?: (left: Selected, right: Selected) => boolean,
  ): Selected
}

/** Framework-owned props visible while a slot-level contextual Hook is bound. */
export type StandardPropsOf<K extends keyof SlotMap & string> =
  (ScopeOf<K> extends 'session' ? SessionStandardProps
    : ScopeOf<K> extends 'session-maybe' ? SessionMaybeStandardProps
      : object) &
  GlobalStandardProps

/**
 * One function-valued slot-level inject.hooks member. The factory is pure and
 * returns the actual custom Hook; it must not invoke a Hook while being bound.
 */
export type SlotHookFactory<
  K extends keyof SlotMap & string,
  Hook extends (...args: never[]) => unknown,
> = (
  standard: StandardPropsOf<K>,
  hookContext: HookContextOf<K>,
) => Hook

/** Component-side Hook produced from one slot-level inject.hooks member. */
type BoundHookOf<Definition> =
  Definition extends HostObservable<infer Snapshot>
    ? SnapshotSelectorHook<Snapshot>
    : Definition extends (...args: never[]) => infer Hook
      ? Hook extends (...args: never[]) => unknown ? Hook : never
      : never

/**
 * Selector-hook share synthesized from a hooks compartment: each source
 * `name` becomes a `use<Name>` selector hook over its snapshot type.
 */
export type PropsSlotHooks<HS extends object> = {
  [N in keyof HS & string as `use${Capitalize<N>}`]:
  BoundHookOf<HS[N]>
}

/** Component-side view of a slot dispatcher's common inject face. */
export type SlotInjectFace<I extends object> =
  I extends { hooks: infer HS extends object } ? Omit<I, 'hooks'> & PropsSlotHooks<HS> : I

/** Selector-hook share synthesized from an entry inject hooks compartment. */
export type PropsHooks<HS extends HooksSources> = {
  [N in keyof HS & string as `use${Capitalize<N>}`]:
  SnapshotSelectorHook<HS[N] extends HostObservable<infer T> ? T : never>
}

/** Selector-hook share synthesized from an entry inject keyed-hooks compartment. */
export type PropsKeyedHooks<HS extends KeyedHooksSources> = {
  [N in keyof HS & string as `use${Capitalize<N>}`]: KeyedSnapshotSelectorHook<
    HS[N] extends (key: string) => HostObservable<infer T> | undefined ? T : never
  >
}

/**
 * The component-side view of an inject face: the reserved `hooks`
 * compartment (when declared) arrives as bound `use<Name>` selector hooks;
 * every other member passes through verbatim.
 */
export type InjectFace<I extends object> =
  I extends { hooks: infer HS extends HooksSources }
    ? I extends { keyedHooks: infer KS extends KeyedHooksSources }
      ? Omit<I, 'hooks' | 'keyedHooks'> & PropsHooks<HS> & PropsKeyedHooks<KS>
      : Omit<I, 'hooks'> & PropsHooks<HS>
    : I extends { keyedHooks: infer KS extends KeyedHooksSources }
      ? Omit<I, 'keyedHooks'> & PropsKeyedHooks<KS>
      : I
