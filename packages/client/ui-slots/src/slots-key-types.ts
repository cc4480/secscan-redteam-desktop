/**
 * Accessors that project one declared slot's owner, entry key, props, hooks,
 * inject face, and scope out of its definition.
 */
import type { SlotMap } from './slots-definition-types.ts'

/** Owner-supplied props share for a slot key ({} for entries declaring no `owner`). */
export type OwnerOf<K extends keyof SlotMap & string> =
  SlotMap[K] extends { owner: infer O extends object } ? O : object

/** Registration/dispatch key domain of one keyed slot. */
export type EntryKeyOf<K extends keyof SlotMap & string> =
  SlotMap[K] extends { kind: 'keyed'; keyProps: infer P extends object }
    ? keyof P & string
    : string

/** Key-dependent props supplied by the owner at one keyed dispatch site. */
export type KeyPropsOf<
  K extends keyof SlotMap & string,
  EntryKey extends EntryKeyOf<K>,
> = SlotMap[K] extends { kind: 'keyed'; keyProps: infer P extends object }
  ? EntryKey extends keyof P
    ? P[EntryKey] extends object ? P[EntryKey] : never
    : never
  : object

/** Opaque per-render occurrence context declared by one slot. */
export type HookContextOf<K extends keyof SlotMap & string> =
  SlotMap[K] extends { hookContext: infer Context } ? Context : never

/** Common render-occurrence inject face declared by one slot. */
export type SlotInjectOf<K extends keyof SlotMap & string> =
  SlotMap[K] extends { inject: infer Injected extends object } ? Injected : object

/** Scope axis of a slot key's SlotMap entry. */
export type ScopeOf<K extends keyof SlotMap & string> = SlotMap[K]['scope']
