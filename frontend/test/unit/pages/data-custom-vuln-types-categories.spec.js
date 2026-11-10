// pages/data/custom: vulnerability types tab (list per language, search, creation, selection, unsaved changes, rename,
// description, reordering, deletion) and vulnerability categories tab (default sort options). Editor stubbed, API mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { QBtn, QInput, QSelect, QItem, QToggle } from 'quasar'

vi.mock('components/editor', () => import('../../helpers/editor-stub'))
vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import CustomPage from 'pages/data/custom'
import DataService from '@/services/data'
import EditorStub from '../../helpers/editor-stub'
import { api, resetApi } from '../../helpers/api-mock'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'
import { mountCustomPage, ok, apiError, CUSTOM_DATA } from '../../helpers/data-pages'

const VULN_TYPES = [
  { name: 'Web', locale: 'en', description: '<p>Web <b>applications</b></p><p>and APIs</p>' },
  { name: 'Network', locale: 'en', description: '' },
  { name: 'Système', locale: 'en' },
  { name: 'Applicatif', locale: 'fr', description: '<p>Applications web</p>' }
]
const CATEGORIES = [
  { name: 'Web', sortValue: 'cvssScore', sortOrder: 'desc', sortAuto: true },
  { name: 'Réseau', sortValue: 'priority', sortOrder: 'asc', sortAuto: false }
]

let wrapper

async function mountTypes(data = {}, roles = '*') {
  wrapper = await mountCustomPage(CustomPage, { vulnTypes: VULN_TYPES, ...data }, { roles, tab: 'vulnerability-types' })
  return wrapper
}

const t = (key, ...args) => wrapper.vm.$t(key, ...args)
const typeItems = () => wrapper.findAllComponents(QItem).filter((item) => item.props('clickable'))
const typeItem = (name) => typeItems().find((item) => item.find('.q-item__label').text() === name)
// Names of the types shown in the list (the types not matching the search are hidden with v-show)
const visibleNames = () => typeItems().filter((item) => item.element.style.display !== 'none').map((item) => item.find('.q-item__label').text())
const nameInput = () => wrapper.findAllComponents(QInput).find((input) => input.props('label') === t('name') && input.props('dense') && !input.find('.q-field__after').exists())
const createInput = () => wrapper.findAllComponents(QInput).find((input) => input.find('.q-field__after').exists())
const searchInput = () => wrapper.findAll('input').find((input) => input.attributes('placeholder') === t('search'))
const languageSelect = () => wrapper.findAllComponents(QSelect).find((select) => select.props('label') === t('language'))
const buttonByLabel = (label) => wrapper.findAllComponents(QBtn).find((b) => b.props('label') === label)
const draggable = () => wrapper.findComponent({ name: 'draggable' })

async function select(name) {
  await typeItem(name).trigger('click')
  await flushPromises()
}

