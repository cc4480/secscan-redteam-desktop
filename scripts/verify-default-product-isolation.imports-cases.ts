/** The import cases: which runtime source references the default Web entry reaches. */

import { describe, expect, it } from 'vitest'
import { verifyDefaultProductIsolation } from './verify-default-product-isolation.ts'
import { experimental, fixture, manifest, write } from './verify-default-product-isolation.harness-cases.ts'

describe('default product isolation', () => {
  it.each([
    `import '${experimental}'`,
    `export * from '${experimental}'`,
    `await import('${experimental}/client')`,
    `const x = require('${experimental}')`,
    'import \'./../../../packages/experimental/prototype/src/index.ts\'',
  ])('rejects runtime source reference %s', (source) => {
    const root = fixture()
    write(root, 'apps/cli/src/bin.ts', source)
    write(root, 'packages/experimental/prototype/src/index.ts', 'export {}\n')

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(experimental)
  })

  it.each([
    "import './preview.ts'", "import './preview.ts?worker'", "new Worker(new URL('./preview.ts', import.meta.url))",
  ])('rejects default Web entry reaching preview via %s', (source) => {
    const root = fixture()
    write(root, 'apps/web/src/main.ts', source)
    write(root, 'apps/web/src/preview.ts', `import '${experimental}'\n`)

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(experimental)
  })

  it.each([
    "import '/src/preview.ts'",
    "export * from '/src/preview.ts'",
    "await import('/src/preview.ts')",
    "new Worker(new URL('/src/preview.ts', import.meta.url))",
  ])('follows Web-root runtime reference %s', (source) => {
    const root = fixture()
    write(root, 'apps/web/src/main.ts', source)
    write(root, 'apps/web/src/preview.ts', `import '${experimental}'\n`)

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(experimental)
  })

  it('does not follow type-only Web-root references', () => {
    const root = fixture()
    write(root, 'apps/web/src/main.ts', "import type { Value } from '/src/preview.ts'\nexport type { Value } from '/src/preview.ts'\n")
    write(root, 'apps/web/src/preview.ts', `import '${experimental}'\n`)

    expect(verifyDefaultProductIsolation(root).failures).toEqual([])
  })

  it.each(['.js', '.jsx', '.mjs', '.ts', '.tsx', '.mts'])('follows extensionless Web imports to %s in a dotted checkout', (extension) => {
    const root = fixture()
    write(root, 'apps/web/src/main.ts', "import './preview'\n")
    write(root, `apps/web/src/preview${extension}`, `import '${experimental}'\n`)

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(experimental)
  })

  it.each(['.js', '.jsx', '.mjs'])('follows Web directory imports to index%s', (extension) => {
    const root = fixture()
    write(root, 'apps/web/src/main.ts', "import './preview'\n")
    write(root, `apps/web/src/preview/index${extension}`, `import '${experimental}'\n`)

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(experimental)
  })

  it.each([['.mjs', '.mts'], ['.cjs', '.cts']])('follows %s runtime requests to their %s source', (request, source) => {
    const root = fixture()
    write(root, 'apps/web/src/main.ts', `import './preview${request}'\n`)
    write(root, `apps/web/src/preview${source}`, `import '${experimental}'\n`)

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(experimental)
  })

  it('follows a Web directory import whose directory name contains a dot', () => {
    const root = fixture()
    write(root, 'apps/web/src/main.ts', "import './preview.v1'\n")
    write(root, 'apps/web/src/preview.v1/index.js', `import '${experimental}'\n`)

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(experimental)
  })

  it('identifies a relative package-directory import using its exact directory owner', () => {
    const root = fixture()
    write(root, 'apps/web/src/main.ts', "import '../../../packages/experimental/prototype'\n")
    manifest(root, 'packages/experimental/prototype/package.json', { main: 'src/entry.js' })
    write(root, 'packages/experimental/prototype/src/entry.js', 'export {}\n')

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(experimental)
  })
})
