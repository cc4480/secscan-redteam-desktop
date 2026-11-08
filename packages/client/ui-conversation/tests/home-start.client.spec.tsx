// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { en, zh } from '../src/client/locales.ts'
import type { InputActions } from '../src/client/contract/input.ts'
import { HomeFavorites } from '../src/client/skeleton/HomeFavorites.tsx'
import { HomeSections } from '../src/client/skeleton/HomeSections.tsx'
import {
  DEFAULT_PINNED_COMMANDS, HOME_COMMANDS_BY_ID, HOME_COMMAND_GROUPS,
  HOME_MOST_USED_COMMANDS, PINNED_COMMANDS_STORAGE_KEY, createPinnedCommandsSource, pinCommand,
  readPinnedCommands, runHomeCommand, unpinCommand, writePinnedCommands,
} from '../src/client/skeleton/home-commands.ts'

const t = makeTranslate(en, commonEn)

function fakeInputActions() {
  const calls: string[] = []
  const actions = {
    captureInsertion: (): never => { throw new Error('unused') },
    insertText: () => false,
    setDraft: (text: string) => { calls.push(`setDraft:${text}`) },
    addAttachments: () => false,
    removeAttachment: () => {},
    pruneAttachments: () => {},
    submit: () => { calls.push('submit') },
  } satisfies InputActions
  return { actions, calls }
}

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: id as SessionId,
    displayTitle: `Session ${id}`,
    running: false,
    retainedBy: {},
    blank: false,
    updatedAt: 1,
    ...overrides,
  }
}

function sessionsHook(state: SessionListState) {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>(state))
}

const emptySessions: SessionListState = { ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }

beforeEach(() => { localStorage.clear() })
afterEach(() => { cleanup() })

describe('home command catalog', () => {
  it('names eighteen commands with unique ids and slash tokens', () => {
    const commands = HOME_COMMAND_GROUPS.flatMap(group => group.commands)
    expect(commands).toHaveLength(18)
    expect(new Set(commands.map(command => command.id)).size).toBe(18)
    for (const command of commands) {
      expect(command.token).toBe(`/${command.id}`)
      expect(en[command.descKey]).toBeTypeOf('string')
      expect(zh[command.descKey]).toBeTypeOf('string')
    }
  })

  it('carries the full registered /goal syntax, edit subcommand included', () => {
    expect(HOME_COMMANDS_BY_ID.get('goal')?.args).toBe('[<objective>|clear|edit <objective>|pause|resume]')
  })

  it('defaults the favorites to the sample five', () => {
    expect(DEFAULT_PINNED_COMMANDS).toEqual(['new-session', 'scan', 'status', 'report', 'model'])
  })

  it('curates the most-used rows scan-first, each with a plain-language scan-type label', () => {
    expect(HOME_MOST_USED_COMMANDS.map(entry => entry.command.id)).toEqual([
      'deepscan', 'scan', 'pcscan', 'nmap', 'nuclei', 'metasploit', 'status', 'report',
    ])
    for (const entry of HOME_MOST_USED_COMMANDS) {
      expect(HOME_COMMANDS_BY_ID.get(entry.command.id)).toBe(entry.command)
      expect(en[entry.kindKey]).toBeTypeOf('string')
      expect(zh[entry.kindKey]).toBeTypeOf('string')
    }
  })
})

describe('runHomeCommand', () => {
  it('submits argument-free composer commands through the input faces', () => {
    const { actions, calls } = fakeInputActions()
    runHomeCommand(HOME_COMMANDS_BY_ID.get('status')!, actions, () => {})
    expect(calls).toEqual(['setDraft:/status', 'submit'])
  })

  it('inserts argument-taking commands with a trailing space and focuses the composer', () => {
    const { actions, calls } = fakeInputActions()
    const focus = vi.fn()
    runHomeCommand(HOME_COMMANDS_BY_ID.get('scan')!, actions, focus)
    expect(calls).toEqual(['setDraft:/scan '])
    expect(focus).toHaveBeenCalledOnce()
  })

  it('inserts runner-protocol commands as draft text, never as a claim submit', () => {
    const { actions, calls } = fakeInputActions()
    runHomeCommand(HOME_COMMANDS_BY_ID.get('deepscan')!, actions, () => {})
    expect(calls).toEqual(['setDraft:/deepscan '])
  })
})