beforeEach(() => {
  resetApi()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('vulnerability types list', () => {
  it('asks to create a language first', async () => {
    await mountTypes({ languages: [] })
    expect(wrapper.text()).toContain(t('createAtLeastOneLanguage'))
    expect(typeItems()).toHaveLength(0)
  })

  it('lists the types of the first language with an excerpt of their description', async () => {
    await mountTypes()
    expect(languageSelect().props('modelValue')).toBe('en')
    expect(visibleNames()).toEqual(['Web', 'Network', 'Système'])
    expect(typeItem('Web').text()).toContain('Web applications and APIs')
    expect(typeItem('Network').findAll('.q-item__label')).toHaveLength(1) // No excerpt for an empty description
    expect(wrapper.text()).toContain(t('selectVulnTypeToEdit'))
  })

  it('shows the types of another language', async () => {
    await mountTypes()
    languageSelect().vm.$emit('update:modelValue', 'fr')
    await flushPromises()
    expect(wrapper.vm.newVulnType.locale).toBe('fr')
    expect(visibleNames()).toEqual(['Applicatif'])
  })

  it('shows a message for a language without type', async () => {
    await mountTypes({ languages: [...CUSTOM_DATA.languages, { locale: 'de', language: 'Deutsch' }] })
    languageSelect().vm.$emit('update:modelValue', 'de')
    await flushPromises()
    expect(typeItems()).toHaveLength(0)
    expect(wrapper.text()).toContain(t('noVulnTypesForLanguage'))
  })

  it('searches in the names and the descriptions (case and accent insensitive)', async () => {
    await mountTypes()
    await searchInput().setValue('SYSTEME')
    expect(visibleNames()).toEqual(['Système'])
    await searchInput().setValue('apis')
    expect(visibleNames()).toEqual(['Web'])
    await searchInput().setValue('<b>')
    expect(visibleNames()).toEqual([]) // HTML tags of the descriptions not searched
    wrapper.vm.vulnTypeSearch = null
    await flushPromises()
    expect(visibleNames()).toEqual(['Web', 'Network', 'Système'])
  })

  it('disables the reordering while searching or without update permission', async () => {
    await mountTypes()
    expect(draggable().vm.$attrs.disabled).toBe(false)
    expect(wrapper.findAll('.handle')).toHaveLength(3)
    await searchInput().setValue('web')
    expect(draggable().vm.$attrs.disabled).toBe(true)
    expect(wrapper.findAll('.handle')).toHaveLength(0)
    wrapper.unmount()
    await mountTypes({}, ['vulnerability-types:read'])
    expect(draggable().vm.$attrs.disabled).toBe(true)
  })

  it('reorders the types of the displayed language (the others kept first)', async () => {
    mockNotify()
    vi.spyOn(DataService, 'updateVulnTypes').mockImplementation(() => ok('updated'))
    await mountTypes()
    const [web, network, systeme] = wrapper.vm.vulnTypesFiltered
    draggable().vm.$emit('update:modelValue', [systeme, web, network])
    await flushPromises()
    expect(DataService.updateVulnTypes).toHaveBeenCalledWith([
      { name: 'Applicatif', locale: 'fr', description: '<p>Applications web</p>' },
      { name: 'Système', locale: 'en', description: '' },
      { name: 'Web', locale: 'en', description: VULN_TYPES[0].description },
      { name: 'Network', locale: 'en', description: '' }
    ])
    expect(DataService.getVulnerabilityTypes).toHaveBeenCalledTimes(2)
  })
})

describe('vulnerability types permissions', () => {
  it('allows everything to the administrators', async () => {
    await mountTypes()
    await select('Web')
    expect(createInput().exists()).toBe(true)
    expect(nameInput().props('readonly')).toBe(false)
    expect(wrapper.findComponent(EditorStub).props('editable')).toBe(true)
    expect(buttonByLabel(t('btn.delete'))).toBeDefined()
    expect(buttonByLabel(t('btn.save'))).toBeDefined()
  })

  it('shows the types read only without permissions', async () => {
    await mountTypes({}, ['vulnerability-types:read'])
    await select('Web')
    expect(createInput()).toBeUndefined()
    expect(nameInput().props('readonly')).toBe(true)
    expect(wrapper.findComponent(EditorStub).props()).toMatchObject({ editable: false, collab: false })
    expect(buttonByLabel(t('btn.delete'))).toBeUndefined()
    expect(buttonByLabel(t('btn.save'))).toBeUndefined()
  })

  it.each([
    [['vulnerability-types:read', 'vulnerability-types:create'], true, false, false],
    [['vulnerability-types:read', 'vulnerability-types:delete'], false, true, false],
    [['vulnerability-types:read', 'vulnerability-types:update'], false, false, true]
  ])('shows the actions allowed by the roles %j', async (roles, canCreate, canDelete, canUpdate) => {
    await mountTypes({}, roles)
    await select('Network')
    expect(!!createInput()).toBe(canCreate)
    expect(!!buttonByLabel(t('btn.delete'))).toBe(canDelete)
    expect(!!buttonByLabel(t('btn.save'))).toBe(canUpdate)
  })
})

describe('vulnerability type creation', () => {
  it('requires a name', async () => {
    vi.spyOn(DataService, 'createVulnerabilityType')
    await mountTypes()
    await createInput().findComponent(QBtn).trigger('click')
    expect(wrapper.vm.errors.vulnType).toBe('Name required')
    expect(wrapper.text()).toContain('Name required')
    expect(DataService.createVulnerabilityType).not.toHaveBeenCalled()
  })

  it('creates a type in the displayed language and selects it to write its description', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'createVulnerabilityType').mockImplementation(() => ok('created'))
    await mountTypes()
    languageSelect().vm.$emit('update:modelValue', 'fr')
    await flushPromises()
    await createInput().find('input').setValue('Élévation de privilèges')
    await createInput().find('input').trigger('keyup', { key: 'Enter' })
    await flushPromises()
    expect(DataService.createVulnerabilityType).toHaveBeenCalledWith({ name: 'Élévation de privilèges', locale: 'fr', description: '' })
    expect(wrapper.vm.newVulnType.name).toBe('')
    expect(wrapper.vm.selectedVulnType).toEqual({ originalName: 'Élévation de privilèges', name: 'Élévation de privilèges', locale: 'fr', description: '' })
    expect(DataService.getVulnerabilityTypes).toHaveBeenCalledTimes(2)
    expect(lastNotification(notify)).toMatchObject({ message: 'Vulnerability type created successfully', color: 'positive' })
  })

  it.each([
    [422, 'Vulnerability type already exists'],
    [422, 'name and locale value must match /^[\\p{Letter}\\p{Mark}0-9 \\[\\]\'()_-]+$/iu']
  ])('notifies the error %i "%s" without adding the type', async (status, message) => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'createVulnerabilityType').mockRejectedValue(apiError(status, message))
    await mountTypes()
    wrapper.vm.newVulnType.name = 'Web'
    wrapper.vm.createVulnerabilityType()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message, color: 'negative' })
    expect(wrapper.vm.vulnTypes).toHaveLength(4)
    expect(wrapper.vm.newVulnType.name).toBe('Web')
    expect(wrapper.vm.selectedVulnType).toBeNull()
  })
})

