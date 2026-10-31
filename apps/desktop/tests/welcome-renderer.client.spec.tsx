// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { Welcome } from '../src/client/WelcomePage.tsx'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import type { WelcomeMcpState, WelcomeSaveResult } from '../src/welcome-api.ts'
import type { ReadinessResult } from '../src/welcome-api.ts'

const html = readFileSync(join(import.meta.dirname, '../renderer/welcome.html'), 'utf8')
afterEach(cleanup)

/** First-run MCP state the shell reports before anything has been stored. */
const unconfiguredMcp: WelcomeMcpState = {
  required: true,
  entryRequired: true,
  endpoint: 'http://127.0.0.1:8787/mcp',
  storePath: '/profile/engagement-credentials.json',
  stored: false,
  fingerprints: {},
  fromEnvironment: [],
}

function mount(language = 'zh-CN', options: { page?: 'entry' | 'mcp'; mcp?: Partial<WelcomeMcpState> } = {}) {
  cleanup()
  const stopAccount = vi.fn()
  const mcp: WelcomeMcpState = { ...unconfiguredMcp, ...options.mcp }
  const api = {
    onAccountState: vi.fn((_listener: (state: AccountView) => void) => stopAccount),
    startSignIn: vi.fn(async (): Promise<AccountView> => ({ links: { usageUrl: 'http://localhost/usage', topUpUrl: 'http://localhost/top_up' }, status: 'signed-out', attempt: null })),
    cancelSignIn: vi.fn(async (): Promise<AccountView> => ({ links: { usageUrl: 'http://localhost/usage', topUpUrl: 'http://localhost/top_up' }, status: 'signed-out', attempt: null })),
    copySignInLink: vi.fn(async () => undefined),
    ...resolveDesktopLocale(language),
    initialPage: options.page ?? ('entry' as const),
    saveApiKey: vi.fn<(value: string) => Promise<WelcomeSaveResult>>().mockResolvedValue({ ok: true }),
    skip: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    readMcp: vi.fn<() => Promise<WelcomeMcpState>>().mockResolvedValue(mcp),
    saveMcp: vi.fn().mockResolvedValue({ ok: true }),
    clearMcp: vi.fn().mockResolvedValue({ ok: true }),
    finishMcp: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    readiness: vi.fn<() => Promise<ReadinessResult>>().mockResolvedValue({ ok: true, readiness: { ok: false, summary: '3 of 15 ready', items: [] } }),
  }
  const mounted = render(<Welcome api={api} />)
  const input = document.querySelector<HTMLInputElement>('#key-input')!
  const button = (id: string) => document.querySelector<HTMLButtonElement>(id)!
  const field = (id: string) => document.querySelector<HTMLInputElement>(id)!
  const enterKey = (value: string) => {
    fireEvent.change(input, { target: { value } })
  }
  const submit = () => fireEvent.submit(document.querySelector('#key-form')!)
  const submitMcp = () => fireEvent.submit(document.querySelector('#mcp-form')!)
  const copy = () => {
    const heading = document.querySelector('main')!.getAttribute('aria-labelledby')!
    const note = (id: string) => {
      const element = document.querySelector<HTMLElement>(id)!
      return element.hidden ? [] : [element.textContent]
    }
    return [
      document.title, document.querySelector('img')!.alt, document.getElementById(heading)!.textContent,
      ...heading === 'welcome-heading' ? [document.querySelector('#welcome-description')!.textContent] : [],
      ...heading === 'key-title' ? [document.querySelector('#key-description')!.textContent, `${input.placeholder} [password]`] : [],
      ...heading === 'mcp-title' ? [
        document.querySelector('#mcp-description')!.textContent,
        `${field('#mcp-secscan').placeholder} [password]`,
        `${field('#mcp-seclayer').placeholder} [password]`,
        `${field('#mcp-runner').placeholder} [password]`,
        `${field('#mcp-endpoint').placeholder} [url]`,
        ...note('#mcp-store'), ...note('#mcp-stored'), ...note('#mcp-environment'),
      ] : [],
      ...[...document.querySelectorAll('button')].filter(item => item.closest('[hidden]') === null)
        .map(item => `${item.textContent || item.getAttribute('aria-label')}${item.disabled ? ' [disabled]' : ''}`),
      '',
    ].join('\n')
  }
  return { document, api, input, button, field, enterKey, submit, submitMcp, copy, unmount: mounted.unmount, stopAccount }
}

