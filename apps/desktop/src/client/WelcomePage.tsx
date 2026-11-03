/** Desktop welcome presentation; account and credential operations stay in the preload. */
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives/src/StateDot.tsx'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import { formatDesktopMessage } from '../locale.ts'
import type { McpServerStatusItem, ReadinessResult } from '../welcome-api.ts'
import type { WelcomeApi, WelcomeMcpState } from '../welcome-api.ts'

type Page = 'entry' | 'key' | 'account' | 'mcp'

/** Token field check mirroring the Host's rule, so an obvious mistake never leaves the window. */
function plausibleToken(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return true
  if (!/^[\x21-\x7e]+$/.test(trimmed)) return false
  return !/^[A-Za-z_][A-Za-z0-9_]*=/.test(trimmed)
}

/** Console field check mirroring the Host's loopback-or-https rule. */
function plausibleEndpoint(value: string): boolean {
  const trimmed = value.trim()
  return trimmed === '' || /^https:\/\//iu.test(trimmed) || /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?:[:/]|$)/iu.test(trimmed)
}

/** Welcome API extended with the tool-readiness check shown on the MCP step. */
export type WelcomeReadinessApi = WelcomeApi & {
  /** Runs the bundled runner's doctor once and returns a safe, secret-free view. */
  readiness(): Promise<ReadinessResult>
}

/**
 * Render the standalone welcome flow using shell-owned operations and localized copy.
 * @param props.api - isolated preload API; no account credentials reach the renderer.
 * @returns welcome pages with fixed bottom actions.
 */