describe('vulnerability type edition', () => {
  it('selects a copy of the type with its description in the editor', async () => {
    await mountTypes()
    await select('Web')
    expect(wrapper.vm.selectedVulnType).toEqual({ originalName: 'Web', name: 'Web', locale: 'en', description: VULN_TYPES[0].description })
    expect(nameInput().props('modelValue')).toBe('Web')
    expect(wrapper.findComponent(EditorStub).props('modelValue')).toBe(VULN_TYPES[0].description)
    expect(typeItem('Web').props('active')).toBe(true)
    expect(buttonByLabel(t('btn.save')).props('disable')).toBe(true) // No change
  })

  it('remounts the editor only when another type is selected', async () => {
    await mountTypes()
    await select('Web')
    const key = wrapper.vm.selectedVulnTypeKey
    await select('Web')
    expect(wrapper.vm.selectedVulnTypeKey).toBe(key)
    await select('Système')
    expect(wrapper.vm.selectedVulnTypeKey).toBe(key + 1)
    expect(wrapper.vm.selectedVulnType.description).toBe('') // Type without description
  })

  it('detects the unsaved changes of the name and of the description', async () => {
    await mountTypes()
    await select('Network')
    expect(wrapper.vm.vulnTypeUnsavedChanges()).toBe(false)
    await nameInput().find('input').setValue('Réseau')
    expect(wrapper.vm.vulnTypeUnsavedChanges()).toBe(true)
    expect(buttonByLabel(t('btn.save')).props('disable')).toBe(false)
    await nameInput().find('input').setValue('Network')
    expect(wrapper.vm.vulnTypeUnsavedChanges()).toBe(false)
    wrapper.findComponent(EditorStub).vm.$emit('update:modelValue', '<p>Infra</p>')
    expect(wrapper.vm.vulnTypeUnsavedChanges()).toBe(true)
  })

  it('asks before leaving a type with unsaved changes', async () => {
    const dialogs = mockDialog()
    await mountTypes()
    await select('Web')
    wrapper.vm.selectedVulnType.name = 'Web app'
    await select('Network')
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0].options.title).toBe(t('msg.thereAreUnsavedChanges'))
    dialogs[0].cancel()
    expect(wrapper.vm.selectedVulnType.name).toBe('Web app')
    await select('Network')
    dialogs[1].ok()
    expect(wrapper.vm.selectedVulnType.originalName).toBe('Network')
  })

  it('asks before changing the language with unsaved changes', async () => {
    const dialogs = mockDialog()
    await mountTypes()
    await select('Web')
    wrapper.vm.selectedVulnType.description = '<p>changed</p>'
    languageSelect().vm.$emit('update:modelValue', 'fr')
    expect(wrapper.vm.newVulnType.locale).toBe('en')
    dialogs[0].ok()
    expect(wrapper.vm.newVulnType.locale).toBe('fr')
    expect(wrapper.vm.selectedVulnType).toBeNull()
  })

  it('changes the language and clears the search and the selection without changes', async () => {
    const dialogs = mockDialog()
    await mountTypes()
    await select('Web')
    wrapper.vm.vulnTypeSearch = 'we'
    wrapper.vm.changeVulnTypesLocale('fr')
    expect(dialogs).toHaveLength(0)
    expect(wrapper.vm.selectedVulnType).toBeNull()
    expect(wrapper.vm.vulnTypeSearch).toBe('')
  })

  it('saves the renamed type with its description (whole list sent)', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'updateVulnTypes').mockImplementation(() => ok('updated'))
    await mountTypes()
    await select('Web')
    await nameInput().find('input').setValue('Applications Web')
    wrapper.findComponent(EditorStub).vm.$emit('update:modelValue', '<p>Nouvelle description</p>')
    await flushPromises()
    await buttonByLabel(t('btn.save')).trigger('click')
    await flushPromises()
    expect(DataService.updateVulnTypes).toHaveBeenCalledWith([
      { name: 'Applications Web', locale: 'en', description: '<p>Nouvelle description</p>' },
      { name: 'Network', locale: 'en', description: '' },
      { name: 'Système', locale: 'en', description: '' },
      { name: 'Applicatif', locale: 'fr', description: '<p>Applications web</p>' }
    ])
    expect(wrapper.vm.selectedVulnType.originalName).toBe('Applications Web')
    expect(DataService.getVulnerabilityTypes).toHaveBeenCalledTimes(2)
    expect(lastNotification(notify)).toMatchObject({ message: 'Vulnerability Types updated successfully', color: 'positive' })
  })

  it('saves only the type of the selected language when two languages have the same name', async () => {
    mockNotify()
    vi.spyOn(DataService, 'updateVulnTypes').mockImplementation(() => ok('updated'))
    await mountTypes({ vulnTypes: [{ name: 'Web', locale: 'en' }, { name: 'Web', locale: 'fr', description: '<p>fr</p>' }] })
    await select('Web')
    wrapper.vm.selectedVulnType.description = '<p>en</p>'
    wrapper.vm.saveVulnType()
    await flushPromises()
    expect(DataService.updateVulnTypes).toHaveBeenCalledWith([
      { name: 'Web', locale: 'en', description: '<p>en</p>' },
      { name: 'Web', locale: 'fr', description: '<p>fr</p>' }
    ])
  })

  it('requires a name to save the type', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'updateVulnTypes')
    await mountTypes()
    await select('Web')
    wrapper.vm.selectedVulnType.name = ''
    wrapper.vm.saveVulnType()
    expect(lastNotification(notify)).toMatchObject({ message: 'Name required', color: 'negative' })
    expect(DataService.updateVulnTypes).not.toHaveBeenCalled()
  })

  it('notifies the error of the save and reloads the types', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'updateVulnTypes').mockRejectedValue(apiError(500, 'E11000 duplicate key error'))
    await mountTypes()
    await select('Web')
    wrapper.vm.selectedVulnType.name = 'Network'
    wrapper.vm.saveVulnType()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'E11000 duplicate key error', color: 'negative' })
    expect(DataService.getVulnerabilityTypes).toHaveBeenCalledTimes(2)
    expect(wrapper.vm.selectedVulnType.originalName).toBe('Web')
    expect(wrapper.vm.vulnTypeUnsavedChanges()).toBe(true) // Changes kept after the reload
  })
})

