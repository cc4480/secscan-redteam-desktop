/**
 * Workflow environments: no GitHub workflow may carry a public client value in
 * its workflow-wide environment.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { dshBuildWorkflows, root } from './client-build-environment-harness-cases.ts'

describe('client build environment', () => {
  it('keeps public client values out of workflow-wide environments', () => {
    for (const name of dshBuildWorkflows) {
      const path = `.github/workflows/${name}`
      const document: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
      if (typeof document !== 'object' || document === null || Array.isArray(document)) {
        throw new TypeError(`${path} must contain a workflow object`)
      }
      expect(JSON.stringify(document), path).not.toContain('DSH_CLIENT_')
    }
  })
})
