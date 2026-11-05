/**
 * Atomically replace `path` with `body`.
 * @param path - Absolute target path (its parent must exist).
 * @param body - The bytes to land.
 * @throws the original error, with the previous contents still in place.
 */
export declare function atomicWriteFileSync(path: string, body: string): void;
