/** Isolated bridge for the Ollama renderer; it exposes scalar operations and never a Node API. */

import { contextBridge, ipcRenderer } from 'electron'
import {
  OLLAMA_IPC,
  type OllamaConnection,
  type OllamaModel,
  type OllamaModelDetails,
  type OllamaOperations,
  type OllamaPullProgress,
  type OllamaSelection,
} from './ollama-api.ts'

const api: OllamaOperations = {
  getConnection: () => ipcRenderer.invoke(OLLAMA_IPC.getConnection) as Promise<OllamaConnection>,
  listModels: () => ipcRenderer.invoke(OLLAMA_IPC.listModels) as Promise<OllamaModel[]>,
  showModel: (name: string) => ipcRenderer.invoke(OLLAMA_IPC.showModel, name) as Promise<OllamaModelDetails>,
  pullModel: (name: string) => ipcRenderer.invoke(OLLAMA_IPC.pullModel, name) as Promise<OllamaModel>,
  cancelPull: (name: string) => ipcRenderer.invoke(OLLAMA_IPC.cancelPull, name) as Promise<void>,
  deleteModel: (name: string) => ipcRenderer.invoke(OLLAMA_IPC.deleteModel, name) as Promise<void>,
  getSelection: () => ipcRenderer.invoke(OLLAMA_IPC.getSelection) as Promise<OllamaSelection>,
  selectModel: (name: string | null) => ipcRenderer.invoke(OLLAMA_IPC.selectModel, name) as Promise<OllamaSelection>,
  onPullProgress: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, progress: OllamaPullProgress): void => { listener(progress) }
    ipcRenderer.on(OLLAMA_IPC.pullProgress, receive)
    return () => { ipcRenderer.removeListener(OLLAMA_IPC.pullProgress, receive) }
  },
}

contextBridge.exposeInMainWorld('dshOllama', api)
