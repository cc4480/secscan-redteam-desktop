/** Isolated bridge for the Local models manager renderer; it exposes scalar operations and never a Node API. */

import { contextBridge, ipcRenderer } from 'electron'
import {
  LLAMA_IPC,
  type LlamaDownloadProgress,
  type LlamaModel,
  type LlamaOperations,
  type LlamaRepoFile,
  type LlamaServerState,
  type LlamaSettings,
} from './llama-api.ts'

const api: LlamaOperations = {
  listModels: () => ipcRenderer.invoke(LLAMA_IPC.listModels) as Promise<LlamaModel[]>,
  listRepoFiles: (repo: string) => ipcRenderer.invoke(LLAMA_IPC.listRepoFiles, repo) as Promise<LlamaRepoFile[]>,
  downloadModel: (input: { repo: string; file: string }) => ipcRenderer.invoke(LLAMA_IPC.downloadModel, input) as Promise<LlamaModel>,
  cancelDownload: (id: string) => ipcRenderer.invoke(LLAMA_IPC.cancelDownload, id) as Promise<void>,
  deleteModel: (id: string) => ipcRenderer.invoke(LLAMA_IPC.deleteModel, id) as Promise<void>,
  getSettings: () => ipcRenderer.invoke(LLAMA_IPC.getSettings) as Promise<LlamaSettings>,
  saveSettings: (settings: LlamaSettings) => ipcRenderer.invoke(LLAMA_IPC.saveSettings, settings) as Promise<LlamaSettings>,
  getServerState: () => ipcRenderer.invoke(LLAMA_IPC.getServerState) as Promise<LlamaServerState>,
  startServer: () => ipcRenderer.invoke(LLAMA_IPC.startServer) as Promise<LlamaServerState>,
  stopServer: () => ipcRenderer.invoke(LLAMA_IPC.stopServer) as Promise<LlamaServerState>,
  onDownloadProgress: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, progress: LlamaDownloadProgress): void => { listener(progress) }
    ipcRenderer.on(LLAMA_IPC.downloadProgress, receive)
    return () => { ipcRenderer.removeListener(LLAMA_IPC.downloadProgress, receive) }
  },
  onServerState: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, state: LlamaServerState): void => { listener(state) }
    ipcRenderer.on(LLAMA_IPC.serverState, receive)
    return () => { ipcRenderer.removeListener(LLAMA_IPC.serverState, receive) }
  },
}

contextBridge.exposeInMainWorld('dshLlama', api)
