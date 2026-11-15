/**
 * Per-model lifecycle controls for the Local models section, and the
 * wrapper component the registration seats: the section component takes
 * its action controls through the `renderModelAction` /
 * `renderFolderModelAction` prop seam and its download form through
 * the `renderDownloadForm` seam, and this package provides them here,
 * wired to the injected `localModels` Remote actions.
 *
 * The controls render in both serving modes. A model row gets Start
 * (load) or Stop (unload) by its load state and Delete behind an
 * inline confirm; in Ollama mode it also gets Download (pull — the
 * host runs it as a job and this control polls the job's own reported
 * progress). In llama mode the per-row Download gives way to the
 * section's Hugging Face download form: a pull there names a
 * repository that is not in the registry yet, so no existing row can
 * name it — the form lists the repository's files and the operator
 * picks one to download. Folder rows get no
 * control in either mode: in llama mode the section's model list is
 * the registry itself, so its rows already carry the controls, and in
 * Ollama mode no honest action exists for an on-disk registry GGUF.
 */

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { LocalModelPullStatus, LocalModelsStatus } from '@deepseek-ai/dsh-api-remotes/client'
import { LocalModelsSection } from './LocalModelsSection.tsx'
import type {
  LocalModelContextState,
  LocalModelRepoFile,
  LocalModelStatusEntry,
  LocalModelsSectionInjected,
  LocalModelsSectionProps,
} from './LocalModelsSection.tsx'
import css from './LocalModelsSection.module.css'

type Translate = LocalModelsSectionProps['t']

/** The controls' state for one row: at rest, awaiting a delete confirm, busy with one action, or showing a failure. */
type ModelActionPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'confirming-delete' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'stopping' }
  | { readonly kind: 'deleting' }
  | { readonly kind: 'pulling'; readonly jobId: string }
  | { readonly kind: 'failed'; readonly message: string }

/** Props of one served row's lifecycle controls. */
interface ModelActionControlsProps {
  /** The row's served-model entry. */
  readonly model: LocalModelStatusEntry
  /** How the local provider is served; an unset context window defaults to the model's own maximum in both modes (the catalog maximum in Ollama mode, the GGUF-declared maximum in llama mode). */
  readonly serving: LocalModelsStatus['serving']
  /** Whether this row offers Download by its own id: true in Ollama mode, where the pull names a served model; in llama mode the download form names the repository instead. */
  readonly showDownload: boolean
  /** The section's injected Remote face. */
  readonly actions: LocalModelsSectionInjected
  /** The section's locale-bound translate function. */
  readonly t: Translate
  /** Called after an action settles successfully, so the section re-reads its status. */
  readonly onSettled: () => void
}

/**
 * @param error - a rejected action call.
 * @returns the message to show for it.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The context control's state: still reading the persisted setting, at rest with it, saving, or showing a failure. */
type ContextPhase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'failed'; readonly message: string }

/** Props of one served row's context-window control. */
interface ContextControlProps {
  /** The row's served-model entry. */
  readonly model: LocalModelStatusEntry
  /** How the local provider is served; decides what the unset default reads as when no maximum is known. */
  readonly serving: LocalModelsStatus['serving']
  /** The section's injected Remote face. */
  readonly actions: LocalModelsSectionInjected
  /** The section's locale-bound translate function. */
  readonly t: Translate
  /** Called after a save or clear settles successfully, so the section re-reads its status. */
  readonly onSettled: () => void
}

/**
 * Render one model's editable context-window control: a numeric input
 * holding the effective value — the persisted setting when one exists,
 * otherwise the model's own maximum, auto-filled so the operator
 * never has to know or type the ceiling — with that maximum enforced
 * as the input's ceiling, and Save / Use-default actions through the
 * context Remote actions. Unset is a real state, never a zero or a
 * blank confusion: the field shows the maximum a Start will use, the
 * hint names it as the default, and Use default (shown only while a
 * value is persisted) clears back to it. Only when no maximum is
 * known does the field stay empty, with the hint naming the server
 * setting as the llama-mode fallback. A rejected save (for example
 * above the maximum) lands in the row as the host's error.
 * @param props - the row's model, the serving mode, the Remote face, the translate function, and the settled callback.
 * @returns the context control element.
 */
