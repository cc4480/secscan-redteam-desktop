/** Mount the Ollama React renderer before Electron reveals the window. */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { OllamaPage } from './ollamapage.tsx'
import type { OllamaOperations } from '../ollama-api.ts'

declare global {
  interface Window {
    dshOllama: OllamaOperations
  }
}

const container = document.getElementById('root')
if (container === null) throw new Error('desktop ollama: missing React root')
const root = createRoot(container)
flushSync(() => { root.render(createElement(OllamaPage, { api: window.dshOllama })) })
window.addEventListener('pagehide', () => { root.unmount() }, { once: true })
