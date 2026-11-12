// pages/settings: loading, permissions, save (button and Ctrl+S), unsaved changes, revert, import / export,
// findings sidebar template (API services mocked, language selector stubbed)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import _ from 'lodash'
import { QBtn, QToggle, QInput, QChip, QBtnToggle, QCheckbox } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import SettingsPage from 'pages/settings'
import SettingsService from '@/services/settings'
import DataService from '@/services/data'
import UserService from '@/services/user'
import SpellcheckService from '@/services/spellcheck'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'
import { trackFileReads } from '../../helpers/data-pages'

// Settings as returned by the backend (defaults of backend/src/models/settings.js)
const SETTINGS = () => ({
  report: {
    enabled: true,
    public: {
      cvssColors: { noneColor: '#4a86e8', lowColor: '#008000', mediumColor: '#f9a009', highColor: '#fe0000', criticalColor: '#212121' },
      remediationColorsComplexity: { lowColor: '#4472c4', mediumColor: '#ffc000', highColor: '#FF2F2F' },
      remediationColorsPriority: { lowColor: '#4472c4', mediumColor: '#ffc000', highColor: '#ff2f2f', urgentColor: '#C00000' },
      captions: ['Figure'],
      extendCvssTemporalEnvironment: false,
      findingSidebarTemplate: '{title}',
      imageDefaultWidth: 'large'
    },
    private: { imageBorder: false, imageBorderColor: '#000000' }
  },
  reviews: { enabled: false, public: { mandatoryReview: false, minReviewers: 1, blockApprovalWithOpenComments: false }, private: { removeApprovalsUponUpdate: false } },
  danger: { enabled: false, public: { nbdaydelete: 30 }, private: {} }
})

const CUSTOM_FIELDS = [
  { label: 'Asset', display: 'finding', fieldType: 'input' },
  { label: 'Impact métier 🔥', display: 'vulnerability', fieldType: 'select' },
  { label: 'Asset', display: 'vulnerability', fieldType: 'input' }, // Same label in another display: once
  { label: 'Spacer', display: 'finding', fieldType: 'space' },
  { label: 'Audit field', display: 'general', fieldType: 'input' },
  { label: 'Bad {label}', display: 'finding', fieldType: 'input' }, // Braces: not usable in the template
  { label: '', display: 'finding', fieldType: 'input' }
]

let wrapper
let $settings
let errors
let fileReadsDone

async function mountPage({ roles = '*', settings = SETTINGS(), customFields = CUSTOM_FIELDS } = {}) {
  UserService.user = { username: 'admin', roles }
  $settings = { refresh: vi.fn(() => Promise.resolve()), reviews: { enabled: false } }
  errors = []
  vi.spyOn(SettingsService, 'getSettings').mockResolvedValue({ data: { datas: settings } })
  vi.spyOn(DataService, 'getCustomFields').mockResolvedValue({ data: { datas: customFields } })
  wrapper = mount(SettingsPage, {
    attachTo: document.body,
    global: {
      mocks: { $_: _, $settings },
      stubs: { LanguageSelector: { name: 'LanguageSelector', template: '<div class="language-selector-stub" />' } },
      config: { errorHandler: (err) => errors.push(err) }
    }
  })
  await flushPromises()
  return wrapper
}

// Ctrl+S (Cmd+S on Mac): keyCode is not an init member of the jsdom KeyboardEvent
function pressSave(options = { ctrlKey: true }) {
  const event = new KeyboardEvent('keydown', { ...options, cancelable: true })
  Object.defineProperty(event, 'keyCode', { value: 83 })
  document.dispatchEvent(event)
  return event
}

const buttons = () => wrapper.findAllComponents(QBtn)
const buttonByLabel = (label) => buttons().find((button) => button.props('label') === label)

// Keydown listeners added by the page: also removed after each test, so that a page left mounted by a failed test
// does not save its settings on the Ctrl+S of the next tests
const keydownListeners = []
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  fileReadsDone = trackFileReads()
  vi.spyOn(document, 'addEventListener').mockImplementation(function (type, listener, options) {
    if (type === 'keydown') keydownListeners.push(listener)
    return EventTarget.prototype.addEventListener.call(this, type, listener, options)
  })
})
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
  keydownListeners.splice(0).forEach((listener) => EventTarget.prototype.removeEventListener.call(document, 'keydown', listener, false))
})

