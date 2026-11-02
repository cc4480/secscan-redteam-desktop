/**
 * The home start state's command catalog and pinned-commands source.
 *
 * The catalog is the fixed, source-verified operator surface the home
 * renders: the composer commands (the engagement and session groups,
 * claimed by name in the composer exactly as if typed) and the runner
 * commands (the engagement engine's operator protocol, which travel as
 * ordinary message text — there is no hidden channel). Argument hints
 * are the commands' real registered syntax, kept verbatim as code
 * tokens; descriptions are locale-owned (`home.cmd.*` keys).
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InputActions } from '../contract/input.ts'

/** How one home command reaches the session when its row is clicked. */
export type HomeCommandLaunch =
  /** Set the draft to the bare token and submit it: the composer's own adjudication runs the command. */
  | 'submit'
  /** Set the draft to the token plus a trailing space and focus the composer for the operator's argument. */
  | 'insert'
  /** Runner protocol: the token is message text for the agent, inserted like `insert`. */
  | 'text'

/** Locale keys carrying one catalog description each. */
export type HomeCommandDescKey =
  | 'home.cmd.scan.desc' | 'home.cmd.status.desc' | 'home.cmd.report.desc'
  | 'home.cmd.stop.desc' | 'home.cmd.use.desc' | 'home.cmd.model.desc'
  | 'home.cmd.permission.desc' | 'home.cmd.plan.desc' | 'home.cmd.goal.desc'
  | 'home.cmd.compact.desc' | 'home.cmd.file.desc' | 'home.cmd.feedback.desc'
  | 'home.cmd.export.desc' | 'home.cmd.pcscan.desc' | 'home.cmd.deepscan.desc'
  | 'home.cmd.nmap.desc' | 'home.cmd.nuclei.desc' | 'home.cmd.metasploit.desc'

/** One command named on the home surface. */
export interface HomeCommand {
  /** Stable pin identity (the command name without the slash). */
  readonly id: string
  /** The command token as typed in the composer, slash included. */
  readonly token: string
  /** The registered argument syntax, verbatim; absent for argument-free commands. */
  readonly args?: string
  /** Locale key of the row's description. */
  readonly descKey: HomeCommandDescKey
  /** Click behavior (see {@link HomeCommandLaunch}). */
  readonly launch: HomeCommandLaunch
}

/** One labelled group of the commands panel. */
export interface HomeCommandGroup {
  /** Stable group identity. */
  readonly id: 'engagements' | 'session' | 'runner'
  /** Locale key of the group heading. */
  readonly labelKey: 'home.commands.group.engagements' | 'home.commands.group.session' | 'home.commands.group.runner'
  /** The group's commands in display order. */
  readonly commands: readonly HomeCommand[]
}

/** The pin identity of the New Session favorite (an action, not a composer command). */
export const NEW_SESSION_PIN_ID = 'new-session'

/** The full home command catalog, in panel order. */
export const HOME_COMMAND_GROUPS: readonly HomeCommandGroup[] = [
  {
    id: 'engagements',
    labelKey: 'home.commands.group.engagements',
    commands: [
      { id: 'scan', token: '/scan', args: '<target>', descKey: 'home.cmd.scan.desc', launch: 'insert' },
      { id: 'status', token: '/status', descKey: 'home.cmd.status.desc', launch: 'submit' },
      { id: 'report', token: '/report', descKey: 'home.cmd.report.desc', launch: 'submit' },
      { id: 'stop', token: '/stop', descKey: 'home.cmd.stop.desc', launch: 'submit' },
      { id: 'use', token: '/use', args: '<tool> [instruction]', descKey: 'home.cmd.use.desc', launch: 'insert' },
    ],
  },
  {
    id: 'session',
    labelKey: 'home.commands.group.session',
    commands: [
      { id: 'model', token: '/model', descKey: 'home.cmd.model.desc', launch: 'insert' },
      { id: 'permission', token: '/permission', args: '<preset>', descKey: 'home.cmd.permission.desc', launch: 'insert' },
      { id: 'plan', token: '/plan', args: '[off|message]', descKey: 'home.cmd.plan.desc', launch: 'insert' },
      { id: 'goal', token: '/goal', args: '[<objective>|clear|edit <objective>|pause|resume]', descKey: 'home.cmd.goal.desc', launch: 'insert' },
      { id: 'compact', token: '/compact', descKey: 'home.cmd.compact.desc', launch: 'submit' },
      { id: 'file', token: '/file', descKey: 'home.cmd.file.desc', launch: 'insert' },
      { id: 'feedback', token: '/feedback', args: '<text>', descKey: 'home.cmd.feedback.desc', launch: 'insert' },
      { id: 'export', token: '/export', descKey: 'home.cmd.export.desc', launch: 'submit' },
    ],
  },
  {
    id: 'runner',
    labelKey: 'home.commands.group.runner',
    commands: [
      { id: 'pcscan', token: '/pcscan', args: '[quick|full]', descKey: 'home.cmd.pcscan.desc', launch: 'text' },
      { id: 'deepscan', token: '/deepscan', args: '<target> [family,…]', descKey: 'home.cmd.deepscan.desc', launch: 'text' },
      { id: 'nmap', token: '/nmap', args: '<host> [quick|service|full|udp|os]', descKey: 'home.cmd.nmap.desc', launch: 'text' },
      { id: 'nuclei', token: '/nuclei', args: '<host> [tags,…]', descKey: 'home.cmd.nuclei.desc', launch: 'text' },
      { id: 'metasploit', token: '/metasploit', args: '<host> [cve]', descKey: 'home.cmd.metasploit.desc', launch: 'text' },
    ],
  },
]

