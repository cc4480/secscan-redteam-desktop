// @vitest-environment jsdom
// Guide panel â†’ composer integration over the REAL input shell: the
// home sections and favorites strip receive the resident
// SessionInputShell's own action face (not a mock), and the composer
// bar binds the same shell's Lexical editor, so a Guide click is proven
// at the surface Carlos uses â€” the command text lands in the composer
// draft and in the contenteditable itself, and an argument-free
// command's click actually submits through the shell's sink.
import './control-row-dom.ts'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import {
  bindSnapshotSelector, conversationSnapshot as conversationFixture, makeTranslate,
  sessionSnapshot as sessionFixture,
} from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DraftAttachmentId, SubmitOutcome } from '../src/client/contract/input.ts'
import type { DraftFileUploads } from '../src/client/contract/slots.ts'
import { SessionInputShell } from '../src/client/input/facade.ts'
import { InputBar } from '../src/client/skeleton/InputBar.tsx'
import type { InputBarProps } from '../src/client/skeleton/InputBar.tsx'
import { HomeSections } from '../src/client/skeleton/HomeSections.tsx'
import { HomeFavorites } from '../src/client/skeleton/HomeFavorites.tsx'
import { en } from '../src/client/locales.ts'

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']

afterEach(cleanup)

// jsdom implements no Range geometry; the composer measures the caret
// with one when it restores the selection after a programmatic focus.
Range.prototype.getBoundingClientRect = (): DOMRect => ({ top: 0, bottom: 0 }) as DOMRect

const SCTX = {} as Context
const SID = 's1' as SessionId
const t = makeTranslate(en, commonEn)

const emptySessions: SessionListState = { ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }

/** One real shell + the mounted composer bar bound to its editor. */
function bench() {
  const sink = vi.fn<(
    text: string,
    attachmentIds: readonly DraftAttachmentId[],
    mode: 'queue' | 'steer',
    signal: AbortSignal,
  ) => Promise<SubmitOutcome>>(() => Promise.resolve({ kind: 'success' }))
  const shell = new SessionInputShell({
    actx: SCTX,
    defaultSink: sink,
    commandAttachments: {
      serialize: () => Promise.resolve([]),
      release: () => {},
      unsupportedNotice: (token: string) => `${token.trim()} attachments-unsupported`,
    },
  })
  const session = createSnapshotStore<SessionSnapshot>({ ...sessionFixture(SID), running: false, subagent: null, removed: false, promptError: null })
  const renderSlot = ((_key: string) => null) as never
  const props: InputBarProps = {
    usePanelInfo: selector => selector({ activePanelId: null }),
    sessionId: SID,
    SessionProvider: ({ children }) => children,
    useSession: bindSnapshotSelector(session),
    useConversation: bindSnapshotSelector(createSnapshotStore(conversationFixture())),
    useSessionStatus: bindSnapshotSelector(createSnapshotStore(new Map())),
    useSessionRetainInfo: () => undefined,
    useResource,
    useSessions: bindSnapshotSelector(createSnapshotStore<SessionListState>(emptySessions)),
    useWorkspaces: bindSnapshotSelector(createSnapshotStore({
      items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    })),
    useProjection: ((_key: string, selector?: (v: unknown) => unknown) => (selector ?? (v => v))(undefined)),
    useInput: bindSnapshotSelector(shell.state),
    inputActions: shell.actions,
    keyboard: shell,
    addFiles: () => null,
    useFileUploads: bindSnapshotSelector(createSnapshotStore<DraftFileUploads>({})),
    retryFileUpload: undefined,
    removeAttachment: (id) => { shell.removeAttachment(id) },
    resolveDraftAttachments: () => [],
    toggleCommandMenu: vi.fn(),
    useBusyEnter: bindSnapshotSelector(createSnapshotStore<'queue' | 'steer'>('queue')),
    useNotices: bindSnapshotSelector(shell.notices),
    useLexicon: bindSnapshotSelector(shell.lexicon),
    useMenuLauncher: bindSnapshotSelector(createSnapshotStore<string | null>(null)),
    stop: vi.fn(),
    t: t as InputBarProps['t'],
    renderSlot,
    variant: 'hero',
  }
  return { sink, shell, bar: <InputBar {...props} /> }
}