describe('settings loading and permissions', () => {
  it('loads the settings and the finding custom fields of the administrators', async () => {
    await mountPage()
    expect(SettingsService.getSettings).toHaveBeenCalledTimes(1)
    expect(DataService.getCustomFields).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.loading).toBe(false)
    expect(wrapper.vm.canEdit).toBe(true)
    expect(wrapper.text()).toContain(wrapper.vm.$t('generalSettings'))
    expect(wrapper.text()).toContain(wrapper.vm.$t('dangerSettings'))
    expect(wrapper.text()).toContain(wrapper.vm.$t('reportsImagesBorder'))
    expect(wrapper.find('.language-selector-stub').exists()).toBe(true)
    expect(buttonByLabel(wrapper.vm.$t('saveSettings'))).toBeTruthy()
    expect(buttonByLabel(wrapper.vm.$t('revertSettingsToDefaults'))).toBeTruthy()
  })

  it('completes the missing settings with the default values', async () => {
    await mountPage({ settings: { report: SETTINGS().report } })
    expect(wrapper.vm.settings.reviews).toEqual({ enabled: false, public: { minReviewers: 1 } })
    expect(wrapper.vm.settings.danger).toEqual({ enabled: false, public: { nbdaydelete: 0 } })
    expect(wrapper.vm.unsavedChanges()).toBe(false)
  })

  it('keeps the values of the server over the default values', async () => {
    const settings = SETTINGS()
    settings.reviews.public.minReviewers = 3
    settings.danger = { enabled: true, public: { nbdaydelete: 90 } }
    await mountPage({ settings })
    expect(wrapper.vm.settings.reviews.public.minReviewers).toBe(3)
    expect(wrapper.vm.settings.danger).toEqual({ enabled: true, public: { nbdaydelete: 90 } })
  })

  it('is read only for the users allowed to read the settings only', async () => {
    await mountPage({ roles: ['settings:read'] })
    expect(wrapper.vm.canEdit).toBe(false)
    expect(buttonByLabel(wrapper.vm.$t('saveSettings'))).toBeUndefined()
    expect(wrapper.text()).not.toContain(wrapper.vm.$t('reportsImagesBorder')) // Reports settings: settings:update only
    const toggles = wrapper.findAllComponents(QToggle)
    expect(toggles.filter((toggle) => toggle.props('disable')).length).toBeGreaterThanOrEqual(2) // danger and reviews toggles
    expect(wrapper.findComponent(QInput).props('readonly')).toBe(true) // Template of the sidebar
    expect(wrapper.findAllComponents(QChip).every((chip) => chip.props('clickable') === false)).toBe(true)
  })

  it('does not insert template variables without the update permission', async () => {
    await mountPage({ roles: ['settings:read'] })
    wrapper.vm.insertFindingTemplateVariable('identifier')
    expect(wrapper.vm.settings.report.public.findingSidebarTemplate).toBe('{title}')
  })

  it('does not request the settings for the users without the read permission', async () => {
    await mountPage({ roles: ['audits:read', 'settings:read-public'] })
    expect(SettingsService.getSettings).not.toHaveBeenCalled()
    expect(DataService.getCustomFields).not.toHaveBeenCalled()
    expect(wrapper.vm.canEdit).toBe(false)
  })

  it('shows the display language selector to the users without the read permission', async () => {
    await mountPage({ roles: ['audits:read', 'settings:read-public'] })
    expect(errors).toEqual([])
    expect(wrapper.find('.language-selector-stub').exists()).toBe(true)
    expect(wrapper.text()).not.toContain(wrapper.vm.$t('dangerSettings'))
  })

  it('notifies the loading error and does not show the settings', async () => {
    const notify = mockNotify()
    UserService.user = { username: 'admin', roles: '*' }
    vi.spyOn(SettingsService, 'getSettings').mockRejectedValue({ response: { status: 403, data: { datas: 'Insufficient privileges' } } })
    vi.spyOn(DataService, 'getCustomFields').mockResolvedValue({ data: { datas: [] } })
    wrapper = mount(SettingsPage, { global: { mocks: { $_: _, $settings: { refresh: vi.fn() } }, stubs: { LanguageSelector: true } } })
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Insufficient privileges', color: 'negative' })
    expect(wrapper.vm.loading).toBe(true)
    expect(wrapper.text()).toBe('')
  })

  it('ignores an error of the custom fields (variables without custom fields)', async () => {
    UserService.user = { username: 'admin', roles: '*' }
    vi.spyOn(SettingsService, 'getSettings').mockResolvedValue({ data: { datas: SETTINGS() } })
    vi.spyOn(DataService, 'getCustomFields').mockRejectedValue({ response: { status: 500 } })
    wrapper = mount(SettingsPage, { global: { mocks: { $_: _, $settings: { refresh: vi.fn() } }, stubs: { LanguageSelector: true } } })
    await flushPromises()
    expect(wrapper.vm.findingCustomFieldLabels).toEqual([])
    expect(wrapper.vm.findingTemplateVariables.some((variable) => variable.startsWith('custom.'))).toBe(false)
  })
})