/**
 * The draft a context read-back state leaves in the field: its
 * persisted value, or its auto-filled maximum while unset.
 * @param state - the host's read-back of the model's context setting.
 * @param fallbackMaximum - the row entry's own maximum, when the read-back names none.
 * @returns the input's text.
 */
function draftOf(state: LocalModelContextState, fallbackMaximum: number | undefined): string {
  const effective = state.contextLength ?? state.maxContextLength ?? fallbackMaximum
  return effective === undefined ? '' : String(effective)
}

export function ContextControl({ model, serving, actions, t, onSettled }: ContextControlProps): ReactNode {
  const [phase, setPhase] = useState<ContextPhase>({ kind: 'loading' })
  const [context, setContext] = useState<LocalModelContextState | undefined>(undefined)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    let current = true
    void (async () => {
      try {
        const state = await actions.getModelContext(model.id)
        if (!current) return
        setContext(state)
        setDraft(draftOf(state, model.maxContextLength))
        setPhase({ kind: 'idle' })
      } catch (error) {
        if (current) setPhase({ kind: 'failed', message: messageOf(error) })
      }
    })()
    return () => { current = false }
  }, [actions, model.id, model.maxContextLength])

  /**
   * Run one save or clear: show the saving state, adopt the host's
   * read-back on success, and surface the failure in the row.
   * @param call - the Remote context action to run.
   */
  const run = (call: () => Promise<LocalModelContextState>): void => {
    setPhase({ kind: 'saving' })
    void (async () => {
      try {
        const state = await call()
        setContext(state)
        setDraft(draftOf(state, model.maxContextLength))
        setPhase({ kind: 'idle' })
        onSettled()
      } catch (error) {
        setPhase({ kind: 'failed', message: messageOf(error) })
      }
    })()
  }

  const maximum = context?.maxContextLength ?? model.maxContextLength
  const persisted = context?.contextLength
  const busy = phase.kind === 'loading' || phase.kind === 'saving'
  const parsed = Number(draft)
  const saveDisabled = busy || draft.trim() === '' || !Number.isSafeInteger(parsed) || parsed <= 0
    || parsed === (persisted ?? maximum)
  const defaultHint = serving === 'ollama' || maximum !== undefined
    ? t('contextDefaultMaximum')
    : t('contextDefaultServer')

  return (
    <span className={css.contextForm}>
      <label className={css.fieldLabel} htmlFor={`context-${model.id}`}>{t('contextLabel')}</label>
      <input
        className={css.contextInput}
        id={`context-${model.id}`}
        type="number"
        min={1}
        {...maximum === undefined ? {} : { max: maximum }}
        placeholder={maximum === undefined ? '' : String(maximum)}
        value={draft}
        disabled={busy}
        onChange={event => setDraft(event.target.value)}
      />
      {persisted === undefined && phase.kind !== 'loading' ? (
        <span className={css.actionStatus}>{defaultHint}</span>
      ) : null}
      <button
        className={css.actionButton}
        type="button"
        disabled={saveDisabled}
        onClick={() => run(() => actions.setModelContext(model.id, parsed))}
      >
        {t('contextSave')}
      </button>
      {persisted !== undefined ? (
        <button
          className={css.actionButton}
          type="button"
          disabled={busy}
          onClick={() => run(() => actions.clearModelContext(model.id))}
        >
          {t('contextClear')}
        </button>
      ) : null}
      {phase.kind === 'saving' ? <span className={css.actionStatus}>{t('contextSaving')}</span> : null}
      {phase.kind === 'failed' ? (
        <span className={css.actionError} role="alert">{phase.message}</span>
      ) : null}
    </span>
  )
}