export function Welcome({ api }: { api: WelcomeReadinessApi }) {
  const { messages: m } = api
  const [page, setPage] = useState<Page>(api.initialPage)
  const pageRef = useRef<Page>(api.initialPage)
  const [attempt, setAttempt] = useState<AccountView['attempt']>(null)
  const attemptRef = useRef<AccountView['attempt']>(null)
  const [starting, setStarting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState<{ status: 'idle' | 'busy' | 'copied' | 'failed' }>({ status: 'idle' })
  const copyState = copyFeedback.status
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mounted = useRef(true)
  const revision = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const keyButton = useRef<HTMLButtonElement>(null)
  const focusEntry = useRef(false)
  const [mcp, setMcp] = useState<WelcomeMcpState | null>(null)
  const [secscanDraft, setSecscanDraft] = useState('')
  const [seclayerDraft, setSeclayerDraft] = useState('')
  const [runnerDraft, setRunnerDraft] = useState('')
  const [endpointDraft, setEndpointDraft] = useState('')
  const [mcpError, setMcpError] = useState('')
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null)
  const [readinessLoading, setReadinessLoading] = useState(false)
  const secscanInput = useRef<HTMLInputElement>(null)

  function navigate(next: Page) {
    pageRef.current = next
    setPage(next)
  }
  function showAccount(state: AccountView) {
    if (pageRef.current === 'key' || pageRef.current === 'mcp' || (state.attempt === null && pageRef.current === 'entry')) return
    attemptRef.current = state.attempt
    setAttempt(state.attempt)
    setStarting(false)
    setCopyFeedback({ status: 'idle' })
    navigate(state.attempt?.phase === 'cancelled' ? 'entry' : 'account')
  }

  useEffect(() => {
    mounted.current = true
    document.documentElement.lang = api.id
    document.title = m.welcomeTitle
    const stop = api.onAccountState((state) => {
      revision.current++
      showAccount(state)
    })
    return () => { mounted.current = false; stop() }
  }, [api, m.welcomeTitle])

  useEffect(() => {
    if (page !== 'mcp') return
    let live = true
    void api.readMcp().then((view) => {
      if (!live || !mounted.current) return
      setMcp(view)
      setEndpointDraft(view.endpoint)
    }).catch(() => {
      if (live && mounted.current) setMcpError(m.welcomeMcpFailed)
    })
    return () => { live = false }
  }, [api, page, m.welcomeMcpFailed])

  useEffect(() => {
    if (page !== 'mcp') return
    let live = true
    setReadinessLoading(true)
    setReadiness(null)
    void (async () => {
      try {
        const result = await api.readiness()
        if (live && mounted.current) setReadiness(result)
      } catch {
        if (live && mounted.current) setReadiness({ ok: false, reason: m.welcomeReadinessUnavailable })
      } finally {
        if (live && mounted.current) setReadinessLoading(false)
      }
    })()
    return () => { live = false }
  }, [api, page, m.welcomeReadinessUnavailable])

  useEffect(() => {
    if (page === 'key') input.current?.focus()
    else if (page === 'mcp') secscanInput.current?.focus()
    else if (page === 'entry' && focusEntry.current) {
      focusEntry.current = false
      keyButton.current?.focus()
    }
  }, [page])

  useEffect(() => {
    if (copyState !== 'copied' && copyState !== 'failed') return
    const timer = setTimeout(() => { setCopyFeedback({ status: 'idle' }) }, 2000)
    return () => { clearTimeout(timer) }
  }, [copyFeedback])

  async function saveKey(event: FormEvent) {
    event.preventDefault()
    if (busyRef.current) return
    const value = draft.trim()
    if (!/^[\x21-\x7e]+$/.test(value) || /^[A-Z][A-Z0-9_]*=[^=]/.test(value)
      || ((value.startsWith('"') || value.startsWith("'") || value.charCodeAt(0) === 96) && value.at(-1) === value[0])) {
      setError(value === '' ? m.welcomeKeyBlank : m.welcomeKeyInvalid)
      input.current?.focus()
      return
    }
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const result = await api.saveApiKey(value)
      if (!mounted.current) return
      if (result.ok) setDraft('')
      else setError(m.welcomeKeyFailed)
    } catch {
      if (mounted.current) setError(m.welcomeKeyFailed)
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function skip() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await api.skip()
      if (mounted.current) setDraft('')
    } catch {
      if (mounted.current) setError(m.welcomeContinueFailed)
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function start() {
    navigate('account')
    setStarting(true)
    setAttempt(null)
    attemptRef.current = null
    const current = ++revision.current
    try {
      const state = await api.startSignIn()
      if (mounted.current && revision.current === current) showAccount(state)
    } catch {
      if (mounted.current && revision.current === current) setStarting(false)
    }
  }
  async function cancel() {
    if (cancelling || attemptRef.current === null) return
    setCancelling(true)
    const current = ++revision.current
    try {
      const state = await api.cancelSignIn(attemptRef.current.id)
      if (mounted.current && revision.current === current) showAccount(state)
    } catch {
      // The current attempt remains visible so cancellation can be retried.
    } finally {
      if (mounted.current) setCancelling(false)
    }
  }
  async function copyLink() {
    const current = attemptRef.current
    if (current?.phase !== 'waiting-browser' || (copyState === 'busy' || copyState === 'copied')) return
    setCopyFeedback({ status: 'busy' })
    try {
      await api.copySignInLink(current.id)
      if (mounted.current && attemptRef.current === current) setCopyFeedback({ status: 'copied' })
    } catch {
      if (mounted.current && attemptRef.current === current) setCopyFeedback({ status: 'failed' })
    }
  }
  async function saveMcp(event: FormEvent) {
    event.preventDefault()
    if (busyRef.current || mcp === null) return
    if (!plausibleToken(secscanDraft) || !plausibleToken(seclayerDraft) || !plausibleToken(runnerDraft)) {
      setMcpError(m.welcomeMcpInvalid)
      return
    }
    if (!plausibleEndpoint(endpointDraft)) {
      setMcpError(m.welcomeMcpEndpointInvalid)
      return
    }
    busyRef.current = true
    setBusy(true)
    setMcpError('')
    try {
      const result = await api.saveMcp({ secscan: secscanDraft, seclayer: seclayerDraft, runner: runnerDraft, endpoint: endpointDraft })
      if (!mounted.current) return
      if (!result.ok) { setMcpError(m.welcomeMcpFailed); return }
      setSecscanDraft('')
      setSeclayerDraft('')
      setRunnerDraft('')
      // The account step still has to run on a fresh machine; otherwise the step's completion ends first run.
      if (mcp.entryRequired) navigate('entry')
      else await api.finishMcp()
    } catch {
      if (mounted.current) setMcpError(m.welcomeMcpFailed)
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function dismissMcp() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setMcpError('')
    try {
      await api.finishMcp()
    } catch {
      if (mounted.current) setMcpError(m.welcomeContinueFailed)
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function removeMcp() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setMcpError('')
    try {
      const result = await api.clearMcp()
      if (!mounted.current) return
      if (!result.ok) { setMcpError(m.welcomeMcpRemoveFailed); return }
      const view = await api.readMcp()
      if (mounted.current) setMcp(view)
    } catch {
      if (mounted.current) setMcpError(m.welcomeMcpRemoveFailed)
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function recheckReadiness() {
    if (readinessLoading) return
    setReadinessLoading(true)
    try {
      const result = await api.readiness()
      if (!mounted.current) return
      setReadiness(result)
    } catch {
      if (mounted.current) setReadiness({ ok: false, reason: m.welcomeReadinessUnavailable })
    } finally {
      if (mounted.current) setReadinessLoading(false)
    }
  }

  const phase = starting ? 'initializing' : attempt?.phase ?? 'failed'
  const waiting = phase === 'waiting-browser'
  const failed = phase === 'expired' || phase === 'failed'
  const title = phase === 'initializing' ? m.welcomeAuthStarting
    : waiting ? m.welcomeAuthWaiting : phase === 'expired' ? m.welcomeAuthExpired
      : phase === 'failed' ? m.welcomeAuthFailed : m.welcomeAuthExchanging
  const heading = page === 'entry' ? 'welcome-heading' : page === 'key' ? 'key-title' : page === 'mcp' ? 'mcp-title' : 'auth-status'
  /** Localized name of one MCP server row's probed state. */
  const serverStatusText = (server: McpServerStatusItem): string => {
    switch (server.state) {
      case 'connected': return m.welcomeMcpStatusConnected
      case 'failed': return m.welcomeMcpStatusFailed
      case 'no-tools': return m.welcomeMcpStatusNoTools
      case 'unkeyed': return m.welcomeMcpStatusUnkeyed
      case 'unpaired': return m.welcomeMcpStatusUnpaired
    }
  }

  const fingerprints = mcp === null ? [] : Object.values(mcp.fingerprints)
  const mcpChanged = secscanDraft.trim() !== '' || seclayerDraft.trim() !== ''
    || runnerDraft.trim() !== ''
    || (mcp !== null && endpointDraft.trim() !== mcp.endpoint)

  return <>
    <div className="titlebar" aria-hidden="true" />
    <main className="welcome" aria-labelledby={heading}>
      <img className="brand" src="assets/welcome-brand.svg" alt={m.welcomeBrand} width="472" height="40" />
      <div id="tagline" className="tagline" hidden={page !== 'entry'}>
        <h1 id="welcome-heading"><span>{m.welcomeTaglineBefore}</span><em>{m.welcomeTaglineBrand}</em><span>{m.welcomeTaglineAfter}</span></h1>
        <p id="welcome-description">{m.welcomeDescription}</p>
      </div>
      <form id="mcp-form" className="mcp-form" hidden={page !== 'mcp'} noValidate onSubmit={(event) => { void saveMcp(event) }} aria-busy={busy}>
        <header className="key-heading"><h1 id="mcp-title">{m.welcomeMcpTitle}</h1><p id="mcp-description">{m.welcomeMcpDescription}</p></header>
        <div className="mcp-fields">
          <div className="key-field">
            <label className="visually-hidden" htmlFor="mcp-secscan">{m.welcomeMcpSecscanPlaceholder}</label>
            <input ref={secscanInput} id="mcp-secscan" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false}
              placeholder={m.welcomeMcpSecscanPlaceholder} value={secscanDraft} disabled={busy}
              aria-describedby="mcp-description mcp-error" onChange={(event) => { setSecscanDraft(event.target.value); setMcpError('') }} />
          </div>
          <div className="key-field">
            <label className="visually-hidden" htmlFor="mcp-seclayer">{m.welcomeMcpSeclayerPlaceholder}</label>
            <input id="mcp-seclayer" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false}
              placeholder={m.welcomeMcpSeclayerPlaceholder} value={seclayerDraft} disabled={busy}
              onChange={(event) => { setSeclayerDraft(event.target.value); setMcpError('') }} />
          </div>
          <div className="key-field">
            <label className="visually-hidden" htmlFor="mcp-runner">{m.welcomeMcpRunnerPlaceholder}</label>
            <input id="mcp-runner" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false}
              placeholder={m.welcomeMcpRunnerPlaceholder} value={runnerDraft} disabled={busy}
              onChange={(event) => { setRunnerDraft(event.target.value); setMcpError('') }} />
          </div>
          <div className="key-field">
            <label className="visually-hidden" htmlFor="mcp-endpoint">{m.welcomeMcpEndpointPlaceholder}</label>
            <input id="mcp-endpoint" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false}
              placeholder={m.welcomeMcpEndpointPlaceholder} value={endpointDraft} disabled={busy}
              onChange={(event) => { setEndpointDraft(event.target.value); setMcpError('') }} />
          </div>
        </div>
        <p id="mcp-store" className="mcp-note">{mcp === null ? '' : formatDesktopMessage(m.welcomeMcpStore, { path: mcp.storePath })}</p>
        <p id="mcp-stored" className="mcp-note" hidden={fingerprints.length === 0}>
          {fingerprints.length === 0 ? '' : `${m.welcomeMcpStored} ${fingerprints.join(' · ')}`}
        </p>
        <p id="mcp-environment" className="mcp-note" hidden={mcp === null || mcp.fromEnvironment.length === 0}>
          {mcp !== null && mcp.fromEnvironment.length > 0 ? m.welcomeMcpEnvironment : ''}
        </p>
        <section id="mcp-server-status" className="readiness" aria-live="polite" hidden={mcp === null || mcp.servers.length === 0}>
          <header className="readiness-heading">
            <h2 className="readiness-title">{m.welcomeMcpStatusTitle}</h2>
          </header>
          <ul className="readiness-list">
            {(mcp?.servers ?? []).map(server => (
              <li key={server.id} id={`mcp-server-${server.id}`} className={`readiness-item readiness-item--${server.state}`}>
                <span className={`readiness-glyph readiness-glyph--${server.state}`} aria-hidden="true" />
                <span className="visually-hidden">{server.state}</span>
                <span className="readiness-item-label">{server.label}</span>
                <span className="readiness-item-detail">{serverStatusText(server)}</span>
                {server.state === 'connected' && server.toolCount !== undefined
                  ? <span className="readiness-item-detail">{formatDesktopMessage(m.welcomeMcpStatusTools, { count: String(server.toolCount) })}</span>
                  : null}
                {server.detail !== undefined ? <span className="readiness-item-detail">{server.detail}</span> : null}
              </li>
            ))}
          </ul>
        </section>
        <section className="readiness" aria-live="polite" aria-busy={readinessLoading}>
          <header className="readiness-heading">
            <h2 className="readiness-title">{m.welcomeReadinessTitle}</h2>
            <button className="readiness-recheck" type="button" disabled={readinessLoading} onClick={() => { void recheckReadiness() }}>
              {m.welcomeReadinessRecheck}
            </button>
          </header>
          {readinessLoading || readiness === null
            ? <p className="readiness-loading">{m.welcomeReadinessLoading}</p>
            : !readiness.ok
              ? <p className="readiness-unavailable">{readiness.reason}</p>
              : <>
                <p className="readiness-summary">{readiness.readiness.summary}</p>
                <ul className="readiness-list">
                  {readiness.readiness.items.map(item => (
                    <li key={item.id} className={`readiness-item readiness-item--${item.state}`}>
                      <span className={`readiness-glyph readiness-glyph--${item.state}`} aria-hidden="true" />
                      <span className="visually-hidden">{item.state}</span>
                      <span className="readiness-item-label">{item.label}</span>
                      {item.detail !== undefined ? <span className="readiness-item-detail">{item.detail}</span> : null}
                      {item.fix !== undefined
                        ? <details className="readiness-item-fix">
                          <summary>{m.welcomeReadinessFix}</summary>
                          <p>{item.fix}</p>
                        </details>
                        : null}
                    </li>
                  ))}
                </ul>
              </>}
        </section>
        <p id="mcp-error" className="mcp-error" role="alert" hidden={mcpError === ''}>{mcpError}</p>
      </form>
      <form id="key-form" className="key-form" hidden={page !== 'key'} noValidate onSubmit={(event) => { void saveKey(event) }} aria-busy={busy}>
        <header className="key-heading"><h1 id="key-title">{m.welcomeKeyTitle}</h1><p id="key-description">{m.welcomeKeyDescription}</p></header>
        <div className="key-field">
          <label className="visually-hidden" htmlFor="key-input">{m.welcomeKeyPlaceholder}</label>
          <input ref={input} id="key-input" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} required
            aria-describedby="key-description key-error" aria-invalid={error !== ''} placeholder={m.welcomeKeyPlaceholder}
            value={draft} disabled={busy} onChange={(event) => { setDraft(event.target.value); setError('') }} />
          <p id="key-error" className="key-error" role="alert" hidden={error === ''}>{error}</p>
        </div>
      </form>
      <section id="auth-page" className={`key-heading ${waiting ? 'auth-waiting' : phase === 'expired' ? 'auth-expired' : ''}`}
        hidden={page !== 'account'} aria-live="polite">
        <h1 id="auth-status">{title}</h1>
        <p id="auth-description" hidden={!waiting && phase !== 'expired'}>{waiting ? m.welcomeAuthWaitingDescription : m.welcomeAuthExpiredDescription}</p>
        <button id="auth-copy" className="copy-link" type="button" hidden={!waiting} disabled={!waiting || (copyState === 'busy' || copyState === 'copied')} onClick={() => { void copyLink() }}>
          {copyState === 'copied' ? m.welcomeAuthCopied : copyState === 'failed' ? m.welcomeAuthCopyFailed : m.welcomeAuthCopyLink}
        </button>
      </section>
      <div id="auth-actions" className="actions" hidden={page !== 'account'}>
        <button id="auth-loading" className="primary" type="button" hidden={failed} disabled aria-label={m.welcomeAuthExchanging}>
          <StateDot state="ongoing" size={16} className="welcome-loading" />
        </button>
        <button id="auth-retry" className="primary" type="button" hidden={!failed} onClick={() => { void start() }}>{m.welcomeAuthRetry}</button>
        <button id="auth-api-key" className="secondary" type="button" hidden={!failed} onClick={() => { navigate('key') }}>{m.welcomeApiKey}</button>
        <button id="auth-cancel" className="secondary" type="button" hidden={failed}
          disabled={cancelling || phase === 'committing' || phase === 'succeeded' || (phase === 'initializing' && !attempt?.id)}
          onClick={() => { void cancel() }}>{m.welcomeAuthCancel}</button>
      </div>
      <div id="entry-actions" className="actions" hidden={page !== 'entry'}>
        <button id="sign-in" className="primary" type="button" onClick={() => { void start() }}>{m.welcomeSignIn}</button>
        <button ref={keyButton} id="api-key" className="secondary" type="button" onClick={() => { navigate('key') }}>{m.welcomeApiKey}</button>
      </div>
      <div id="key-actions" className="actions" hidden={page !== 'key'}>
        <button id="save-key" className="primary" type="submit" form="key-form" disabled={busy || draft.trim() === ''}>{m.welcomeKeySave}</button>
        <button id="skip-key" className="secondary" type="button" disabled={busy} onClick={() => { void skip() }}>{m.welcomeKeyLater}</button>
        <button id="back-to-login" className="back" type="button" disabled={busy} onClick={() => {
          if (busyRef.current) return
          setDraft(''); setError(''); focusEntry.current = true; navigate('entry')
        }}>{m.welcomeKeyBack}</button>
      </div>
      <div id="mcp-actions" className="actions" hidden={page !== 'mcp'}>
        <button id="mcp-save" className="primary" type="submit" form="mcp-form" disabled={busy || mcp === null || !mcpChanged}>{m.welcomeMcpSave}</button>
        <button id="mcp-later" className="secondary" type="button" disabled={busy || mcp === null} onClick={() => { void dismissMcp() }}>
          {mcp !== null && !mcp.required ? m.welcomeMcpClose : m.welcomeMcpLater}
        </button>
        {mcp !== null && mcp.stored
          ? <button id="mcp-remove" className="back" type="button" disabled={busy} onClick={() => { void removeMcp() }}>{m.welcomeMcpRemove}</button>
          : null}
      </div>
    </main>
  </>
}
