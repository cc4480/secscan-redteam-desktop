/** Windows Application menu bridge, isolated from the Web client. */
import { ipcRenderer } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'

/**
 * Document event the in-app sidebar dispatches to open the native
 * Application menu: the detail carries the anchor point (the sidebar
 * row's bottom-left) in CSS pixels, the same anchor the caption
 * buttons used before the menu moved into the sidebar.
 */
const APPLICATION_MENU_EVENT = 'dsh:application-menu'

/**
 * Bridge the sidebar's Application row to the native popup without moving
 * focus out of the active editor: the editor's selection is remembered on
 * focus-out and restored once the popup closes. There is no caption
 * menubar anymore — the Application menu's only seat is the sidebar row
 * above the panel list, and the Edit menu is gone entirely.
 * @returns Language refresh and document teardown operations.
 */
export function installWindowsMenu(): { update(): void; dispose(): void } {
  let restoreEditor = (): void => {}
  const rememberEditor = (event: FocusEvent): void => {
    const target = event.composedPath()[0]
    if (!(target instanceof HTMLElement)) return
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)
      && !target.matches('[contenteditable="true"]')) return
    const selection = document.getSelection()
    const ranges = selection === null ? [] : Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
    const input = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : undefined
    const start = input?.selectionStart
    const end = input?.selectionEnd
    const direction = input?.selectionDirection
    restoreEditor = () => {
      if (!target.isConnected) return
      target.focus({ preventScroll: true })
      if (input !== undefined && start != null && end != null) input.setSelectionRange(start, end, direction ?? undefined)
      else if (selection !== null && ranges.length > 0) {
        selection.removeAllRanges()
        for (const range of ranges) selection.addRange(range)
      }
    }
  }
  document.addEventListener('focusout', rememberEditor, true)
  let popupOpen = false
  const openApplicationMenu = async (x: number, y: number): Promise<void> => {
    if (popupOpen) return
    popupOpen = true
    try { await ipcRenderer.invoke(DESKTOP_IPC.windowsMenu, 'application', x, y) }
    catch (error) { console.error('Desktop application menu failed', error) }
    finally {
      popupOpen = false
      restoreEditor()
    }
  }
  const onMenuRequest = (event: Event): void => {
    const detail = (event as CustomEvent<{ x?: unknown; y?: unknown }>).detail
    const x = detail?.x
    const y = detail?.y
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return
    void openApplicationMenu(x, y)
  }
  document.addEventListener(APPLICATION_MENU_EVENT, onMenuRequest)
  return {
    // No caption labels remain to refresh: the menu's only seat is the
    // sidebar row, which the client renders and labels itself.
    update: () => {},
    dispose: () => {
      document.removeEventListener('focusout', rememberEditor, true)
      document.removeEventListener(APPLICATION_MENU_EVENT, onMenuRequest)
    },
  }
}