describe('desktop welcome presentation', () => {
  it.each(['zh-CN', 'en'])('renders the %s entry and API-key step', async (language) => {
    const view = mount(language)
    expect(view.document.documentElement.lang).toBe(language)
    expect(view.document.querySelector('img')!.getAttribute('src')).toBe('assets/welcome-brand.svg')
    await expect(view.copy()).toMatchFileSnapshot(`./expected/welcome/${language}.expected.txt`)
    fireEvent.click(view.button('#api-key'))
    expect(view.document.activeElement).toBe(view.input)
    expect(view.input.type).toBe('password')
    await expect(view.copy()).toMatchFileSnapshot(`./expected/welcome/${language}-api-key.expected.txt`)
  })

  it('sends one trimmed key, prevents competing actions, and clears it after saving', async () => {
    const view = mount()
    const saved = Promise.withResolvers<WelcomeSaveResult>()
    view.api.saveApiKey.mockReturnValue(saved.promise)
    fireEvent.click(view.button('#api-key'))
    view.enterKey('  sk-desktop-example  ')
    view.submit()
    view.submit()
    fireEvent.click(view.button('#skip-key'))
    fireEvent.click(view.button('#back-to-login'))
    expect(view.api.saveApiKey).toHaveBeenCalledExactlyOnceWith('sk-desktop-example')
    expect(view.api.skip).not.toHaveBeenCalled()
    expect(view.button('#save-key').disabled).toBe(true)
    expect(view.button('#save-key').textContent).toBe(view.api.messages.welcomeKeySave)
    expect(view.button('#back-to-login').disabled).toBe(true)
    expect(view.document.querySelector<HTMLElement>('#key-form')!.hidden).toBe(false)
    saved.resolve({ ok: true })
    await vi.waitFor(() => { expect(view.input.value).toBe('') })
    expect(view.document.body.textContent).not.toContain('sk-desktop-example')
  })

  it.each(['', 'bad key', '密钥', 'DEEPSEEK_API_KEY=sk-example', '"sk-example"', '`sk-example`'])(
    'rejects invalid input before sending it: %s', (value) => {
      const view = mount()
      fireEvent.click(view.button('#api-key'))
      view.enterKey(value)
      view.submit()
      expect(view.api.saveApiKey).not.toHaveBeenCalled()
      expect(view.document.querySelector<HTMLElement>('#key-error')!.hidden).toBe(false)
      expect(view.input.getAttribute('aria-invalid')).toBe('true')
    },
  )

  it('retains an unsaved draft and allows retry after a refused save', async () => {
    const view = mount()
    view.api.saveApiKey.mockResolvedValue({ ok: false })
    fireEvent.click(view.button('#api-key'))
    view.enterKey('sk-retry')
    view.submit()
    await vi.waitFor(() => { expect(view.button('#save-key').disabled).toBe(false) })
    expect(view.input.value).toBe('sk-retry')
    expect(view.document.querySelector('#key-error')!.textContent).toBe(view.api.messages.welcomeKeyFailed)
    view.api.saveApiKey.mockResolvedValue({ ok: true })
    view.submit()
    await vi.waitFor(() => { expect(view.input.value).toBe('') })
  })

  it('skips without saving and starts a fresh renderer at the entry again', async () => {
    const view = mount()
    const skipped = Promise.withResolvers<undefined>()
    view.api.skip.mockReturnValue(skipped.promise)
    fireEvent.click(view.button('#api-key'))
    view.enterKey('sk-not-saved')
    fireEvent.click(view.button('#skip-key'))
    try {
      expect(view.button('#save-key').textContent).toBe(view.api.messages.welcomeKeySave)
      expect(view.button('#skip-key').textContent).toBe(view.api.messages.welcomeKeyLater)
      expect(view.button('#save-key').disabled).toBe(true)
      expect(view.button('#skip-key').disabled).toBe(true)
      expect(view.button('#back-to-login').disabled).toBe(true)
      fireEvent.click(view.button('#skip-key'))
      view.submit()
      expect(view.api.skip).toHaveBeenCalledOnce()
      expect(view.api.saveApiKey).not.toHaveBeenCalled()
    } finally {
      skipped.resolve(undefined)
    }
    await vi.waitFor(() => { expect(view.input.value).toBe('') })
    expect(view.api.skip).toHaveBeenCalledOnce()
    expect(view.api.saveApiKey).not.toHaveBeenCalled()
    expect(mount().document.querySelector<HTMLElement>('#key-form')!.hidden).toBe(true)
  })

  it('returns to the entry without saving and clears the draft and validation error', () => {
    const view = mount()
    fireEvent.click(view.button('#api-key'))
    view.enterKey('invalid key')
    view.submit()
    fireEvent.click(view.button('#back-to-login'))
    expect(view.document.querySelector<HTMLElement>('#key-form')!.hidden).toBe(true)
    expect(view.document.activeElement).toBe(view.button('#api-key'))
    expect(view.input.value).toBe('')
    expect(view.api.saveApiKey).not.toHaveBeenCalled()
    expect(view.api.skip).not.toHaveBeenCalled()
    fireEvent.click(view.button('#api-key'))
    expect(view.input.value).toBe('')
    expect(view.document.querySelector<HTMLElement>('#key-error')!.hidden).toBe(true)
    expect(view.button('#save-key').disabled).toBe(true)
  })

  it('keeps visible copy in the shell dictionaries and denies network access', () => {
    expect([...html.matchAll(/>([^<]*\p{L}[^<]*)</gu)]).toEqual([])
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("form-action 'none'")
  })
})

