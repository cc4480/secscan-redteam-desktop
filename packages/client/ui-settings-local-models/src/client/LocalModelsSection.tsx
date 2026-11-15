/**
 * Local models settings section: the local serving endpoint's status, the
 * models it serves with their load state, and the model files stored on
 * this host, read through the `localModels` Remote namespace. On-disk
 * files are listed separately from served models — being on disk does not
 * mean being served. A loaded model's runtime context allocation and its
 * maximum context are labeled as the different facts they are.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  LocalModelActionResult,
  LocalModelDeleteResult,
  LocalModelPullStart,
  LocalModelPullStatus,
  LocalModelsStatus,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './LocalModelsSection.module.css'

/** One served-model entry of the status payload. */
export type LocalModelStatusEntry = LocalModelsStatus['models'][number]

/** One on-disk model file entry of the status payload. */
export type LocalFolderModel = LocalModelsStatus['folderModels'][number]

/**
 * One model's persisted context-window setting, as the context actions
 * report it: `contextLength` is the persisted value, absent when unset
 * (an unset Ollama model starts at its catalog maximum; an unset llama
 * model starts at the server default), and `maxContextLength` is the
 * model's known maximum — the ceiling a set is validated against.
 */
export interface LocalModelContextState {
  /** Model id the setting belongs to, verbatim. */
  readonly modelId: string
  /** Persisted context length for the model, absent when unset. */
  readonly contextLength?: number
  /** The model's known maximum context length, when known. */
  readonly maxContextLength?: number
}

/**
 * One file a Hugging Face repository offers, as the repository-listing
 * action reports it: the download form lists these (name and size) and
 * the operator picks one, so no step requires typing an exact file
 * name. Defined here rather than imported from the Remote assembly
 * because the generated Remote client does not carry the listing
 * action yet — the same reason {@link LocalModelContextState} is
 * defined here.
 */
export interface LocalModelRepoFile {
  /** File path inside the repository, verbatim. */
  readonly file: string
  /** Bytes, when the Hub reports the file's size. */
  readonly sizeBytes?: number
  /** True for `.gguf` files the manager offers (never a projector). */
  readonly isGguf: boolean
  /** True for a vision projector (`mmproj-*.gguf`), a companion asset fetched automatically with a model from the same repository. */
  readonly isProjector?: boolean
}

/** Registration-side business face for the section. */
export interface LocalModelsSectionInjected {
  /**
   * Read the current local-models status from the Host.
   * @returns the status payload; rejects when the Remote call fails.
   */
  loadStatus: () => Promise<LocalModelsStatus>
  /**
   * Load one model into the host endpoint (in llama mode, load it into the host's llama-server).
   * @param modelId - the model to load, verbatim.
   * @returns the verified action outcome; rejects when the Remote call fails.
   */
  startModel: (modelId: string) => Promise<LocalModelActionResult>
  /**
   * Unload one model from the host endpoint (in llama mode, stop the host's llama-server serving it).
   * @param modelId - the model to unload, verbatim.
   * @returns the verified action outcome; rejects when the Remote call fails.
   */
  stopModel: (modelId: string) => Promise<LocalModelActionResult>
  /**
   * Delete one model from the host (in Ollama mode its library; in llama mode its registry and file).
   * @param modelId - the model to delete, verbatim.
   * @returns the verified action outcome; rejects when the Remote call fails.
   */
  deleteModel: (modelId: string) => Promise<LocalModelDeleteResult>
  /**
   * Start pulling one model on the host as a host-side job (in llama mode, a Hugging Face download named by the one `modelId` string: the repository, with the GGUF file appended after a `/` when one is named).
   * @param modelId - the model to pull, verbatim.
   * @returns the pull job's handle; rejects when the Remote call fails.
   */
  startPull: (modelId: string) => Promise<LocalModelPullStart>
  /**
   * List the files one Hugging Face repository offers from the Host (llama mode): the operator names a repository, sees its files with their sizes, and picks one to download.
   * @param repo - the repository to list, in `owner/name` form, verbatim.
   * @returns every file the repository offers; rejects when the Remote call fails.
   */
  listRepoFiles: (repo: string) => Promise<LocalModelRepoFile[]>
  /**
   * Read one pull job's progress from the Host.
   * @param jobId - the job handle `startPull` returned.
   * @returns the pull's current status; rejects when the Remote call fails.
   */
  pullStatus: (jobId: string) => Promise<LocalModelPullStatus>
  /**
   * Read one model's persisted context-window setting from the Host.
   * @param modelId - the model whose setting to read, verbatim.
   * @returns the persisted setting and the known maximum; rejects when the Remote call fails.
   */
  getModelContext: (modelId: string) => Promise<LocalModelContextState>
  /**
   * Persist one model's context window on the Host; the next Start honors it.
   * @param modelId - the model the setting belongs to, verbatim.
   * @param contextLength - the context window to persist.
   * @returns the persisted setting, read back; rejects when the value is invalid or the Remote call fails.
   */
  setModelContext: (modelId: string, contextLength: number) => Promise<LocalModelContextState>
  /**
   * Clear one model's persisted context window on the Host, back to the unset default.
   * @param modelId - the model whose setting to clear, verbatim.
   * @returns the setting after clearing; rejects when the Remote call fails.
   */
  clearModelContext: (modelId: string) => Promise<LocalModelContextState>
}

