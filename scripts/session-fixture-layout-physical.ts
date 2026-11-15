/** Repository roots whose session JSONL preserves physical persistence encoding. */

/** Physical persistence artifacts validated by the WebWorker runtime fixture spec. */
const WEBWORKER_PHYSICAL_SESSION_FIXTURE_ROOT =
  'packages/experimental/webworker-runtime/tests/fixtures/vfs-example/home/sessions/'

/** Installed-runtime snapshots that preserve the JSONL writer's physical encoding. */
const PYTHON_RUNTIME_PHYSICAL_SESSION_FIXTURE_ROOT =
  'scripts/snapshots/python-sdk-single-exe/'

/**
 * Whether a repository JSONL preserves physical persistence encoding rather
 * than the logical event projection owned by this script.
 * @param path - Repository-relative path with `/` separators.
 * @returns True for physical WebWorker and installed-runtime session logs.
 */
export function isPhysicalSessionFixture(path: string): boolean {
  if (path.startsWith(WEBWORKER_PHYSICAL_SESSION_FIXTURE_ROOT)) {
    return /\/session(?:\.v[1-9]\d*)?\.jsonl$/.test(path)
  }
  return path.startsWith(PYTHON_RUNTIME_PHYSICAL_SESSION_FIXTURE_ROOT)
    && /\/session(?:\.[1-9]\d*)?(?:\.v[1-9]\d*)?\.jsonl$/.test(path)
}
