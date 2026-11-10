// pages/data/custom: languages and audit types tabs (creation, validation, edition, reordering, removal, errors, permissions)
// Editor stubbed, API services mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { QBtn, QInput, QSelect, QCheckbox, QExpansionItem } from 'quasar'

vi.mock('components/editor', () => import('../../helpers/editor-stub'))
vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import CustomPage from 'pages/data/custom'
import DataService from '@/services/data'
import { api, resetApi } from '../../helpers/api-mock'
import { mockNotify, lastNotification } from '../../helpers/quasar'
import { mountCustomPage, mountPage, ok, apiError, CUSTOM_DATA } from '../../helpers/data-pages'

const LANGUAGES = CUSTOM_DATA.languages
const SECTIONS = [{ field: 'scope', name: 'Périmètre', icon: 'mdi-target' }, { field: 'summary', name: 'Synthèse' }]
const AUDIT_TYPES = [
  { name: 'Pentest', templates: [{ locale: 'en', template: 't-en' }, { locale: 'fr', template: 't-fr' }], sections: ['scope'], hidden: ['network'] },
  { name: 'Audit de code', templates: [{ locale: 'en', template: 't-en' }, { locale: 'fr', template: 't-fr' }], sections: [], hidden: [] }
]

let wrapper

async function mountCustom(tab = 'languages', data = {}, roles = '*') {
  wrapper = await mountCustomPage(CustomPage, { auditTypes: AUDIT_TYPES, sections: SECTIONS, ...data }, { roles, tab })
  return wrapper
}

const t = (key, ...args) => wrapper.vm.$t(key, ...args)
const ref = (name) => wrapper.findComponent({ ref: name })
const buttonByLabel = (label) => wrapper.findAllComponents(QBtn).filter((b) => b.props('label') === label || b.text() === label).at(-1)
const editButton = () => wrapper.findAllComponents(QBtn).find((b) => b.props('icon') === 'fa fa-edit')
const draggable = () => wrapper.findComponent({ name: 'draggable' })

beforeEach(() => {
  resetApi()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('custom data page loading', () => {
  it('loads all the custom data and selects the first language for the vulnerability types and custom fields', async () => {
    await mountCustom()
    for (const method of ['getLanguages', 'getAuditTypes', 'getVulnerabilityTypes', 'getVulnerabilityCategories', 'getSections', 'getCustomFields'])
      expect(DataService[method]).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.templates).toHaveLength(2)
    expect(wrapper.vm.newVulnType.locale).toBe('en')
    expect(wrapper.vm.cfLocale).toBe('en')
    expect(wrapper.vm.selectedTab).toBe('languages')
  })

  it('keeps empty locales without language', async () => {
    await mountCustom('languages', { languages: [] })
    expect(wrapper.vm.newVulnType.locale).toBe('')
    expect(wrapper.vm.cfLocale).toBe('')
  })

  it('does not crash when the data cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const method of ['getLanguages', 'getAuditTypes', 'getVulnerabilityTypes', 'getVulnerabilityCategories', 'getSections', 'getCustomFields'])
      vi.spyOn(DataService, method).mockRejectedValue(apiError(500, 'Internal error'))
    wrapper = await mountPage(CustomPage)
    expect(wrapper.vm.languages).toEqual([])
    expect(wrapper.vm.customFields).toEqual([])
    expect(console.error).toHaveBeenCalled() // Custom fields
  })

  it('shows the six tabs', async () => {
    await mountCustom()
    expect(wrapper.findAll('.q-tab').map((tab) => tab.text())).toEqual([
      t('languages'), t('auditTypes'), t('vulnerabilityTypes'), t('vulnerabilityCategories'), t('customFields'), t('customSections')
    ])
  })
})