/**
 * Props the renderer binds for the section. The two action renderers are
 * the per-model action seam: the section calls one for each row, with
 * the row's entry and the status payload it came from, when a caller
 * provides it. The download renderer is the same seam for the section's
 * download form. This package's registration provides them (see
 * `./ModelActions.tsx`), wired to the injected lifecycle actions; the
 * bare component renders no action control without them.
 */
export type LocalModelsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.localModels'>
  & InjectFace<LocalModelsSectionInjected>
  & {
    /** Render one served model's action control, when a caller provides one. */
    renderModelAction?: (model: LocalModelStatusEntry, status: LocalModelsStatus) => ReactNode
    /** Render one on-disk model file's action control, when a caller provides one. */
    renderFolderModelAction?: (model: LocalFolderModel, status: LocalModelsStatus) => ReactNode
    /** Render the section's download form for the current status, when a caller provides one. */
    renderDownloadForm?: (status: LocalModelsStatus) => ReactNode
  }

type Translate = LocalModelsSectionProps['t']

/** The section's read state: the Remote call is pending, failed, or landed. */
type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly payload: LocalModelsStatus }

/** The labeled facts one loaded or available model row carries, in display order. */
function modelFacts(model: LocalModelStatusEntry, t: Translate): string[] {
  const facts: string[] = []
  if (model.loaded && model.contextLength !== undefined) {
    facts.push(t('contextLength', { count: String(model.contextLength) }))
  }
  if (model.maxContextLength !== undefined) {
    facts.push(t('maxContextLength', { count: String(model.maxContextLength) }))
  }
  if (model.loaded && model.sizeVram !== undefined) {
    facts.push(t('memoryInUse', { size: String(model.sizeVram) }))
  }
  return facts
}

/** Render the local endpoint status, its served models, and the on-disk model files. */
export function LocalModelsSection(
  { loadStatus, renderDownloadForm, renderFolderModelAction, renderModelAction, t }: LocalModelsSectionProps,
): ReactNode {
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<ViewState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => loadStatus()).then(
      (payload) => { if (current) setState({ status: 'ready', payload }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [loadStatus, request])

  const refresh = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  const payload = state.status === 'ready' ? state.payload : undefined

  return (
    <div className={css.section}>
      <div className={css.header}>
        <h2 className={css.heading}>{t('title')}</h2>
        <button className={css.refreshButton} type="button" onClick={refresh}>{t('refresh')}</button>
      </div>
      <p className={css.intro}>{t('intro')}</p>
      {state.status === 'loading' ? (
        <p className={css.status} role="status">{t('loading')}</p>
      ) : null}
      {state.status === 'error' ? (
        <p className={css.error} role="alert">{t('loadFailed')}</p>
      ) : null}
      {payload !== undefined ? (
        <>
          <section className={css.group}>
            <h3 className={css.subheading}>{t('endpointTitle')}</h3>
            {payload.endpoint.up ? (
              <p className={css.statusLine}>
                <span>{t('endpointUp')}</span>
                <code className={css.value}>{payload.endpoint.baseUrl}</code>
              </p>
            ) : (
              <>
                <p className={css.statusLine}>{t('endpointDown')}</p>
                <p className={css.hint}>{t('endpointDownHint')}</p>
              </>
            )}
          </section>
          {renderDownloadForm?.(payload)}
          <section className={css.group}>
            <h3 className={css.subheading}>{t('servedTitle')}</h3>
            {payload.models.length === 0 ? (
              <p className={css.hint}>{t('servedEmpty')}</p>
            ) : (
              <ul className={css.rows}>
                {payload.models.map(model => (
                  <li className={css.row} key={model.id}>
                    <div className={css.rowHead}>
                      <span className={css.modelId}>{model.id}</span>
                      <span className={css.tag}>{payload.endpoint.up && model.loaded ? t('loaded') : t('available')}</span>
                      {renderModelAction?.(model, payload)}
                    </div>
                    {modelFacts(model, t).length === 0 ? null : (
                      <p className={css.meta}>
                        {modelFacts(model, t).map(fact => <span key={fact}>{fact}</span>)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={css.group}>
            <h3 className={css.subheading}>{t('folderTitle')}</h3>
            {payload.folderModels.length === 0 ? (
              <p className={css.hint}>{t('folderEmpty')}</p>
            ) : (
              <ul className={css.rows}>
                {payload.folderModels.map(model => {
                  const servedEntry = payload.models.find(candidate => candidate.id === model.id)
                  const isServed = payload.endpoint.up && servedEntry?.loaded === true
                  return (
                  <li className={css.row} key={model.id}>
                    <div className={css.rowHead}>
                      <span className={css.modelId}>{model.id}</span>
                      <span className={css.tag}>{t('onDisk')}</span>
                      <span className={css.tag}>{isServed ? t('loaded') : t('notServed')}</span>
                      {renderFolderModelAction?.(model, payload)}
                    </div>
                    <p className={css.meta}>
                      <code className={css.value}>{model.path}</code>
                    </p>
                  </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
