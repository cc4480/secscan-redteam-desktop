/**
 * scoped-slots-factory-kit — contiguous range of the former scoped-slots.tsx, moved verbatim.
 * Public entry point stays ./scoped-slots.tsx.
 */

import {
  useEffect, useMemo, useRef, type FC,
} from 'react'
import {
  type ScopedStandardSourceBinding, type SlotRendererHost, type StandardSourceBinding, type StoredFactory,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  observableHook, useHost, useRootBinding,
} from './bindings.tsx'
import {
  SlotAssemblyError,
} from './errors.ts'
import {
  InjectedProps, FactoryRenderOwner, boundRenderFactorySlot, boundFactoryRenderSlot, boundFactoryRenderSlotChain, runInject,
} from './scoped-slots-binding-cache.tsx'
import {
  localeSeat, useLocaleRevision,
} from './scoped-slots-inject.tsx'
import {
  sessionGenerationKeyOf,
} from './scoped-slots-entry-keys.tsx'
import {
  standardProps, scopeAreaProvider,
} from './scoped-slots-standard.tsx'
import {
  FactoryOccurrenceValue, FactoryOccurrenceContext, useFactorySlotRuntime,
} from './scoped-slots-factory-runtime.tsx'


export function assertNoPropOverlap(owner: string, provided: InjectedProps, received: object): void {
  for (const name of Object.keys(received)) {
    if (Object.hasOwn(provided, name)) {
      throw new SlotAssemblyError(`${owner} received duplicate prop '${name}'`)
    }
  }
}

export function factoryKit(
  host: SlotRendererHost,
  definition: StoredFactory,
  rootBinding: StandardSourceBinding,
  scopeBinding: StandardSourceBinding | undefined,
  occurrence: object,
): { kit: InjectedProps; registrationKit: InjectedProps; actions: object | undefined } {
  const standard = standardProps(definition.scope, rootBinding, scopeBinding)
  const registrationKit: InjectedProps = { renderFactorySlot: boundRenderFactorySlot(definition) }
  if (definition.locale !== undefined) {
    const face = host.locale
    if (face === undefined) {
      throw new SlotAssemblyError(
        `factory declares locale namespace '${definition.locale}' but no locale face is installed`)
    }
    registrationKit['t'] = localeSeat(face, definition.locale)
  }
  const scoped = scopeBinding?.key === undefined ? undefined : scopeBinding as ScopedStandardSourceBinding
  const store = host.factoryStoreOf(definition, scoped, occurrence)
  if (store !== undefined) {
    registrationKit['useStore'] = observableHook(store)
    registrationKit['actions'] = store.actions
  }
  if (definition.children !== undefined) {
    registrationKit['renderSlot'] = boundFactoryRenderSlot(host, definition)
    if (Object.values(definition.children).some(spec => spec.kind === 'chain')) {
      registrationKit['renderSlotChain'] = boundFactoryRenderSlotChain(host, definition)
    }
    if (Object.values(definition.children).some(spec => spec.scope !== 'root')) {
      const sessionAdapter = host.scope('session')
      if (sessionAdapter === undefined) {
        throw new SlotAssemblyError("factory declares a session child without an installed 'session' scope adapter")
      }
      registrationKit['SessionProvider'] = scopeAreaProvider(sessionAdapter)
    }
  }
  return { kit: { ...standard, ...registrationKit }, registrationKit, actions: store?.actions }
}

export interface FactoryOccurrenceProps {
  definition: StoredFactory
  inputProps: object
  selected: Readonly<Record<string, FC<InjectedProps>>>
  caller: FactoryRenderOwner
}

export function FactoryOccurrence({ definition, inputProps, selected, caller, binding, maybeEpoch }: FactoryOccurrenceProps & {
  binding: StandardSourceBinding
  maybeEpoch: number
}) {
  if (definition.scope === 'root') {
    return <FactoryOccurrenceBody definition={definition} inputProps={inputProps} selected={selected} caller={caller} />
  }
  if (definition.scope === 'session') {
    if (binding.key === undefined) {
      throw new SlotAssemblyError(`strict session factory '${definition.name}' rendered without a scope binding`)
    }
    return (
      <FactoryOccurrenceBody
        key={sessionGenerationKeyOf(binding as ScopedStandardSourceBinding)}
        definition={definition}
        inputProps={inputProps}
        selected={selected}
        caller={caller}
        scopeBinding={binding}
      />
    )
  }
  return (
    <FactoryOccurrenceBody
      key={maybeEpoch}
      definition={definition}
      inputProps={inputProps}
      selected={selected}
      caller={caller}
      scopeBinding={binding}
    />
  )
}

export function FactoryOccurrenceBody({
  definition, inputProps, selected, caller, scopeBinding,
}: FactoryOccurrenceProps & { scopeBinding?: StandardSourceBinding | undefined }) {
  const host = useHost()
  const rootBinding = useRootBinding()
  const occurrence = useRef<object>({}).current
  const localeRevision = useLocaleRevision(host.locale)
  useEffect(
    () => host.retainFactoryOccurrence(definition, occurrence),
    [definition, host, occurrence],
  )
  const { kit, registrationKit, actions } = useMemo(
    () => factoryKit(host, definition, rootBinding, scopeBinding, occurrence),
    [definition, host, localeRevision, occurrence, rootBinding, scopeBinding],
  )
  const injected = useMemo(
    () => runInject(definition, scopeBinding, actions),
    [actions, definition, scopeBinding],
  )
  assertNoPropOverlap(`factory '${definition.name}' inject`, kit, injected)
  const provided = { ...kit, ...injected, useFactorySlot: useFactorySlotRuntime }
  assertNoPropOverlap(`factory '${definition.name}' occurrence`, provided, inputProps)
  const context = useMemo<FactoryOccurrenceValue>(() => ({
    host,
    definition,
    selected,
    registrationKit: { ...registrationKit, ...injected },
    rootBinding,
    caller,
  }), [caller, definition, host, injected, registrationKit, rootBinding, selected])
  const Comp = definition.component as FC<InjectedProps>
  return (
    <FactoryOccurrenceContext.Provider value={context}>
      <Comp {...provided} {...inputProps} />
    </FactoryOccurrenceContext.Provider>
  )
}
