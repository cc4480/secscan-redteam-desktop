/**
 * scoped-slots-renderer — contiguous range of the former scoped-slots.tsx, moved verbatim.
 * Public entry point stays ./scoped-slots.tsx.
 */

import {
  useSyncExternalStore,
} from 'react'
import {
  type SlotRenderer,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  HostContext, RootStandardProvider, ScopeProvider, useHost,
} from './bindings.tsx'
import {
  SlotAssemblyError,
} from './errors.ts'
import {
  EMPTY_SLOT_INJECT,
} from './scoped-slots-binding-cache.tsx'
import {
  useLocaleRevision,
} from './scoped-slots-inject.tsx'
import {
  entryKeyOf, SlotErrorBoundary,
} from './scoped-slots-entry-keys.tsx'
import {
  RootEntry,
} from './scoped-slots-factory-runtime.tsx'
import {
  ANCHOR_STYLE,
} from './scoped-slots-outlets.tsx'

/** Root outlet: the shell's single ctx-level render entry — an unregistered 'root' is a boot-order failure, never a silent blank. */
export function RootOutlet({ ownerProps }: { ownerProps: object }) {
  const host = useHost()
  useSyncExternalStore(
    fn => host.subscribe('root', fn),
    () => host.getVersion('root'),
  )
  useLocaleRevision(host.locale)
  const entry = host.entriesOfSlot('root')[0]
  if (!entry) {
    // Registrations exist but every one abdicated: the shadowing collapse ran
    // dry, so the crash face replaces the tree (registered-but-broken is a
    // crash, not the boot-order assembly failure below).
    if (host.entriesOf('root').length > 0) return <div data-slot-error="root" />
    throw new SlotAssemblyError("renderSlot('root') before any 'root' registration (boot order)")
  }
  // Same anchor contract as SlotOutlet: 'root' is a slot like any other, and
  // display:contents keeps the wrapper out of the shell's layout.
  return (
    <div data-slot="root" style={ANCHOR_STYLE}>
      <SlotErrorBoundary
        slotKey="root"
        key={entryKeyOf(entry)}
        onEntryError={(error) => { host.reportEntryError('root', entry, error, { abdicate: true }) }}
      >
        <RootEntry
          entry={entry}
          ownerProps={ownerProps}
          slotKey="root"
          slotInjected={EMPTY_SLOT_INJECT}
          hookContext={undefined}
          hasHookContext={false}
        />
      </SlotErrorBoundary>
    </div>
  )
}

/**
 * Build the renderer installed into the `ui-renderer` SlotRegistry
 * (ctx.slots.install(createSlotRenderer()) at boot; the service owns the
 * install/renderSlot contract and the double-install/not-installed throws).
 * @returns the renderer.
 */
export function createSlotRenderer(): SlotRenderer {
  return {
    renderRoot(host, ownerProps) {
      return (
        <HostContext.Provider value={host}>
          <RootStandardProvider>
            <ScopeProvider scope="session-maybe">
              <RootOutlet ownerProps={ownerProps} />
            </ScopeProvider>
          </RootStandardProvider>
        </HostContext.Provider>
      )
    },
  }
}
