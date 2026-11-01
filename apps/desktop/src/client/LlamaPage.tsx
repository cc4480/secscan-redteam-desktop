/** Local-models manager page: llama-server status, installed GGUFs, Hub downloads and runtime settings. */
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type {
  LlamaDownloadPhase,
  LlamaDownloadProgress,
  LlamaModel,
  LlamaOperations,
  LlamaRepoFile,
  LlamaServerState,
  LlamaServerStatus,
  LlamaSettings,
} from '../llama-api.ts'

const STATUS_LABEL: Record<LlamaServerStatus, string> = {
  stopped: 'Stopped',
  starting: 'Starting',
  running: 'Running',
  error: 'Error',
}

const PHASE_LABEL: Record<LlamaDownloadPhase, string> = {
  listing: 'Listing files',
  downloading: 'Downloading',
  verifying: 'Verifying',
  done: 'Finishing',
  error: 'Failed',
  cancelled: 'Cancelled',
}

const CONTEXT_MIN = 512
const CONTEXT_MAX = 1048576
const THREADS_MIN = 1
const THREADS_MAX = 256

/** Hugging Face repository ids are two path-safe segments (`owner/name`); anything else never reaches the bridge. */
const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/

/** One download the page is tracking; the model id is only known once progress arrives. */
interface DownloadTask {
  readonly repo: string
  readonly file: string
  id?: string
  progress?: LlamaDownloadProgress
}

/**
 * Byte count as user-facing text: MB below a gibibyte, GB above it.
 * @param bytes - exact byte count.
 * @returns size text with one or two decimals.
 */
function sizeText(bytes: number): string {
  const mib = bytes / (1024 * 1024)
  return mib < 1024 ? `${mib.toFixed(1)} MB` : `${(mib / 1024).toFixed(2)} GB`
}

/**
 * Progress text for the bytes seen so far.
 * @param progress - one download event.
 * @returns received size alone, or `received / total` when the Hub reported a total.
 */
function progressText(progress: LlamaDownloadProgress): string {
  const received = sizeText(progress.receivedBytes)
  if (progress.totalBytes === undefined || progress.totalBytes <= 0) return received
  return `${received} / ${sizeText(progress.totalBytes)}`
}

/**
 * Whole-number percent for a download when the total size is known.
 * @param progress - one download event.
 * @returns 0-100, or `null` while the total is unknown.
 */
function progressPercent(progress: LlamaDownloadProgress): number | null {
  if (progress.totalBytes === undefined || progress.totalBytes <= 0) return null
  const ratio = (progress.receivedBytes / progress.totalBytes) * 100
  return Math.min(100, Math.max(0, Math.round(ratio)))
}

/**
 * Download date as a short locale date.
 * @param epochMs - epoch milliseconds from the model registry.
 * @returns locale date text, or `--` for an unusable value.
 */
function dateText(epochMs: number): string {
  const date = new Date(epochMs)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * Operator-facing failure text for a bridge rejection.
 * @param error - rejection reason.
 * @param fallback - text used when the reason carries no message.
 * @returns the error message or the fallback.
 */
function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback
}

/**
 * Render the local-models manager page against the preload bridge.
 * @param props.api - isolated `window.dshLlama` operations; the renderer never touches the network itself.
 * @returns server status, installed models, Hub download and settings panels.
 */
