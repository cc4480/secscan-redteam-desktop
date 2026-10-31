/** Mount the local React renderer before Electron reveals the welcome window. */
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Welcome } from './WelcomePage.tsx'
import type { WelcomeReadinessApi } from './WelcomePage.tsx'

declare global {
  interface Window {
    dshWelcome: WelcomeReadinessApi
  }
}

const container = document.getElementById('root')
if (container === null) throw new Error('desktop welcome: missing React root')
const root = createRoot(container)
flushSync(() => { root.render(<Welcome api={window.dshWelcome} />) })
window.addEventListener('pagehide', () => { root.unmount() }, { once: true })
