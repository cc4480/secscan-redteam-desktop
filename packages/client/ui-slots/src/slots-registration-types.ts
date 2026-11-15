/**
 * What a registration stores and what the core reads back: the register and
 * register-factory signatures, the stored factory and entry records, the label
 * union, and the slot label resolver.
 */
import type { StoreDecl } from '@deepseek-ai/dsh-client-store'
import type { ReactNode } from 'react'
import type {
  ChildrenDecl, SlotEntryDef, SlotFactoryMap, SlotMap,
  SlotScope, SlotSpec,
} from './slots-definition-types.ts'
import type {
  FactoryChildrenOf, FactoryComponentPropsOf, FactoryDefOf, FactoryInjectOf,
  FactoryLocaleOf, FactoryStoreOf,
} from './slots-factory-types.ts'
import type {
  FactoryChildrenCheck, FactoryCollisionCheck, FactoryField, FactoryInjectParams,
  RuntimeFactorySlots,
} from './slots-composed-props.ts'
import type { SlotComponent } from './slots-render-props.ts'
import type { EntryKeyOf } from './slots-key-types.ts'
import type { ChainSelect } from './slots-standard-props.ts'

/** Registration options checked against the complete declaration-merged Factory definition. */
export type RegisterFactoryOptions<F extends keyof SlotFactoryMap & string> = {
  name: F
  scope: FactoryDefOf<F>['scope']
} & FactoryField<F, 'children', FactoryChildrenOf<F>>
  & FactoryField<F, 'store', FactoryStoreOf<F> | (() => FactoryStoreOf<F>)>
  & FactoryField<F, 'inject', (...args: FactoryInjectParams<F>) => FactoryInjectOf<F>>
  & FactoryField<F, 'locale', FactoryLocaleOf<F>>
  & FactoryField<F, 'slots', RuntimeFactorySlots<F>>
  & FactoryCollisionCheck<F>
  & FactoryChildrenCheck<F>

/**
 * Typed registration method implemented by the renderer-owned SlotRegistry service.
 * @param options - runtime values checked against the Factory declaration.
 * @param component - reusable definition Component.
 * @returns an idempotent definition disposer.
 */
export interface RegisterFactory {
  <F extends keyof SlotFactoryMap & string>(
    options: RegisterFactoryOptions<F>,
    component: SlotComponent<FactoryComponentPropsOf<F>>,
  ): () => void
}

/** Type-erased Factory definition stored by the runtime registry. */
export interface StoredFactory {
  readonly name: string
  readonly component: unknown
  readonly scope: SlotScope
  readonly children?: Readonly<Record<string, SlotSpec<SlotEntryDef>>> | undefined
  readonly store?: StoreDecl | undefined
  readonly inject?: ((...args: never[]) => Record<string, unknown>) | undefined
  readonly locale?: string | undefined
  readonly slots?: Readonly<Record<string, { scope: SlotScope }>> | undefined
  /** Diagnostics label of who registered the definition. */
  readonly registrant?: string | undefined
}

/**
 * A list-entry display label: a plain string, or a thunk re-evaluated per
 * read so registration-time text (nav rows, tabs) follows the active locale
 * without re-registration. Owners resolve through {@link resolveSlotLabel}.
 */
export type SlotLabel = string | (() => string)

/**
 * Kind shape fields carried in register options (keyed dispatch key; list
 * id/order/label; chain select/priority; non-chain priority = cell shadowing rank).
 */
export type KindOptions<
  K extends keyof SlotMap & string,
  EntryKey extends EntryKeyOf<K>,
  M = never,
> =
  SlotMap[K]['kind'] extends 'keyed' ? {
    key: EntryKey
    /** Cell shadowing rank (ascending, default 0, lowest renders; same key + same priority throws — see {@link SlotCore.register}). */
    priority?: number
  }
    : SlotMap[K]['kind'] extends 'list' ? {
      id: string
      order?: number
      label?: SlotLabel
      /** Cell shadowing rank (ascending, default 0, lowest renders; same id + same priority throws — see {@link SlotCore.register}). */
      priority?: number
    }
      : SlotMap[K]['kind'] extends 'chain' ? {
        /** Routing selector, mandatory on chain entries; `M` (the component's `matched` prop) infers from its return. */
        select: ChainSelect<SlotMap[K] extends { owner: infer O extends object } ? O : object, M>
        /** Explicit chain position (ascending, default 0, lower tries first); ties keep registration = assembly order. */
        priority?: number
      }
        : {
          /**
           * Cell shadowing rank (ascending, default 0, lowest renders; a
           * same-priority second registration throws — see {@link SlotCore.register}).
           */
          priority?: number
        }