describe('settings save', () => {
  it('saves the settings, refreshes the public settings and notifies', async () => {
    const notify = mockNotify()
    vi.spyOn(SettingsService, 'updateSettings').mockResolvedValue({ data: { datas: 'Settings updated' } })
    await mountPage()
    wrapper.vm.settings.report.public.extendCvssTemporalEnvironment = true
    expect(wrapper.vm.unsavedChanges()).toBe(true)
    await buttonByLabel(wrapper.vm.$t('saveSettings')).trigger('click')
    await flushPromises()
    expect(SettingsService.updateSettings).toHaveBeenCalledTimes(1)
    expect(SettingsService.updateSettings.mock.calls[0][0].report.public.extendCvssTemporalEnvironment).toBe(true)
    expect($settings.refresh).toHaveBeenCalled()
    expect(wrapper.vm.unsavedChanges()).toBe(false)
    expect(lastNotification(notify)).toMatchObject({ message: wrapper.vm.$t('msg.settingsUpdatedOk'), color: 'positive' })
  })

  it.each([
    [0, 1],
    [-5, 1],
    [150, 99],
    [1, 1],
    [99, 99],
    [4, 4]
  ])('limits the minimal number of reviewers %j to %j before saving', async (value, sent) => {
    mockNotify()
    vi.spyOn(SettingsService, 'updateSettings').mockResolvedValue({})
    await mountPage()
    wrapper.vm.settings.reviews.public.minReviewers = value
    wrapper.vm.updateSettings()
    await flushPromises()
    expect(SettingsService.updateSettings.mock.calls[0][0].reviews.public.minReviewers).toBe(sent)
    expect(wrapper.vm.settings.reviews.public.minReviewers).toBe(sent)
  })

  it('notifies the error of the server and keeps the changes unsaved', async () => {
    const notify = mockNotify()
    vi.spyOn(SettingsService, 'updateSettings').mockRejectedValue({ response: { status: 422, data: { datas: 'Invalid color' } } })
    await mountPage()
    wrapper.vm.settings.report.public.cvssColors.lowColor = 'green'
    wrapper.vm.updateSettings()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Invalid color', color: 'negative' })
    expect($settings.refresh).not.toHaveBeenCalled()
    expect(wrapper.vm.unsavedChanges()).toBe(true)
  })

  it('shows the message of the server for an HTTP error of axios', async () => {
    const notify = mockNotify()
    vi.spyOn(SettingsService, 'updateSettings').mockRejectedValue(Object.assign(new Error('Request failed with status code 422'), { response: { status: 422, data: { datas: 'Invalid color' } } }))
    await mountPage()
    wrapper.vm.updateSettings()
    await flushPromises()
    expect(lastNotification(notify).message).toBe('Invalid color')
  })

  it('shows the message of a network error (no response)', async () => {
    const notify = mockNotify()
    vi.spyOn(SettingsService, 'updateSettings').mockRejectedValue(new Error('Network Error'))
    await mountPage()
    wrapper.vm.updateSettings()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Network Error', color: 'negative' })
  })

  it('saves with Ctrl+S', async () => {
    mockNotify()
    vi.spyOn(SettingsService, 'updateSettings').mockResolvedValue({})
    await mountPage()
    const event = pressSave()
    await flushPromises()
    expect(SettingsService.updateSettings).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true) // No "save the page" dialog of the browser
  })

  it('does not save with S alone or another shortcut', async () => {
    vi.spyOn(SettingsService, 'updateSettings').mockResolvedValue({})
    await mountPage()
    pressSave({})
    pressSave({ altKey: true })
    expect(SettingsService.updateSettings).not.toHaveBeenCalled()
  })

  it('does not listen to Ctrl+S for the users without the read permission', async () => {
    vi.spyOn(SettingsService, 'updateSettings').mockResolvedValue({})
    await mountPage({ roles: ['audits:read'] })
    pressSave()
    expect(SettingsService.updateSettings).not.toHaveBeenCalled()
  })

  it('stops listening to Ctrl+S once the page is left', async () => {
    vi.spyOn(SettingsService, 'updateSettings').mockResolvedValue({})
    await mountPage()
    wrapper.unmount()
    wrapper = null
    pressSave()
    expect(SettingsService.updateSettings).not.toHaveBeenCalled()
  })
})

