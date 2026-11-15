/**
 * The curated half of the client slot catalog: the entry a registrant reads, the
 * cardinality and scope literals the scan accepts, and the register-option tables
 * taught per cardinality. Curated facts separated from the scan that fills them
 * in and the renderer that emits them, so a change to the teaching lands in one
 * file without touching either.
 */

/** One register-call option as the catalog teaches it. */
export interface OptionDoc {
  readonly name: string
  readonly requirement: 'required' | 'optional'
  readonly type: string
  readonly doc: string
}

/** One resolved catalog entry, ready to render. */
export interface SlotEntry {
  readonly key: string
  readonly kind: string
  readonly scope: string
  readonly summary: string
  readonly doc: string
  readonly registerOptions: readonly OptionDoc[]
  readonly ownerProps: readonly string[]
  readonly ownerPropsReferences: readonly string[]
  readonly standardProps: readonly string[]
  readonly keyDomain: string
  readonly hookContext: string
  readonly slotInject: string
  readonly declaredBy: string
  readonly occupants: readonly string[]
  readonly replaceRisk: string
  readonly example: string
  readonly source: string
}

/** Source globs: every workspace package's sources, `.tsx` included (a contract may live in one). */
export const SOURCE_GLOBS = ['packages/*/*/src/**/*.ts', 'packages/*/*/src/**/*.tsx']

/** Slot cardinalities the contract allows. */
export const KINDS = ['single', 'list', 'keyed', 'chain'] as const
/** Slot data scopes the contract allows. */
export const SCOPES = ['root', 'session', 'session-maybe'] as const

/** Declarations longer than this render truncated; the full shape stays in source. */
export const MAX_DECL_CHARS = 1200

/**
 * Line budget for ONE slot's expanded report. The whole point of narrowing to a
 * single slot is to spend less context, so a report a model cannot finish
 * reading is a defect rather than a detail. The widest measured slot renders 60
 * lines, so this leaves room to document a slot properly while catching the two
 * ways a report runs away: an owner share that hands down a subsystem instead of
 * a share, and prose that grew into a manual.
 */
export const MAX_ENTRY_LINES = 120

/**
 * Register options per cardinality, curated from `KindOptions` in
 * `packages/client/ui-slots/src/index.ts` — the authority for what a register
 * call may pass. Curated rather than projected because the authority is a
 * conditional type keyed on the slot's kind: it has no per-kind declaration a
 * lexical scan could read, and its own JSDoc addresses the compiler, not a
 * registrant. `verify-client-catalog` pins the authority's text so a change
 * there forces this table to be revisited.
 */
export const REGISTER_OPTIONS: Readonly<Record<(typeof KINDS)[number], readonly OptionDoc[]>> = {
  single: [],
  list: [
    { name: 'id', requirement: 'required', type: 'string', doc: 'Your cell key. Use an id of your own: a fresh id is added beside the shipped entries, while reusing a shipped id puts you in THAT cell and replaces it. Owners that filter by id address you by it.' },
    { name: 'order', requirement: 'optional', type: 'number', doc: 'Position among the entries, ascending (default 0).' },
    { name: 'label', requirement: 'optional', type: 'string | (() => string)', doc: 'Display text where the owner projects one (nav rows, tabs). A thunk is re-read on every projection, so localized text follows the active locale without re-registering.' },
  ],
  keyed: [
    { name: 'key', requirement: 'required', type: 'string', doc: 'Your cell key: the entry renders where the owner dispatches this exact key. Registering an already-occupied key replaces that occupant.' },
  ],
  chain: [
    { name: 'select', requirement: 'required', type: '(owner) => unknown | null', doc: 'Pure routing selector. Entries are tried in ascending order; the first non-null result wins and arrives as the component\'s `matched` prop. All-null falls through to the owner\'s fallback.' },
  ],
}

/** The one register option a dynamic package must NOT pass, and why. */
export const PRIORITY_NOTE = 'Do NOT pass `priority`: the browser-half facade assigns one automatically, and it is LOWER than every shipped entry — in a single or keyed cell that means your entry is the one that renders.'

/** Cross-cutting rules a registrant needs once, not per slot. */
export const CLIENT_NOTES: readonly string[] = [
  'Contribute UI only through `ctx.slots.register(options, Component)`; declare `inject: [\'slots\']` in your returned plugin (object form) or the seat is withheld.',
  'Wrap every registration in `ctx.slots.inject(key, () => ctx.slots.register(...))`. A slot exists only while the entry that declared it is mounted, and registering into an undeclared slot throws; `inject` runs your registration when the declaration is (or becomes) live and re-runs it if the owner remounts.',
  PRIORITY_NOTE,
  'You cannot `import` anything, so the design-system components are out of reach: build markup with `React.createElement` and ship CSS through `styles.insert(css)`. Use the theme CSS variables (`var(--dsw-alias-bg-layer-1)`, `var(--dsw-alias-label-primary)`, …) instead of literal colors, or your contribution breaks in the other color scheme.',
  'Every component receives the framework hook seats listed under `framework props` for its scope; a selector hook is called with a selector, e.g. `useSessions(state => state.current)`.',
  'This catalog is the COMPILE-TIME contract of the shipped web bundle, not a snapshot of one page: a key is registrable only where the owner that declares it is mounted. A failed registration surfaces in the browser-half load report — read it back with `cordis_inspect what:"temporary"`.',
]

/** Standard-kit interface that applies to each scope, beyond the global one. */
export const SCOPE_KIT: Readonly<Record<(typeof SCOPES)[number], string | undefined>> = {
  'root': undefined,
  'session': 'SessionStandardProps',
  'session-maybe': 'SessionMaybeStandardProps',
}

/** Extra example options per cardinality. */
export const KIND_EXAMPLE: Readonly<Record<string, readonly string[]>> = {
  single: [],
  list: ["id: 'my-entry'", 'order: 100', "label: 'My entry'"],
  keyed: ["key: '<one key the owner dispatches>'"],
  chain: ['select: owner => null'],
}
