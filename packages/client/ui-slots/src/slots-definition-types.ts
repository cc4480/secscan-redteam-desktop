/**
 * The merge-extensible slot and factory maps, the kind/scope discriminants, and
 * the declaration a parent passes in its children object.
 */
import type { StoreDecl } from '@deepseek-ai/dsh-client-store'
import type { LocaleNamespaceMap } from './slots-locale-types.ts'

/** Slot contract table. Owners extend via declaration merging; entries are {@link SlotEntryDef}. */
export interface SlotMap {}

/** Reusable Component Factory contract table, extended through declaration merging. */
export interface SlotFactoryMap {}

/** Slot cardinality: single occupant, ordered list, key-dispatched, or selector-routed chain. */
export type SlotKind = 'single' | 'list' | 'keyed' | 'chain'

/** Slot data context: global, current-session-optional, or strict session-bound. */
export type SlotScope = 'root' | 'session-maybe' | 'session'

/** Declaration-merged explicit target types for non-root scope Providers. */
export interface SlotScopeTargetMap {}

/**
 * One SlotMap entry: kind/scope axes plus the optional owner-supplied props
 * share (`owner` is what the parent passes at its renderSlot call site; the
 * framework standard kit and the registrant's injected share never enter this
 * table — full component props compose at the component from the framework
 * shares, see {@link ComposedProps}).
 */
export interface SlotEntryDef {
  kind: SlotKind
  scope: SlotScope
  owner?: object
  /**
   * Optional keyed-entry prop table. A keyed registration contributes one
   * literal key and receives the corresponding prop share; ordinary owner
   * props remain common to every key.
   */
  keyProps?: Record<string, object>
  /**
   * Optional opaque context carried by one renderSlot occurrence. Only
   * function-valued members of the slot-level injected hooks compartment
   * receive it; the slot machinery never interprets the value.
   */
  hookContext?: unknown
  /**
   * Optional Slot-level inject face supplied by the parent registration's
   * child declaration. Every registered entry receives its bound component
   * face; child registrants do not own or replace this common capability.
   */
  inject?: object
}

/** One caller-selected Component position inside a reusable Factory. */
export interface FactoryLocalSlotDef {
  scope: SlotScope
  props?: object
}

/** Complete static definition of one reusable Component Factory. */
export interface SlotFactoryDef {
  scope: SlotScope
  props?: object
  children?: ChildrenDecl
  store?: StoreDecl
  inject?: object
  locale?: keyof LocaleNamespaceMap & string
  slots?: Record<string, FactoryLocalSlotDef>
}

/**
 * Runtime dispatch spec for one slot, recorded from a register call's
 * `children` value. The literal is compile-time checked against the SlotMap
 * entry (`SlotSpec<SlotMap[P]>` in {@link ChildrenDecl}), so kind, scope, and
 * any common inject face are declared at one point and validate each other.
 */
export type SlotSpec<E extends SlotEntryDef> = {
  kind: E['kind']
  scope: E['scope']
} & ('inject' extends keyof E
  ? E extends { inject: infer Injected extends object }
    ? { inject: Injected }
    : { inject?: object }
  : { inject?: never })

/**
 * Child-slot declaration table for register(): keys are the declared (and
 * thereby render-authorized) slot names, values are their runtime dispatch
 * specs. Declaring is claiming: the registering entry becomes the only entry
 * allowed to render these keys.
 */
export type ChildrenDecl = { [P in keyof SlotMap & string]?: SlotSpec<SlotMap[P]> }
