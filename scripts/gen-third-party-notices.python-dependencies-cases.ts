/** Collection of the Python dependencies the notices must disclose. */

import { describe, expect, it } from 'vitest'
import primaryRuntimeLock from './primary-runtime/lock.json' with { type: 'json' }
import {
  assertRuntimeLicenses,
  collectBundledPythonDependencies,
  collectPythonDependencies,
} from './gen-third-party-notices.ts'

describe('collectPythonDependencies', () => {
  it('labels shared Python metadata in the Python-project context', () => {
    const dependencies = collectPythonDependencies(['[project]\ndependencies = ["numpy", "pandas", "six", "tzdata"]\n'])
    expect(dependencies.map(({ role }) => role)).toEqual(Array(4).fill('Python project dependency'))
  })

  it('excludes normalized local project names without exempting a third-party prefix', () => {
    const pyprojects = [
      '[project]\nname = "deepseek-harness-runtime-bin"\ndependencies = ["pydantic"]\n',
      '[project]\nname = "deepseek-harness-sdk"\ndependencies = ["DeepSeek.Harness_Runtime-Bin", "deepseek-unrelated"]\n',
    ]
    expect(() => collectPythonDependencies(pyprojects)).toThrow(
      'python dependency deepseek-unrelated is missing from PYTHON_METADATA',
    )
  })
})

describe('collectBundledPythonDependencies', () => {
  it('discloses the committed bundled Python closure with its exact locked versions', () => {
    const dependencies = collectBundledPythonDependencies(primaryRuntimeLock.pythonPackages)
    expect(dependencies).toHaveLength(Object.keys(primaryRuntimeLock.pythonPackages).length)
    expect(dependencies).toContainEqual({
      name: 'pillow', version: primaryRuntimeLock.pythonPackages.Pillow,
      license: 'MIT-CMU', repo: 'https://github.com/python-pillow/Pillow',
    })
    expect(dependencies).toContainEqual({
      name: 'typing-extensions', version: primaryRuntimeLock.pythonPackages.typing_extensions,
      license: 'PSF-2.0', repo: 'https://github.com/python/typing_extensions',
    })
  })

  it('normalizes names while preserving pinned version strings', () => {
    expect(collectBundledPythonDependencies({ 'typing_extensions': '4.16.0', 'Pillow': '12.3.0' }))
      .toEqual([
        { name: 'pillow', version: '12.3.0', license: 'MIT-CMU', repo: 'https://github.com/python-pillow/Pillow' },
        { name: 'typing-extensions', version: '4.16.0', license: 'PSF-2.0', repo: 'https://github.com/python/typing_extensions' },
      ])
  })

  it('rejects duplicate normalized distribution names with the same locked version', () => {
    expect(() => collectBundledPythonDependencies({ typing_extensions: '4.16.0', 'typing.extensions': '4.16.0' }))
      .toThrow('duplicate normalized names')
  })

  it('rejects missing distribution metadata and conflicting normalized versions', () => {
    expect(() => collectBundledPythonDependencies({ missing: '1.0' })).toThrow('missing from PYTHON_METADATA')
    expect(() => collectBundledPythonDependencies({ Pillow: '12.3.0', pillow: '12.4.0' })).toThrow('conflicting locked versions')
  })

  it('applies the runtime license check to bundled Python distributions', () => {
    expect(() => { assertRuntimeLicenses(collectBundledPythonDependencies(primaryRuntimeLock.pythonPackages)) }).not.toThrow()
    const dependencies = collectBundledPythonDependencies({ 'copyleft-wheel': '1.0' }, {
      'copyleft-wheel': { license: 'GPL-3.0-only', repo: 'https://example.com/project' },
    })
    expect(() => { assertRuntimeLicenses(dependencies) }).toThrow('copyleft-wheel (GPL-3.0-only)')
  })
})