describe('languages', () => {
  it('lists the languages (read only)', async () => {
    await mountCustom()
    const readonly = wrapper.findAllComponents(QInput).filter((input) => input.props('readonly'))
    expect(readonly.map((input) => input.props('modelValue'))).toEqual(['English', 'en', 'Français', 'fr'])
  })

  it('hides the list without language', async () => {
    await mountCustom('languages', { languages: [] })
    expect(wrapper.text()).not.toContain(t('listOfLanguages'))
  })

  it.each([
    ['*', true, true],
    [['languages:read'], false, false],
    [['languages:read', 'languages:create'], true, false],
    [['languages:read', 'languages:update'], false, true]
  ])('shows the creation form and the edit button allowed by the roles %j', async (roles, canCreate, canUpdate) => {
    await mountCustom('languages', {}, roles)
    expect(ref('validate-language').exists()).toBe(canCreate)
    expect(!!editButton()).toBe(canUpdate)
  })

  it('requires the language and the locale', async () => {
    vi.spyOn(DataService, 'createLanguage')
    await mountCustom()
    await buttonByLabel('+').trigger('click')
    await flushPromises()
    expect(DataService.createLanguage).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Language is required')
    expect(wrapper.text()).toContain('Locale is required')
    await ref('validate-language').find('input').setValue('Deutsch')
    wrapper.vm.createLanguage()
    await flushPromises()
    expect(DataService.createLanguage).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('Language is required')
  })

  it('creates a language, resets the form and reloads the languages', async () => {
    const notify = mockNotify()
    let sent // Copy of the language when sent (the form is reset after the creation)
    vi.spyOn(DataService, 'createLanguage').mockImplementation((language) => { sent = { ...language }; return ok('created') })
    await mountCustom()
    await ref('validate-language').find('input').setValue('Português (Brasil)')
    await ref('validate-locale').find('input').setValue('pt-BR')
    await ref('validate-locale').find('input').trigger('keyup', { key: 'Enter' })
    await flushPromises()
    expect(DataService.createLanguage).toHaveBeenCalledTimes(1)
    expect(sent).toEqual({ language: 'Português (Brasil)', locale: 'pt-BR' })
    expect(wrapper.vm.newLanguage).toEqual({ locale: '', language: '' })
    expect(DataService.getLanguages).toHaveBeenCalledTimes(2)
    expect(lastNotification(notify)).toMatchObject({ message: 'Language created successfully', color: 'positive' })
  })

  it('sends the language to the API', async () => {
    mockNotify()
    let sent
    api.post.mockImplementation((url, data) => { sent = [url, JSON.stringify(data)]; return ok('created') })
    await mountCustom()
    Object.assign(wrapper.vm.newLanguage, { language: '日本語', locale: 'ja' })
    wrapper.vm.createLanguage()
    await flushPromises()
    expect(sent).toEqual(['data/languages', '{"locale":"ja","language":"日本語"}'])
  })

  it.each([
    [422, 'Language already exists'],
    [422, 'name and locale value must match /^[\\p{Letter}\\p{Mark}0-9 \\[\\]\'()_-]+$/iu'],
    [403, 'Insufficient privileges']
  ])('notifies the error %i "%s" and keeps the form', async (status, message) => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'createLanguage').mockRejectedValue(apiError(status, message))
    await mountCustom()
    Object.assign(wrapper.vm.newLanguage, { language: 'English', locale: 'en' })
    wrapper.vm.createLanguage()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message, color: 'negative' })
    expect(wrapper.vm.newLanguage).toEqual({ language: 'English', locale: 'en' })
    expect(DataService.getLanguages).toHaveBeenCalledTimes(1)
  })

  it('edits a copy of the languages', async () => {
    await mountCustom()
    await editButton().trigger('click')
    expect(wrapper.vm.editLanguage).toBe(true)
    expect(wrapper.vm.editLanguages).toEqual(LANGUAGES)
    const editable = wrapper.findAllComponents(QInput).filter((input) => !input.props('readonly') && input.props('label') === t('language') && input.props('modelValue'))
    await editable[0].find('input').setValue('Anglais')
    expect(wrapper.vm.editLanguages[0].language).toBe('Anglais')
    expect(wrapper.vm.languages[0].language).toBe('English')
  })

  it('removes and reorders the languages before saving them', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'updateLanguages').mockImplementation(() => ok('updated'))
    const languages = [...LANGUAGES, { locale: 'de', language: 'Deutsch' }]
    await mountCustom('languages', { languages })
    await editButton().trigger('click')
    const removeButtons = wrapper.findAllComponents(QBtn).filter((b) => b.props('label') === 'x')
    expect(removeButtons).toHaveLength(3)
    await removeButtons[1].trigger('click') // fr
    expect(wrapper.vm.editLanguages.map((l) => l.locale)).toEqual(['en', 'de'])
    draggable().vm.$emit('update:modelValue', [wrapper.vm.editLanguages[1], wrapper.vm.editLanguages[0]])
    await buttonByLabel(t('btn.save')).trigger('click')
    await flushPromises()
    expect(DataService.updateLanguages).toHaveBeenCalledWith([{ locale: 'de', language: 'Deutsch' }, { locale: 'en', language: 'English' }])
    expect(wrapper.vm.editLanguage).toBe(false)
    expect(DataService.getLanguages).toHaveBeenCalledTimes(2)
    expect(lastNotification(notify)).toMatchObject({ message: 'Languages updated successfully', color: 'positive' })
  })

  it('cancels the edition without saving', async () => {
    vi.spyOn(DataService, 'updateLanguages')
    await mountCustom()
    await editButton().trigger('click')
    wrapper.vm.removeLanguage('en')
    await buttonByLabel(t('btn.cancel')).trigger('click')
    expect(wrapper.vm.editLanguage).toBe(false)
    expect(wrapper.vm.languages).toEqual(LANGUAGES)
    expect(DataService.updateLanguages).not.toHaveBeenCalled()
  })

  it('notifies the error of the update and stays in edition', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'updateLanguages').mockRejectedValue(apiError(422, 'Language already exists'))
    await mountCustom()
    await editButton().trigger('click')
    wrapper.vm.editLanguages[1].locale = 'en'
    wrapper.vm.updateLanguages()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Language already exists', color: 'negative' })
    expect(wrapper.vm.editLanguage).toBe(true)
  })

  it('removes all the occurrences of a locale', async () => {
    await mountCustom()
    wrapper.vm.editLanguages = [{ locale: 'en' }, { locale: 'fr' }, { locale: 'en' }]
    wrapper.vm.removeLanguage('en')
    expect(wrapper.vm.editLanguages).toEqual([{ locale: 'fr' }])
    wrapper.vm.removeLanguage('unknown')
    expect(wrapper.vm.editLanguages).toEqual([{ locale: 'fr' }])
  })
})

