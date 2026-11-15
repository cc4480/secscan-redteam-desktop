/**
 * The standing seats every component receives, the scope standard props, and the
 * render options and bound render-slot signature.
 */
import type { ReactNode } from 'react'
import type { SlotMap, SlotScope } from './slots-definition-types.ts'
import type {
  EntryKeyOf, HookContextOf, KeyPropsOf, OwnerOf,
  ScopeOf, SlotInjectOf,
} from './slots-key-types.ts'
import type { SlotInjectFace } from './slots-hook-types.ts'

/**
 * Framework standard kit delivered to every session-scope slot component.
 * Declared empty here (zero-dependency layer): `ui-session` merges the
 * Session lifecycle hook, projection hook, and Session identity; domain UI
 * adapters merge their own standard hooks exactly as consumers merge SlotMap keys.
 */
export interface SessionStandardProps {}

/**
 * Framework standard kit delivered to session-optional slots. Its hooks stay
 * callable while no session is selected and return `undefined` until one
 * becomes current; `ui-session` and domain UI adapters merge the concrete
 * members.
 */
export interface SessionMaybeStandardProps {}

/**
 * Framework standard kit delivered to EVERY slot component (the global seat).
 * Declared empty here; each owning UI adapter merges the global selector hooks
 * that shared page composition consumes.
 */
export interface GlobalStandardProps {}

/**
 * The session id type as `ui-session`'s SessionStandardProps merge declares it
 * (branded); falls back to `string` in programs without the merge (this
 * package's own tests).
 */
export type SessionIdOf = SessionStandardProps extends { sessionId: infer S } ? S : string

/** Standard props selected by one declared scope. */
export type ScopeStandardProps<S extends SlotScope> =
  (S extends 'session' ? SessionStandardProps
    : S extends 'session-maybe' ? SessionMaybeStandardProps
      : object) & GlobalStandardProps

/**
 * Runtime props share for a slot key: owner share (parent's renderSlot call
 * site) + session standard kit (session scope only) + the global seat.
 */
export type PropsRuntime<
  K extends keyof SlotMap & string,
  EntryKey extends EntryKeyOf<K> = EntryKeyOf<K>,
> =
  OwnerOf<K> &
  KeyPropsOf<K, EntryKey> &
  SlotInjectFace<SlotInjectOf<K>> &
  ScopeStandardProps<ScopeOf<K>>

/** renderSlot dispatch options: keyed dispatch key, list filtering, and empty fallback. */
export interface RenderOpts<EntryKey extends string = string> {
  entryKey?: EntryKey
  only?: string
  fallback?: ReactNode
  /** Type-erased runtime seat; PropsRenderSlots narrows or removes it per slot declaration. */
  hookContext?: unknown
}

/** renderSlotChain dispatch options. */
export interface ChainRenderOpts {
  /** The owner's fallback body, rendered when every entry's selector declines. */
  fallback?: ReactNode
  /** Render only the owner fallback without resolving or dispatching the chain's scope. */
  fallbackOnly?: boolean
  /**
   * Keep the fallback permanently mounted: an election hides it (wrapped,
   * display:none) instead of unmounting it, and the all-decline case shows it
   * as-is — fallback-held state (composer drafts, DOM state) survives a
   * takeover. Chain kind only; the sole consumer is the
   * `conversation.composer` chain.
   */
  overlay?: boolean
}

/**
 * Chain-entry selector: the routing decision of one chain contribution.
 * Runs at render time in chain order (ascending `priority`, default 0, lower
 * tries first; ties keep registration = assembly order); the first non-null
 * return elects its entry
 * and becomes the component's `matched` prop; `null` passes to the next
 * entry; all-null falls to the owner's {@link ChainRenderOpts} fallback.
 * MUST be pure — a function of the owner props only, no external mutable
 * reads, no side effects (the decline decision lives here, never in a
 * mounted component probing its own props).
 */
export type ChainSelect<O extends object, M> = (owner: O) => M | null

/** Keys of a slot-key union whose SlotMap entry is chain-kind (renderSlotChain's dispatch domain). */
export type ChainKeysOf<S extends keyof SlotMap & string> =
  S extends unknown ? (SlotMap[S]['kind'] extends 'chain' ? S : never) : never

/** Keys in a render share whose dispatch occurrence requires hookContext. */
type ContextualKeysOf<S extends keyof SlotMap & string> =
  S extends unknown ? (SlotMap[S] extends { hookContext: unknown } ? S : never) : never

/** Keys in a render share with the ordinary optional options bag. */
type OrdinaryKeysOf<S extends keyof SlotMap & string> = Exclude<S, ContextualKeysOf<S>>

/**
 * Plain and contextual child dispatch signatures. Keeping them as separate
 * call signatures preserves ordinary renderSlot assignability while making a
 * declared hookContext mandatory only for the Slot keys that need it.
 */
export type RenderSlotFn<S extends keyof SlotMap & string> =
  ([ContextualKeysOf<S>] extends [never] ? object : {
    <
      K extends ContextualKeysOf<S>,
      EntryKey extends EntryKeyOf<K> = EntryKeyOf<K>,
    >(
      key: K,
      owner: OwnerOf<K> & KeyPropsOf<K, NoInfer<EntryKey>>,
      opts: RenderOpts<EntryKey> & { hookContext: HookContextOf<K> },
    ): ReactNode
  }) &
  ([OrdinaryKeysOf<S>] extends [never] ? object : {
    <
      K extends OrdinaryKeysOf<S>,
      EntryKey extends EntryKeyOf<K> = EntryKeyOf<K>,
    >(
      key: K,
      owner: OwnerOf<K> & KeyPropsOf<K, NoInfer<EntryKey>>,
      opts?: Omit<RenderOpts<EntryKey>, 'hookContext'>,
    ): ReactNode
  })