/** Every catalog command by pin identity. */
export const HOME_COMMANDS_BY_ID: ReadonlyMap<string, HomeCommand> = new Map(
  HOME_COMMAND_GROUPS.flatMap(group => group.commands.map(command => [command.id, command] as const)),
)

/** Every pinnable identity: the New Session action plus every catalog command. */
export const PINNABLE_IDS: readonly string[] = [
  NEW_SESSION_PIN_ID,
  ...HOME_COMMANDS_BY_ID.keys(),
]

/** The favorites the home shows before the operator pins anything: the sample's five. */
export const DEFAULT_PINNED_COMMANDS: readonly string[] = [
  NEW_SESSION_PIN_ID, 'scan', 'status', 'report', 'model',
]

/** localStorage key of the per-profile pinned-commands list. */
export const PINNED_COMMANDS_STORAGE_KEY = 'dsh.conversation.pinned-commands.v1'

/**
 * Run one home command through the composer faces, exactly as if the
 * operator had typed it there: argument-free composer commands submit
 * at once (the input machine adjudicates the claim), argument-taking
 * commands and runner-protocol text land in the draft with the caret
 * behind the token, ready for the operator's argument.
 * @param command - the clicked catalog entry.
 * @param inputActions - the current Session's public input actions.
 * @param focusComposer - returns keyboard focus to the composer editor.
 */
export function runHomeCommand(
  command: HomeCommand,
  inputActions: InputActions,
  focusComposer: () => void,
): void {
  if (command.launch === 'submit') {
    inputActions.setDraft(command.token)
    inputActions.submit()
    return
  }
  inputActions.setDraft(`${command.token} `)
  focusComposer()
}

/**
 * Read the persisted pinned list, validated against the pinnable set.
 * @returns the stored order (duplicates and unknown ids dropped), the
 * defaults when storage is absent or unusable, and an empty list when
 * the operator has unpinned everything.
 */
export function readPinnedCommands(): readonly string[] {
  if (typeof localStorage === 'undefined') return DEFAULT_PINNED_COMMANDS
  let raw: string | null
  try { raw = localStorage.getItem(PINNED_COMMANDS_STORAGE_KEY) }
  catch (_storageUnavailable) { return DEFAULT_PINNED_COMMANDS }
  if (raw === null) return DEFAULT_PINNED_COMMANDS
  try {
    const stored: unknown = JSON.parse(raw)
    if (!Array.isArray(stored)) return DEFAULT_PINNED_COMMANDS
    const valid = new Set(PINNABLE_IDS)
    const seen = new Set<string>()
    const pins: string[] = []
    for (const entry of stored) {
      if (typeof entry === 'string' && valid.has(entry) && !seen.has(entry)) {
        seen.add(entry)
        pins.push(entry)
      }
    }
    return pins
  } catch (_invalidJson) {
    return DEFAULT_PINNED_COMMANDS
  }
}

/**
 * Persist the pinned list for this profile.
 * @param pins - pin identities in display order.
 */
export function writePinnedCommands(pins: readonly string[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PINNED_COMMANDS_STORAGE_KEY, JSON.stringify(pins))
  } catch (error) {
    console.error('Pinned commands persistence failed:', error)
  }
}

/**
 * Create the profile-global pinned-commands source: seeded from
 * storage, written back on every change. One instance per client,
 * created by the plugin's apply and shared through the factory inject
 * hooks compartment.
 * @returns the snapshot store the home reads and the pin actions write.
 */
export function createPinnedCommandsSource(): SnapshotStore<readonly string[]> {
  const source = createSnapshotStore<readonly string[]>(readPinnedCommands())
  source.subscribe(() => { writePinnedCommands(source.getSnapshot()) })
  return source
}

/**
 * Pin one identity at the end of the favorites order.
 * @param source - the pinned-commands source.
 * @param id - a pinnable identity; unknown or already-pinned ids are ignored.
 */
export function pinCommand(source: SnapshotStore<readonly string[]>, id: string): void {
  if (!PINNABLE_IDS.includes(id)) return
  const current = source.getSnapshot()
  if (current.includes(id)) return
  source.set([...current, id])
}

/**
 * Remove one identity from the favorites.
 * @param source - the pinned-commands source.
 * @param id - the pin identity to remove; absent ids are ignored.
 */
export function unpinCommand(source: SnapshotStore<readonly string[]>, id: string): void {
  const current = source.getSnapshot()
  if (!current.includes(id)) return
  source.set(current.filter(pinned => pinned !== id))
}
