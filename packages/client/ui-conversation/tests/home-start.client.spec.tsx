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
  PINNED_COMMANDS_STORAGE_KEY, createPinnedCommandsSource, pinCommand,
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

  it('renders every catalog command with its description and the fleet panel', () => {
    const { view } = renderSections()
    const section = view.getByLabelText('Most-used commands')
    const panel = within(section)
    const nameSpans = [...section.querySelectorAll('span')]
    for (const group of HOME_COMMAND_GROUPS) {
      for (const command of group.commands) {
        const label = command.args === undefined ? command.token : `${command.token} ${command.args}`
        expect(nameSpans.some(span => span.textContent === label)).toBe(true)
        expect(panel.getByText(en[command.descKey])).toBeTruthy()
      }
    }
    expect(view.getByText('Morpheus')).toBeTruthy()
    expect(view.getByText('Scribe')).toBeTruthy()
    expect(view.getByText('AlterEgo · 108 tools')).toBeTruthy()
  })

  it('launches a command on row click and toggles pins from the star', () => {
    const { view, props, calls } = renderSections()
    const panel = within(view.getByLabelText('Most-used commands'))
    fireEvent.click(panel.getByText('Show the current engagement status'))
    expect(calls).toEqual(['setDraft:/status', 'submit'])
    fireEvent.click(panel.getByLabelText('Unpin /status'))
    expect(props.unpinCommand).toHaveBeenCalledWith('status')
    fireEvent.click(panel.getByLabelText('Pin /stop to favorites'))
    expect(props.pinCommand).toHaveBeenCalledWith('stop')
  })

  it('omits Continue when no recent session exists', () => {
    const { view } = renderSections()
    expect(view.queryByText('Continue')).toBeNull()
  })

  it('continues a real recent session, skipping the current, blank, and subagent rows', () => {
    const current = 'cur' as SessionId
    const alpha = 'a' as SessionId
    const blank = 'b' as SessionId
    const sub = 'c' as SessionId
    const state: SessionListState = {
      ids: [current, alpha, blank, sub],
      byId: {
        [current]: summary('cur'),
        [alpha]: summary('a', { displayTitle: 'Alpha scan', cwd: '/work/alpha', running: true }),
        [blank]: summary('b', { blank: true }),
        [sub]: summary('c', { origin: 'subagent' }),
      },
      phase: 'ready',
      projectionsBySession: {},
    }
    const { view, props } = renderSections({
      useSessions: sessionsHook(state),
      currentSessionId: current,
    })
    expect(view.getByText('Alpha scan')).toBeTruthy()
    expect(view.getByText('Running')).toBeTruthy()
    expect(view.queryByText('Session b')).toBeNull()
    expect(view.queryByText('Session c')).toBeNull()
    fireEvent.click(view.getByText('Alpha scan'))
    expect(props.openSession).toHaveBeenCalledWith('a')
  })
})