describe('settings unsaved changes', () => {
  const leave = () => {
    const next = vi.fn()
    SettingsPage.beforeRouteLeave.call(wrapper.vm, { path: '/audits' }, { path: '/settings' }, next)
    return next
  }

  it('leaves the page without confirmation when nothing changed', async () => {
    const dialogs = mockDialog()
    await mountPage()
    expect(leave()).toHaveBeenCalledWith()
    expect(dialogs).toHaveLength(0)
  })

  it('asks a confirmation to leave with unsaved changes', async () => {
    const dialogs = mockDialog()
    await mountPage()
    wrapper.vm.settings.danger.enabled = true
    const next = leave()
    expect(next).not.toHaveBeenCalled()
    expect(dialogs[0].options.title).toBe(wrapper.vm.$t('msg.thereAreUnsavedChanges'))
    dialogs[0].ok()
    expect(next).toHaveBeenCalledWith()
  })

  it('stays on the page when the confirmation is cancelled', async () => {
    const dialogs = mockDialog()
    await mountPage()
    wrapper.vm.settings.report.public.captions.push('Tableau')
    const next = leave()
    dialogs[0].cancel()
    expect(next).not.toHaveBeenCalled()
  })

  it('detects the unsaved changes in nested settings, with unicode values', async () => {
    await mountPage()
    wrapper.vm.settings.report.public.findingSidebarTemplate = '{title} — {custom.Impact métier 🔥}'
    expect(wrapper.vm.unsavedChanges()).toBe(true)
    wrapper.vm.settings.report.public.findingSidebarTemplate = '{title}'
    expect(wrapper.vm.unsavedChanges()).toBe(false)
  })
})

