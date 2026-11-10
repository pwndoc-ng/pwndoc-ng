// Hurried user on the custom data page (languages, audit types, vulnerability types and categories, custom fields,
// sections): navigation while a request is pending, answers in disorder, double submissions, input before the end of
// a loading, items selected quickly. The answers of the API are delayed and given by the test (controlled promises).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { QItem } from 'quasar'

vi.mock('components/editor', () => import('../../helpers/editor-stub'))
vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import CustomPage from 'pages/data/custom'
import DataService from '@/services/data'
import { resetApi } from '../../helpers/api-mock'
import { mockDialog, mockNotify } from '../../helpers/quasar'
import { mountCustomPage, ok, controlled, trackUnhandledRejections, settle, CUSTOM_DATA } from '../../helpers/data-pages'

const LANGUAGES = CUSTOM_DATA.languages
const VULN_TYPES = [
  { name: 'Web', locale: 'en', description: '<p>Web</p>' },
  { name: 'Network', locale: 'en', description: '' },
  { name: 'Applicatif', locale: 'fr', description: '<p>Applications</p>' }
]
const AUDIT_TYPES = [{ name: 'Pentest', templates: [{ locale: 'en', template: 't-en' }, { locale: 'fr', template: 't-fr' }], sections: [], hidden: [] }]
const CATEGORIES = [{ name: 'Web', sortValue: 'cvssScore', sortOrder: 'desc', sortAuto: true }]
const SECTIONS = [{ field: 'scope', name: 'Périmètre', icon: '' }]
const FIELDS = [
  { _id: 'f1', label: 'Contact', fieldType: 'input', display: 'general', displaySub: '', size: 12, offset: 0, required: false, description: '', text: [], options: [], position: 0 },
  { _id: 'f2', label: 'Note', fieldType: 'input', display: 'general', displaySub: '', size: 12, offset: 0, required: false, description: '', text: [], options: [], position: 1 }
]
const DATA = { vulnTypes: VULN_TYPES, auditTypes: AUDIT_TYPES, categories: CATEGORIES, sections: SECTIONS, customFields: FIELDS }

let wrapper
let notify
let errors

async function mountCustom(tab = 'languages', data = {}) {
  wrapper = await mountCustomPage(CustomPage, { ...DATA, ...data }, { tab })
  return wrapper.vm
}

function unmount() {
  wrapper.unmount()
  wrapper = null
}

const typeItem = (name) => wrapper.findAllComponents(QItem).filter((item) => item.props('clickable')).find((item) => item.find('.q-item__label').text() === name)
const typeNames = () => wrapper.vm.vulnTypesFiltered.map((type) => type.name)