it.each(['zh-CN', 'en'])('renders %s timeout with manual retry and API-key alternative', async (language) => {
  const view = mount(language)
  const receive = (state: AccountView) => { act(() => { view.api.onAccountState.mock.calls[0]![0](state) }) }
  receive({ status: 'signed-out', links: { usageUrl: '', topUpUrl: '' }, attempt: { id: 'expired' as NonNullable<AccountView['attempt']>['id'], phase: 'expired' } })
  expect(view.button('#auth-retry').hidden).toBe(false)
  expect(view.button('#auth-api-key').hidden).toBe(false)
  expect(view.api.startSignIn).not.toHaveBeenCalled()
  await expect(view.copy() + view.document.querySelector('#auth-description')!.textContent + '\n').toMatchFileSnapshot(`./expected/welcome/${language}-timeout.expected.txt`)
  fireEvent.click(view.button('#auth-api-key'))
  expect(view.document.querySelector('#auth-page')!.hasAttribute('hidden')).toBe(true)
  expect(view.document.querySelector('#key-form')!.hasAttribute('hidden')).toBe(false)
})

it.each(['zh-CN', 'en'])('renders %s browser fallback and copies only the active login link', async (language) => {
  const view = mount(language)
  const receive = (state: AccountView) => { act(() => { view.api.onAccountState.mock.calls[0]![0](state) }) }
  const waiting: AccountView = { status: 'signed-out', links: { usageUrl: '', topUpUrl: '' },
    attempt: { id: 'waiting' as NonNullable<AccountView['attempt']>['id'], phase: 'waiting-browser', authorizeUrl: 'https://example.test/login' } }
  receive(waiting)
  await expect(view.copy() + view.document.querySelector('#auth-description')!.textContent + '\n')
    .toMatchFileSnapshot(`./expected/welcome/${language}-waiting.expected.txt`)
  fireEvent.click(view.button('#auth-copy'))
  await vi.waitFor(() => { expect(view.button('#auth-copy').textContent).toBe(view.api.messages.welcomeAuthCopied) })
  expect(view.api.copySignInLink).toHaveBeenCalledWith('waiting')
  await vi.waitFor(() => { expect(view.button('#auth-copy').disabled).toBe(false) }, { timeout: 3000 })
  view.api.copySignInLink.mockRejectedValueOnce(new Error('clipboard unavailable'))
  fireEvent.click(view.button('#auth-copy'))
  await vi.waitFor(() => { expect(view.button('#auth-copy').textContent).toBe(view.api.messages.welcomeAuthCopyFailed) })
  expect(view.button('#auth-cancel').disabled).toBe(false)
  receive({ ...waiting, attempt: { ...waiting.attempt!, phase: 'exchanging' } })
  expect(view.button('#auth-copy').hidden).toBe(true)
  expect(view.button('#auth-loading').hidden).toBe(false)
  receive({ ...waiting, attempt: { ...waiting.attempt!, phase: 'cancelled' } })
  expect(view.document.querySelector('main')!.classList.contains('waiting-page')).toBe(false)
})

