// services/backup.js: selection tree of the backup data (consistency with the server and the translations)
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import BackupService from '@/services/backup'
import messages from '@/i18n'
import { FRONTEND_DIR, flattenMessages } from '../../helpers/source'

const { CATEGORY_GROUPS, DEPENDENCIES } = BackupService
const categories = CATEGORY_GROUPS.flatMap((group) => group.categories)

// Categories and dependencies of the server (backend/src/lib/backup.js): the backend is next to the frontend in the
// repository, a missing file fails the tests instead of skipping them
const backendFile = path.join(FRONTEND_DIR, '..', 'backend', 'src', 'lib', 'backup.js')
const backendSource = fs.readFileSync(backendFile, 'utf8')

function backendCategories() {
  const block = backendSource.match(/var CATEGORIES = \{([\s\S]*?)\n\};/)[1]
  return [...block.matchAll(/^\s*(\w+):/gm)].map((match) => match[1])
}

function backendDependencies() {
  const literal = backendSource.match(/var DEPENDENCIES = (\{.*\});/)[1]
  return Function(`return (${literal})`)()
}

describe('BackupService categories', () => {
  it('lists every category once, in one group', () => {
    expect(new Set(categories).size).toBe(categories.length)
    const keys = CATEGORY_GROUPS.map((group) => group.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(CATEGORY_GROUPS.every((group) => group.categories.length > 0)).toBe(true)
  })

  it('only has dependencies between known categories, without cycle', () => {
    for (const [category, dependencies] of Object.entries(DEPENDENCIES)) {
      expect(categories).toContain(category)
      for (const dependency of dependencies) {
        expect(categories).toContain(dependency)
        expect(DEPENDENCIES[dependency] || []).not.toContain(category)
      }
    }
    expect(DEPENDENCIES).toEqual({ audits: ['images'], vulnerabilities: ['images'], clients: ['companies'] })
  })

  it.each(['en-US', 'fr-FR'])('has a %s label for every category, group, backup type, restore mode and warning', (locale) => {
    const flat = flattenMessages(messages[locale])
    const keys = [
      ...categories.map((category) => `backup.categories.${category}`),
      ...CATEGORY_GROUPS.map((group) => `backup.categories.${group.key}`),
      'backup.type.full', 'backup.type.partial',
      'backup.mode.merge', 'backup.mode.replace',
      'backup.modeInfo.merge', 'backup.modeInfo.replace',
      'backup.restoreWarning.merge', 'backup.restoreWarning.replace'
    ]
    expect(keys.filter((key) => !flat[key])).toEqual([])
  })

  describe('consistency with the server (backend/src/lib/backup.js)', () => {
    it('offers the categories of the server', () => {
      expect([...categories].sort()).toEqual(backendCategories().sort())
    })

    it('applies the same dependencies as the server', () => {
      expect(DEPENDENCIES).toEqual(backendDependencies())
    })
  })
})
