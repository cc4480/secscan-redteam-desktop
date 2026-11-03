/**
 * One atomic file replace, for every store in the runner.
 *
 * Two modules grew their own version and both had the same destructive
 * fallback: on a failed rename they deleted the LIVE file, then renamed —
 * and if that second rename also threw, the `finally` deleted the tmp as
 * well, leaving neither copy. One Windows AV lock or EBUSY was enough to
 * lose a findings registry or a foundry store outright.
 *
 * The sequence here never unlinks the live file. A failed rename is retried
 * by moving the target ASIDE (`*.bak`), placing the new file, and only then
 * discarding the backup; any failure restores the backup. A crash at any
 * point leaves either the old bytes or the new bytes on disk.
 */
import { copyFileSync, existsSync, renameSync, rmSync, writeFileSync } from 'node:fs'

/** A unique tmp path beside the target, so two writers never share one. */
function siblingTmp(path: string): string {
  return `${path}.tmp-${process.pid}-${Date.now().toString(36)}`
}

/**
 * Atomically replace `path` with `body`.
 * @param path - Absolute target path (its parent must exist).
 * @param body - The bytes to land.
 * @throws the original error, with the previous contents still in place.
 */
export function atomicWriteFileSync(path: string, body: string): void {
  const tmp = siblingTmp(path)
  const bak = `${path}.bak-${process.pid}`
  try {
    writeFileSync(tmp, body)
    try {
      renameSync(tmp, path)
      return
    } catch {
      // Rename can fail on Windows while a reader holds the target. Move the
      // live file aside instead of deleting it — the bytes stay recoverable.
      try {
        renameSync(path, bak)
      } catch {
        // No live file to move (first write, or already gone): fall through to
        // a plain copy, which is still safe because there is nothing to lose.
        copyFileSync(tmp, path)
        return
      }
    }
    try {
      renameSync(tmp, path)
      rmSync(bak, { force: true })
    } catch (err) {
      // Restore the original, then report the failure with data intact.
      try {
        if (existsSync(bak) && !existsSync(path)) renameSync(bak, path)
      } catch {
        /* the backup stays on disk under .bak — recoverable by hand */
      }
      throw err
    }
  } finally {
    if (existsSync(tmp)) {
      try {
        rmSync(tmp, { force: true })
      } catch {
        /* tmp already gone */
      }
    }
  }
}
