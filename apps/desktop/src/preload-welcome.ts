import type { AccountView, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'
/** Localized welcome copy and write-only credential actions. */

import { contextBridge, ipcRenderer } from 'electron'
import { resolveDesktopLocale } from './locale.ts'
import { WELCOME_IPC, type WelcomeApi, type WelcomePage, type WelcomeSaveResult } from './welcome-api.ts'
import type { McpCredentialDraftInput } from './mcp-credential-contract.ts'

const localePrefix = '--dsh-welcome-locale='
const pagePrefix = '--dsh-welcome-page='
const locale = process.argv.find(argument => argument.startsWith(localePrefix))?.slice(localePrefix.length)
if (locale === undefined) throw new Error('desktop welcome: missing window locale')
// The window's opening page is a shell-owned decision, so it travels the same command-line channel as the locale.
const requestedPage = process.argv.find(argument => argument.startsWith(pagePrefix))?.slice(pagePrefix.length)
const initialPage: WelcomePage = requestedPage === 'mcp' ? 'mcp' : 'entry'
const api: WelcomeApi = {
  ...resolveDesktopLocale(locale),
  initialPage,
  startSignIn: () => ipcRenderer.invoke(WELCOME_IPC.start) as Promise<AccountView>,
  cancelSignIn: (id: SignInAttemptId) => ipcRenderer.invoke(WELCOME_IPC.cancel, id) as Promise<AccountView>,
  copySignInLink: (id: SignInAttemptId) => ipcRenderer.invoke(WELCOME_IPC.copyLink, id) as Promise<void>,
  onAccountState: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, state: AccountView): void =>{  listener(state) }
    ipcRenderer.on(WELCOME_IPC.state, receive)
    return () => { ipcRenderer.removeListener(WELCOME_IPC.state, receive) }
  },
  saveApiKey: (value: string) => ipcRenderer.invoke(WELCOME_IPC.saveApiKey, value) as Promise<WelcomeSaveResult>,
  skip: () => ipcRenderer.invoke(WELCOME_IPC.skip) as Promise<void>,
  readMcp: () => ipcRenderer.invoke(WELCOME_IPC.readMcp) as ReturnType<WelcomeApi['readMcp']>,
  saveMcp: (input: McpCredentialDraftInput) => ipcRenderer.invoke(WELCOME_IPC.saveMcp, input) as Promise<WelcomeSaveResult>,
  clearMcp: () => ipcRenderer.invoke(WELCOME_IPC.clearMcp) as Promise<WelcomeSaveResult>,
  finishMcp: () => ipcRenderer.invoke(WELCOME_IPC.finishMcp) as Promise<void>,
}
contextBridge.exposeInMainWorld('dshWelcome', api)