beforeEach(() => {
  resetApi()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  notify = mockNotify()
  errors = trackUnhandledRejections()
})
afterEach(() => {
  errors.stop()
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('navigation while a request is pending', () => {
  it('the data answered after leaving the page changes nothing and throws nothing', async () => {
    const languages = controlled(DataService, 'getLanguages')
    const vulnTypes = controlled(DataService, 'getVulnerabilityTypes')
    const fields = controlled(DataService, 'getCustomFields')
    await mountCustom()
    unmount()
    await languages[0].resolve(LANGUAGES)
    await vulnTypes[0].reject(500, 'Internal error')
    await fields[0].resolve(FIELDS)
    await settle()
    expect(errors).toEqual([])
    expect(notify).not.toHaveBeenCalled()
  })

  it.each([
    ['languages', 'createLanguage', 'createLanguage', (vm) => Object.assign(vm.newLanguage, { language: 'Deutsch', locale: 'de' })],
    ['audit-types', 'createAuditType', 'createAuditType', (vm) => Object.assign(vm.newAuditType, { name: 'Red Team', templates: vm.languages.map((l) => vm.getTemplateOptionsLanguage(l.locale)[0]) })],
    ['vulnerability-types', 'createVulnerabilityType', 'createVulnerabilityType', (vm) => { vm.newVulnType.name = 'Cloud' }],
    ['vulnerability-categories', 'createVulnerabilityCategory', 'createVulnerabilityCategory', (vm) => { vm.newVulnCat.name = 'Cloud' }],
    ['custom-sections', 'createSection', 'createSection', (vm) => Object.assign(vm.newSection, { name: 'Annexes', field: 'annex' })]
  ])('%s: a creation answered after leaving the page throws nothing', async (tab, service, method, fill) => {
    const vm = await mountCustom(tab)
    const requests = controlled(DataService, service)
    fill(vm)
    await flushPromises()
    vm[method]()
    expect(requests).toHaveLength(1)
    unmount()
    await requests[0].resolve('created')
    await settle()
    expect(errors).toEqual([])
    expect(notify.mock.calls.at(-1)[0].color).toBe('positive')
  })

  it('a deletion of a vulnerability type answered after leaving the page throws nothing', async () => {
    const dialogs = mockDialog()
    const vm = await mountCustom('vulnerability-types')
    const deletions = controlled(DataService, 'deleteVulnerabilityType')
    await typeItem('Web').trigger('click')
    vm.deleteVulnType()
    dialogs[0].ok()
    unmount()
    await deletions[0].resolve('deleted')
    await settle()
    expect(errors).toEqual([])
  })

  it('a save of the sections refused after leaving the page is notified without exception', async () => {
    const vm = await mountCustom('custom-sections')
    const requests = controlled(DataService, 'updateSections')
    vm.editSection = true
    vm.editSections = [...SECTIONS]
    vm.updateSections()
    unmount()
    await requests[0].reject(422, 'Missing required parameters')
    await settle()
    expect(errors).toEqual([])
    expect(notify.mock.calls.at(-1)[0].color).toBe('negative')
  })
})

describe('answers in disorder', () => {
  it('shows the types of the language chosen while the types were loading', async () => {
    const vulnTypes = controlled(DataService, 'getVulnerabilityTypes')
    const vm = await mountCustom('vulnerability-types')
    vm.changeVulnTypesLocale('fr')
    await vulnTypes[0].resolve(VULN_TYPES)
    expect(vm.newVulnType.locale).toBe('fr')
    expect(typeNames()).toEqual(['Applicatif'])
    expect(typeItem('Applicatif')).toBeDefined()
  })

  it('shows the custom fields loaded after the tab was opened', async () => {
    const fields = controlled(DataService, 'getCustomFields')
    const vm = await mountCustom('languages')
    vm.selectedTab = 'custom-fields'
    await flushPromises()
    expect(vm.canDisplayCustomFields()).toBe(false)
    await fields[0].resolve(FIELDS)
    expect(vm.canDisplayCustomFields()).toBe(true)
    expect(wrapper.findComponent({ name: 'draggable' }).exists()).toBe(true)
  })

  it('shows at once the last order of the vulnerability types reordered quickly', async () => {
    const vm = await mountCustom('vulnerability-types')
    const saves = controlled(DataService, 'updateVulnTypes')
    const [web, network] = vm.vulnTypesFiltered
    vm.reorderVulnTypes([network, web])
    vm.reorderVulnTypes([web, network])
    expect(saves).toHaveLength(2)
    expect(saves[1].args[0].map((type) => type.name)).toEqual(['Applicatif', 'Web', 'Network'])
    expect(typeNames()).toEqual(['Web', 'Network'])
  })

  it('keeps the last order of the vulnerability types when the reloads are answered in disorder', async () => {
    const reloads = controlled(DataService, 'getVulnerabilityTypes')
    const vm = await mountCustom('vulnerability-types')
    await reloads[0].resolve(VULN_TYPES)
    const saves = controlled(DataService, 'updateVulnTypes')
    const [web, network] = vm.vulnTypesFiltered
    vm.reorderVulnTypes([network, web])
    vm.reorderVulnTypes([web, network])
    await saves[0].resolve('ok') // Reload 1 requested
    await saves[1].resolve('ok') // Reload 2 requested
    await reloads[2].resolve(saves[1].args[0]) // Last order
    await reloads[1].resolve(saves[0].args[0]) // Stale answer of the first reload
    expect(typeNames()).toEqual(['Web', 'Network'])
  })

  it('keeps the language chosen for the vulnerability types when a language is created', async () => {
    const vm = await mountCustom('vulnerability-types')
    vm.changeVulnTypesLocale('fr')
    vm.cfLocale = 'fr'
    await flushPromises()
    await typeItem('Applicatif').trigger('click')
    vi.spyOn(DataService, 'createLanguage').mockImplementation(() => ok('created'))
    DataService.getLanguages.mockImplementation(() => ok([...LANGUAGES, { locale: 'de', language: 'Deutsch' }]))
    Object.assign(vm.newLanguage, { language: 'Deutsch', locale: 'de' })
    vm.selectedTab = 'languages'
    await flushPromises()
    vm.createLanguage()
    await flushPromises()
    expect(vm.newVulnType.locale).toBe('fr')
    expect(vm.cfLocale).toBe('fr')
  })
})

describe('double submission', () => {
  const CREATIONS = [
    ['language', 'languages', 'createLanguage', 'createLanguage', (vm) => Object.assign(vm.newLanguage, { language: 'Deutsch', locale: 'de' })],
    ['audit type', 'audit-types', 'createAuditType', 'createAuditType', (vm) => Object.assign(vm.newAuditType, { name: 'Red Team', templates: vm.languages.map((l) => vm.getTemplateOptionsLanguage(l.locale)[0]) })],
    ['vulnerability type', 'vulnerability-types', 'createVulnerabilityType', 'createVulnerabilityType', (vm) => { vm.newVulnType.name = 'Cloud' }],
    ['vulnerability category', 'vulnerability-categories', 'createVulnerabilityCategory', 'createVulnerabilityCategory', (vm) => { vm.newVulnCat.name = 'Cloud' }],
    ['custom field', 'custom-fields', 'createCustomField', 'createCustomField', (vm) => Object.assign(vm.newCustomField, { fieldType: 'input', label: 'Owner' })],
    ['section', 'custom-sections', 'createSection', 'createSection', (vm) => Object.assign(vm.newSection, { name: 'Annexes', field: 'annex' })]
  ]

  it.each(CREATIONS)('a double click on the creation of a %s sends one request', async (label, tab, service, method, fill) => {
    const vm = await mountCustom(tab)
    const requests = controlled(DataService, service)
    fill(vm)
    await flushPromises()
    vm[method]()
    vm[method]()
    expect(requests).toHaveLength(1)
  })

  it.each(CREATIONS)('after a double click on the creation of a %s, one success is notified, no exception', async (label, tab, service, method, fill) => {
    const vm = await mountCustom(tab)
    const requests = controlled(DataService, service)
    fill(vm)
    await flushPromises()
    vm[method]()
    vm[method]()
    await requests[0].resolve('created')
    await settle()
    expect(requests).toHaveLength(1)
    expect(errors).toEqual([])
    expect(notify.mock.calls.map(([options]) => options.color)).toEqual(['positive'])
  })

  it('a creation can be done again once the previous one answered (refused)', async () => {
    const vm = await mountCustom('vulnerability-categories')
    const requests = controlled(DataService, 'createVulnerabilityCategory')
    vm.newVulnCat.name = 'Web'
    vm.createVulnerabilityCategory()
    await requests[0].reject(422, 'Vulnerability category already exists')
    vm.newVulnCat.name = 'Cloud'
    vm.createVulnerabilityCategory()
    expect(requests).toHaveLength(2)
    expect(requests[1].args[0].name).toBe('Cloud')
  })

  it('a vulnerability type created twice quickly is displayed once', async () => {
    const vm = await mountCustom('vulnerability-types')
    const requests = controlled(DataService, 'createVulnerabilityType')
    DataService.getVulnerabilityTypes.mockImplementation(() => ok([...VULN_TYPES, { name: 'Cloud', locale: 'en', description: '' }]))
    vm.newVulnType.name = 'Cloud'
    vm.createVulnerabilityType()
    vm.createVulnerabilityType()
    await requests[0].resolve('created')
    expect(requests).toHaveLength(1)
    expect(typeNames().filter((name) => name === 'Cloud')).toHaveLength(1)
    expect(vm.selectedVulnType.originalName).toBe('Cloud')
  })

  it('a double save of the languages leaves the edition once with the same list sent twice', async () => {
    const vm = await mountCustom('languages')
    const saves = controlled(DataService, 'updateLanguages')
    vm.editLanguage = true
    vm.editLanguages = [...LANGUAGES].reverse()
    vm.updateLanguages()
    vm.updateLanguages()
    expect(saves[1].args).toEqual(saves[0].args)
    await saves[0].resolve('ok')
    await saves[1].resolve('ok')
    expect(vm.editLanguage).toBe(false)
    expect(errors).toEqual([])
  })
})

describe('input before the end of a loading', () => {
  it('keeps the language typed while the languages are loading', async () => {
    const languages = controlled(DataService, 'getLanguages')
    const vm = await mountCustom('languages')
    Object.assign(vm.newLanguage, { language: 'Español', locale: 'es' })
    await languages[0].resolve(LANGUAGES)
    expect(vm.newLanguage).toEqual({ language: 'Español', locale: 'es' })
    expect(vm.newVulnType.locale).toBe('en')
  })

  it('keeps the description being written when the vulnerability types are reloaded', async () => {
    const vm = await mountCustom('vulnerability-types')
    await typeItem('Web').trigger('click')
    const reloads = controlled(DataService, 'getVulnerabilityTypes')
    vm.getVulnerabilityTypes()
    vm.selectedVulnType.description = '<p>Rédaction en cours</p>'
    await reloads[0].resolve(VULN_TYPES)
    expect(vm.selectedVulnType.description).toBe('<p>Rédaction en cours</p>')
    expect(vm.vulnTypeUnsavedChanges()).toBe(true)
  })

  it('creates the field at the end of the list when it is created during the loading of the fields', async () => {
    const fields = controlled(DataService, 'getCustomFields')
    const vm = await mountCustom('custom-fields')
    const creations = controlled(DataService, 'createCustomField')
    Object.assign(vm.newCustomField, { fieldType: 'input', label: 'Owner' })
    await flushPromises()
    vm.createCustomField()
    await fields[0].resolve(FIELDS)
    expect(creations[0].args[0].position).toBe(FIELDS.length)
  })

  it('creates the field at the end of the loaded list', async () => {
    const vm = await mountCustom('custom-fields')
    const creations = controlled(DataService, 'createCustomField')
    Object.assign(vm.newCustomField, { fieldType: 'input', label: 'Owner' })
    await flushPromises()
    vm.createCustomField()
    expect(creations[0].args[0].position).toBe(FIELDS.length)
  })

  it('attaches the options added during the loading of the languages to a language', async () => {
    const languages = controlled(DataService, 'getLanguages')
    const vm = await mountCustom('custom-fields')
    vm.newCustomField.fieldType = 'select'
    vm.newCustomOption = 'Haute'
    vm.addCustomFieldOption(vm.newCustomField.options)
    await languages[0].resolve(LANGUAGES)
    expect(vm.newCustomFieldLangOptions).toEqual([{ locale: 'en', value: 'Haute' }])
  })

  it.each([
    ['languages', 'getLanguages', 'createLanguage', 'updateLanguages', 'updateLanguages', (vm) => Object.assign(vm.newLanguage, { language: 'Deutsch', locale: 'de' }), { locale: 'de', language: 'Deutsch' }, 'locale', LANGUAGES],
    ['audit-types', 'getAuditTypes', 'createAuditType', 'updateAuditTypes', 'updateAuditTypes', (vm) => Object.assign(vm.newAuditType, { name: 'Red Team', templates: vm.languages.map((l) => vm.getTemplateOptionsLanguage(l.locale)[0]) }), { name: 'Red Team', templates: [], sections: [], hidden: [] }, 'name', AUDIT_TYPES],
    ['vulnerability-categories', 'getVulnerabilityCategories', 'createVulnerabilityCategory', 'updateVulnerabilityCategories', 'updateVulnCategories', (vm) => { vm.newVulnCat.name = 'Cloud' }, { name: 'Cloud', sortValue: 'cvssScore', sortOrder: 'desc', sortAuto: true }, 'name', CATEGORIES],
    ['custom-sections', 'getSections', 'createSection', 'updateSections', 'updateSections', (vm) => Object.assign(vm.newSection, { name: 'Annexes', field: 'annex' }), { name: 'Annexes', field: 'annex', icon: '' }, 'field', SECTIONS]
  ])('%s: an item created during the edition is not deleted by the save of the edition', async (tab, getter, create, update, updateMethod, fill, created, key, initial) => {
    const vm = await mountCustom(tab)
    await wrapper.findAllComponents({ name: 'QBtn' }).find((button) => button.props('icon') === 'fa fa-edit').trigger('click')
    vi.spyOn(DataService, create).mockImplementation(() => ok('created'))
    DataService[getter].mockImplementation(() => ok([...initial, created]))
    fill(vm)
    await flushPromises()
    vm[create]() // Methods of the page named as the services
    await flushPromises()
    const saves = controlled(DataService, update)
    vm[updateMethod]()
    expect(saves[0].args[0].map((item) => item[key])).toContain(created[key])
  })
})

describe('items selected quickly', () => {
  it('selects the last vulnerability type clicked', async () => {
    const vm = await mountCustom('vulnerability-types')
    await typeItem('Web').trigger('click')
    await typeItem('Network').trigger('click')
    await typeItem('Web').trigger('click')
    expect(vm.selectedVulnType.originalName).toBe('Web')
    expect(vm.selectedVulnTypeKey).toBe(3)
  })

  it('saves the type selected last', async () => {
    const vm = await mountCustom('vulnerability-types')
    const saves = controlled(DataService, 'updateVulnTypes')
    await typeItem('Web').trigger('click')
    await typeItem('Network').trigger('click')
    vm.selectedVulnType.description = '<p>Réseau</p>'
    vm.saveVulnType()
    expect(saves[0].args[0]).toContainEqual({ name: 'Network', locale: 'en', description: '<p>Réseau</p>' })
    expect(saves[0].args[0]).toContainEqual({ name: 'Web', locale: 'en', description: '<p>Web</p>' })
  })

  it('switches between the tabs quickly without losing the edition in progress', async () => {
    const vm = await mountCustom('languages')
    await wrapper.findAllComponents({ name: 'QBtn' }).find((button) => button.props('icon') === 'fa fa-edit').trigger('click')
    vm.editLanguages[0].language = 'Anglais'
    for (const tab of ['audit-types', 'vulnerability-types', 'custom-fields', 'languages']) vm.selectedTab = tab
    await flushPromises()
    expect(vm.editLanguage).toBe(true)
    expect(vm.editLanguages[0].language).toBe('Anglais')
  })
})
