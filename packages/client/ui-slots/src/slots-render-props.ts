/**
 * The render-slots share: the declared children of one slot, their matched
 * owner share, the session provider shape, and the slot component signature.
 */
import type { ReactNode } from 'react'
import type { SlotEntryDef, SlotMap, SlotScopeTargetMap } from './slots-definition-types.ts'
import type { ChainKeysOf, ChainRenderOpts, RenderSlotFn } from './slots-standard-props.ts'
import type { OwnerOf, ScopeOf } from './slots-key-types.ts'

/**
 * Chain matched share: a chain-slot component receives its selector's
 * non-null result as the framework-injected `matched` prop; other kinds add
 * nothing to the composed constraint.
 */
export type MatchedShare<E extends SlotEntryDef, M> =
  E['kind'] extends 'chain' ? { matched: M } : object

/** Props of the standard-kit SessionProvider seat. */
export interface SessionAreaProps {
  /**
   * Explicit Session-scope target. Omit this property to inherit the surrounding
   * binding; pass `undefined` to establish an explicitly absent binding.
   */
  readonly session?: SlotScopeTargetMap[keyof SlotScopeTargetMap & 'session'] | undefined
  /** No-session body (also covers a current id whose session cannot be resolved). */
  empty?: (() => ReactNode) | undefined
  /** Session body; scoped entries apply their declared remount semantics. */
  children: ReactNode
}

/**
 * Framework-wired session area component. `ui-session` supplies the current
 * Controller binding through the renderer scope adapter; entries that declare
 * `session` or `session-maybe` children receive this component without importing it.
 */
export type SessionProviderComponent = (props: SessionAreaProps) => ReactNode

/**
 * Child-slot render share: `renderSlot` statically narrowed to the entry's
 * declared children keys. Delegation is plain props passing (hand
 * `props.renderSlot` down); the authorizing identity stays the registering
 * entry. `__renders` is a phantom variance anchor (never materialized):
 * generic method signatures compare loosely across differing key unions, so
 * this contravariant marker is what actually enforces "component key set ⊆
 * children declaration" at the register call site.
 */
export type PropsRenderSlots<S extends keyof SlotMap & string> = {
  /**
   * Render a declared non-chain child slot (chain keys dispatch through
   * `renderSlotChain` — their routing lives in entry selectors).
   * @param key - declared child key.
   * @param owner - owner props share for that key (decided at the render site).
   * @param opts - kind dispatch options.
   * @returns rendered node(s).
   */
  renderSlot: RenderSlotFn<Exclude<S, ChainKeysOf<S>>>
  readonly __renders?: ((key: S) => void) | undefined
} & ([ChainKeysOf<S>] extends [never] ? object : {
  /**
   * Render a declared chain child slot: entry selectors run in chain order
   * over `owner`; the first non-null match renders its component with the
   * selector result injected as `matched`; all-null renders `opts.fallback`.
   * @param key - declared chain child key.
   * @param owner - owner props share (the selectors' routing input).
   * @param opts - fallback body for the all-null case.
   * @returns rendered node(s).
   */
  renderSlotChain: <K extends ChainKeysOf<S>>(key: K, owner: OwnerOf<K>, opts?: ChainRenderOpts) => ReactNode
}) & ([Extract<ScopeOf<S>, 'session' | 'session-maybe'>] extends [never]
  ? object
  : { SessionProvider: SessionProviderComponent })

/**
 * Registration-position component shape: the bare call signature, so composed
 * constraints check through clean parameter contravariance (FC statics add
 * covariant noise rejecting legitimate narrowings).
 */
export type SlotComponent<P> = (props: P) => ReactNode