describe('vulnerability type deletion', () => {
  it('deletes the selected type of its language after confirmation', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(DataService, 'deleteVulnerabilityType').mockImplementation(() => ok('deleted'))
    await mountTypes()
    await select('Système')
    await buttonByLabel(t('btn.delete')).trigger('click')
    expect(dialogs[0].options.message).toBe('Système will be permanently deleted')
    expect(DataService.deleteVulnerabilityType).not.toHaveBeenCalled()
    dialogs[0].ok()
    await flushPromises()
    expect(DataService.deleteVulnerabilityType).toHaveBeenCalledWith('Système', 'en')
    expect(wrapper.vm.selectedVulnType).toBeNull()
    expect(DataService.getVulnerabilityTypes).toHaveBeenCalledTimes(2)
    expect(lastNotification(notify)).toMatchObject({ message: 'Vulnerability type deleted successfully', color: 'positive' })
  })

  it('deletes the original name of a renamed type', async () => {
    const dialogs = mockDialog()
    mockNotify()
    await mountTypes()
    await select('Système')
    wrapper.vm.selectedVulnType.name = 'Renamed'
    wrapper.vm.deleteVulnType()
    dialogs[0].ok()
    await flushPromises()
    expect(api.delete).toHaveBeenCalledWith(`data/vulnerability-types/${encodeURIComponent('Système')}`, { params: { locale: 'en' } })
  })

  it('does not delete when cancelled and notifies the errors', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(DataService, 'deleteVulnerabilityType').mockRejectedValue(apiError(404, 'Vulnerability type not found'))
    await mountTypes()
    await select('Web')
    wrapper.vm.deleteVulnType()
    dialogs[0].cancel()
    expect(DataService.deleteVulnerabilityType).not.toHaveBeenCalled()
    wrapper.vm.deleteVulnType()
    dialogs[1].ok()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Vulnerability type not found', color: 'negative' })
    expect(wrapper.vm.selectedVulnType.originalName).toBe('Web')
  })
})

