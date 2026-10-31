/** Mount the local-models React renderer before Electron reveals the manager window. */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { LlamaPage } from './LlamaPage.tsx'
import type { LlamaOperations } from '../llama-api.ts'

declare global {
  interface Window {
    dshLlama: LlamaOperations
  }
}

const container = document.getElementById('root')
if (container === null) throw new Error('desktop local models: missing React root')
const root = createRoot(container)
flushSync(() => { root.render(createElement(LlamaPage, { api: window.dshLlama })) })
window.addEventListener('pagehide', () => { root.unmount() }, { once: true })
