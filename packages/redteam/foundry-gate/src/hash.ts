import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Recompute a bundle directory's hash, byte-for-byte compatible with the
 * Foundry validator: files are visited in sorted relative-path order and
 * each file contributes its relative path (UTF-8) followed by its bytes.
 *
 * @param bundleDir - the bundle directory to hash
 * @returns the lowercase hex SHA-256 digest
 */
export function bundleHash(bundleDir: string): string {
  const files: string[] = []
  collect(bundleDir, bundleDir, files)
  files.sort()
  const hash = createHash('sha256')
  for (const rel of files) {
    hash.update(rel, 'utf8')
    hash.update(readFileSync(join(bundleDir, rel)))
  }
  return hash.digest('hex')
}

/**
 * Collect every file under a directory as a relative path with `/` separators.
 *
 * @param dir - the directory currently being walked
 * @param base - the bundle root the paths are relative to
 * @param out - accumulator for relative file paths
 * @returns nothing; results accumulate in `out`
 */
function collect(dir: string, base: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collect(path, base, out)
    else if (entry.isFile()) out.push(relative(base, path).split(sep).join('/'))
  }
}
