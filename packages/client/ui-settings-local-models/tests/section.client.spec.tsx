// @vitest-environment jsdom
/** The Local models section: endpoint state, served rows, folder rows, and the Remote read states. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LocalModelsStatus } from '@deepseek-ai/dsh-api-remotes/client'
import { LocalModelsSection } from '../src/client/LocalModelsSection.tsx'
import type { LocalModelsSectionProps } from '../src/client/LocalModelsSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof en, params?: Record<string, unknown>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    en[key],
  )) as LocalModelsSectionProps['t']

function renderSection(payload: LocalModelsStatus) {
  const props = { t, loadStatus: async () => payload } as LocalModelsSectionProps
  render(<LocalModelsSection {...props} />)
}

const UP: LocalModelsStatus = {
  serving: 'ollama',
  endpoint: { up: true, baseUrl: 'http://127.0.0.1:11434' },
  models: [
    { id: 'ornith-1.5:9b', loaded: true, contextLength: 4096, maxContextLength: 131072, sizeVram: 42 },
    { id: 'ornith-1.5:35b', loaded: false, maxContextLength: 32768 },
  ],
  folderModels: [],
}

describe('LocalModelsSection', () => {
  it('shows the endpoint as up with its base URL', async () => {
    renderSection(UP)

    expect(await screen.findByText(en.endpointUp)).toBeTruthy()
    expect(screen.getByText('http://127.0.0.1:11434')).toBeTruthy()
    expect(screen.queryByText(en.endpointDown)).toBeNull()
  })

  it('renders a loaded model with its runtime context, maximum, and memory kept distinct', async () => {
    renderSection(UP)

    expect(await screen.findByText('ornith-1.5:9b')).toBeTruthy()
    expect(screen.getByText(en.loaded)).toBeTruthy()
    expect(screen.getByText('Context: 4096')).toBeTruthy()
    expect(screen.getByText('Maximum context: 131072')).toBeTruthy()
    expect(screen.getByText('Memory in use: 42 bytes')).toBeTruthy()
  })

  it('renders an unloaded model as available, with its maximum but no runtime context', async () => {
    renderSection(UP)

    expect(await screen.findByText('ornith-1.5:35b')).toBeTruthy()
    expect(screen.getByText(en.available)).toBeTruthy()
    expect(screen.getByText('Maximum context: 32768')).toBeTruthy()
    expect(screen.queryByText('Context: 32768')).toBeNull()
  })

  it('shows the honest down state and never marks a model loaded', async () => {
    renderSection({
      serving: 'ollama',
      endpoint: { up: false, baseUrl: 'http://127.0.0.1:11434' },
      models: [{ id: 'registry-model', loaded: false }],
      folderModels: [],
    })

    expect(await screen.findByText(en.endpointDown)).toBeTruthy()
    expect(screen.getByText(en.endpointDownHint)).toBeTruthy()
    expect(screen.queryByText('http://127.0.0.1:11434')).toBeNull()
    expect(screen.getByText('registry-model')).toBeTruthy()
    expect(screen.getByText(en.available)).toBeTruthy()
    expect(screen.queryByText(en.loaded)).toBeNull()
  })

  it('never marks a model loaded when the endpoint is down, even if the payload says loaded', async () => {
    renderSection({
      serving: 'ollama',
      endpoint: { up: false, baseUrl: 'http://127.0.0.1:11434' },
      models: [{ id: 'ornith-1.5:9b', loaded: true }],
      folderModels: [],
    })

    expect(await screen.findByText(en.endpointDown)).toBeTruthy()
    expect(screen.getByText('ornith-1.5:9b')).toBeTruthy()
    expect(screen.getByText(en.available)).toBeTruthy()
    expect(screen.queryByText(en.loaded)).toBeNull()
  })

  it('shows no memory in use for an unloaded model that carries a size', async () => {
    renderSection({
      serving: 'ollama',
      endpoint: { up: true, baseUrl: 'http://127.0.0.1:11434' },
      models: [{ id: 'ornith-1.5:35b', loaded: false, sizeVram: 42 }],
      folderModels: [],
    })

    expect(await screen.findByText('ornith-1.5:35b')).toBeTruthy()
    expect(screen.getByText(en.available)).toBeTruthy()
    expect(screen.queryByText('Memory in use: 42 bytes')).toBeNull()
  })

  it('renders folder models as on disk and not served', async () => {
    renderSection({
      serving: 'ollama',
      endpoint: { up: true, baseUrl: 'http://127.0.0.1:11434' },
      models: [],
      folderModels: [{ id: 'qwen3.5-4b', path: '/models/qwen3.5-4b.gguf' }],
    })

    expect(await screen.findByText('qwen3.5-4b')).toBeTruthy()
    expect(screen.getByText('/models/qwen3.5-4b.gguf')).toBeTruthy()
    expect(screen.getByText(en.onDisk)).toBeTruthy()
    expect(screen.getByText(en.notServed)).toBeTruthy()
    expect(screen.getByText(en.servedEmpty)).toBeTruthy()
  })

  it('marks an on-disk model as loaded instead of not served when the status says the endpoint serves it', async () => {
    renderSection({
      serving: 'llama',
      endpoint: { up: true, baseUrl: 'http://127.0.0.1:45969/v1' },
      models: [{ id: 'qwen3.5-4b', loaded: true }],
      folderModels: [{ id: 'qwen3.5-4b', path: '/models/qwen3.5-4b.gguf' }],
    })

    expect(await screen.findByText('/models/qwen3.5-4b.gguf')).toBeTruthy()
    // One Loaded tag on the served row, one on the folder row.
    expect(screen.getAllByText(en.loaded)).toHaveLength(2)
    expect(screen.queryByText(en.notServed)).toBeNull()
  })

  it('says so when the local models folder holds no model files', async () => {
    renderSection(UP)

    expect(await screen.findByText(en.folderEmpty)).toBeTruthy()
  })

  it('shows a loading state while the status read is pending', () => {
    const props = {
      t,
      loadStatus: () => new Promise<LocalModelsStatus>(() => {}),
    } as LocalModelsSectionProps
    render(<LocalModelsSection {...props} />)

    expect(screen.getByText(en.loading)).toBeTruthy()
  })

  it('shows an error state when the status read rejects, then recovers on refresh', async () => {
    const loadStatus = vi.fn<() => Promise<LocalModelsStatus>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(UP)
    const props = { t, loadStatus } as LocalModelsSectionProps
    render(<LocalModelsSection {...props} />)

    expect(await screen.findByText(en.loadFailed)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(en.loadFailed)

    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    expect(await screen.findByText(en.endpointUp)).toBeTruthy()
    expect(loadStatus).toHaveBeenCalledTimes(2)
  })

  it('ships no per-model action control without a provided action renderer', async () => {
    renderSection(UP)

    expect(await screen.findByText('ornith-1.5:9b')).toBeTruthy()
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(button => button.textContent)).toEqual([en.refresh])
  })
})
