/**
 * Factory registration and component prop derivation, plus the render-factory
 * share and its local-slot aliases.
 */
import type { HandleOf, PropsStore, StoreDecl } from '@deepseek-ai/dsh-client-store'
import type { ReactNode } from 'react'
import type {
  FactoryLocalSlotDef, SlotFactoryDef, SlotFactoryMap, SlotMap,
} from './slots-definition-types.ts'
import type { LocaleNamespaceMap, PropsLocale } from './slots-locale-types.ts'
import type { PropsRenderSlots, SlotComponent } from './slots-render-props.ts'
import type { InjectFace } from './slots-hook-types.ts'
import type { ScopeStandardProps } from './slots-standard-props.ts'

export type FactoryDefOf<F extends keyof SlotFactoryMap & string> = SlotFactoryMap[F] & SlotFactoryDef

export type FactoryInputPropsOf<F extends keyof SlotFactoryMap & string> =
  SlotFactoryMap[F] extends { props: infer P extends object } ? P : object

export type FactoryChildrenOf<F extends keyof SlotFactoryMap & string> =
  SlotFactoryMap[F] extends { children: infer D extends Record<string, unknown> } ? D : Record<never, never>

export type FactoryStoreOf<F extends keyof SlotFactoryMap & string> =
  SlotFactoryMap[F] extends { store: infer H extends StoreDecl } ? HandleOf<H> : undefined

export type FactoryInjectOf<F extends keyof SlotFactoryMap & string> =
  SlotFactoryMap[F] extends { inject: infer I extends object } ? I : object

export type FactoryLocaleOf<F extends keyof SlotFactoryMap & string> =
  SlotFactoryMap[F] extends { locale: infer N extends keyof LocaleNamespaceMap & string } ? N : undefined

type FactoryLocalSlotsOf<F extends keyof SlotFactoryMap & string> =
  SlotFactoryMap[F] extends { slots: infer S extends Record<string, FactoryLocalSlotDef> }
    ? S
    : Record<never, never>

export type FactoryLocalNameOf<F extends keyof SlotFactoryMap & string> = keyof FactoryLocalSlotsOf<F> & string

export type FactoryLocalDefOf<
  F extends keyof SlotFactoryMap & string,
  N extends FactoryLocalNameOf<F>,
> = FactoryLocalSlotsOf<F>[N] & FactoryLocalSlotDef

export type FactoryLocalInputPropsOf<
  F extends keyof SlotFactoryMap & string,
  N extends FactoryLocalNameOf<F>,
> = FactoryLocalDefOf<F, N> extends { props: infer P extends object } ? P : object

export type FactoryRenderPropsOf<F extends keyof SlotFactoryMap & string> =
  [keyof FactoryChildrenOf<F> & keyof SlotMap & string] extends [never]
    ? object
    : PropsRenderSlots<keyof FactoryChildrenOf<F> & keyof SlotMap & string>

/** Framework-derived props shared by a Factory definition and its local Components. */
export type FactoryRegistrationPropsOf<F extends keyof SlotFactoryMap & string> =
  FactoryRenderPropsOf<F>
  & PropsStore<FactoryStoreOf<F>>
  & InjectFace<FactoryInjectOf<F>>
  & PropsLocale<FactoryLocaleOf<F>>
  & PropsRenderFactories

/** Complete props received by a registered Factory Component. */
export type FactoryComponentPropsOf<F extends keyof SlotFactoryMap & string> =
  FactoryInputPropsOf<F>
  & FactoryRegistrationPropsOf<F>
  & ScopeStandardProps<FactoryDefOf<F>['scope']>
  & { useFactorySlot: UseFactorySlot<F> }

/** Complete props received by one caller-selected or fallback local Component. */
export type FactoryLocalComponentPropsOf<
  F extends keyof SlotFactoryMap & string,
  N extends FactoryLocalNameOf<F>,
> = FactoryLocalInputPropsOf<F, N>
  & FactoryRegistrationPropsOf<F>
  & ScopeStandardProps<FactoryLocalDefOf<F, N>['scope']>

/** Component accepted for one declared local Factory position. */
export type FactoryLocalComponent<
  F extends keyof SlotFactoryMap & string,
  N extends FactoryLocalNameOf<F>,
> = SlotComponent<FactoryLocalComponentPropsOf<F, N>>

/**
 * Hook exposed only to a Factory definition for selecting a local Component.
 * @param name - declared local position.
 * @param fallback - Component used when the occurrence caller makes no selection.
 * @returns a stable Component accepting only the local occurrence props.
 */
export type UseFactorySlot<F extends keyof SlotFactoryMap & string> =
  <N extends FactoryLocalNameOf<F>>(
    name: N,
    fallback: FactoryLocalComponent<F, N>,
  ) => SlotComponent<FactoryLocalInputPropsOf<F, N>>

/**
 * Render one independently keyed occurrence of a registered Factory.
 * @param name - declaration-merged Factory name.
 * @param props - caller-owned occurrence input.
 * @param options - local Component selections and the missing-definition fallback.
 * @returns the Factory occurrence or fallback.
 */
export type RenderFactorySlot = <F extends keyof SlotFactoryMap & string>(
  name: F,
  props: FactoryInputPropsOf<F>,
  options?: {
    slots?: Partial<{ [N in FactoryLocalNameOf<F>]: FactoryLocalComponent<F, N> }>
    fallback?: ReactNode
  },
) => ReactNode

/** Factory rendering capability supplied to every renderer-created Component. */
export interface PropsRenderFactories {
  renderFactorySlot: RenderFactorySlot
}
