// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installWindowsMenu } from '../src/preload-menu.ts'
import { DESKTOP_IPC } from '../src/ipc.ts'

const invoke = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>())
vi.mock('electron', () => ({ ipcRenderer: { invoke } }))
let menu: ReturnType<typeof installWindowsMenu> | undefined

beforeEach(() => {
  invoke.mockResolvedValue(undefined)
})

afterEach(() => {
  menu?.dispose()
  menu = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const requestApplicationMenu = (detail?: unknown): void => {
  document.dispatchEvent(new CustomEvent('dsh:application-menu', { detail }))
}

it('installs no caption menubar: the Application menu lives in the sidebar now', () => {
  menu = installWindowsMenu()
  expect(document.querySelector('[data-windows-menu]')).toBeNull()
  expect(document.querySelector('button')).toBeNull()
  // update() stays a no-op: there are no caption labels left to refresh.
  menu.update()
  expect(document.querySelector('[data-windows-menu]')).toBeNull()
  expect(invoke).not.toHaveBeenCalled()
})

it('bridges the sidebar Application event to the windowsMenu IPC', async () => {
  menu = installWindowsMenu()
  requestApplicationMenu({ x: 48, y: 34 })
  await vi.waitFor(() => { expect(invoke).toHaveBeenCalledTimes(1) })
  expect(invoke).toHaveBeenCalledExactlyOnceWith(DESKTOP_IPC.windowsMenu, 'application', 48, 34)
  // The bridge has no Edit path: 'application' is the only name it can send.
  expect(invoke).not.toHaveBeenCalledWith(DESKTOP_IPC.windowsMenu, 'edit', expect.anything(), expect.anything())
})

it('ignores menu requests without finite numeric coordinates', () => {
  menu = installWindowsMenu()
  requestApplicationMenu()
  requestApplicationMenu({})
  requestApplicationMenu({ x: 48 })
  requestApplicationMenu({ x: '48', y: 34 })
  requestApplicationMenu({ x: Number.NaN, y: 34 })
  requestApplicationMenu({ x: 48, y: Number.POSITIVE_INFINITY })
  expect(invoke).not.toHaveBeenCalled()
})

it('ignores a second request while a popup is already open', async () => {
  let close!: () => void
  invoke.mockImplementation(() => new Promise<void>((resolve) => { close = resolve }))
  menu = installWindowsMenu()
  requestApplicationMenu({ x: 1, y: 2 })
  requestApplicationMenu({ x: 3, y: 4 })
  expect(invoke).toHaveBeenCalledExactlyOnceWith(DESKTOP_IPC.windowsMenu, 'application', 1, 2)
  close()
  await vi.waitFor(() => { expect(invoke).toHaveBeenCalledTimes(1) })
  requestApplicationMenu({ x: 5, y: 6 })
  await vi.waitFor(() => { expect(invoke).toHaveBeenCalledTimes(2) })
  expect(invoke).toHaveBeenLastCalledWith(DESKTOP_IPC.windowsMenu, 'application', 5, 6)
})

it('restores a text input and its selection after the popup closes', async () => {
  const input = document.createElement('input')
  input.value = 'editor text'
  document.body.append(input)
  menu = installWindowsMenu()
  input.focus()
  input.setSelectionRange(2, 6, 'backward')
  const other = document.createElement('button')
  document.body.append(other)
  other.focus()
  input.setSelectionRange(0, 0)
  requestApplicationMenu({ x: 0, y: 0 })
  await vi.waitFor(() => { expect(document.activeElement).toBe(input) })
  expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([2, 6, 'backward'])
})

it('restores a contenteditable selection after the popup closes', async () => {
  const editor = document.createElement('div')
  editor.contentEditable = 'true'
  editor.setAttribute('contenteditable', 'true')
  editor.tabIndex = 0
  editor.textContent = 'editable text'
  document.body.append(editor)
  menu = installWindowsMenu()
  editor.focus()
  const range = document.createRange()
  range.setStart(editor.firstChild!, 2)
  range.setEnd(editor.firstChild!, 8)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
  const other = document.createElement('button')
  document.body.append(other)
  other.focus()
  document.getSelection()!.removeAllRanges()
  requestApplicationMenu({ x: 0, y: 0 })
  await vi.waitFor(() => { expect(document.activeElement).toBe(editor) })
  expect(document.getSelection()!.toString()).toBe('itable')
})

it('reports a failed popup request and still serves the next one', async () => {
  const error = new Error('popup rejected')
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  invoke.mockRejectedValueOnce(error)
  menu = installWindowsMenu()
  requestApplicationMenu({ x: 1, y: 1 })
  await vi.waitFor(() => { expect(log).toHaveBeenCalledWith('Desktop application menu failed', error) })
  requestApplicationMenu({ x: 2, y: 2 })
  await vi.waitFor(() => { expect(invoke).toHaveBeenCalledTimes(2) })
  expect(invoke).toHaveBeenLastCalledWith(DESKTOP_IPC.windowsMenu, 'application', 2, 2)
})

it('stops bridging after disposal', async () => {
  menu = installWindowsMenu()
  menu.dispose()
  menu = undefined
  requestApplicationMenu({ x: 1, y: 2 })
  await new Promise<void>((resolve) => { queueMicrotask(resolve) })
  expect(invoke).not.toHaveBeenCalled()
})
