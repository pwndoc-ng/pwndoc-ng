// Boot files: i18n, dark mode, public settings, lodash
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Dark } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import { api, resetApi } from '../../helpers/api-mock'
import bootI18n, { i18n, $t } from 'boot/i18n'
import bootDarkmode, { updateDarkMode } from 'boot/darkmode'
import bootSettings from 'boot/settings'
import bootLodash from 'boot/lodash'

const newApp = () => ({ config: { globalProperties: {} }, use: vi.fn() })

describe('boot/i18n', () => {
  it('uses the composition API mode with English as fallback', () => {
    expect(i18n.mode).toBe('composition')
    expect(i18n.global.fallbackLocale.value).toBe('en-US')
    expect(i18n.global.availableLocales.sort()).toEqual(['de-DE', 'en-US', 'fr-FR', 'pt-BR', 'zh-CN'])
  })

  it('translates in the JS files with $t, with list and named parameters', () => {
    expect($t('btn.cancel')).toBe('Cancel')
    expect($t('backup.uploadOk', ['a.zip'])).toBe('a.zip added to the backups')
    expect($t('backup.restoreOk', [3, 1])).toBe('3 documents and 1 report templates restored')
  })

  it('follows the selected language and falls back to English for the missing translations', () => {
    try {
      i18n.global.locale.value = 'fr-FR'
      expect($t('btn.cancel')).toBe('Annuler')
      // German translation partial: a key absent from de-DE is displayed in English
      i18n.global.locale.value = 'de-DE'
      expect($t('btn.cancel')).toBe('Abbrechen')
      expect(i18n.global.te('cloneExistingReport', 'de-DE')).toBe(false)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect($t('cloneExistingReport')).toBe(i18n.global.t('cloneExistingReport', {}, { locale: 'en-US' }))
      warn.mockRestore()
    }
    finally {
      i18n.global.locale.value = 'en-US'
    }
  })

  it('installs the plugin on the application', () => {
    const app = newApp()
    bootI18n({ app })
    expect(app.use).toHaveBeenCalledWith(i18n)
  })

  it('starts in the language saved in the browser, English by default', async () => {
    vi.resetModules()
    localStorage.setItem('system_language', 'de-DE')
    const { i18n: german } = await import('boot/i18n')
    expect(german.global.locale.value).toBe('de-DE')
    vi.resetModules()
    localStorage.removeItem('system_language')
    const { i18n: english } = await import('boot/i18n')
    expect(english.global.locale.value).toBe('en-US')
    expect(localStorage.getItem('system_language')).toBe('en-US')
  })
})

describe('boot/darkmode', () => {
  beforeEach(() => localStorage.removeItem('darkmodeEnabled'))

  it('enables the dark mode and saves the choice', () => {
    updateDarkMode(true)
    expect(Dark.isActive).toBe(true)
    expect(localStorage.getItem('darkmodeEnabled')).toBe('y')
    updateDarkMode(false)
    expect(Dark.isActive).toBe(false)
    expect(localStorage.getItem('darkmodeEnabled')).toBeNull()
  })

  it('restores the saved choice', () => {
    localStorage.setItem('darkmodeEnabled', 'y')
    updateDarkMode()
    expect(Dark.isActive).toBe(true)
    localStorage.removeItem('darkmodeEnabled')
    updateDarkMode()
    expect(Dark.isActive).toBe(false)
  })

  it('exposes $toggleDarkMode and $updateDarkMode', () => {
    const app = newApp()
    bootDarkmode({ app })
    app.config.globalProperties.$toggleDarkMode()
    expect(Dark.isActive).toBe(true)
    app.config.globalProperties.$toggleDarkMode()
    expect(Dark.isActive).toBe(false)
    expect(app.config.globalProperties.$updateDarkMode).toBe(updateDarkMode)
  })
})

describe('boot/settings', () => {
  beforeEach(() => resetApi())

  it('loads the public settings into $settings and refreshes them', async () => {
    api.get.mockResolvedValueOnce({ data: { datas: { reviews: { enabled: true }, report: { public: { highlightWarning: false } } } } })
    const app = newApp()
    await bootSettings({ app })
    const settings = app.config.globalProperties.$settings
    expect(api.get).toHaveBeenCalledWith('settings/public')
    expect(settings.reviews.enabled).toBe(true)
    api.get.mockResolvedValueOnce({ data: { datas: { reviews: { enabled: false } } } })
    await settings.refresh()
    expect(settings.reviews.enabled).toBe(false)
    expect(settings.report.public.highlightWarning).toBe(false)
  })

  it('keeps an empty $settings when the settings cannot be loaded', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    api.get.mockRejectedValue(new Error('Network Error'))
    const app = newApp()
    await bootSettings({ app })
    const settings = app.config.globalProperties.$settings
    expect(Object.keys(settings)).toEqual(['refresh'])
    await settings.refresh()
    expect(error).toHaveBeenCalledTimes(2)
  })
})

describe('boot/lodash', () => {
  it('exposes lodash as $_', async () => {
    const app = newApp()
    bootLodash({ app })
    expect(app.config.globalProperties.$_.cloneDeep({ a: [1] })).toEqual({ a: [1] })
  })
})