describe('settings revert, import and export', () => {
  it('reverts the settings to the default values after confirmation', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(SettingsService, 'revertDefaults').mockResolvedValue({})
    await mountPage()
    await buttonByLabel(wrapper.vm.$t('revertSettingsToDefaults')).trigger('click')
    expect(SettingsService.revertDefaults).not.toHaveBeenCalled()
    expect(dialogs[0].options.ok.color).toBe('negative')
    await dialogs[0].ok()
    await flushPromises()
    expect(SettingsService.revertDefaults).toHaveBeenCalledTimes(1)
    expect($settings.refresh).toHaveBeenCalled()
    expect(SettingsService.getSettings).toHaveBeenCalledTimes(2)
    expect(lastNotification(notify)).toMatchObject({ message: wrapper.vm.$t('msg.settingsUpdatedOk'), color: 'positive' })
  })

  it('does not revert when cancelled', async () => {
    const dialogs = mockDialog()
    vi.spyOn(SettingsService, 'revertDefaults').mockResolvedValue({})
    await mountPage()
    wrapper.vm.revertToDefaults()
    dialogs[0].cancel()
    expect(SettingsService.revertDefaults).not.toHaveBeenCalled()
  })

  it('notifies the error of the revert', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(SettingsService, 'revertDefaults').mockRejectedValue({ response: { status: 403, data: { datas: 'Insufficient privileges' } } })
    await mountPage()
    wrapper.vm.revertToDefaults()
    await dialogs[0].ok()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Insufficient privileges', color: 'negative' })
  })

  // Files read by FileReader (asynchronous in jsdom): waits for the end of the reading
  async function importFile(content) {
    wrapper.vm.importSettings([new File([content], 'settings.json', { type: 'application/json' })])
    await fileReadsDone()
  }

  it('imports a JSON file of settings after confirmation', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(SettingsService, 'updateSettings').mockResolvedValue({})
    await mountPage()
    const imported = { report: { public: { captions: ['Figure', 'Tableau', '図'] } } }
    await importFile(JSON.stringify(imported))
    expect(dialogs[0].options.title).toBe(wrapper.vm.$t('msg.importingSettings'))
    expect(SettingsService.updateSettings).not.toHaveBeenCalled()
    await dialogs[0].ok()
    await flushPromises()
    expect(SettingsService.updateSettings).toHaveBeenCalledWith(imported)
    expect(SettingsService.getSettings).toHaveBeenCalledTimes(2)
    expect(lastNotification(notify)).toMatchObject({ message: wrapper.vm.$t('msg.settingsImportedOk'), color: 'positive' })
  })

  it('does not import when the confirmation is cancelled', async () => {
    const dialogs = mockDialog()
    vi.spyOn(SettingsService, 'updateSettings').mockResolvedValue({})
    await mountPage()
    await importFile('{"danger": {"enabled": true}}')
    dialogs[0].cancel()
    expect(SettingsService.updateSettings).not.toHaveBeenCalled()
  })

  it('notifies a JSON syntax error with its message and imports nothing', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(SettingsService, 'updateSettings')
    await mountPage()
    await importFile('{"report": ')
    expect(dialogs).toHaveLength(0)
    expect(SettingsService.updateSettings).not.toHaveBeenCalled()
    expect(lastNotification(notify).color).toBe('negative')
    expect(lastNotification(notify).message).toMatch(/^Error while parsing JSON content: .*JSON/)
  })

  it.each(['42', '"text"', 'true'])('refuses a JSON value which is not an object (%s)', async (content) => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    await mountPage()
    await importFile(content)
    expect(dialogs).toHaveLength(0)
    expect(lastNotification(notify)).toMatchObject({ message: wrapper.vm.$t('err.importingSettingsError'), color: 'negative' })
  })

  it.each(['null', '[]', '[{"report": {}}]'])('refuses null and arrays (%s)', async (content) => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    await mountPage()
    await importFile(content)
    expect(dialogs).toHaveLength(0)
    expect(lastNotification(notify).color).toBe('negative')
  })

  it('notifies the error of the server when importing', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(SettingsService, 'updateSettings').mockRejectedValue({ response: { status: 422, data: { datas: 'Invalid color' } } })
    await mountPage()
    await importFile('{"report": {"public": {"cvssColors": {"lowColor": "green"}}}}')
    await dialogs[0].ok()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Invalid color', color: 'negative' })
  })

  it('exports the settings as a JSON file named by the server', async () => {
    let saved
    let fileName
    URL.createObjectURL = vi.fn((blob) => { saved = blob; return 'blob:settings' })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { fileName = this.download })
    const exported = { report: { public: { captions: ['Légende'] } } }
    vi.spyOn(SettingsService, 'exportSettings').mockResolvedValue({ data: exported, headers: { 'content-disposition': `attachment; filename="${encodeURIComponent('Paramètres pwndoc.json')}"` } })
    await mountPage()
    await wrapper.vm.exportSettings()
    expect(fileName).toBe('Paramètres pwndoc.json')
    expect(saved.type).toBe('application/json')
    expect(JSON.parse(await saved.text())).toEqual(exported)
    expect(document.querySelector('a[download]')).toBeNull() // Temporary link removed
  })
})

