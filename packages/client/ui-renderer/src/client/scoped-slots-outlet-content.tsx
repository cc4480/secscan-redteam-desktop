/**
 * scoped-slots-outlet-content — contiguous range of the former scoped-slots.tsx, moved verbatim.
 * Public entry point stays ./scoped-slots.tsx.
 */

import {
  type ReactNode,
} from 'react'
import {
  type ChainRenderOpts, type RenderOpts, type SlotRendererHost, type StandardSourceBinding, type StoredEntry,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  SlotAssemblyError,
} from './errors.ts'
import {
  cachedSlotInject,
} from './scoped-slots-binding-cache.tsx'
import {
  entryKeyOf, SlotErrorBoundary,
} from './scoped-slots-entry-keys.tsx'
import {
  SessionMaybeEntry,
} from './scoped-slots-entry-render.tsx'
import {
  RootEntry,
} from './scoped-slots-factory-runtime.tsx'
import {
  StrictSessionEntry,
} from './scoped-slots-outlets.tsx'

/** Kind dispatch behind the outlet anchor (single/keyed/list/chain, fallbacks, crash faces). */
export function renderOutletContent(
  host: SlotRendererHost,
  slotKey: string,
  ownerProps: object,
  opts: (RenderOpts & ChainRenderOpts) | undefined,
  scopeBinding: StandardSourceBinding,
): ReactNode {
  const spec = host.specOf(slotKey)
  // Undeclared (or no-longer-declared) keys render empty: a declaring entry's
  // unload returns the slot to the undeclared state while retained elements
  // may still be mounted — natural empty, not an ownership failure.
  if (!spec) return null
  if (spec.kind === 'chain' && opts?.fallbackOnly === true) {
    return renderChainResult(slotKey, null, opts)
  }
  if (spec.scope === 'session' && scopeBinding.key === undefined) {
    throw new SlotAssemblyError(`strict session slot '${slotKey}' rendered without a scope binding`)
  }
  const entries = host.entriesOf(slotKey)
  const slotInjected = cachedSlotInject(spec.inject)

  // The boundary must wrap the Entry ELEMENT, not live inside it: inject
  // factories and kit synthesis run in the Entry body and must land in the
  // per-entry fallback rather than escaping to the tree above.
  const guarded = (entry: StoredEntry, key?: string | number, owner: object = ownerProps) => {
    const hasHookContext = opts !== undefined && Object.hasOwn(opts, 'hookContext')
    const hookContext = opts?.hookContext
    // Shadowing kinds abdicate on crash (the cell falls to its next
    // survivor); chain reports without abdicating — election alternatives
    // resolve at select time, and retiring a crashed elected entry would
    // change the static crash face.
    const onEntryError = (error: unknown) => {
      host.reportEntryError(slotKey, entry, error, { abdicate: spec.kind !== 'chain' })
    }
    return spec.scope === 'session'
      ? (
        <StrictSessionEntry
          slotKey={slotKey}
          entry={entry}
          ownerProps={owner}
          slotInjected={slotInjected}
          hookContext={hookContext}
          hasHookContext={hasHookContext}
          onEntryError={onEntryError}
          key={key}
        />
      )
      : (
        <SlotErrorBoundary slotKey={slotKey} key={key} onEntryError={onEntryError}>
          {spec.scope === 'session-maybe'
            ? (
              <SessionMaybeEntry
                entry={entry}
                ownerProps={owner}
                slotKey={slotKey}
                slotInjected={slotInjected}
                hookContext={hookContext}
                hasHookContext={hasHookContext}
              />
            )
            : (
              <RootEntry
                entry={entry}
                ownerProps={owner}
                slotKey={slotKey}
                slotInjected={slotInjected}
                hookContext={hookContext}
                hasHookContext={hasHookContext}
              />
            )}
        </SlotErrorBoundary>
      )
  }
  // A cell whose every registration abdicated keeps the crash face: the
  // shadowing collapse ran out of survivors, which is a failure state, not
  // the owner's natural-empty fallback.
  const deadCell = () => <div data-slot-error={slotKey} />

  if (spec.kind === 'single') {
    const entry = host.entriesOfSlot(slotKey)[0]
    if (!entry) return entries.length > 0 ? deadCell() : <>{opts?.fallback ?? null}</>
    return guarded(entry, entryKeyOf(entry))
  }
  if (spec.kind === 'keyed') {
    const entry = host.entriesOfSlot(slotKey).find(e => e.options.key === opts?.entryKey)
    if (!entry) {
      const occupied = entries.some(e => e.options.key === opts?.entryKey)
      return occupied ? deadCell() : <>{opts?.fallback ?? null}</>
    }
    return guarded(entry, entryKeyOf(entry))
  }
  if (spec.kind === 'chain') {
    // Entries arrive priority-sorted from the ledger (the core orders at
    // register, ties keep registration sequence). Selectors are pure
    // functions of the owner props (register-face contract), so the routing
    // pass runs per render with zero mount side effects: the first non-null
    // election renders, decliners never mount.
    let elected: ReactNode = null
    for (const entry of entries) {
      let matched: unknown
      try {
        // Chain entries always carry select (SlotCore register validation).
        matched = (entry.select as (owner: object) => unknown)(ownerProps)
      } catch (error) {
        // A throwing selector is a registrant contract breach (select MUST be
        // pure and total), but it runs before the entry's SlotErrorBoundary
        // exists — uncontained it would black out the whole owner region. So
        // it degrades to a decline: the chain and the fallback stay intact,
        // and the breach is reported like a crashed entry.
        console.error(
          `chain selector crashed in '${slotKey}' (${entry.registrant ?? 'unknown registrant'}), treating as declined:`,
          error)
        continue
      }
      if (matched !== null) {
        elected = guarded(entry, entryKeyOf(entry), { ...ownerProps, matched })
        break
      }
    }
    return renderChainResult(slotKey, elected, opts)
  }
  // list: one row per id cell — the cell's shadowing winner, or the crash
  // face once every entry of the cell abdicated (a dry cell must not
  // silently drop its row). Row sequence: registration order refined by
  // explicit order, optional id filter, as before shadowing existed.
  const winners = host.entriesOfSlot(slotKey)
  const rows: { entry: StoredEntry | undefined; id: string | undefined; order: number }[] = winners.map(entry => ({
    entry,
    id: entry.options.id,
    order: entry.options.order ?? 0,
  }))
  const rowIds = new Set(rows.map(row => row.id))
  for (const entry of entries) {
    if (rowIds.has(entry.options.id)) continue
    rowIds.add(entry.options.id)
    // Dry cells anchor their row at the cell head's declared order.
    rows.push({ entry: undefined, id: entry.options.id, order: entry.options.order ?? 0 })
  }
  let list = [...rows].sort((a, b) => a.order - b.order)
  if (opts?.only !== undefined) list = list.filter(item => item.id === opts.only)
  if (list.length === 0) return <>{opts?.fallback ?? null}</>
  // Winner rows key by entry identity (see entryKeyOf); dry-cell rows key by
  // id — the disjoint prefixes keep the two namespaces from colliding.
  return (
    <>
      {list.map((item, i) => item.entry !== undefined
        ? guarded(item.entry, `e${entryKeyOf(item.entry)}`)
        : <div data-slot-error={slotKey} key={`x${item.id ?? i}`} />)}
    </>
  )
}

/** Render a chain election while preserving the overlay fallback's tree position. */
export function renderChainResult(
  slotKey: string,
  elected: ReactNode,
  opts: (RenderOpts & ChainRenderOpts) | undefined,
): ReactNode {
  if (!opts?.overlay) return elected ?? <>{opts?.fallback ?? null}</>
  return (
    <>
      <div
        data-chain-overlay-fallback={slotKey}
        style={{ display: elected === null ? 'contents' : 'none' }}
      >
        {opts.fallback ?? null}
      </div>
      {elected}
    </>
  )
}
