/** Electron single-instance ownership before any Desktop profile lifecycle begins. */

/** Minimal Electron application operations needed for instance ownership. */
export interface DesktopSingleInstanceApplication {
  requestSingleInstanceLock(): boolean
  quit(): void
  on(event: 'second-instance', listener: () => void): unknown
}

/**
 * Claim the process-lifetime Desktop lock and route later launches to the owner.
 *
 * Losing the lock is a legitimate outcome (the operator launched the app twice), but quitting
 * without a trace is not: it looks exactly like a failed launch. `onLockLost` gives the caller a
 * chance to record why this process is about to exit before it does.
 * @param application - Electron application singleton.
 * @param focusOwner - focus or recreate the primary window after a later launch.
 * @param onLockLost - records the exit reason; called only when another process owns the lock.
 * @returns true only in the process that may access the Desktop profile.
 */
export function claimDesktopSingleInstance(
  application: DesktopSingleInstanceApplication,
  focusOwner: () => void,
  onLockLost?: () => void,
): boolean {
  if (!application.requestSingleInstanceLock()) {
    onLockLost?.()
    application.quit()
    return false
  }
  application.on('second-instance', focusOwner)
  return true
}