function sectionsProps(shell: SessionInputShell, focusComposer: () => void) {
  return {
    t,
    useSessions: bindSnapshotSelector(createSnapshotStore<SessionListState>(emptySessions)),
    currentSessionId: SID,
    inputActions: shell.actions,
    disabled: false,
    pinned: ['scan', 'status', 'report', 'model'],
    pinCommand: vi.fn(),
    unpinCommand: vi.fn(),
    openSession: vi.fn(),
    focusComposer,
  }
}

function composerText(container: HTMLElement): string {
  return container.querySelector('[data-composer-input]')?.textContent ?? ''
}

describe('Guide panel commands reach the real composer', () => {
  it('Most-used insert command lands in the composer draft and the editor DOM', () => {
    const { shell, bar } = bench()
    const focusComposer = vi.fn()
    const view = render(<>{bar}<HomeSections {...sectionsProps(shell, focusComposer)} /></>)
    const panel = within(view.getByLabelText('Most-used commands'))
    fireEvent.click(panel.getByText(en['home.cmd.scan.desc']))
    expect(shell.snapshot.draft).toBe('/scan ')
    expect(composerText(view.container)).toContain('/scan')
    expect(focusComposer).toHaveBeenCalledOnce()
  })

  it('Most-used runner command lands as draft text, ready for its argument', () => {
    const { shell, bar } = bench()
    const view = render(<>{bar}<HomeSections {...sectionsProps(shell, vi.fn())} /></>)
    const panel = within(view.getByLabelText('Most-used commands'))
    fireEvent.click(panel.getByText(en['home.cmd.deepscan.desc']))
    expect(shell.snapshot.draft).toBe('/deepscan ')
    expect(composerText(view.container)).toContain('/deepscan')
  })

  it('Most-used argument-free command submits through the shell sink', async () => {
    const { shell, sink, bar } = bench()
    const focusComposer = vi.fn()
    const view = render(<>{bar}<HomeSections {...sectionsProps(shell, focusComposer)} /></>)
    const panel = within(view.getByLabelText('Most-used commands'))
    fireEvent.click(panel.getByText(en['home.cmd.status.desc']))
    await act(async () => {})
    await vi.waitFor(() => { expect(sink).toHaveBeenCalledOnce() })
    expect(sink.mock.calls[0]?.[0]).toBe('/status')
    expect(shell.snapshot.draft).toBe('')
    expect(focusComposer).not.toHaveBeenCalled()
  })

  it('Quick start steps land in the composer through the same faces', async () => {
    const { shell, sink, bar } = bench()
    const focusComposer = vi.fn()
    const view = render(<>{bar}<HomeSections {...sectionsProps(shell, focusComposer)} /></>)
    const panel = within(view.getByLabelText('Quick start'))
    const step = (key: 'home.step2.title' | 'home.step3.title') => panel.getByText(en[key]).closest('button')!
    fireEvent.click(step('home.step2.title'))
    expect(shell.snapshot.draft).toBe('/scan ')
    expect(composerText(view.container)).toContain('/scan')
    fireEvent.click(step('home.step3.title'))
    await act(async () => {})
    await vi.waitFor(() => { expect(sink).toHaveBeenCalledOnce() })
    expect(sink.mock.calls[0]?.[0]).toBe('/status')
  })

  it('Favorites chips land in the composer through the same faces', async () => {
    const { shell, sink, bar } = bench()
    const focusComposer = vi.fn()
    const view = render(
      <>
        {bar}
        <HomeFavorites
          t={t}
          pinned={['scan', 'status']}
          inputActions={shell.actions}
          disabled={false}
          onStartNewSession={vi.fn()}
          focusComposer={focusComposer}
        />
      </>,
    )
    fireEvent.click(view.getByText('/scan'))
    expect(shell.snapshot.draft).toBe('/scan ')
    expect(composerText(view.container)).toContain('/scan')
    expect(focusComposer).toHaveBeenCalledOnce()
    fireEvent.click(view.getByText('/status'))
    await act(async () => {})
    await vi.waitFor(() => { expect(sink).toHaveBeenCalledOnce() })
    expect(sink.mock.calls[0]?.[0]).toBe('/status')
  })
})