/** Render one model's Start/Stop, Download (Ollama mode), and Delete controls with their pending and failure states. */
export function ModelActionControls({ model, serving, showDownload, actions, t, onSettled }: ModelActionControlsProps): ReactNode {
  const [phase, setPhase] = useState<ModelActionPhase>({ kind: 'idle' })
  const [pull, setPull] = useState<LocalModelPullStatus | undefined>(undefined)

  const busy = phase.kind === 'starting' || phase.kind === 'stopping'
    || phase.kind === 'deleting' || phase.kind === 'pulling'

  /**
   * Run one load/unload/delete action: show its pending state, refresh
   * the section on success, and surface the failure in the row.
   * @param kind - the pending phase to show while the call runs.
   * @param call - the Remote action to run.
   */
  const run = (kind: 'starting' | 'stopping' | 'deleting', call: () => Promise<unknown>): void => {
    setPhase({ kind })
    void (async () => {
      try {
        await call()
        onSettled()
      } catch (error) {
        setPhase({ kind: 'failed', message: messageOf(error) })
      }
    })()
  }

  /** Start a pull for this row's model and move the controls into the polling phase. */
  const download = (): void => {
    void (async () => {
      try {
        const { jobId } = await actions.startPull(model.id)
        setPull(undefined)
        setPhase({ kind: 'pulling', jobId })
      } catch (error) {
        setPhase({ kind: 'failed', message: messageOf(error) })
      }
    })()
  }

  // While a pull runs, poll the host job: its own phase text and layer
  // byte counts are the progress shown, and its settlement either
  // refreshes the section (done) or lands in the row as a failure.
  useEffect(() => {
    if (phase.kind !== 'pulling') return
    let current = true
    const tick = async (): Promise<void> => {
      try {
        const status = await actions.pullStatus(phase.jobId)
        if (!current) return
        setPull(status)
        if (status.state === 'done') onSettled()
        else if (status.state === 'failed') setPhase({ kind: 'failed', message: status.error ?? '' })
      } catch (error) {
        if (current) setPhase({ kind: 'failed', message: messageOf(error) })
      }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, 1000)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [phase, actions, onSettled])

  const pendingLabel = phase.kind === 'starting' ? t('starting')
    : phase.kind === 'stopping' ? t('stopping')
    : phase.kind === 'deleting' ? t('deleting')
    : undefined

  const pullPercent = pull !== undefined && pull.totalBytes !== undefined && pull.totalBytes > 0
    && pull.completedBytes !== undefined
    ? Math.floor((pull.completedBytes / pull.totalBytes) * 100)
    : undefined
  const pullText = phase.kind === 'pulling'
    ? [
      pull?.status === undefined ? t('download') : t('pullProgress', { status: pull.status }),
      ...pullPercent === undefined ? [] : [t('pullPercent', { percent: String(pullPercent) })],
    ].join(' ')
    : undefined

  return (
    <>
    <span className={css.actions}>
      {phase.kind === 'confirming-delete' ? (
        <>
          <button
            className={css.actionButton}
            type="button"
            onClick={() => run('deleting', () => actions.deleteModel(model.id))}
          >
            {t('confirmDelete')}
          </button>
          <button className={css.actionButton} type="button" onClick={() => setPhase({ kind: 'idle' })}>
            {t('cancel')}
          </button>
        </>
      ) : (
        <>
          {model.loaded ? (
            <button
              className={css.actionButton}
              type="button"
              disabled={busy}
              onClick={() => run('stopping', () => actions.stopModel(model.id))}
            >
              {t('stop')}
            </button>
          ) : (
            <button
              className={css.actionButton}
              type="button"
              disabled={busy}
              onClick={() => run('starting', () => actions.startModel(model.id))}
            >
              {t('start')}
            </button>
          )}
          {showDownload ? (
            <button className={css.actionButton} type="button" disabled={busy} onClick={download}>
              {t('download')}
            </button>
          ) : null}
          <button
            className={css.actionButton}
            type="button"
            disabled={busy}
            onClick={() => setPhase({ kind: 'confirming-delete' })}
          >
            {t('delete')}
          </button>
          {pendingLabel !== undefined ? <span className={css.actionStatus}>{pendingLabel}</span> : null}
          {pullText !== undefined ? <span className={css.actionStatus}>{pullText}</span> : null}
          {pullPercent !== undefined ? (
            <span
              className={css.progressTrack}
              role="progressbar"
              aria-valuenow={pullPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span className={css.progressFill} style={{ width: `${pullPercent}%` }} />
            </span>
          ) : null}
        </>
      )}
      {phase.kind === 'failed' ? (
        <p className={css.actionError} role="alert">{phase.message}</p>
      ) : null}
    </span>
    <ContextControl model={model} serving={serving} actions={actions} t={t} onSettled={onSettled} />
    </>
  )
}

/** The download form's state: at rest, listing a repository, starting a picked file's pull job, polling it, or showing a failure. */
type DownloadFormPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'listing' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'pulling'; readonly jobId: string }
  | { readonly kind: 'failed'; readonly message: string }

/** Props of the section's Hugging Face download form. */
interface HfDownloadFormProps {
  /** The section's injected Remote face. */
  readonly actions: LocalModelsSectionInjected
  /** The section's locale-bound translate function. */
  readonly t: Translate
  /** Called after the download settles successfully, so the section re-reads its status. */
  readonly onSettled: () => void
}

/**
 * Format one repository file's size the way the desktop page did: MB
 * below a gibibyte, GB above it, through the locale's unit templates.
 * @param sizeBytes - the file's byte count, when the Hub reported one.
 * @param t - the section's translate function.
 * @returns the size text, or the unknown-size text when unreported.
 */
function repoFileSize(sizeBytes: number | undefined, t: Translate): string {
  if (sizeBytes === undefined) return t('fileSizeUnknown')
  const mib = sizeBytes / (1024 * 1024)
  return mib < 1024
    ? t('fileSizeMb', { size: mib.toFixed(1) })
    : t('fileSizeGb', { size: (mib / 1024).toFixed(2) })
}

/**
 * Render the Hugging Face download form (llama mode), the desktop
 * page's list-and-pick flow: the operator names a repository, the
 * form lists its files through the host's listing action, and each
 * listed GGUF carries its own Download — no step requires typing an
 * exact file name. Picking a file starts the host's pull job for
 * `repository/file` (the one `modelId` string the Remote pull takes);
 * while the job runs, the form polls it and shows its own phase text
 * and byte counts — the same progress the Ollama per-row Download
 * shows; on done the section re-reads its status, so the downloaded
 * model appears in the list, and a failure lands in the form as the
 * error the host reported. Projector files are listed for size
 * context but carry no Download: the host fetches the projector
 * automatically as the companion of a model from the same repository.
 * @param props - the injected Remote face, the translate function, and the settled callback.
 * @returns the download form element.
 */
export function HfDownloadForm({ actions, t, onSettled }: HfDownloadFormProps): ReactNode {
  const [repo, setRepo] = useState('')
  const [listedRepo, setListedRepo] = useState('')
  const [repoFiles, setRepoFiles] = useState<readonly LocalModelRepoFile[]>([])
  const [phase, setPhase] = useState<DownloadFormPhase>({ kind: 'idle' })
  const [pull, setPull] = useState<LocalModelPullStatus | undefined>(undefined)

  const busy = phase.kind === 'listing' || phase.kind === 'starting' || phase.kind === 'pulling'

  /** List the named repository's files and render them for picking. */
  const list = (): void => {
    const repository = repo.trim()
    if (repository === '') return
    setPhase({ kind: 'listing' })
    void (async () => {
      try {
        const files = await actions.listRepoFiles(repository)
        setListedRepo(repository)
        setRepoFiles(files)
        setPhase({ kind: 'idle' })
      } catch (error) {
        setPhase({ kind: 'failed', message: messageOf(error) })
      }
    })()
  }

  /**
   * Start a pull for one picked file and move the form into the polling phase.
   * @param file - the picked repository file.
   */
  const download = (file: LocalModelRepoFile): void => {
    setPhase({ kind: 'starting' })
    void (async () => {
      try {
        const { jobId } = await actions.startPull(`${listedRepo}/${file.file}`)
        setPull(undefined)
        setPhase({ kind: 'pulling', jobId })
      } catch (error) {
        setPhase({ kind: 'failed', message: messageOf(error) })
      }
    })()
  }

  // While the pull runs, poll the host job: its own phase text and
  // layer byte counts are the progress shown, and its settlement
  // either refreshes the section (done) or lands in the form as a
  // failure carrying the error the host reported.
  useEffect(() => {
    if (phase.kind !== 'pulling') return
    let current = true
    const tick = async (): Promise<void> => {
      try {
        const status = await actions.pullStatus(phase.jobId)
        if (!current) return
        setPull(status)
        if (status.state === 'done') onSettled()
        else if (status.state === 'failed') {
          setPhase({ kind: 'failed', message: status.error ?? t('downloadFailed') })
        }
      } catch (error) {
        if (current) setPhase({ kind: 'failed', message: messageOf(error) })
      }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, 1000)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [phase, actions, onSettled, t])

  const pullPercent = pull !== undefined && pull.totalBytes !== undefined && pull.totalBytes > 0
    && pull.completedBytes !== undefined
    ? Math.floor((pull.completedBytes / pull.totalBytes) * 100)
    : undefined
  const pullText = phase.kind === 'pulling'
    ? [
      pull?.status === undefined ? t('download') : t('pullProgress', { status: pull.status }),
      ...pullPercent === undefined ? [] : [t('pullPercent', { percent: String(pullPercent) })],
    ].join(' ')
    : undefined
  const downloadable = repoFiles.filter(file => file.isGguf)

  return (
    <section className={css.group}>
      <h3 className={css.subheading}>{t('downloadTitle')}</h3>
      <p className={css.hint}>{t('downloadIntro')}</p>
      <div className={css.downloadForm}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('hfRepo')}</span>
          <input
            className={css.input}
            type="text"
            value={repo}
            disabled={busy}
            onChange={event => setRepo(event.target.value)}
          />
        </label>
        <button
          className={css.actionButton}
          type="button"
          disabled={busy || repo.trim() === ''}
          onClick={list}
        >
          {phase.kind === 'listing' ? t('listingFiles') : t('listFiles')}
        </button>
        {pullText !== undefined ? <span className={css.actionStatus}>{pullText}</span> : null}
        {pullPercent !== undefined ? (
          <span
            className={css.progressTrack}
            role="progressbar"
            aria-valuenow={pullPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className={css.progressFill} style={{ width: `${pullPercent}%` }} />
          </span>
        ) : null}
      </div>
      {listedRepo !== '' && phase.kind !== 'listing' ? (
        downloadable.length === 0 ? (
          <p className={css.hint}>{t('repoEmpty')}</p>
        ) : (
          <>
            <h4 className={css.repoFilesHeading}>{t('repoFilesTitle', { repo: listedRepo })}</h4>
            <ul className={css.rows} aria-label={t('repoFilesTitle', { repo: listedRepo })}>
              {repoFiles.map(file => (
                <li className={css.row} key={file.file}>
                  <div className={css.rowHead}>
                    <span className={css.modelId}>{file.file}</span>
                    <span className={css.meta}>{repoFileSize(file.sizeBytes, t)}</span>
                    {file.isGguf ? (
                      <span className={css.actions}>
                        <button
                          className={css.actionButton}
                          type="button"
                          disabled={busy}
                          aria-label={t('downloadFile', { file: file.file })}
                          onClick={() => download(file)}
                        >
                          {t('download')}
                        </button>
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )
      ) : null}
      {phase.kind === 'failed' ? (
        <p className={css.actionError} role="alert">{phase.message}</p>
      ) : null}
    </section>
  )
}

/**
 * The section as this package registers it: the bare section component
 * plus this package's own action renderers for its prop seam. After any
 * action settles, the section remounts on a fresh key so it re-reads
 * the status the action changed.
 * @param props - the composed slot props, including the injected Remote face.
 * @returns the section element.
 */
export function LocalModelsSectionWithActions(props: LocalModelsSectionProps): ReactNode {
  const [generation, setGeneration] = useState(0)
  const settled = useCallback((): void => { setGeneration(value => value + 1) }, [])
  const {
    loadStatus, startModel, stopModel, deleteModel, startPull, pullStatus, listRepoFiles,
    getModelContext, setModelContext, clearModelContext, t,
  } = props
  const actions: LocalModelsSectionInjected = {
    loadStatus, startModel, stopModel, deleteModel, startPull, pullStatus, listRepoFiles,
    getModelContext, setModelContext, clearModelContext,
  }

  const renderModelAction = (model: LocalModelStatusEntry, status: LocalModelsStatus): ReactNode => (
    <ModelActionControls
      model={model}
      serving={status.serving}
      showDownload={status.serving === 'ollama'}
      actions={actions}
      t={t}
      onSettled={settled}
    />
  )
  // Provided and rendering nothing, deliberately: in llama mode the
  // model rows are the registry and already carry the controls, and in
  // Ollama mode no honest action exists for an on-disk registry GGUF
  // (see the header).
  const renderFolderModelAction = (): ReactNode => null
  // The Hugging Face download form exists only in llama mode: an
  // Ollama pull names a model its registry already knows, which the
  // per-row Download covers.
  const renderDownloadForm = (status: LocalModelsStatus): ReactNode => {
    if (status.serving !== 'llama') return null
    return <HfDownloadForm actions={actions} t={t} onSettled={settled} />
  }

  return (
    <LocalModelsSection
      key={generation}
      {...props}
      renderModelAction={renderModelAction}
      renderFolderModelAction={renderFolderModelAction}
      renderDownloadForm={renderDownloadForm}
    />
  )
}