/**
 * Compile-time presence check: an entry declaring children MUST consume
 * `renderSlot` (or `renderSlotChain` when its only children are chain slots)
 * — declaring is claiming; an entry that does not render its children should
 * not declare them. Evaluates to an unsatisfiable intersection member naming
 * the declared keys when violated.
 */
export type RendersCheck<C, D> =
  [keyof D & keyof SlotMap & string] extends [never] ? unknown
    : C extends (props: infer P) => ReactNode
      ? ('renderSlot' extends keyof P ? unknown
        : 'renderSlotChain' extends keyof P ? unknown
          : { 'children declared but the component consumes no renderSlot': keyof D & keyof SlotMap & string })
      : unknown

/** Common register options share (see {@link SlotCore.register} for semantics). */
export type BaseOptions<
  K extends keyof SlotMap & string,
  EntryKey extends EntryKeyOf<K>,
  D extends ChildrenDecl,
  H,
  M = never,
  N = undefined,
> = {
  /** Target slot key (the entry contributes INTO this slot). */
  name: K
  /** Child-slot declaration + render authorization + runtime spec, in one table. */
  children?: D
  /** Store seat: a shared handle (apply-constructed) or an exclusive factory (framework-called per entry x scope). */
  store?: H
  /**
   * Dictionary namespace of this entry's copy. Declaring it puts the
   * framework-synthesized `t` seat (typed to the namespace's dictionary
   * union) on the component props; rendering requires an installed locale
   * face — fails loud otherwise.
   */
  locale?: N
  /** Registrant identity label for diagnostics (the runtime Service wrapper stamps the caller's fiber name). */
  registrant?: string
} & KindOptions<K, EntryKey, M>

/**
 * One stored registration, as recorded by the core and read by the render
 * machinery (type-erased at this boundary; the registration contract already proved
 * the shares against the component).
 */
export interface StoredEntry {
  component: unknown
  options: { key?: string; id?: string; order?: number; label?: SlotLabel; priority?: number }
  /** Chain routing selector (type-erased like `inject`; present exactly on chain-slot entries). */
  select?: ((owner: never) => unknown) | undefined
  /** Registrant business face; positional params derive from the declaration (sessionId?, actions?). */
  inject?: ((...args: never[]) => Record<string, unknown>) | undefined
  /** Child-slot declaration table (declaration + authorization + runtime spec in one). */
  children?: Readonly<Record<string, SlotSpec<SlotEntryDef>>> | undefined
  /** Declared store seat (instance resolution and lifecycle live with the host machinery). */
  store?: StoreDecl | undefined
  /** Declared dictionary namespace (the render machinery synthesizes the `t` seat from it). */
  locale?: string | undefined
  /** Diagnostics label of who registered. */
  registrant?: string | undefined
}

/**
 * Resolve a possibly-thunked list label at read time (thunks follow the
 * active locale; owners projecting ledger rows call this instead of reading
 * `options.label` raw).
 * @param label - the stored label.
 * @returns the display string, or undefined when the entry declared none.
 */
export function resolveSlotLabel(label: SlotLabel | undefined): string | undefined {
  return typeof label === 'function' ? label() : label
}

/**
 * Type-erased options view the implementation works with. Optional members
 * carry explicit `| undefined`: under exactOptionalPropertyTypes the public
 * overloads (whose generics admit undefined) would otherwise fail
 * overload-to-implementation compatibility.
 */
export interface ErasedOptions {
  name: string
  key?: string | undefined
  id?: string | undefined
  order?: number | undefined
  label?: SlotLabel | undefined
  select?: ((owner: never) => unknown) | undefined
  priority?: number | undefined
  children?: Record<string, SlotSpec<SlotEntryDef>> | undefined
  store?: StoreDecl | undefined
  locale?: string | undefined
  /* oxlint-disable-next-line typescript/no-explicit-any --
   * implementation-signature position only (both public overloads type inject
   * exactly); `never[]` would fail overload-to-implementation compatibility
   * against the per-declaration InjectParams tuples. */
  inject?: ((...args: any) => Record<string, unknown>) | undefined
  registrant?: string | undefined
}

/**
 * Per-key registry record. Created on first touch; never removed (version
 * stays monotonic across redeclarations).
 */
export interface SlotRecord {
  spec: SlotSpec<SlotEntryDef> | undefined
  /** Diagnostics: which slot's entry declared this key ('(built-in)' for root). */
  declaredBy: string | undefined
  /** Live parent declaration, absent for root slots. */
  parent: string | undefined
  /** Monotonic declaration lifetime, distinct from ordinary entry mutations. */
  declarationEpoch: number
  entries: readonly StoredEntry[]
  version: number
  listeners: Set<() => void>
  declarationListeners: Set<() => void>
}

export interface FactoryRecord {
  definition: StoredFactory | undefined
  version: number
  listeners: Set<() => void>
}

export const NO_ENTRIES: readonly StoredEntry[] = Object.freeze([])