describe('findings sidebar template', () => {
  it('offers the variables of the findings and their usable custom fields (once each)', async () => {
    await mountPage()
    expect(wrapper.vm.findingCustomFieldLabels).toEqual(['Asset', 'Impact métier 🔥'])
    expect(wrapper.vm.findingTemplateVariables).toEqual([
      'title', 'identifier', 'vulnType', 'category', 'severity', 'cvssScore', 'cvssVector', 'priority', 'remediationComplexity', 'affected',
      'custom.Asset', 'custom.Impact métier 🔥'
    ])
    expect(wrapper.findAllComponents(QChip).map((chip) => chip.text())).toContain('{custom.Impact métier 🔥}')
  })

  it('shows the description with the braces of the examples', async () => {
    await mountPage()
    expect(wrapper.vm.findingTemplateDescription).toContain('{custom.Label}')
    expect(wrapper.vm.findingTemplateDescription).toContain('Default: {title}')
  })

  it('adds the clicked variable at the end of the template', async () => {
    await mountPage()
    const chip = wrapper.findAllComponents(QChip).find((c) => c.text() === '{identifier}')
    await chip.trigger('click')
    expect(wrapper.vm.settings.report.public.findingSidebarTemplate).toBe('{title} {identifier}')
    wrapper.vm.settings.report.public.findingSidebarTemplate = ''
    wrapper.vm.insertFindingTemplateVariable('custom.Asset')
    expect(wrapper.vm.settings.report.public.findingSidebarTemplate).toBe('{custom.Asset}')
  })

  it.each([
    ['{title}', 'SQL Injection'],
    ['{identifier} - {title}', 'IDX-003 - SQL Injection'],
    ['{severity} ({cvssScore}) {priority}/{remediationComplexity}', 'High (8.1) High/Easy'],
    ['{TITLE} [{custom.asset}]', 'SQL Injection [<Asset>]'],
    ['{custom.Impact métier 🔥}', '<Impact métier 🔥>'],
    ['{affected}  {vulnType}', 'srv-web-01 Web'],
    ['{unknown} {title}', '{unknown} SQL Injection'],
    ['{custom.Absent}', 'SQL Injection'], // Empty label: title
    ['', 'SQL Injection']
  ])('previews the template %j with a sample finding', async (template, preview) => {
    await mountPage()
    wrapper.vm.settings.report.public.findingSidebarTemplate = template
    expect(wrapper.vm.findingTemplatePreview).toBe(preview)
  })

  it('shows the preview as text (no HTML interpretation)', async () => {
    await mountPage()
    wrapper.vm.settings.report.public.findingSidebarTemplate = '<img src=x onerror=alert(1)> {title}'
    await flushPromises()
    expect(wrapper.find('img[src="x"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)> SQL Injection')
  })
})

describe('highlighted texts warning', () => {
  it('enables the warning and chooses several colors among the highlight colors of the editors', async () => {
    const settings = SETTINGS()
    settings.report.public.highlightWarning = false
    settings.report.public.highlightWarningColors = ['#ffff00']
    await mountPage({ settings })
    expect(wrapper.vm.highlightColorOptions).toEqual([
      { value: '#ffff00', label: 'Yellow' }, { value: '#fe0000', label: 'Red' }, { value: '#00ff00', label: 'Green' }, { value: '#00ffff', label: 'Cyan' }
    ])
    const section = wrapper.find('.highlight-warning-settings')
    expect(section.text()).toContain('Highlighted texts to replace')
    const boxes = () => section.findAllComponents(QCheckbox)
    expect(boxes()).toHaveLength(4)
    expect(boxes().every((box) => box.props('disable'))).toBe(true) // Disabled with the warning
    expect(boxes().map((box) => box.props('modelValue').includes(box.props('val')))).toEqual([true, false, false, false])
    wrapper.vm.settings.report.public.highlightWarning = true
    await flushPromises()
    expect(boxes().some((box) => box.props('disable'))).toBe(false)
    await boxes()[2].trigger('click') // Green added
    await boxes()[1].trigger('click') // Red added
    await boxes()[0].trigger('click') // Yellow removed
    expect(wrapper.vm.settings.report.public.highlightWarningColors).toEqual(['#00ff00', '#fe0000'])
    const update = vi.spyOn(SettingsService, 'updateSettings').mockResolvedValue({})
    wrapper.vm.updateSettings()
    await flushPromises()
    expect(update.mock.calls[0][0].report.public).toMatchObject({ highlightWarning: true, highlightWarningColors: ['#00ff00', '#fe0000'] })
  })
})

describe('quality checks', () => {
  const CHECKS = { completeness: true, comments: true, internalLinks: true, images: true, references: true, duplicates: true }

  it('enables and disables each check of the quality checks', async () => {
    const settings = SETTINGS()
    settings.qa = { public: { checks: { ...CHECKS } } }
    await mountPage({ settings })
    const items = wrapper.findAll('.qa-settings .qa-check')
    expect(items.map((item) => item.text())).toEqual([
      expect.stringContaining('Completeness'), expect.stringContaining('Review comments'), expect.stringContaining('Links between findings'),
      expect.stringContaining('Images'), expect.stringContaining('References'), expect.stringContaining('Duplicated vulnerabilities')
    ])
    expect(wrapper.find('.qa-settings').text()).toContain('Links are never opened')
    await items[2].findComponent(QToggle).trigger('click')
    expect(wrapper.vm.settings.qa.public.checks.internalLinks).toBe(false)
    const update = vi.spyOn(SettingsService, 'updateSettings').mockResolvedValue({})
    wrapper.vm.updateSettings()
    await flushPromises()
    expect(update.mock.calls[0][0].qa.public.checks).toEqual({ ...CHECKS, internalLinks: false })
  })

  it('is read only for the users allowed to read the settings only', async () => {
    const settings = SETTINGS()
    settings.qa = { public: { checks: { ...CHECKS } } }
    await mountPage({ settings, roles: ['settings:read'] })
    expect(wrapper.findAll('.qa-settings .qa-check').every((item) => item.findComponent(QToggle).props('disable'))).toBe(true)
  })
})

describe('words ignored by the spell checker', () => {
  const WORDS = () => [
    { _id: 'w1', word: 'Nmap', status: 'pending', proposedBy: { username: 'jdoe', firstname: 'John', lastname: 'Doe' } },
    { _id: 'w2', word: 'Burp', status: 'approved', proposedBy: { username: 'pentester' }, approvedBy: { username: 'admin', firstname: 'Ad', lastname: 'Min' } }
  ]
  const items = () => wrapper.findAll('.spellcheck-word')

  it('lists the proposed words first, then the approved ones, with who proposed and approved them', async () => {
    vi.spyOn(SpellcheckService, 'getAllWords').mockResolvedValue({ data: { datas: WORDS() } })
    await mountPage()
    expect(items()).toHaveLength(2)
    expect(items()[0].text()).toContain('Nmap')
    expect(items()[0].text()).toContain('Proposed by John Doe')
    expect(items()[0].text()).toContain('Pending')
    expect(items()[1].text()).toContain('Proposed by pentester · approved by Ad Min')
    expect(items()[0].find('.spellcheck-approve').exists()).toBe(true)
    expect(items()[1].find('.spellcheck-approve').exists()).toBe(false) // Already approved
  })

  it('is not shown to the users who cannot approve the words', async () => {
    const getAll = vi.spyOn(SpellcheckService, 'getAllWords')
    await mountPage({ roles: ['settings:read', 'settings:update', 'spellcheck-words:create'] })
    expect(getAll).not.toHaveBeenCalled()
    expect(wrapper.find('.spellcheck-words').exists()).toBe(false)
  })

  it('approves a proposed word, removes a word, then reloads the list and the words of the editors', async () => {
    const getAll = vi.spyOn(SpellcheckService, 'getAllWords').mockResolvedValue({ data: { datas: WORDS() } })
    const approve = vi.spyOn(SpellcheckService, 'approveWord').mockResolvedValue({})
    const remove = vi.spyOn(SpellcheckService, 'deleteWord').mockResolvedValue({})
    const clear = vi.spyOn(SpellcheckService, 'clearCache')
    await mountPage()
    await items()[0].find('.spellcheck-approve').trigger('click')
    await flushPromises()
    expect(approve).toHaveBeenCalledWith('w1')
    expect(getAll).toHaveBeenCalledTimes(2)
    await items()[1].find('.spellcheck-delete').trigger('click')
    await flushPromises()
    expect(remove).toHaveBeenCalledWith('w2')
    expect(getAll).toHaveBeenCalledTimes(3)
    expect(clear).toHaveBeenCalledTimes(2)
  })

  it('adds a word (approved at once) with Enter, not an empty word', async () => {
    vi.spyOn(SpellcheckService, 'getAllWords').mockResolvedValue({ data: { datas: [] } })
    const propose = vi.spyOn(SpellcheckService, 'proposeWord').mockResolvedValue({ data: { datas: { word: 'Wireshark', status: 'approved' } } })
    await mountPage()
    expect(wrapper.find('.spellcheck-words').text()).toContain('No word')
    const input = wrapper.find('.spellcheck-words input')
    await input.setValue('   ')
    await input.trigger('keyup', { key: 'Enter' })
    expect(propose).not.toHaveBeenCalled()
    await input.setValue(' Wireshark ')
    await input.trigger('keyup', { key: 'Enter' })
    await flushPromises()
    expect(propose).toHaveBeenCalledWith('Wireshark')
    expect(wrapper.vm.spellcheckNewWord).toBe('')
  })

  it('notifies the errors of the server', async () => {
    const notify = mockNotify()
    vi.spyOn(SpellcheckService, 'getAllWords').mockResolvedValue({ data: { datas: WORDS() } })
    vi.spyOn(SpellcheckService, 'approveWord').mockRejectedValue({ response: { data: { datas: 'Word not found' } } })
    await mountPage()
    await items()[0].find('.spellcheck-approve').trigger('click')
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Word not found', color: 'negative' })
  })
})

describe('settings dependent fields', () => {
  it('disables the danger and reviews options while they are disabled', async () => {
    await mountPage()
    const nbDays = wrapper.findAllComponents(QInput).find((input) => input.props('hint') === wrapper.vm.$t('numberDayBeforeDelete'))
    expect(nbDays.props('disable')).toBe(true)
    const removeApprovals = wrapper.findComponent(QBtnToggle)
    expect(removeApprovals.props('disable')).toBe(true)
    wrapper.vm.settings.danger.enabled = true
    wrapper.vm.settings.reviews.enabled = true
    await flushPromises()
    expect(nbDays.props('disable')).toBe(false)
    expect(removeApprovals.props('disable')).toBe(false)
  })

  it('disables the image border color while the border is disabled', async () => {
    await mountPage()
    const color = () => wrapper.find('input[type="color"]')
    expect(color().attributes('disabled')).toBeDefined()
    wrapper.vm.settings.report.private.imageBorder = true
    await flushPromises()
    expect(color().attributes('disabled')).toBeUndefined()
  })
})

describe('automatic backups', () => {
  const withBackups = (changes = {}) => ({
    ...SETTINGS(),
    backups: { enabled: true, private: { time: '02:00', days: [1, 2, 3, 4, 5], keepDaily: 5, keepWeekly: 2, weeklyDay: 5, ...changes } }
  })
  const card = () => wrapper.find('.backup-settings')

  it('shows the schedule and the rotation, days of the week from Monday', async () => {
    await mountPage({ settings: withBackups() })
    expect(card().exists()).toBe(true)
    expect(card().findAll('.q-checkbox').map((box) => box.text())).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
    expect(card().findAll('.q-checkbox[aria-checked="true"]').map((box) => box.text())).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
    expect(card().text()).toContain(wrapper.vm.$t('backupRotationInfo', [5, 2, 'Friday', 7]))
    expect(card().text()).toContain('BACKUP_PASSWORD')
  })

  it('keeps the days of the server (lists not merged with the default values)', async () => {
    await mountPage({ settings: withBackups({ days: [0, 6] }) })
    expect(wrapper.vm.settings.backups.private.days).toEqual([0, 6])
    expect(wrapper.vm.unsavedChanges()).toBe(false)
  })

  it('saves the schedule with the other settings', async () => {
    mockNotify()
    vi.spyOn(SettingsService, 'updateSettings').mockResolvedValue({ data: { datas: 'Settings updated' } })
    await mountPage({ settings: withBackups() })
    wrapper.vm.settings.backups.private.keepDaily = 3
    wrapper.vm.settings.backups.private.days = [1, 3]
    await flushPromises()
    expect(card().text()).toContain(wrapper.vm.$t('backupRotationInfo', [3, 2, 'Friday', 5]))
    expect(wrapper.vm.unsavedChanges()).toBe(true)
    await buttonByLabel(wrapper.vm.$t('saveSettings')).trigger('click')
    await flushPromises()
    expect(SettingsService.updateSettings.mock.calls[0][0].backups).toEqual(withBackups({ keepDaily: 3, days: [1, 3] }).backups)
  })

  it('disables the schedule while the automatic backups are disabled or for the users not allowed to update', async () => {
    await mountPage({ settings: { ...withBackups(), backups: { ...withBackups().backups, enabled: false } } })
    const inputs = () => card().findAllComponents(QInput)
    expect(inputs().every((input) => input.props('disable'))).toBe(true)
    wrapper.vm.settings.backups.enabled = true
    await flushPromises()
    expect(inputs().every((input) => !input.props('disable'))).toBe(true)
    wrapper.unmount()
    await mountPage({ roles: ['settings:read'], settings: withBackups() })
    expect(card().findComponent(QToggle).props('disable')).toBe(true)
    expect(card().findAllComponents(QInput).every((input) => input.props('disable'))).toBe(true)
  })

  it('is not shown without the settings of the automatic backups (previous server)', async () => {
    await mountPage()
    expect(card().exists()).toBe(false)
  })
})