describe('pinned commands persistence', () => {
  it('reads the defaults when storage is absent', () => {
    expect(readPinnedCommands()).toEqual(DEFAULT_PINNED_COMMANDS)
  })

  it('round-trips a written list and honors an emptied list', () => {
    writePinnedCommands(['status', 'nmap'])
    expect(readPinnedCommands()).toEqual(['status', 'nmap'])
    writePinnedCommands([])
    expect(readPinnedCommands()).toEqual([])
  })

  it('drops unknown and duplicate ids from a stored list', () => {
    localStorage.setItem(PINNED_COMMANDS_STORAGE_KEY, JSON.stringify(['scan', 'bogus', 'scan', 7, 'stop']))
    expect(readPinnedCommands()).toEqual(['scan', 'stop'])
  })

  it('falls back to the defaults on unparseable storage', () => {
    localStorage.setItem(PINNED_COMMANDS_STORAGE_KEY, '{not json')
    expect(readPinnedCommands()).toEqual(DEFAULT_PINNED_COMMANDS)
    localStorage.setItem(PINNED_COMMANDS_STORAGE_KEY, JSON.stringify('scan'))
    expect(readPinnedCommands()).toEqual(DEFAULT_PINNED_COMMANDS)
  })

  it('pins and unpins through the source, writing each change back', () => {
    const source = createPinnedCommandsSource()
    expect(source.getSnapshot()).toEqual(DEFAULT_PINNED_COMMANDS)
    pinCommand(source, 'nmap')
    expect(source.getSnapshot()).toEqual([...DEFAULT_PINNED_COMMANDS, 'nmap'])
    expect(readPinnedCommands()).toEqual([...DEFAULT_PINNED_COMMANDS, 'nmap'])
    pinCommand(source, 'nmap')
    pinCommand(source, 'not-a-command')
    expect(source.getSnapshot()).toEqual([...DEFAULT_PINNED_COMMANDS, 'nmap'])
    unpinCommand(source, 'scan')
    expect(source.getSnapshot()).toEqual(['new-session', 'status', 'report', 'model', 'nmap'])
    unpinCommand(source, 'scan')
    expect(source.getSnapshot()).toEqual(['new-session', 'status', 'report', 'model', 'nmap'])
  })
})