export function LlamaPage({ api }: { api: LlamaOperations }) {
  const [server, setServer] = useState<LlamaServerState>({ status: 'stopped' })
  const [models, setModels] = useState<LlamaModel[]>([])
  const [settings, setSettings] = useState<LlamaSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [serverError, setServerError] = useState('')
  const [serverBusy, setServerBusy] = useState<'start' | 'stop' | null>(null)
  const [modelsError, setModelsError] = useState('')
  const [modelsNotice, setModelsNotice] = useState('')
  const [usingModelId, setUsingModelId] = useState<string | null>(null)
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null)
  const [confirmModelId, setConfirmModelId] = useState<string | null>(null)
  const [repoDraft, setRepoDraft] = useState('')
  const [repo, setRepo] = useState('')
  const [repoFiles, setRepoFiles] = useState<LlamaRepoFile[]>([])
  const [listing, setListing] = useState(false)
  const [repoError, setRepoError] = useState('')
  const [download, setDownload] = useState<DownloadTask | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [downloadNotice, setDownloadNotice] = useState('')
  const [contextDraft, setContextDraft] = useState('')
  const [threadsDraft, setThreadsDraft] = useState('')
  const [startOnLaunchDraft, setStartOnLaunchDraft] = useState(false)
  const [tokenDraft, setTokenDraft] = useState('')
  const [hasStoredToken, setHasStoredToken] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [settingsNotice, setSettingsNotice] = useState('')
  const mounted = useRef(true)
  const serverAction = useRef(false)
  const modelAction = useRef(false)
  const listAction = useRef(false)
  const downloadAction = useRef(false)
  const saveAction = useRef(false)
  const cancelRequested = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Bridge events keep the page current while the host changes state on its own (launch, crash, download).
  useEffect(() => {
    const stopServerEvents = api.onServerState((state) => {
      if (!mounted.current) return
      setServer(state)
    })
    const stopProgressEvents = api.onDownloadProgress((progress) => {
      if (!mounted.current) return
      setDownload((current) => {
        if (current === null) return current
        if (current.id !== undefined && current.id !== progress.id) return current
        return { ...current, id: current.id ?? progress.id, progress }
      })
    })
    return () => { stopServerEvents(); stopProgressEvents() }
  }, [api])

  useEffect(() => {
    let live = true
    const load = async () => {
      const [stateResult, modelsResult, settingsResult] = await Promise.allSettled([
        api.getServerState(),
        api.listModels(),
        api.getSettings(),
      ])
      if (!live || !mounted.current) return
      const failures: string[] = []
      if (stateResult.status === 'fulfilled') {
        setServer(stateResult.value)
      } else {
        failures.push('server status')
      }
      if (modelsResult.status === 'fulfilled') {
        setModels(modelsResult.value)
      } else {
        failures.push('installed models')
      }
      if (settingsResult.status === 'fulfilled') {
        const stored = settingsResult.value
        setSettings(stored)
        setContextDraft(String(stored.contextLength))
        setThreadsDraft(String(stored.threads))
        setStartOnLaunchDraft(stored.startOnLaunch)
        setHasStoredToken(stored.huggingFaceToken !== undefined && stored.huggingFaceToken !== '')
      } else {
        failures.push('settings')
      }
      setLoading(false)
      if (failures.length > 0) setLoadError(`Could not load ${failures.join(', ')}. Close and reopen this window.`)
    }
    void load()
    return () => { live = false }
  }, [api])

  async function startServer() {
    if (serverAction.current) return
    serverAction.current = true
    setServerBusy('start')
    setServerError('')
    try {
      const state = await api.startServer()
      if (mounted.current) setServer(state)
    } catch (error) {
      if (mounted.current) setServerError(errorText(error, 'The local model server could not be started.'))
    } finally {
      serverAction.current = false
      if (mounted.current) setServerBusy(null)
    }
  }

  async function stopServer() {
    if (serverAction.current) return
    serverAction.current = true
    setServerBusy('stop')
    setServerError('')
    try {
      const state = await api.stopServer()
      if (mounted.current) setServer(state)
    } catch (error) {
      if (mounted.current) setServerError(errorText(error, 'The local model server could not be stopped.'))
    } finally {
      serverAction.current = false
      if (mounted.current) setServerBusy(null)
    }
  }

  async function useModel(model: LlamaModel) {
    if (settings === null || modelAction.current || serverAction.current) return
    modelAction.current = true
    setUsingModelId(model.id)
    setModelsError('')
    setModelsNotice('')
    try {
      const saved = await api.saveSettings({ ...settings, activeModelId: model.id })
      if (!mounted.current) return
      setSettings(saved)
      const state = await api.startServer()
      if (mounted.current) {
        setServer(state)
        setModelsNotice(`Serving ${model.file}.`)
      }
    } catch (error) {
      if (mounted.current) setModelsError(errorText(error, `Could not serve ${model.file}.`))
    } finally {
      modelAction.current = false
      if (mounted.current) setUsingModelId(null)
    }
  }

  async function deleteModel(model: LlamaModel) {
    if (modelAction.current || serverAction.current) return
    modelAction.current = true
    setDeletingModelId(model.id)
    setConfirmModelId(null)
    setModelsError('')
    setModelsNotice('')
    try {
      await api.deleteModel(model.id)
      const [list, stored] = await Promise.all([api.listModels(), api.getSettings()])
      if (!mounted.current) return
      setModels(list)
      setSettings(stored)
      setModelsNotice(`Deleted ${model.file}.`)
    } catch (error) {
      if (mounted.current) setModelsError(errorText(error, `Could not delete ${model.file}.`))
    } finally {
      modelAction.current = false
      if (mounted.current) setDeletingModelId(null)
    }
  }

  async function listFiles(event: FormEvent) {
    event.preventDefault()
    if (listAction.current) return
    const target = repoDraft.trim()
    if (!REPO_PATTERN.test(target)) {
      setRepoError('Enter a Hugging Face repo as owner/name, for example mradermacher/Huihui-Qwen3.8-27B-abliterated-GGUF.')
      return
    }
    listAction.current = true
    setListing(true)
    setRepoError('')
    setRepoFiles([])
    setRepo('')
    setDownloadNotice('')
    try {
      const files = await api.listRepoFiles(target)
      if (!mounted.current) return
      setRepo(target)
      setRepoFiles(files)
      if (files.length === 0) setRepoError('That repository lists no .gguf files.')
    } catch (error) {
      if (mounted.current) setRepoError(errorText(error, 'The repository files could not be listed.'))
    } finally {
      listAction.current = false
      if (mounted.current) setListing(false)
    }
  }

  async function downloadFile(file: LlamaRepoFile) {
    if (download !== null || downloadAction.current || repo === '') return
    downloadAction.current = true
    cancelRequested.current = false
    setDownload({ repo, file: file.file })
    setDownloadError('')
    setDownloadNotice('')
    try {
      const model = await api.downloadModel({ repo, file: file.file })
      if (!mounted.current) return
      setDownload(null)
      setDownloadNotice(`Downloaded ${model.file}.`)
      const [list, stored] = await Promise.all([api.listModels(), api.getSettings()])
      if (!mounted.current) return
      setModels(list)
      setSettings(stored)
    } catch (error) {
      if (!mounted.current) return
      setDownload(null)
      if (cancelRequested.current) setDownloadNotice(`Cancelled ${file.file}.`)
      else setDownloadError(errorText(error, `The download of ${file.file} failed.`))
    } finally {
      downloadAction.current = false
    }
  }

  async function cancelDownload() {
    if (download === null || download.id === undefined || cancelling) return
    cancelRequested.current = true
    setCancelling(true)
    try {
      await api.cancelDownload(download.id)
    } catch (error) {
      cancelRequested.current = false
      if (mounted.current) setDownloadError(errorText(error, 'The download could not be cancelled.'))
    } finally {
      if (mounted.current) setCancelling(false)
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault()
    if (settings === null || saveAction.current) return
    const contextLength = Number(contextDraft.trim())
    const threads = Number(threadsDraft.trim())
    if (!Number.isInteger(contextLength) || contextLength < CONTEXT_MIN || contextLength > CONTEXT_MAX) {
      setSettingsError(`Context length must be a whole number between ${CONTEXT_MIN} and ${CONTEXT_MAX}.`)
      return
    }
    if (!Number.isInteger(threads) || threads < THREADS_MIN || threads > THREADS_MAX) {
      setSettingsError(`Threads must be a whole number between ${THREADS_MIN} and ${THREADS_MAX}.`)
      return
    }
    const token = tokenDraft.trim()
    if (token !== '' && !/^[\x21-\x7e]+$/.test(token)) {
      setSettingsError('The Hugging Face token must be printable ASCII without spaces.')
      return
    }
    saveAction.current = true
    setSavingSettings(true)
    setSettingsError('')
    setSettingsNotice('')
    try {
      // A blank token field leaves the stored token alone: saveSettings replaces the whole object.
      const next: LlamaSettings = token !== ''
        ? { ...settings, contextLength, threads, startOnLaunch: startOnLaunchDraft, huggingFaceToken: token }
        : { ...settings, contextLength, threads, startOnLaunch: startOnLaunchDraft }
      const saved = await api.saveSettings(next)
      if (!mounted.current) return
      setSettings(saved)
      setContextDraft(String(saved.contextLength))
      setThreadsDraft(String(saved.threads))
      setStartOnLaunchDraft(saved.startOnLaunch)
      setTokenDraft('')
      setHasStoredToken(saved.huggingFaceToken !== undefined && saved.huggingFaceToken !== '')
      setSettingsNotice('Settings saved.')
    } catch (error) {
      if (mounted.current) setSettingsError(errorText(error, 'The settings could not be saved.'))
    } finally {
      saveAction.current = false
      if (mounted.current) setSavingSettings(false)
    }
  }

  function resetDrafts() {
    if (settings === null) return
    setContextDraft(String(settings.contextLength))
    setThreadsDraft(String(settings.threads))
    setStartOnLaunchDraft(settings.startOnLaunch)
    setTokenDraft('')
    setSettingsError('')
    setSettingsNotice('')
  }

  const activeModelId = settings === null ? null : settings.activeModelId
  const servingModel = models.find(model => model.id === server.modelId)
  const servingName = servingModel === undefined ? server.modelId ?? '--' : servingModel.file
  const modelBusy = usingModelId !== null || deletingModelId !== null
  const actionsBusy = modelBusy || serverBusy !== null
  const downloadProgress = download === null ? undefined : download.progress
  const downloadPercent = downloadProgress === undefined ? null : progressPercent(downloadProgress)
  const downloadText = downloadProgress === undefined
    ? 'Preparing the download'
    : downloadPercent === null
      ? progressText(downloadProgress)
      : `${downloadPercent}% - ${progressText(downloadProgress)}`
  const canStart = activeModelId !== null && server.status !== 'running' && server.status !== 'starting'
  const canStop = server.status === 'running' || server.status === 'starting'

  return <>
    <div className="titlebar" aria-hidden="true" />
    <main className="llama" aria-label="Local models">
      <header className="llama-header">
        <div className="llama-heading">
          <h1 className="llama-title">Local models</h1>
          <p className="llama-subtitle">Runs a bundled llama-server on this machine and serves the selected GGUF model to the app.</p>
        </div>
      </header>
      {loading ? <p className="muted" role="status">Loading local model settings...</p> : null}
      {loadError !== '' ? <p className="inline-error" role="alert">{loadError}</p> : null}

      <section className="panel" aria-labelledby="llama-server-heading">
        <div className="panel-heading">
          <h2 id="llama-server-heading" className="panel-title">Server</h2>
          <span className={`status-pill status-pill--${server.status}`} role="status" aria-live="polite">
            {STATUS_LABEL[server.status]}
          </span>
        </div>
        <dl className="llama-facts">
          <dt>Model</dt>
          <dd>{servingName}</dd>
          <dt>Base URL</dt>
          <dd className="llama-mono">{server.baseUrl === undefined ? 'Not running' : server.baseUrl}</dd>
        </dl>
        {server.status === 'error' && server.error !== undefined ? <p className="inline-error" role="alert">{server.error}</p> : null}
        {serverError !== '' ? <p className="inline-error" role="alert">{serverError}</p> : null}
        <div className="button-row">
          <button className="primary" type="button"
            disabled={serverBusy !== null || !canStart} onClick={() => { void startServer() }}>
            {serverBusy === 'start' ? 'Starting...' : 'Start server'}
          </button>
          <button className="secondary" type="button"
            disabled={serverBusy !== null || !canStop} onClick={() => { void stopServer() }}>
            {serverBusy === 'stop' ? 'Stopping...' : 'Stop server'}
          </button>
        </div>
        {activeModelId === null ? <p className="muted">Select a model below to start the server.</p> : null}
      </section>

      <section className="panel" aria-labelledby="llama-models-heading">
        <div className="panel-heading">
          <h2 id="llama-models-heading" className="panel-title">Installed models</h2>
          <span className="muted">{models.length === 1 ? '1 model' : `${models.length} models`}</span>
        </div>
        {modelsError !== '' ? <p className="inline-error" role="alert">{modelsError}</p> : null}
        {modelsNotice !== '' ? <p className="inline-note" role="status">{modelsNotice}</p> : null}
        {models.length === 0
          ? <p className="empty-state">No models downloaded yet. Add one from Hugging Face below.</p>
          : <table className="model-table">
            <caption className="visually-hidden">Installed GGUF models</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col" className="numeric">Quant</th>
                <th scope="col" className="numeric">Size</th>
                <th scope="col" className="numeric">Downloaded</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {models.map(model => (
                <tr key={model.id} aria-busy={deletingModelId === model.id}>
                  <th scope="row">
                    <span className="llama-model-line">
                      <span className="llama-model-name">{model.file}</span>
                      <span className="llama-model-repo">{model.repo}</span>
                      {model.id === activeModelId ? <span className="llama-model-active">Active</span> : null}
                      {model.companionPath !== undefined ? <span className="llama-model-companion">Vision projector attached</span> : null}
                    </span>
                  </th>
                  <td className="numeric">{model.quantization === undefined ? '--' : model.quantization}</td>
                  <td className="numeric">{sizeText(model.sizeBytes)}</td>
                  <td className="numeric">{dateText(model.downloadedAt)}</td>
                  <td className="row-actions">
                    {confirmModelId === model.id
                      ? <>
                        <button className="danger small" type="button"
                          aria-label={`Confirm delete ${model.file}`} disabled={actionsBusy}
                          onClick={() => { void deleteModel(model) }}>
                          {deletingModelId === model.id ? 'Deleting...' : 'Confirm delete'}
                        </button>
                        <button className="secondary small" type="button"
                          disabled={actionsBusy} onClick={() => { setConfirmModelId(null) }}>Cancel</button>
                      </>
                      : <>
                        <button className="secondary small" type="button"
                          aria-label={`Use ${model.file}`} disabled={actionsBusy || settings === null}
                          onClick={() => { void useModel(model) }}>
                          {usingModelId === model.id ? 'Starting...' : 'Use'}
                        </button>
                        <button className="secondary small" type="button"
                          aria-label={`Delete ${model.file}`} disabled={actionsBusy}
                          onClick={() => { setConfirmModelId(model.id) }}>Delete</button>
                      </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>}
      </section>

      <section className="panel" aria-labelledby="llama-add-heading">
        <div className="panel-heading">
          <h2 id="llama-add-heading" className="panel-title">Add from Hugging Face</h2>
        </div>
        <form className="field" noValidate onSubmit={(event) => { void listFiles(event) }} aria-busy={listing}>
          <label className="field-label" htmlFor="llama-repo-input">Repository</label>
          <div className="button-row">
            <input id="llama-repo-input" type="text" value={repoDraft}
              disabled={listing || download !== null} placeholder="mradermacher/Huihui-Qwen3.8-27B-abliterated-GGUF"
              autoComplete="off" autoCapitalize="off" spellCheck={false}
              aria-describedby={repoError === '' ? undefined : 'llama-repo-error'}
              onChange={(event) => { setRepoDraft(event.target.value); setRepoError('') }} />
            <button className="secondary" type="submit"
              disabled={listing || download !== null || repoDraft.trim() === ''}>
              {listing ? 'Listing files...' : 'List files'}
            </button>
          </div>
        </form>
        {repoError !== '' ? <p id="llama-repo-error" className="inline-error" role="alert">{repoError}</p> : null}
        {downloadError !== '' ? <p className="inline-error" role="alert">{downloadError}</p> : null}
        {downloadNotice !== '' ? <p className="inline-note" role="status">{downloadNotice}</p> : null}
        {download !== null
          ? <div className="progress" role="group" aria-label={`Download of ${download.file}`}>
            <div className="progress-label">
              <span className="llama-download-name">{download.file}</span>
              <span className="muted">{downloadProgress === undefined ? 'Preparing' : PHASE_LABEL[downloadProgress.phase]}</span>
            </div>
            {downloadPercent === null
              ? <progress className="llama-progress" max={100} aria-label={`Download of ${download.file} is starting`} />
              : <progress className="llama-progress" max={100} value={downloadPercent} aria-label={`Download of ${download.file}`} />}
            <div className="progress-label">
              <span className="muted" aria-live="polite">{downloadText}</span>
              <button className="secondary small" type="button"
                disabled={cancelling || download.id === undefined} onClick={() => { void cancelDownload() }}>
                {cancelling ? 'Cancelling...' : 'Cancel download'}
              </button>
            </div>
          </div>
          : null}
        {repoFiles.length > 0
          ? <ul className="list" aria-label={`Files in ${repo}`}>
            {repoFiles.map(file => (
              <li key={file.file} className="list-row">
                <span className="list-row-label llama-file-name">{file.file}</span>
                <span className="list-row-meta">{file.sizeBytes === undefined ? 'Size unknown' : sizeText(file.sizeBytes)}</span>
                <button className="primary small" type="button"
                  aria-label={`Download ${file.file}`} disabled={download !== null || !file.isGguf}
                  onClick={() => { void downloadFile(file) }}>
                  Download
                </button>
              </li>
            ))}
          </ul>
          : null}
      </section>

      <section className="panel" aria-labelledby="llama-settings-heading">
        <div className="panel-heading">
          <h2 id="llama-settings-heading" className="panel-title">Settings</h2>
        </div>
        {settings === null
          ? <p className="empty-state">Settings are not available.</p>
          : <form className="llama-settings" noValidate onSubmit={(event) => { void saveSettings(event) }} aria-busy={savingSettings}>
            <div className="field">
              <label className="field-label" htmlFor="llama-context-input">Context length</label>
              <input id="llama-context-input" type="number" inputMode="numeric"
                min={CONTEXT_MIN} max={CONTEXT_MAX} step={1} value={contextDraft} disabled={savingSettings}
                onChange={(event) => { setContextDraft(event.target.value); setSettingsError('') }} />
              <p className="field-hint">Tokens of context passed to llama-server. The default is 32768.</p>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="llama-threads-input">Threads</label>
              <input id="llama-threads-input" type="number" inputMode="numeric"
                min={THREADS_MIN} max={THREADS_MAX} step={1} value={threadsDraft} disabled={savingSettings}
                onChange={(event) => { setThreadsDraft(event.target.value); setSettingsError('') }} />
              <p className="field-hint">CPU threads used for generation.</p>
            </div>
            <label className="checkbox-field" htmlFor="llama-start-on-launch">
              <input id="llama-start-on-launch" type="checkbox" checked={startOnLaunchDraft} disabled={savingSettings}
                onChange={(event) => { setStartOnLaunchDraft(event.target.checked); setSettingsError('') }} />
              <span>Start the local model server when the app launches</span>
            </label>
            <div className="field">
              <label className="field-label" htmlFor="llama-token-input">Hugging Face token (optional)</label>
              <input id="llama-token-input" type="password" autoComplete="off" autoCapitalize="off"
                spellCheck={false} value={tokenDraft} disabled={savingSettings}
                placeholder={hasStoredToken ? 'A token is saved; leave blank to keep it' : 'For gated repositories'}
                onChange={(event) => { setTokenDraft(event.target.value); setSettingsError('') }} />
              <p className="field-hint">A saved token is never shown again. Leave this field blank to keep it.</p>
            </div>
            {settingsError !== '' ? <p className="inline-error" role="alert">{settingsError}</p> : null}
            {settingsNotice !== '' ? <p className="inline-note" role="status">{settingsNotice}</p> : null}
            <div className="button-row">
              <button className="primary" type="submit" disabled={savingSettings}>
                {savingSettings ? 'Saving...' : 'Save settings'}
              </button>
              <button className="secondary" type="button" disabled={savingSettings}
                onClick={resetDrafts}>Reset</button>
            </div>
          </form>}
      </section>
    </main>
  </>
}
