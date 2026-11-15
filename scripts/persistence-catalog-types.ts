/** Catalog record types and the event-envelope vocabulary shared by discovery and rendering. */

/** One log event, extracted from a `SessionEventMap` declaration. */
export interface LogEventEntry {
  /** Scoped name, e.g. `turn/start`. */
  name: string
  /** The scope prefix, e.g. `turn` (everything before the first `/`). */
  scope: string
  /** Payload type text (the member's type annotation, whitespace-collapsed). */
  payload: string
  /** Source member declaration and complete JSDoc, dedented from its container. */
  declaration: string
  /** Description prose (the member's JSDoc), one line per paragraph. */
  doc: string
  /** Source pointer `packages/…/file.ts:line` of the declaration. */
  source: string
  /** Whether interpretation requires a plugin-owned message projection. */
  messageProjection?: true
}

/** A {@link LogEventEntry} plus its surface-eligibility badge. */
export interface AnnotatedLogEventEntry extends LogEventEntry {
  /** Whether the type is a `SurfaceEventType` member (may carry `surfaceOp`). */
  surface: boolean
}

/** One owning event-envelope declaration pasted into the generated catalog. */
export interface EventEnvelopeTypeEntry {
  /** Exported declaration name. */
  name: EventEnvelopeTypeName
  /** Verbatim type declaration, including its complete leading JSDoc. */
  declaration: string
  /** Source pointer `packages/…/file.ts:line` of the declaration. */
  source: string
}

/** Event-envelope declarations rendered before the per-event vocabulary. */
export const EVENT_ENVELOPE_TYPE_NAMES = [
  'SessionEventType',
  'SurfaceEventType',
  'SurfaceOp',
  'SessionEvent',
] as const

/** A name from {@link EVENT_ENVELOPE_TYPE_NAMES}. */
export type EventEnvelopeTypeName = typeof EVENT_ENVELOPE_TYPE_NAMES[number]
