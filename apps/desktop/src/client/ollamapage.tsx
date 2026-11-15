/**
 * The Ollama surface.
 *
 * Mirrors the Local models page's job — see what is installed, fetch a model
 * with live progress, delete one — with two things the Hugging Face page cannot
 * show: the model's own detected context window and output budget (labelled
 * declared or derived), and whether the daemon declares it tool-capable, which is
 * the difference between an engagement that uses the app's tools and one that
 * silently never calls them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  OllamaConnection,
  OllamaModel,
  OllamaModelDetails,
  OllamaOperations,
  OllamaPullProgress,
  OllamaSelection,
} from '../ollama-api.ts'

/** Props: the bridge the preload exposed. */
export interface OllamaPageProps {
  readonly api: OllamaOperations
}

/** @param bytes - a byte count. @returns a short human size. */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

/** @param error - an unknown failure. @returns its message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * @param progress - a pull progress event.
 * @returns the completion fraction in 0..1, or undefined when the total is unknown.
 */
function fractionOf(progress: OllamaPullProgress): number | undefined {
  if (progress.totalBytes === undefined || progress.totalBytes <= 0) return undefined
  return Math.min(1, progress.receivedBytes / progress.totalBytes)
}

export function OllamaPage({ api }: OllamaPageProps): JSX.Element {
  const [connection, setConnection] = useState<OllamaConnection | undefined>(undefined)
  const [models, setModels] = useState<readonly OllamaModel[]>([])
  const [details, setDetails] = useState<Readonly<Record<string, OllamaModelDetails>>>({})
  const [selection, setSelection] = useState<OllamaSelection | undefined>(undefined)
  const [name, setName] = useState('')
  const [pull, setPull] = useState<OllamaPullProgress | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextConnection, nextModels, nextSelection] = await Promise.all([
        api.getConnection(),
        api.listModels().catch(() => [] as OllamaModel[]),
        api.getSelection(),
      ])
      setConnection(nextConnection)
      setModels(nextModels)
      setSelection(nextSelection)
      // Detail is what carries the limits and tool capability; a failed read leaves
      // that row's numbers blank rather than hiding the model.
      const read = await Promise.all(nextModels.map(async (model) => {
        try {
          return [model.name, await api.showModel(model.name)] as const
        } catch {
          return [model.name, undefined] as const
        }
      }))
      const table: Record<string, OllamaModelDetails> = {}
      for (const [key, value] of read) if (value !== undefined) table[key] = value
      setDetails(table)
      setError(undefined)
    } catch (failure) {
      setError(messageOf(failure))
    }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    // Progress arrives as an event, not a promise: subscribed once for the page's life.
    return api.onPullProgress((progress) => { setPull(progress) })
  }, [api])

  const startPull = useCallback(async (): Promise<void> => {
    const target = name.trim()
    if (target === '') return
    setBusy(true)
    setError(undefined)
    setPull({ name: target, phase: 'pulling', receivedBytes: 0 })
    try {
      await api.pullModel(target)
      setName('')
      await refresh()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
      setPull(undefined)
    }
  }, [api, name, refresh])

  const choose = useCallback(async (model: string | null): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      setSelection(await api.selectModel(model))
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }, [api])

  const remove = useCallback(async (model: string): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await api.deleteModel(model)
      await refresh()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }, [api, refresh])

  const active = selection?.activeModel ?? null
  const progress = pull === undefined ? undefined : fractionOf(pull)
  const reachable = connection?.reachable === true

  const rows = useMemo(() => models.map((model) => {
    const detail = details[model.name]
    return { model, detail }
  }), [models, details])

  return (
    <>
      <header className="titlebar"><h1>Ollama models</h1></header>
      <main>
        <section className="card">
          <div className="row">
            <span className={reachable ? 'badge ok' : 'badge warn'}>
              {reachable ? `daemon ${connection?.version ?? 'ready'}` : 'daemon unreachable'}
            </span>
            <span className="note mono">{connection?.baseUrl ?? '—'}</span>
            <span className="spacer" />
            <button onClick={() => { void refresh() }} disabled={busy}>Recheck</button>
          </div>
          {!reachable && connection?.error !== undefined
            ? <p className="note error">{connection.error}</p>
            : null}
          <p className="note">
            {active === null
              ? 'No model is selected: the engagement fleet is not routed to Ollama.'
              : <>The fleet is routed to <span className="mono">{active}</span>.</>}
          </p>
          {active !== null
            ? <button className="danger" onClick={() => { void choose(null) }} disabled={busy}>Stand down</button>
            : null}
        </section>

        <section className="card">
          <div className="row">
            <input
              type="text"
              placeholder="model to pull, e.g. llama3.2:3b"
              value={name}
              disabled={busy || !reachable}
              onChange={(event) => { setName(event.target.value) }}
              onKeyDown={(event) => { if (event.key === 'Enter') void startPull() }}
            />
            <button className="primary" onClick={() => { void startPull() }} disabled={busy || !reachable || name.trim() === ''}>
              Pull
            </button>
            {pull !== undefined
              ? <button onClick={() => { void api.cancelPull(pull.name) }}>Cancel</button>
              : null}
          </div>
          {pull !== undefined
            ? <>
              <div className="progress" style={{ marginTop: 10 }}>
                <span style={{ width: `${String(Math.round((progress ?? 0) * 100))}%` }} />
              </div>
              <p className="note">
                {pull.name} · {pull.phase}
                {pull.status === undefined ? '' : ` · ${pull.status}`}
                {pull.totalBytes === undefined
                  ? ''
                  : ` · ${formatBytes(pull.receivedBytes)} / ${formatBytes(pull.totalBytes)}`}
              </p>
            </>
            : <p className="note">Pulls stream from the daemon; the bytes land in Ollama's own store.</p>}
        </section>

        <section className="card">
          {rows.length === 0
            ? <p className="note">{reachable ? 'No models installed yet.' : 'Start the daemon to see installed models.'}</p>
            : <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Size</th>
                  <th>Context</th>
                  <th>Max output</th>
                  <th>Tools</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ model, detail }) => (
                  <tr key={model.name}>
                    <td className="mono">
                      {model.name}
                      {active === model.name ? <> <span className="badge ok">active</span></> : null}
                    </td>
                    <td>{formatBytes(model.sizeBytes)}</td>
                    <td>
                      {detail === undefined
                        ? '—'
                        : <>
                          {detail.contextLength.toLocaleString()}
                          {' '}
                          <span className={detail.contextSource === 'declared' ? 'badge' : 'badge muted'}>
                            {detail.contextSource}
                          </span>
                        </>}
                    </td>
                    <td>
                      {detail === undefined
                        ? '—'
                        : <>
                          {detail.maxOutputTokens.toLocaleString()}
                          {' '}
                          <span className={detail.maxOutputSource === 'declared' ? 'badge' : 'badge muted'}>
                            {detail.maxOutputSource}
                          </span>
                        </>}
                    </td>
                    <td>
                      {detail === undefined
                        ? '—'
                        : detail.supportsTools
                          ? <span className="badge ok">tools</span>
                          : detail.capabilitiesDeclared
                            ? <span className="badge warn" title="This model declares no tool support, so it cannot be selected for the fleet">no tools</span>
                            : <span className="badge muted" title="The daemon did not declare a capability list; tool support is unverified">unknown</span>}
                    </td>
                    <td>
                      <div className="row">
                        <button
                          className="primary"
                          disabled={busy || active === model.name}
                          onClick={() => { void choose(model.name) }}
                        >
                          Use
                        </button>
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() => { void remove(model.name) }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>}
          {error === undefined ? null : <p className="note error">{error}</p>}
        </section>
      </main>
    </>
  )
}
