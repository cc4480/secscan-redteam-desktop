// @vitest-environment jsdom
/** The registered section's per-model lifecycle controls: clicks reach the injected Remote face, progress is the host job's own, failures land in the row. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  LocalModelActionResult,
  LocalModelDeleteResult,
  LocalModelPullStart,
  LocalModelPullStatus,
  LocalModelsStatus,
} from '@deepseek-ai/dsh-api-remotes/client'
import { LocalModelsSectionWithActions } from '../src/client/ModelActions.tsx'
import type { LocalModelsSectionInjected, LocalModelsSectionProps } from '../src/client/LocalModelsSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof en, params?: Record<string, unknown>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    en[key],
  )) as LocalModelsSectionProps['t']

const MODEL_ID = 'ornith-1.5:9b'

const AVAILABLE: LocalModelsStatus = {
  serving: 'ollama',
  endpoint: { up: true, baseUrl: 'http://127.0.0.1:11434' },
  models: [{ id: MODEL_ID, loaded: false }],
  folderModels: [],
}

const LOADED: LocalModelsStatus = {
  serving: 'ollama',
  endpoint: { up: true, baseUrl: 'http://127.0.0.1:11434' },
  models: [{ id: MODEL_ID, loaded: true, contextLength: 4096 }],
  folderModels: [],
}

/** A full inject face with every member stubbed; tests override the members they drive. */
function stubFace(overrides: Partial<LocalModelsSectionInjected> = {}): LocalModelsSectionInjected {
  return {
    loadStatus: async () => AVAILABLE,
    startModel: async (modelId): Promise<LocalModelActionResult> => ({ modelId, loaded: true }),
    stopModel: async (modelId): Promise<LocalModelActionResult> => ({ modelId, loaded: false }),
    deleteModel: async (modelId): Promise<LocalModelDeleteResult> => ({ modelId, deleted: true }),
    startPull: async (): Promise<LocalModelPullStart> => ({ jobId: 'job-1' }),
    pullStatus: async (jobId): Promise<LocalModelPullStatus> => ({ jobId, modelId: MODEL_ID, state: 'done' }),
    listRepoFiles: async () => [],
    getModelContext: async (modelId) => ({ modelId, maxContextLength: 262144 }),
    setModelContext: async (modelId, contextLength) => ({ modelId, contextLength, maxContextLength: 262144 }),
    clearModelContext: async (modelId) => ({ modelId, maxContextLength: 262144 }),
    ...overrides,
  }
}

function renderActions(face: LocalModelsSectionInjected) {
  const props = { t, ...face } as LocalModelsSectionProps
  render(<LocalModelsSectionWithActions {...props} />)
}