describe('vulnerability categories', () => {
  const CUSTOM_FIELDS = [
    { _id: 'f1', label: 'Impact', fieldType: 'select', display: 'finding', displaySub: '' },
    { _id: 'f2', label: 'OWASP', fieldType: 'input', display: 'vulnerability', displaySub: 'Web' },
    { _id: 'f3', label: 'Date de test', fieldType: 'date', display: 'finding', displaySub: 'Réseau' },
    { _id: 'f4', label: 'Général', fieldType: 'input', display: 'general', displaySub: '' },
    { _id: 'f5', label: 'Texte', fieldType: 'text', display: 'finding', displaySub: '' },
    { _id: 'f6', label: 'Cases', fieldType: 'checkbox', display: 'vulnerability', displaySub: '' },
    { _id: 'f7', label: 'Choix', fieldType: 'radio', display: 'vulnerability' }
  ]

  async function mountCategories(data = {}, roles = '*') {
    wrapper = await mountCustomPage(CustomPage, { categories: CATEGORIES, customFields: CUSTOM_FIELDS, ...data }, { roles, tab: 'vulnerability-categories' })
    return wrapper
  }
  const editButton = () => wrapper.findAllComponents(QBtn).find((b) => b.props('icon') === 'fa fa-edit')
  const categoryInput = () => wrapper.findAllComponents(QInput).find((input) => !input.props('readonly') && input.props('label') === t('name'))

  it('lists the categories with their default sort options (read only)', async () => {
    await mountCategories()
    const names = wrapper.findAllComponents(QInput).filter((input) => input.props('readonly')).map((input) => input.props('modelValue'))
    expect(names).toEqual(['Web', 'Réseau'])
    expect(wrapper.findAllComponents(QToggle).filter((toggle) => toggle.props('disable')).map((toggle) => toggle.props('modelValue'))).toEqual([true, false])
  })

  it.each([
    ['*', true, true],
    [['vulnerability-categories:read'], false, false],
    [['vulnerability-categories:create'], true, false],
    [['vulnerability-categories:update'], false, true]
  ])('shows the creation form and the edit button allowed by the roles %j', async (roles, canCreate, canUpdate) => {
    await mountCategories({}, roles)
    expect(!!categoryInput()).toBe(canCreate)
    expect(!!editButton()).toBe(canUpdate)
  })

  it('requires a name', async () => {
    vi.spyOn(DataService, 'createVulnerabilityCategory')
    await mountCategories()
    await wrapper.findAllComponents(QBtn).find((b) => b.props('label') === t('btn.create')).trigger('click')
    expect(wrapper.vm.errors.vulnCat).toBe('Name required')
    expect(DataService.createVulnerabilityCategory).not.toHaveBeenCalled()
  })

  it('creates a category with its default sort options and resets the form', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'createVulnerabilityCategory').mockImplementation(() => ok('created'))
    await mountCategories()
    await categoryInput().find('input').setValue('Configuration & durcissement')
    wrapper.findAllComponents(QSelect).find((s) => s.props('label') === t('sortBy') && !s.props('readonly')).vm.$emit('update:modelValue', 'cvssEnvironmentalScore')
    wrapper.findAllComponents(QSelect).find((s) => s.props('label') === t('sortOrder') && !s.props('readonly')).vm.$emit('update:modelValue', 'asc')
    wrapper.findAllComponents(QToggle).find((toggle) => !toggle.props('disable')).vm.$emit('update:modelValue', false)
    await categoryInput().find('input').trigger('keyup', { key: 'Enter' })
    await flushPromises()
    expect(DataService.createVulnerabilityCategory).toHaveBeenCalledWith({ name: 'Configuration & durcissement', sortValue: 'cvssEnvironmentalScore', sortOrder: 'asc', sortAuto: false })
    expect(wrapper.vm.newVulnCat).toEqual({ name: '', sortValue: 'cvssScore', sortOrder: 'desc', sortAuto: true })
    expect(DataService.getVulnerabilityCategories).toHaveBeenCalledTimes(2)
    expect(lastNotification(notify)).toMatchObject({ message: 'Vulnerability category created successfully', color: 'positive' })
  })

  it('notifies the error of the creation', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'createVulnerabilityCategory').mockRejectedValue(apiError(422, 'Vulnerability category already exists'))
    await mountCategories()
    wrapper.vm.newVulnCat.name = 'Web'
    wrapper.vm.createVulnerabilityCategory()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Vulnerability category already exists', color: 'negative' })
    expect(wrapper.vm.newVulnCat.name).toBe('Web')
  })

  it('offers the custom fields of the category as sort options', async () => {
    await mountCategories()
    const values = (category) => wrapper.vm.getSortOptions(category).map((o) => o.value)
    const builtIn = ['cvssScore', 'cvssTemporalScore', 'cvssEnvironmentalScore', 'priority', 'remediationComplexity']
    expect(values('Web')).toEqual([...builtIn, 'Impact', 'OWASP', 'Choix'])
    expect(values('Réseau')).toEqual([...builtIn, 'Impact', 'Date de test', 'Choix'])
    expect(values('Autre')).toEqual([...builtIn, 'Impact', 'Choix'])
  })

  it('edits a copy of the categories and saves them reordered', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'updateVulnerabilityCategories').mockImplementation(() => ok('updated'))
    await mountCategories()
    await editButton().trigger('click')
    expect(wrapper.vm.editCategory).toBe(true)
    const sortBy = draggable().findAllComponents(QSelect).filter((s) => s.props('label') === t('sortBy'))
    expect(sortBy[0].props('options').map((o) => o.value)).toContain('OWASP')
    expect(sortBy[1].props('options').map((o) => o.value)).toContain('Date de test')
    sortBy[0].vm.$emit('update:modelValue', 'OWASP')
    expect(wrapper.vm.vulnCategories[0].sortValue).toBe('cvssScore') // Copy
    draggable().vm.$emit('update:modelValue', [...wrapper.vm.editCategories].reverse())
    await wrapper.findAllComponents(QBtn).find((b) => b.text() === t('btn.save')).trigger('click')
    await flushPromises()
    expect(DataService.updateVulnerabilityCategories).toHaveBeenCalledWith([
      { name: 'Réseau', sortValue: 'priority', sortOrder: 'asc', sortAuto: false },
      { name: 'Web', sortValue: 'OWASP', sortOrder: 'desc', sortAuto: true }
    ])
    expect(wrapper.vm.editCategory).toBe(false)
    expect(lastNotification(notify)).toMatchObject({ message: 'Vulnerability Categories updated successfully', color: 'positive' })
  })

  it('removes a category, cancels and notifies the errors of the update', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'updateVulnerabilityCategories').mockRejectedValue(apiError(422, 'Missing required parameters: name'))
    await mountCategories()
    await editButton().trigger('click')
    await wrapper.findAllComponents(QBtn).filter((b) => b.props('label') === 'x')[0].trigger('click')
    expect(wrapper.vm.editCategories.map((c) => c.name)).toEqual(['Réseau'])
    wrapper.vm.updateVulnCategories()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Missing required parameters: name', color: 'negative' })
    expect(wrapper.vm.editCategory).toBe(true)
    await wrapper.findAllComponents(QBtn).find((b) => b.text() === t('btn.cancel')).trigger('click')
    expect(wrapper.vm.editCategory).toBe(false)
    expect(wrapper.vm.vulnCategories).toHaveLength(2)
  })
})