it('keeps a newer account notification when the start response arrives late', async () => {
  const view = mount()
  const started = Promise.withResolvers<AccountView>()
  view.api.startSignIn.mockReturnValueOnce(started.promise)
  fireEvent.click(view.button('#sign-in'))
  expect(view.button('#auth-cancel').disabled).toBe(true)
  const state: AccountView = { status: 'signed-out', links: { usageUrl: '', topUpUrl: '' },
    attempt: { id: 'attempt' as NonNullable<AccountView['attempt']>['id'], phase: 'expired' } }
  act(() => { view.api.onAccountState.mock.calls[0]![0](state) })
  await act(async () => { started.resolve({ ...state, attempt: { ...state.attempt!, phase: 'waiting-browser' } }); await started.promise })
  expect(view.document.querySelector('#auth-status')!.textContent).toBe(view.api.messages.welcomeAuthExpired)
  expect(view.button('#auth-retry').hidden).toBe(false)
})

it('does not restore a copied-link status after leaving the waiting phase', async () => {
  const view = mount()
  const copied = Promise.withResolvers<undefined>()
  view.api.copySignInLink.mockReturnValueOnce(copied.promise)
  const waiting: AccountView = { status: 'signed-out', links: { usageUrl: '', topUpUrl: '' },
    attempt: { id: 'attempt' as NonNullable<AccountView['attempt']>['id'], phase: 'waiting-browser' } }
  act(() => { view.api.onAccountState.mock.calls[0]![0](waiting) })
  fireEvent.click(view.button('#auth-copy'))
  expect(view.button('#auth-copy').disabled).toBe(true)
  act(() => { view.api.onAccountState.mock.calls[0]![0]({ ...waiting, attempt: { ...waiting.attempt!, phase: 'exchanging' } }) })
  await act(async () => { copied.resolve(undefined); await copied.promise })
  expect(view.button('#auth-copy').hidden).toBe(true)
  expect(view.button('#auth-copy').textContent).toBe(view.api.messages.welcomeAuthCopyLink)
})

it('keeps the key draft while account notifications arrive and releases the subscription on unmount', () => {
  const view = mount()
  fireEvent.click(view.button('#api-key'))
  view.enterKey('sk-draft')
  act(() => { view.api.onAccountState.mock.calls[0]![0]({ status: 'signed-out', links: { usageUrl: '', topUpUrl: '' },
    attempt: { id: 'expired' as NonNullable<AccountView['attempt']>['id'], phase: 'expired' } }) })
  expect(view.document.querySelector<HTMLElement>('#key-form')!.hidden).toBe(false)
  expect(view.input.value).toBe('sk-draft')
  view.unmount()
  expect(view.stopAccount).toHaveBeenCalledOnce()
})

it.each(['copied', 'failed'] as const)('restores the copy action after %s feedback and cleans up on unmount', async (result) => {
  vi.useFakeTimers()
  try {
    const view = mount('en')
    if (result === 'failed') view.api.copySignInLink.mockRejectedValue(new Error('clipboard unavailable'))
    const waiting: AccountView = { status: 'signed-out', links: { usageUrl: '', topUpUrl: '' },
      attempt: { id: 'waiting' as NonNullable<AccountView['attempt']>['id'], phase: 'waiting-browser' } }
    act(() => { view.api.onAccountState.mock.calls[0]![0](waiting) })
    const feedback = result === 'copied' ? view.api.messages.welcomeAuthCopied : view.api.messages.welcomeAuthCopyFailed
    const copy = async () => { await act(async () => { fireEvent.click(view.button('#auth-copy')) }) }
    await copy()
    expect(view.button('#auth-copy').textContent).toBe(feedback)
    expect(view.button('#auth-copy').disabled).toBe(result === 'copied')
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    await copy()
    expect(view.api.copySignInLink).toHaveBeenCalledTimes(result === 'copied' ? 1 : 2)
    await act(async () => { await vi.advanceTimersByTimeAsync(result === 'copied' ? 499 : 1999) })
    expect(view.button('#auth-copy').textContent).toBe(feedback)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(view.button('#auth-copy').textContent).toBe(view.api.messages.welcomeAuthCopyLink)
    expect(view.button('#auth-copy').disabled).toBe(false)
    await copy()
    expect(view.api.copySignInLink).toHaveBeenCalledTimes(result === 'copied' ? 2 : 3)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    cleanup()
    vi.useRealTimers()
  }
})