describe('audit types', () => {
  // Template selects of the creation form (one per language)
  const templateSelects = () => [].concat(wrapper.vm.$refs['validate-auditType-template'] || [])

  it('asks to create a language first', async () => {
    await mountCustom('audit-types', { languages: [] })
    expect(wrapper.text()).toContain(t('createAtLeastOneLanguage'))
    expect(ref('validate-auditType-name').exists()).toBe(false)
  })

  it('lists the audit types', async () => {
    await mountCustom('audit-types')
    expect(wrapper.findAllComponents(QExpansionItem).map((item) => item.props('label'))).toEqual(['Pentest', 'Audit de code'])
  })

  it('offers the templates for each language', async () => {
    await mountCustom('audit-types')
    expect(wrapper.vm.getTemplateOptionsLanguage('fr')).toEqual([
      { name: 'Default EN', locale: 'fr', template: 't-en' }, { name: 'Modèle FR', locale: 'fr', template: 't-fr' }
    ])
    expect(templateSelects()).toHaveLength(2)
    expect(templateSelects()[1].$props.options.map((o) => o.locale)).toEqual(['fr', 'fr'])
    expect(wrapper.text()).toContain(`Français ${t('template')}`)
  })

  it.each([
    ['*', true, true],
    [['audit-types:read'], false, false],
    [['audit-types:read', 'audit-types:create'], true, false],
    [['audit-types:read', 'audit-types:update'], false, true]
  ])('shows the creation form and the edit button allowed by the roles %j', async (roles, canCreate, canUpdate) => {
    await mountCustom('audit-types', {}, roles)
    expect(ref('validate-auditType-name').exists()).toBe(canCreate)
    expect(!!editButton()).toBe(canUpdate)
  })

  it('requires a name and a template for each language', async () => {
    vi.spyOn(DataService, 'createAuditType')
    await mountCustom('audit-types')
    await buttonByLabel(t('btn.create')).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Name is required')
    expect(wrapper.text()).toContain('Field is required')
    wrapper.vm.newAuditType.name = 'Red Team'
    templateSelects()[0].$emit('update:modelValue', wrapper.vm.getTemplateOptionsLanguage('en')[0])
    wrapper.vm.createAuditType()
    expect(DataService.createAuditType).not.toHaveBeenCalled() // No template for fr
  })

  it('requires the template of the first language when only the second one is selected', async () => {
    vi.spyOn(DataService, 'createAuditType')
    await mountCustom('audit-types')
    wrapper.vm.newAuditType.name = 'Red Team'
    templateSelects()[1].$emit('update:modelValue', wrapper.vm.getTemplateOptionsLanguage('fr')[1])
    wrapper.vm.createAuditType()
    expect(DataService.createAuditType).not.toHaveBeenCalled()
  })

  it('creates an audit type with its templates, sections and hidden built-in sections', async () => {
    const notify = mockNotify()
    let sent // Copy of the audit type when sent (the form is reset after the creation)
    vi.spyOn(DataService, 'createAuditType').mockImplementation((auditType) => { sent = JSON.parse(JSON.stringify(auditType)); return ok('created') })
    await mountCustom('audit-types')
    await ref('validate-auditType-name').find('input').setValue('Test d’intrusion')
    templateSelects()[0].$emit('update:modelValue', wrapper.vm.getTemplateOptionsLanguage('en')[0])
    templateSelects()[1].$emit('update:modelValue', wrapper.vm.getTemplateOptionsLanguage('fr')[1])
    wrapper.findAllComponents(QSelect).find((s) => s.props('label') === t('addSections')).vm.$emit('update:modelValue', ['summary', 'scope'])
    wrapper.findAllComponents(QCheckbox).find((c) => c.props('val') === 'findings' && !c.props('disable')).vm.$emit('update:modelValue', ['findings'])
    await flushPromises()
    await buttonByLabel(t('btn.create')).trigger('click')
    await flushPromises()
    expect(DataService.createAuditType).toHaveBeenCalledTimes(1)
    expect(sent).toEqual({
      name: 'Test d’intrusion',
      templates: [{ name: 'Default EN', locale: 'en', template: 't-en' }, { name: 'Modèle FR', locale: 'fr', template: 't-fr' }],
      sections: ['summary', 'scope'],
      hidden: ['findings']
    })
    expect(wrapper.vm.newAuditType).toEqual({ name: '', templates: [], sections: [], hidden: [] })
    expect(DataService.getAuditTypes).toHaveBeenCalledTimes(2)
    expect(lastNotification(notify)).toMatchObject({ message: 'Audit type created successfully', color: 'positive' })
  })

  it('notifies the error of the creation and keeps the form', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'createAuditType').mockRejectedValue(apiError(422, 'Audit type already exists'))
    await mountCustom('audit-types')
    wrapper.vm.newAuditType.name = 'Pentest'
    wrapper.vm.newAuditType.templates = wrapper.vm.languages.map((l) => wrapper.vm.getTemplateOptionsLanguage(l.locale)[0])
    wrapper.vm.createAuditType()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Audit type already exists', color: 'negative' })
    expect(wrapper.vm.newAuditType.name).toBe('Pentest')
  })

  it('edits a copy of the audit types (templates, sections, hidden sections)', async () => {
    await mountCustom('audit-types')
    await editButton().trigger('click')
    expect(wrapper.vm.editAuditType).toBe(true)
    expect(wrapper.vm.editAuditTypes).toEqual(AUDIT_TYPES)
    wrapper.vm.editAuditTypes[0].hidden.push('findings')
    expect(wrapper.vm.auditTypes[0].hidden).toEqual(['network'])
  })

  it('removes, reorders and saves the audit types', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'updateAuditTypes').mockImplementation(() => ok('updated'))
    const auditTypes = [...AUDIT_TYPES, { name: 'Ancien', templates: [], sections: [], hidden: [] }]
    await mountCustom('audit-types', { auditTypes })
    await editButton().trigger('click')
    await wrapper.findAllComponents(QBtn).filter((b) => b.props('label') === 'x')[0].trigger('click')
    expect(wrapper.vm.editAuditTypes.map((a) => a.name)).toEqual(['Audit de code', 'Ancien'])
    draggable().vm.$emit('update:modelValue', [...wrapper.vm.editAuditTypes].reverse())
    await buttonByLabel(t('btn.save')).trigger('click')
    await flushPromises()
    expect(DataService.updateAuditTypes.mock.calls[0][0].map((a) => a.name)).toEqual(['Ancien', 'Audit de code'])
    expect(wrapper.vm.editAuditType).toBe(false)
    expect(DataService.getAuditTypes).toHaveBeenCalledTimes(2)
    expect(lastNotification(notify)).toMatchObject({ message: 'Audit Types updated successfully', color: 'positive' })
  })

  it('selects the templates of the old audit types without templates', async () => {
    mockNotify()
    vi.spyOn(DataService, 'updateAuditTypes').mockImplementation(() => ok('updated'))
    await mountCustom('audit-types', { auditTypes: [{ name: 'Ancien', templates: [], sections: [], hidden: [] }] })
    await editButton().trigger('click')
    const [select] = [].concat(wrapper.vm.$refs['validate-template-edit2'] || [])
    expect(select).toBeDefined()
    select.$emit('update:modelValue', wrapper.vm.getTemplateOptionsLanguage('en')[0])
    wrapper.vm.updateAuditTypes()
    await flushPromises()
    expect(DataService.updateAuditTypes.mock.calls[0][0][0].templates[0]).toEqual({ name: 'Default EN', locale: 'en', template: 't-en' })
  })

  it('cancels the edition and notifies the errors of the update', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'updateAuditTypes').mockRejectedValue(apiError(422, 'Missing required parameters: name, templates'))
    await mountCustom('audit-types')
    await editButton().trigger('click')
    wrapper.vm.editAuditTypes[0].name = ''
    wrapper.vm.updateAuditTypes()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Missing required parameters: name, templates', color: 'negative' })
    expect(wrapper.vm.editAuditType).toBe(true)
    await buttonByLabel(t('btn.cancel')).trigger('click')
    expect(wrapper.vm.editAuditType).toBe(false)
    expect(wrapper.vm.auditTypes[0].name).toBe('Pentest')
  })

  it('removes the audit type by name', async () => {
    await mountCustom('audit-types')
    wrapper.vm.editAuditTypes = [{ name: 'A' }, { name: 'B' }]
    wrapper.vm.removeAuditType({ name: 'A' })
    expect(wrapper.vm.editAuditTypes).toEqual([{ name: 'B' }])
  })

  it('shows the template of each language whatever the order of the templates', async () => {
    const auditTypes = [{ name: 'Pentest', templates: [{ locale: 'fr', template: 't-fr' }, { locale: 'en', template: 't-en' }], sections: [], hidden: [] }]
    await mountCustom('audit-types', { auditTypes })
    const englishTemplate = wrapper.findAllComponents(QSelect).find((s) => s.props('label') === `English ${t('template')}` && s.props('readonly'))
    expect(englishTemplate.props('modelValue')).toBe('t-en')
  })
})
