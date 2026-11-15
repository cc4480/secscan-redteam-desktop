import { fileURLToPath } from 'node:url'

/** Repository root: the directory holding this `scripts/` tree. */
export const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** Client-face type emit feeding every tsdown lib entry in the watch set. */
export const CLIENT_TYPE_PROGRAM = 'tsconfig.client.json'

/** Compile-shell workspace whose dist `dsh web` serves. */
export const SHELL_PACKAGE = '@deepseek-ai/dsh-web-frontend'