describe('HomeFavorites', () => {
  it('renders the pinned chips and runs their commands', () => {
    const { actions, calls } = fakeInputActions()
    const startNewSession = vi.fn()
    const focus = vi.fn()
    const view = render(
      <HomeFavorites
        t={t}
        pinned={['new-session', 'scan', 'status']}
        inputActions={actions}
        disabled={false}
        onStartNewSession={startNewSession}
        focusComposer={focus}
      />,
    )
    fireEvent.click(view.getByText('New session'))
    expect(startNewSession).toHaveBeenCalledOnce()
    fireEvent.click(view.getByText('/scan'))
    fireEvent.click(view.getByText('/status'))
    expect(calls).toEqual(['setDraft:/scan ', 'setDraft:/status', 'submit'])
    expect(focus).toHaveBeenCalledOnce()
  })

  it('disables command chips in the inert posture but keeps New Session live', () => {
    const { actions } = fakeInputActions()
    const view = render(
      <HomeFavorites
        t={t}
        pinned={['new-session', 'status']}
        inputActions={actions}
        disabled
        onStartNewSession={() => {}}
        focusComposer={() => {}}
      />,
    )
    expect((view.getByText('/status').closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect((view.getByText('New session').closest('button') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('HomeSections', () => {
  function renderSections(overrides: Partial<Parameters<typeof HomeSections>[0]> = {}) {
    const { actions, calls } = fakeInputActions()
    const props: Parameters<typeof HomeSections>[0] = {
      t,
      useSessions: sessionsHook(emptySessions),
      currentSessionId: undefined,
      inputActions: actions,
      disabled: false,
      pinned: ['scan', 'status', 'report', 'model'],
      pinCommand: vi.fn(),
      unpinCommand: vi.fn(),
      openSession: vi.fn(),
      focusComposer: vi.fn(),
      ...overrides,
    }
    return { view: render(<HomeSections {...props} />), props, calls }
  }

  it('renders ONE guide panel holding Quick start, Most-used commands, and Continue as sub-blocks', () => {
    const { view } = renderSections()
    const root = view.container
    // Exactly one top-level section in the center column: the guide panel.
    const topSections = root.querySelectorAll(':scope > section')
    expect(topSections).toHaveLength(1)
    const guide = view.getByLabelText(en['home.guide.title'])
    expect(guide).toBe(topSections[0])
    // The side panel stays a separate aside, untouched by the merge.
    expect(root.querySelectorAll(':scope > aside')).toHaveLength(1)
    // The three sub-blocks live inside the one panel, in flow order,
    // under the ids the side panel's Guide links scroll to — and none
    // of them is a panel section of its own.
    const blocks = ['home-quick-start', 'home-commands', 'home-continue']
      .map(id => document.getElementById(id))
    for (const block of blocks) {
      expect(block).not.toBeNull()
      expect(block!.tagName).not.toBe('SECTION')
      expect(guide.contains(block)).toBe(true)
    }
    expect([...guide.querySelectorAll('[id^="home-"]')].map(el => el.id)).toEqual([
      'home-quick-start', 'home-commands', 'home-continue',
    ])
    // Every option Carlos named is inside the one panel: the four
    // step cards, the eight command rows with their pin stars (the
    // favorites toggles), and the Continue block.
    const quick = within(blocks[0] as HTMLElement)
    for (const key of ['home.step1.title', 'home.step2.title', 'home.step3.title', 'home.step4.title'] as const) {
      expect(quick.getByText(en[key]).closest('button')).not.toBeNull()
    }
    const commands = within(blocks[1] as HTMLElement)
    expect(commands.getAllByLabelText(/^(Pin|Unpin) \//)).toHaveLength(8)
    for (const { command } of HOME_MOST_USED_COMMANDS) {
      expect(commands.getByText(en[command.descKey])).toBeTruthy()
    }
    const cont = within(blocks[2] as HTMLElement)
    expect(cont.getByText(en['home.continue.empty'])).toBeTruthy()
  })

  it('lists the most-used commands scan-first with scan-type labels, and keeps the fleet panel', () => {
    const { view } = renderSections()
    const section = view.getByLabelText('Most-used commands')
    const panel = within(section)
    const nameSpans = [...section.querySelectorAll('span')]
    const labels = HOME_MOST_USED_COMMANDS.map(({ command }) => (
      command.args === undefined ? command.token : `${command.token} ${command.args}`
    ))
    const positions = labels.map(label => nameSpans.findIndex(span => span.textContent === label))
    expect(positions.every(at => at >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    for (const { command, kindKey } of HOME_MOST_USED_COMMANDS) {
      expect(panel.getByText(en[kindKey])).toBeTruthy()
      expect(panel.getByText(en[command.descKey])).toBeTruthy()
    }
    expect(nameSpans.some(span => span.textContent.startsWith('/goal'))).toBe(false)
    expect(view.getByText('Morpheus')).toBeTruthy()
    expect(view.getByText('Scribe')).toBeTruthy()
    expect(view.getByText('AlterEgo · 109 tools')).toBeTruthy()
  })

  it('launches most-used commands on row click and toggles pins from the star', () => {
    const { view, props, calls } = renderSections()
    const panel = within(view.getByLabelText('Most-used commands'))
    fireEvent.click(panel.getByText(en['home.cmd.deepscan.desc']))
    fireEvent.click(panel.getByText(en['home.cmd.status.desc']))
    expect(calls).toEqual(['setDraft:/deepscan ', 'setDraft:/status', 'submit'])
    fireEvent.click(panel.getByLabelText('Unpin /report'))
    expect(props.unpinCommand).toHaveBeenCalledWith('report')
    fireEvent.click(panel.getByLabelText('Pin /nmap to favorites'))
    expect(props.pinCommand).toHaveBeenCalledWith('nmap')
  })

  it('renders the four quick-start steps as actions wired to the real flow', () => {
    const { view, props, calls } = renderSections()
    const panel = within(view.getByLabelText('Quick start'))
    const stepKeys = ['home.step1.title', 'home.step2.title', 'home.step3.title', 'home.step4.title'] as const
    for (const key of stepKeys) expect(panel.getByText(en[key])).toBeTruthy()
    const stepButton = (key: typeof stepKeys[number]) => (
      panel.getByText(en[key]).closest('button') as HTMLButtonElement
    )
    fireEvent.click(stepButton('home.step2.title'))
    fireEvent.click(stepButton('home.step3.title'))
    fireEvent.click(stepButton('home.step4.title'))
    expect(calls).toEqual(['setDraft:/scan ', 'setDraft:/status', 'submit', 'setDraft:/report', 'submit'])
    // The insert launch focuses the composer for the target; the submits do not.
    expect(props.focusComposer).toHaveBeenCalledOnce()
    fireEvent.click(stepButton('home.step1.title'))
    expect(props.focusComposer).toHaveBeenCalledTimes(2)
    expect(calls).toHaveLength(5)
  })

  it('keeps step one live in the inert posture while the command steps disable', () => {
    const { view, props } = renderSections({ disabled: true })
    const panel = within(view.getByLabelText('Quick start'))
    const step1 = panel.getByText(en['home.step1.title']).closest('button') as HTMLButtonElement
    const step2 = panel.getByText(en['home.step2.title']).closest('button') as HTMLButtonElement
    expect(step2.disabled).toBe(true)
    expect(step1.disabled).toBe(false)
    fireEvent.click(step1)
    expect(props.focusComposer).toHaveBeenCalledOnce()
  })

  it('shows an honest Continue empty state with no button when no recent session exists', () => {
    const { view } = renderSections()
    const panel = within(view.getByLabelText('Continue'))
    expect(panel.getByText(en['home.continue.empty'])).toBeTruthy()
    expect(panel.queryByRole('button')).toBeNull()
  })

  it('continues only the most recent session, skipping the current, blank, and subagent rows', () => {
    const current = 'cur' as SessionId
    const alpha = 'a' as SessionId
    const beta = 'z' as SessionId
    const blank = 'b' as SessionId
    const sub = 'c' as SessionId
    const state: SessionListState = {
      ids: [current, blank, alpha, sub, beta],
      byId: {
        [current]: summary('cur'),
        [blank]: summary('b', { blank: true }),
        [alpha]: summary('a', { displayTitle: 'Alpha scan', cwd: '/work/alpha', running: true }),
        [sub]: summary('c', { origin: 'subagent' }),
        [beta]: summary('z', { displayTitle: 'Beta scan' }),
      },
      phase: 'ready',
      projectionsBySession: {},
    }
    const { view, props } = renderSections({
      useSessions: sessionsHook(state),
      currentSessionId: current,
    })
    const panel = within(view.getByLabelText('Continue'))
    expect(panel.getByText('Alpha scan')).toBeTruthy()
    expect(panel.getByText('Running')).toBeTruthy()
    expect(panel.queryByText('Beta scan')).toBeNull()
    expect(panel.queryByText('Session b')).toBeNull()
    expect(panel.queryByText('Session c')).toBeNull()
    const buttons = panel.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.textContent).toContain(en['home.continue.resume'])
    fireEvent.click(buttons[0]!)
    expect(props.openSession).toHaveBeenCalledOnce()
    expect(props.openSession).toHaveBeenCalledWith('a')
  })
})