describe('Local models section actions', () => {
  it('starts an available model through the face and reloads the status it changed', async () => {
    const loadStatus = vi.fn<LocalModelsSectionInjected['loadStatus']>()
      .mockResolvedValueOnce(AVAILABLE)
      .mockResolvedValue(LOADED)
    const startModel = vi.fn<LocalModelsSectionInjected['startModel']>()
      .mockResolvedValue({ modelId: MODEL_ID, loaded: true })
    renderActions(stubFace({ loadStatus, startModel }))

    fireEvent.click(await screen.findByRole('button', { name: en.start }))

    await vi.waitFor(() => { expect(screen.getByText(en.loaded)).toBeTruthy() })
    expect(startModel).toHaveBeenCalledTimes(1)
    expect(startModel).toHaveBeenCalledWith(MODEL_ID)
    expect(loadStatus).toHaveBeenCalledTimes(2)
    // The loaded row now offers Stop instead of Start.
    expect(screen.getByRole('button', { name: en.stop })).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.start })).toBeNull()
  })

  it('stops a loaded model through the face', async () => {
    const loadStatus = vi.fn<LocalModelsSectionInjected['loadStatus']>()
      .mockResolvedValueOnce(LOADED)
      .mockResolvedValue(AVAILABLE)
    const stopModel = vi.fn<LocalModelsSectionInjected['stopModel']>()
      .mockResolvedValue({ modelId: MODEL_ID, loaded: false })
    renderActions(stubFace({ loadStatus, stopModel }))

    fireEvent.click(await screen.findByRole('button', { name: en.stop }))

    await vi.waitFor(() => { expect(screen.getByRole('button', { name: en.start })).toBeTruthy() })
    expect(stopModel).toHaveBeenCalledTimes(1)
    expect(stopModel).toHaveBeenCalledWith(MODEL_ID)
  })

  it('deletes only after an inline confirm, and cancel leaves the model alone', async () => {
    const loadStatus = vi.fn<LocalModelsSectionInjected['loadStatus']>()
      .mockResolvedValueOnce(AVAILABLE)
      .mockResolvedValue({ ...AVAILABLE, models: [] })
    const deleteModel = vi.fn<LocalModelsSectionInjected['deleteModel']>()
      .mockResolvedValue({ modelId: MODEL_ID, deleted: true })
    renderActions(stubFace({ loadStatus, deleteModel }))

    fireEvent.click(await screen.findByRole('button', { name: en.delete }))
    fireEvent.click(await screen.findByRole('button', { name: en.cancel }))
    expect(deleteModel).not.toHaveBeenCalled()
    expect(screen.getByText(MODEL_ID)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.delete }))
    fireEvent.click(await screen.findByRole('button', { name: en.confirmDelete }))

    await vi.waitFor(() => { expect(screen.queryByText(MODEL_ID)).toBeNull() })
    expect(deleteModel).toHaveBeenCalledTimes(1)
    expect(deleteModel).toHaveBeenCalledWith(MODEL_ID)
  })

  it('surfaces an action failure in the row instead of pretending success', async () => {
    const loadStatus = vi.fn<LocalModelsSectionInjected['loadStatus']>().mockResolvedValue(AVAILABLE)
    const startModel = vi.fn<LocalModelsSectionInjected['startModel']>()
      .mockRejectedValue(new Error('localModels.startModel failed: LOCAL_OLLAMA_UNREACHABLE: endpoint is silent'))
    renderActions(stubFace({ loadStatus, startModel }))

    fireEvent.click(await screen.findByRole('button', { name: en.start }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('LOCAL_OLLAMA_UNREACHABLE')
    // No reload was triggered and the row still offers the action.
    expect(loadStatus).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: en.start })).toBeTruthy()
  })

  it('shows the pull job progress the host reports, then reloads when it settles', async () => {
    const loadStatus = vi.fn<LocalModelsSectionInjected['loadStatus']>()
      .mockResolvedValueOnce(AVAILABLE)
      .mockResolvedValue(LOADED)
    const startPull = vi.fn<LocalModelsSectionInjected['startPull']>().mockResolvedValue({ jobId: 'job-1' })
    const pullStatus = vi.fn<LocalModelsSectionInjected['pullStatus']>()
      .mockResolvedValueOnce({
        jobId: 'job-1', modelId: MODEL_ID, state: 'running', status: 'downloading', completedBytes: 5, totalBytes: 10,
      })
      .mockResolvedValue({ jobId: 'job-1', modelId: MODEL_ID, state: 'done', status: 'success' })
    renderActions(stubFace({ loadStatus, startPull, pullStatus }))

    fireEvent.click(await screen.findByRole('button', { name: en.download }))

    expect(await screen.findByText('Downloading: downloading 50%')).toBeTruthy()
    // The progress bar rides the same reported bytes: 5 of 10 = 50%.
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50')
    expect(startPull).toHaveBeenCalledWith(MODEL_ID)
    // The next poll reports the job done; the section re-reads its status.
    await vi.waitFor(() => { expect(loadStatus).toHaveBeenCalledTimes(2) }, { timeout: 4000 })
  })

  it('renders no download form in Ollama mode', async () => {
    renderActions(stubFace())

    expect(await screen.findByText(MODEL_ID)).toBeTruthy()
    expect(screen.queryByText(en.downloadTitle)).toBeNull()
    expect(screen.queryByLabelText(en.hfRepo)).toBeNull()
    expect(screen.queryByRole('button', { name: en.listFiles })).toBeNull()
  })

  describe('in llama mode', () => {
    const LLAMA_AVAILABLE_ID = 'ornith-1.5-9b-uncensored'
    const LLAMA_LOADED_ID = 'qwen3.6-35b-a3b'
    const LLAMA: LocalModelsStatus = {
      serving: 'llama',
      endpoint: { up: true, baseUrl: 'http://127.0.0.1:45969/v1' },
      models: [
        { id: LLAMA_AVAILABLE_ID, loaded: false },
        { id: LLAMA_LOADED_ID, loaded: true },
      ],
      folderModels: [],
    }

    it('renders Start, Stop, and Delete per registry model, the served model marked loaded, and the download form', async () => {
      renderActions(stubFace({ loadStatus: async () => LLAMA }))

      expect(await screen.findByText(LLAMA_AVAILABLE_ID)).toBeTruthy()
      expect(screen.getByText(LLAMA_LOADED_ID)).toBeTruthy()
      // The status payload's loaded model is the one marked loaded.
      expect(screen.getByText(en.loaded)).toBeTruthy()
      expect(screen.getByRole('button', { name: en.start })).toBeTruthy()
      expect(screen.getByRole('button', { name: en.stop })).toBeTruthy()
      expect(screen.getAllByRole('button', { name: en.delete })).toHaveLength(2)
      // No Download control exists before a repository is listed: the
      // form's only submit is List files, and its only text input is
      // the repository — there is no filename field to type into.
      expect(screen.queryAllByRole('button', { name: en.download })).toHaveLength(0)
      expect(screen.getByRole('button', { name: en.listFiles })).toBeTruthy()
      expect(screen.getByText(en.downloadTitle)).toBeTruthy()
      expect(screen.getByLabelText(en.hfRepo)).toBeTruthy()
      expect(screen.getAllByRole('textbox')).toHaveLength(1)
      expect(screen.queryByLabelText(/GGUF file/)).toBeNull()
    })

    it('starts an available model through the face with its id and reloads the status', async () => {
      const loadStatus = vi.fn<LocalModelsSectionInjected['loadStatus']>().mockResolvedValue(LLAMA)
      const startModel = vi.fn<LocalModelsSectionInjected['startModel']>()
        .mockResolvedValue({ modelId: LLAMA_AVAILABLE_ID, loaded: true })
      renderActions(stubFace({ loadStatus, startModel }))

      fireEvent.click(await screen.findByRole('button', { name: en.start }))

      await vi.waitFor(() => { expect(loadStatus).toHaveBeenCalledTimes(2) })
      expect(startModel).toHaveBeenCalledTimes(1)
      expect(startModel).toHaveBeenCalledWith(LLAMA_AVAILABLE_ID)
    })

    it('disables the row controls and shows the pending label while a start is in flight', async () => {
      const startModel = vi.fn<LocalModelsSectionInjected['startModel']>()
        .mockReturnValue(new Promise<LocalModelActionResult>(() => {}))
      renderActions(stubFace({ loadStatus: async () => LLAMA, startModel }))

      fireEvent.click(await screen.findByRole('button', { name: en.start }))

      expect(await screen.findByText(en.starting)).toBeTruthy()
      expect((screen.getByRole('button', { name: en.start }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('button', { name: en.stop }) as HTMLButtonElement).disabled).toBe(false)
      // Only the starting row's Delete is disabled; the other row stays live.
      expect(screen.getAllByRole('button', { name: en.delete })
        .filter(button => (button as HTMLButtonElement).disabled)).toHaveLength(1)
    })

    it('stops the served model through the face with its id', async () => {
      const loadStatus = vi.fn<LocalModelsSectionInjected['loadStatus']>().mockResolvedValue(LLAMA)
      const stopModel = vi.fn<LocalModelsSectionInjected['stopModel']>()
        .mockResolvedValue({ modelId: LLAMA_LOADED_ID, loaded: false })
      renderActions(stubFace({ loadStatus, stopModel }))

      fireEvent.click(await screen.findByRole('button', { name: en.stop }))

      await vi.waitFor(() => { expect(loadStatus).toHaveBeenCalledTimes(2) })
      expect(stopModel).toHaveBeenCalledTimes(1)
      expect(stopModel).toHaveBeenCalledWith(LLAMA_LOADED_ID)
    })

    it('deletes a registry model only after the same inline confirm Ollama mode uses', async () => {
      const loadStatus = vi.fn<LocalModelsSectionInjected['loadStatus']>().mockResolvedValue(LLAMA)
      const deleteModel = vi.fn<LocalModelsSectionInjected['deleteModel']>()
        .mockResolvedValue({ modelId: LLAMA_AVAILABLE_ID, deleted: true })
      renderActions(stubFace({ loadStatus, deleteModel }))

      const [firstDelete] = await screen.findAllByRole('button', { name: en.delete })
      fireEvent.click(firstDelete!)
      fireEvent.click(await screen.findByRole('button', { name: en.cancel }))
      expect(deleteModel).not.toHaveBeenCalled()

      fireEvent.click(screen.getAllByRole('button', { name: en.delete })[0]!)
      fireEvent.click(await screen.findByRole('button', { name: en.confirmDelete }))

      await vi.waitFor(() => { expect(loadStatus).toHaveBeenCalledTimes(2) })
      expect(deleteModel).toHaveBeenCalledTimes(1)
      expect(deleteModel).toHaveBeenCalledWith(LLAMA_AVAILABLE_ID)
    })

    const REPO_FILES = [
      { file: 'model.Q4_K_M.gguf', sizeBytes: 5898000000, isGguf: true },
      { file: 'model.Q8_0.gguf', sizeBytes: 10500000000, isGguf: true },
      { file: 'mmproj-model.gguf', sizeBytes: 1000000000, isGguf: false, isProjector: true },
      { file: 'README.md', isGguf: false },
    ]

    /** Render the llama section, name the repository, and list its files. */
    async function listRepo(face: LocalModelsSectionInjected): Promise<void> {
      renderActions(face)
      fireEvent.change(await screen.findByLabelText(en.hfRepo), { target: { value: 'owner/repo' } })
      fireEvent.click(screen.getByRole('button', { name: en.listFiles }))
      await screen.findByText('model.Q4_K_M.gguf')
    }

    it('lists the repository files with names and sizes from the listing action', async () => {
      const listRepoFiles = vi.fn<LocalModelsSectionInjected['listRepoFiles']>().mockResolvedValue(REPO_FILES)
      await listRepo(stubFace({ loadStatus: async () => LLAMA, listRepoFiles }))

      expect(listRepoFiles).toHaveBeenCalledTimes(1)
      expect(listRepoFiles).toHaveBeenCalledWith('owner/repo')
      expect(screen.getByText('Files in owner/repo')).toBeTruthy()
      // Every file is listed; GGUF sizes render in the desktop page's units.
      expect(screen.getByText('model.Q8_0.gguf')).toBeTruthy()
      expect(screen.getByText('5.49 GB')).toBeTruthy()
      expect(screen.getByText('9.78 GB')).toBeTruthy()
      expect(screen.getByText('mmproj-model.gguf')).toBeTruthy()
      expect(screen.getByText('953.7 MB')).toBeTruthy()
      expect(screen.getByText('README.md')).toBeTruthy()
      expect(screen.getByText(en.fileSizeUnknown)).toBeTruthy()
      // Only the two GGUF files carry a Download; the projector and the
      // readme are listed for context and are not downloadable picks.
      expect(screen.getByRole('button', { name: 'Download model.Q4_K_M.gguf' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Download model.Q8_0.gguf' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Download mmproj-model.gguf' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Download README.md' })).toBeNull()
    })

    it('downloads the picked file: real pull progress, then the refreshed list shows the new model', async () => {
      const AFTER: LocalModelsStatus = {
        ...LLAMA,
        models: [...LLAMA.models, { id: 'new-model', loaded: false }],
      }
      const loadStatus = vi.fn<LocalModelsSectionInjected['loadStatus']>()
        .mockResolvedValueOnce(LLAMA)
        .mockResolvedValue(AFTER)
      const listRepoFiles = vi.fn<LocalModelsSectionInjected['listRepoFiles']>().mockResolvedValue(REPO_FILES)
      const startPull = vi.fn<LocalModelsSectionInjected['startPull']>().mockResolvedValue({ jobId: 'job-1' })
      const pullStatus = vi.fn<LocalModelsSectionInjected['pullStatus']>()
        .mockResolvedValueOnce({
          jobId: 'job-1', modelId: 'owner/repo/model.Q4_K_M.gguf', state: 'running', status: 'downloading', completedBytes: 5, totalBytes: 10,
        })
        .mockResolvedValue({ jobId: 'job-1', modelId: 'owner/repo/model.Q4_K_M.gguf', state: 'done', status: 'success' })
      await listRepo(stubFace({ loadStatus, listRepoFiles, startPull, pullStatus }))

      fireEvent.click(screen.getByRole('button', { name: 'Download model.Q4_K_M.gguf' }))

      expect(await screen.findByText('Downloading: downloading 50%')).toBeTruthy()
      // The progress bar rides the same reported bytes: 5 of 10 = 50%.
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50')
      // The pick issues the pull for exactly repository/file.
      expect(startPull).toHaveBeenCalledTimes(1)
      expect(startPull).toHaveBeenCalledWith('owner/repo/model.Q4_K_M.gguf')
      // The next poll reports the job done; the section re-reads its status and the new model appears.
      expect(await screen.findByText('new-model', {}, { timeout: 4000 })).toBeTruthy()
      expect(loadStatus).toHaveBeenCalledTimes(2)
    })

    it('says so when the repository lists no downloadable GGUF files', async () => {
      const listRepoFiles = vi.fn<LocalModelsSectionInjected['listRepoFiles']>()
        .mockResolvedValue([{ file: 'README.md', isGguf: false }])
      renderActions(stubFace({ loadStatus: async () => LLAMA, listRepoFiles }))

      fireEvent.change(await screen.findByLabelText(en.hfRepo), { target: { value: 'owner/docs-only' } })
      fireEvent.click(screen.getByRole('button', { name: en.listFiles }))

      expect(await screen.findByText(en.repoEmpty)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Download README.md' })).toBeNull()
    })

    it('surfaces a listing failure in the form', async () => {
      const listRepoFiles = vi.fn<LocalModelsSectionInjected['listRepoFiles']>()
        .mockRejectedValue(new Error('localModels.listRepoFiles failed: LOCAL_REPO_LIST_FAILED: Hugging Face repo not found'))
      renderActions(stubFace({ loadStatus: async () => LLAMA, listRepoFiles }))

      fireEvent.change(await screen.findByLabelText(en.hfRepo), { target: { value: 'owner/missing' } })
      fireEvent.click(screen.getByRole('button', { name: en.listFiles }))

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain('LOCAL_REPO_LIST_FAILED')
    })

    it('surfaces the typed error when the picked download job fails', async () => {
      const listRepoFiles = vi.fn<LocalModelsSectionInjected['listRepoFiles']>().mockResolvedValue(REPO_FILES)
      const startPull = vi.fn<LocalModelsSectionInjected['startPull']>().mockResolvedValue({ jobId: 'job-1' })
      const pullStatus = vi.fn<LocalModelsSectionInjected['pullStatus']>()
        .mockResolvedValue({
          jobId: 'job-1',
          modelId: 'owner/repo/model.Q4_K_M.gguf',
          state: 'failed',
          error: 'LOCAL_PULL_FAILED: repository not found',
        })
      await listRepo(stubFace({ loadStatus: async () => LLAMA, listRepoFiles, startPull, pullStatus }))

      fireEvent.click(screen.getByRole('button', { name: 'Download model.Q4_K_M.gguf' }))

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain('LOCAL_PULL_FAILED: repository not found')
    })

    it('surfaces a rejected startPull for the picked file as the form error', async () => {
      const listRepoFiles = vi.fn<LocalModelsSectionInjected['listRepoFiles']>().mockResolvedValue(REPO_FILES)
      const startPull = vi.fn<LocalModelsSectionInjected['startPull']>()
        .mockRejectedValue(new Error('localModels.startPull failed: LOCAL_HF_UNREACHABLE: host is silent'))
      await listRepo(stubFace({ loadStatus: async () => LLAMA, listRepoFiles, startPull }))

      fireEvent.click(screen.getByRole('button', { name: 'Download model.Q4_K_M.gguf' }))

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain('LOCAL_HF_UNREACHABLE')
    })
  })

  describe('context window control', () => {
    it('auto-fills the model maximum while unset, as the value a Start will use', async () => {
      renderActions(stubFace())

      expect(await screen.findByText(en.contextDefaultMaximum)).toBeTruthy()
      const input = screen.getByLabelText(en.contextLabel) as HTMLInputElement
      await vi.waitFor(() => { expect(input.value).toBe('262144') })
      expect(input.placeholder).toBe('262144')
      expect(input.max).toBe('262144')
      // The auto-filled value is already the effective one: nothing to save.
      expect((screen.getByRole('button', { name: en.contextSave }) as HTMLButtonElement).disabled).toBe(true)
      // No clear control while nothing is persisted.
      expect(screen.queryByRole('button', { name: en.contextClear })).toBeNull()
    })

    it('saves the entered value through the face and shows the persisted value after reload', async () => {
      const loadStatus = vi.fn<LocalModelsSectionInjected['loadStatus']>().mockResolvedValue(AVAILABLE)
      const getModelContext = vi.fn<LocalModelsSectionInjected['getModelContext']>()
        .mockResolvedValueOnce({ modelId: MODEL_ID, maxContextLength: 262144 })
        .mockResolvedValue({ modelId: MODEL_ID, contextLength: 65536, maxContextLength: 262144 })
      const setModelContext = vi.fn<LocalModelsSectionInjected['setModelContext']>()
        .mockResolvedValue({ modelId: MODEL_ID, contextLength: 65536, maxContextLength: 262144 })
      renderActions(stubFace({ loadStatus, getModelContext, setModelContext }))

      const input = await screen.findByLabelText(en.contextLabel) as HTMLInputElement
      fireEvent.change(input, { target: { value: '65536' } })
      fireEvent.click(screen.getByRole('button', { name: en.contextSave }))

      await vi.waitFor(() => { expect(setModelContext).toHaveBeenCalledWith(MODEL_ID, 65536) })
      // The save settled, so the section re-read its status and the
      // remounted control reads back the persisted value.
      await vi.waitFor(() => { expect(loadStatus).toHaveBeenCalledTimes(2) })
      const reloaded = await screen.findByLabelText(en.contextLabel) as HTMLInputElement
      await vi.waitFor(() => { expect(reloaded.value).toBe('65536') })
      expect(screen.getByRole('button', { name: en.contextClear })).toBeTruthy()
      expect(screen.queryByText(en.contextDefaultMaximum)).toBeNull()
    })

    it('clears a persisted value through the face, back to the default reading', async () => {
      const getModelContext = vi.fn<LocalModelsSectionInjected['getModelContext']>()
        .mockResolvedValueOnce({ modelId: MODEL_ID, contextLength: 65536, maxContextLength: 262144 })
        .mockResolvedValue({ modelId: MODEL_ID, maxContextLength: 262144 })
      const clearModelContext = vi.fn<LocalModelsSectionInjected['clearModelContext']>()
        .mockResolvedValue({ modelId: MODEL_ID, maxContextLength: 262144 })
      renderActions(stubFace({ getModelContext, clearModelContext }))

      fireEvent.click(await screen.findByRole('button', { name: en.contextClear }))

      await vi.waitFor(() => { expect(clearModelContext).toHaveBeenCalledWith(MODEL_ID) })
      expect(await screen.findByText(en.contextDefaultMaximum)).toBeTruthy()
      // Clearing returns the field to the auto-filled maximum, not to blank.
      const input = screen.getByLabelText(en.contextLabel) as HTMLInputElement
      await vi.waitFor(() => { expect(input.value).toBe('262144') })
    })

    it('surfaces a rejected save in the row instead of pretending it persisted', async () => {
      const setModelContext = vi.fn<LocalModelsSectionInjected['setModelContext']>()
        .mockRejectedValue(new Error('localModels.setModelContext failed: LOCAL_CONTEXT_LENGTH_TOO_LARGE: exceeds the maximum of 262144'))
      renderActions(stubFace({ setModelContext }))

      const input = await screen.findByLabelText(en.contextLabel) as HTMLInputElement
      fireEvent.change(input, { target: { value: '999999' } })
      fireEvent.click(screen.getByRole('button', { name: en.contextSave }))

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain('LOCAL_CONTEXT_LENGTH_TOO_LARGE')
    })

    it('auto-fills the declared maximum in llama mode too', async () => {
      renderActions(stubFace({
        loadStatus: async () => ({
          serving: 'llama',
          endpoint: { up: true, baseUrl: 'http://127.0.0.1:45969/v1' },
          models: [{ id: MODEL_ID, loaded: false }],
          folderModels: [],
        }),
        getModelContext: async (modelId) => ({ modelId, maxContextLength: 262144 }),
      }))

      expect(await screen.findByText(en.contextDefaultMaximum)).toBeTruthy()
      expect(screen.queryByText(en.contextDefaultServer)).toBeNull()
      const input = screen.getByLabelText(en.contextLabel) as HTMLInputElement
      await vi.waitFor(() => { expect(input.value).toBe('262144') })
    })

    it('reads the unset default as the server setting in llama mode only when no maximum is known', async () => {
      renderActions(stubFace({
        loadStatus: async () => ({
          serving: 'llama',
          endpoint: { up: true, baseUrl: 'http://127.0.0.1:45969/v1' },
          models: [{ id: MODEL_ID, loaded: false }],
          folderModels: [],
        }),
        getModelContext: async (modelId) => ({ modelId }),
      }))

      expect(await screen.findByText(en.contextDefaultServer)).toBeTruthy()
      expect(screen.queryByText(en.contextDefaultMaximum)).toBeNull()
      const input = screen.getByLabelText(en.contextLabel) as HTMLInputElement
      expect(input.value).toBe('')
    })
  })

  it('renders no action control for on-disk folder models in Ollama mode', async () => {
    renderActions(stubFace({
      loadStatus: async () => ({
        serving: 'ollama',
        endpoint: { up: true, baseUrl: 'http://127.0.0.1:11434' },
        models: [],
        folderModels: [{ id: 'qwen3.5-4b', path: '/models/qwen3.5-4b.gguf' }],
      }),
    }))

    expect(await screen.findByText('qwen3.5-4b')).toBeTruthy()
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(button => button.textContent)).toEqual([en.refresh])
  })
})