describe('desktop welcome MCP access step', () => {
  const loaded = async (view: ReturnType<typeof mount>) => {
    await vi.waitFor(() => { expect(view.button('#mcp-later').disabled).toBe(false) })
  }

  it.each(['zh-CN', 'en'])('opens on the %s setup step instead of the account entry', async (language) => {
    const view = mount(language, { page: 'mcp' })
    await loaded(view)
    expect(view.document.querySelector<HTMLElement>('#mcp-form')!.hidden).toBe(false)
    expect(view.document.querySelector<HTMLElement>('#key-form')!.hidden).toBe(true)
    expect(view.document.querySelector<HTMLElement>('#tagline')!.hidden).toBe(true)
    expect(view.field('#mcp-secscan').type).toBe('password')
    expect(view.field('#mcp-seclayer').type).toBe('password')
    expect(view.field('#mcp-runner').type).toBe('password')
    expect(view.field('#mcp-endpoint').value).toBe('http://127.0.0.1:8787/mcp')
    expect(view.document.activeElement).toBe(view.field('#mcp-secscan'))
    expect(view.api.readMcp).toHaveBeenCalledOnce()
    expect(view.button('#mcp-save').disabled).toBe(true)
    await expect(view.copy()).toMatchFileSnapshot(`./expected/welcome/${language}-mcp.expected.txt`)
  })

  it('stores one trimmed draft and continues to the account step', async () => {
    const view = mount('en', { page: 'mcp' })
    await loaded(view)
    fireEvent.change(view.field('#mcp-secscan'), { target: { value: '  ssk_onetime-test-token  ' } })
    fireEvent.change(view.field('#mcp-runner'), { target: { value: 'runner-onetime-test-token' } })
    expect(view.button('#mcp-save').disabled).toBe(false)
    view.submitMcp()
    view.submitMcp()
    expect(view.api.saveMcp).toHaveBeenCalledExactlyOnceWith({
      secscan: '  ssk_onetime-test-token  ', seclayer: '', runner: 'runner-onetime-test-token', endpoint: 'http://127.0.0.1:8787/mcp',
    })
    await vi.waitFor(() => { expect(view.document.querySelector<HTMLElement>('#mcp-form')!.hidden).toBe(true) })
    expect(view.document.querySelector<HTMLElement>('#tagline')!.hidden).toBe(false)
    expect(view.api.finishMcp).not.toHaveBeenCalled()
    // A token must never survive in the rendered document once it has been stored.
    expect(view.document.body.textContent).not.toContain('ssk_onetime-test-token')
    expect(view.document.body.textContent).not.toContain('runner-onetime-test-token')
    expect(view.field('#mcp-secscan').value).toBe('')
  })

  it('enables Save for a Seclayer-only edit and stores the key (GATE B)', async () => {
    const view = mount('en', { page: 'mcp' })
    await loaded(view)
    expect(view.field('#mcp-seclayer').type).toBe('password')
    expect(view.button('#mcp-save').disabled).toBe(true)
    fireEvent.change(view.field('#mcp-seclayer'), { target: { value: 'seclayer-test-key-0003' } })
    expect(view.button('#mcp-save').disabled).toBe(false)
    view.submitMcp()
    expect(view.api.saveMcp).toHaveBeenCalledExactlyOnceWith({
      secscan: '', seclayer: 'seclayer-test-key-0003', runner: '', endpoint: 'http://127.0.0.1:8787/mcp',
    })
    await vi.waitFor(() => { expect(view.document.querySelector<HTMLElement>('#mcp-form')!.hidden).toBe(true) })
    // The stored key must not survive in the rendered document or the field.
    expect(view.field('#mcp-seclayer').value).toBe('')
    expect(view.document.body.textContent).not.toContain('seclayer-test-key-0003')
  })

  it('shows all three stored fingerprints and the environment note for an inherited Seclayer key', async () => {
    const view = mount('en', {
      page: 'mcp',
      mcp: {
        required: false, entryRequired: false, stored: true,
        fingerprints: { SECSCAN_MCP_TOKEN: 'ssk_…0001', SECLAYER_API_KEY: 'secl…0003', REDTEAM_UI_TOKEN: 'rtr_…0002' },
        fromEnvironment: ['SECLAYER_API_KEY'],
      },
    })
    await loaded(view)
    const stored = view.document.querySelector('#mcp-stored')!.textContent
    expect(stored).toContain('ssk_…0001')
    expect(stored).toContain('secl…0003')
    expect(stored).toContain('rtr_…0002')
    expect(view.document.querySelector<HTMLElement>('#mcp-environment')!.hidden).toBe(false)
    expect(view.document.querySelector('#mcp-environment')!.textContent).toBe(view.api.messages.welcomeMcpEnvironment)
  })

  it('finishes first run directly when the account step has nothing to ask', async () => {
    const view = mount('en', { page: 'mcp', mcp: { required: false, entryRequired: false } })
    await loaded(view)
    expect(view.button('#mcp-later').textContent).toBe(view.api.messages.welcomeMcpClose)
    fireEvent.change(view.field('#mcp-secscan'), { target: { value: 'ssk_rotation-test-token' } })
    view.submitMcp()
    await vi.waitFor(() => { expect(view.api.finishMcp).toHaveBeenCalledOnce() })
    // The host closes this window or opens the workspace; the step never routes to the account entry.
    expect(view.document.querySelector<HTMLElement>('#mcp-form')!.hidden).toBe(false)
    expect(view.document.querySelector<HTMLElement>('#tagline')!.hidden).toBe(true)
  })

  it('leaves the step without storing anything when it is dismissed', async () => {
    const view = mount('en', { page: 'mcp' })
    await loaded(view)
    expect(view.button('#mcp-later').textContent).toBe(view.api.messages.welcomeMcpLater)
    fireEvent.click(view.button('#mcp-later'))
    await vi.waitFor(() => { expect(view.api.finishMcp).toHaveBeenCalledOnce() })
    expect(view.api.saveMcp).not.toHaveBeenCalled()
    expect(view.api.clearMcp).not.toHaveBeenCalled()
  })

  it.each(['bad token', 'SECSCAN_MCP_TOKEN=ssk_assignment'])('refuses %s before the host sees it', async (value) => {
    const view = mount('en', { page: 'mcp' })
    await loaded(view)
    fireEvent.change(view.field('#mcp-secscan'), { target: { value } })
    view.submitMcp()
    expect(view.api.saveMcp).not.toHaveBeenCalled()
    expect(view.document.querySelector<HTMLElement>('#mcp-error')!.hidden).toBe(false)
    expect(view.document.querySelector('#mcp-error')!.textContent).toBe(view.api.messages.welcomeMcpInvalid)
  })

  it('refuses a console address that would send the token off the loopback', async () => {
    const view = mount('en', { page: 'mcp' })
    await loaded(view)
    fireEvent.change(view.field('#mcp-secscan'), { target: { value: 'ssk_loopback-test-token' } })
    fireEvent.change(view.field('#mcp-endpoint'), { target: { value: 'http://console.example.test/mcp' } })
    view.submitMcp()
    expect(view.api.saveMcp).not.toHaveBeenCalled()
    expect(view.document.querySelector('#mcp-error')!.textContent).toBe(view.api.messages.welcomeMcpEndpointInvalid)
    expect(view.document.querySelector<HTMLElement>('#mcp-error')!.hidden).toBe(false)
  })

  it('retains the drafts when the host refuses a save', async () => {
    const view = mount('en', { page: 'mcp' })
    await loaded(view)
    view.api.saveMcp.mockResolvedValue({ ok: false })
    fireEvent.change(view.field('#mcp-secscan'), { target: { value: 'ssk_refused-test-token' } })
    view.submitMcp()
    await vi.waitFor(() => { expect(view.document.querySelector<HTMLElement>('#mcp-error')!.hidden).toBe(false) })
    expect(view.document.querySelector('#mcp-error')!.textContent).toBe(view.api.messages.welcomeMcpFailed)
    expect(view.field('#mcp-secscan').value).toBe('ssk_refused-test-token')
    expect(view.document.body.textContent).not.toContain('ssk_refused-test-token')
  })

  it('shows stored fingerprints, an environment note, and removes the document on request', async () => {
    const view = mount('en', {
      page: 'mcp',
      mcp: {
        required: false, entryRequired: false, stored: true,
        fingerprints: { SECSCAN_MCP_TOKEN: 'ssk_…0001', REDTEAM_UI_TOKEN: 'rtr_…0002' },
        fromEnvironment: ['REDTEAM_MCP_URL'],
      },
    })
    await loaded(view)
    expect(view.document.querySelector('#mcp-stored')!.textContent).toContain('ssk_…0001')
    expect(view.document.querySelector('#mcp-stored')!.textContent).toContain('rtr_…0002')
    expect(view.document.querySelector<HTMLElement>('#mcp-environment')!.hidden).toBe(false)
    view.api.readMcp.mockResolvedValue({ ...unconfiguredMcp, stored: false })
    fireEvent.click(view.button('#mcp-remove'))
    await vi.waitFor(() => { expect(view.api.clearMcp).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(view.document.querySelector('#mcp-remove')).toBeNull() })
    expect(view.api.readMcp).toHaveBeenCalledTimes(2)
  })
})
