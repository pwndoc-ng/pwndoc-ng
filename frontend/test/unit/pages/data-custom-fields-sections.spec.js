// pages/data/custom: custom fields tab (creation form, options per language, preview, default values per language,
// reordering, deletion) and custom sections tab. Editor stubbed, API services mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { QBtn, QInput, QSelect, QOptionGroup, QToggle } from 'quasar'

vi.mock('components/editor', () => import('../../helpers/editor-stub'))
vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import CustomPage from 'pages/data/custom'
import DataService from '@/services/data'
import EditorStub from '../../helpers/editor-stub'
import { api, resetApi } from '../../helpers/api-mock'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'
import { mountCustomPage, ok, apiError } from '../../helpers/data-pages'

const CATEGORIES = [{ name: 'Web' }, { name: 'Réseau' }]
const SECTIONS = [{ field: 'scope', name: 'Périmètre', icon: 'mdi-target' }, { field: 'summary', name: 'Synthèse', icon: '' }]
const field = (_id, label, fieldType, display, displaySub = '', extra = {}) => ({
  _id, label, fieldType, display, displaySub, size: 12, offset: 0, required: false, description: '', text: [], options: [], ...extra
})
const FIELDS = [
  field('g1', 'Client contact', 'input', 'general', '', { size: 6, required: true, description: 'Contact', text: [{ locale: 'en', value: 'John' }, { locale: 'fr', value: 'Jean' }] }),
  field('g2', 'Priorité', 'select', 'general', '', { size: 6, offset: 0, options: [{ locale: 'en', value: 'Low' }, { locale: 'en', value: 'High' }, { locale: 'fr', value: 'Basse' }] }),
  field('f1', 'Impact', 'text', 'finding', '', { text: [{ locale: 'en', value: '<p>Impact</p>' }] }),
  field('v1', 'OWASP', 'checkbox', 'vulnerability', '', { options: [{ locale: 'en', value: 'A01' }, { locale: 'en', value: 'A02' }] }),
  field('w1', 'Web only', 'radio', 'finding', 'Web', { options: [{ locale: 'en', value: 'Yes' }, { locale: 'en', value: 'No' }] }),
  field('s1', 'Date de revue', 'date', 'section', 'Périmètre'),
  field('sp', '', 'space', 'general'),
  field('m1', 'Tags', 'select-multiple', 'general', '', { options: [{ locale: 'en', value: 'pci' }, { locale: 'en', value: 'gdpr' }] })
]

let wrapper

async function mountFields(data = {}, roles = '*') {
  wrapper = await mountCustomPage(CustomPage, { categories: CATEGORIES, sections: SECTIONS, customFields: FIELDS, ...data }, { roles, tab: 'custom-fields' })
  return wrapper
}

const t = (key, ...args) => wrapper.vm.$t(key, ...args)
const ref = (name) => wrapper.findComponent({ ref: name })
const selectByLabel = (label) => wrapper.findAllComponents(QSelect).find((s) => s.props('label') === label)
const inputByLabel = (label) => wrapper.findAllComponents(QInput).find((i) => i.props('label') === label)
const buttonByLabel = (label) => wrapper.findAllComponents(QBtn).find((b) => b.props('label') === label)
const draggable = () => wrapper.findComponent({ name: 'draggable' })
// Labels of the fields displayed in the preview, in the order of the list ('' for the spaces and option groups)
const displayedLabels = () => draggable().findAll('.q-item.relative-position')
  .map((item) => item.find('.q-field__label').exists() ? item.find('.q-field__label').text() : '')

async function setView(display, displaySub = '') {
  Object.assign(wrapper.vm.newCustomField, { display, displaySub })
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

describe('custom fields form', () => {
  it('offers the views and the components', async () => {
    await mountFields()
    expect(selectByLabel(t('selectView')).props('options').map((o) => o.value)).toEqual(['general', 'finding', 'section', 'vulnerability'])
    expect(ref('select-component').props('options').map((o) => o.value)).toEqual(['checkbox', 'date', 'text', 'input', 'radio', 'select', 'select-multiple', 'space'])
    expect(wrapper.vm.newCustomField.display).toBe('general')
  })

  it.each([
    ['general', null],
    ['finding', 'selectCategory'],
    ['vulnerability', 'selectCategory'],
    ['section', 'selectSection']
  ])('offers the sub view of the view %s', async (display, subLabel) => {
    await mountFields()
    await setView(display)
    expect(!!selectByLabel(t('selectCategory'))).toBe(subLabel === 'selectCategory')
    expect(!!selectByLabel(t('selectSection'))).toBe(subLabel === 'selectSection')
    if (subLabel === 'selectCategory') expect(selectByLabel(t('selectCategory')).props('options')).toEqual(CATEGORIES)
    if (subLabel === 'selectSection') {
      expect(selectByLabel(t('selectSection')).props('options')).toEqual(SECTIONS)
      expect(selectByLabel(t('selectSection')).props('optionValue')).toBe('name')
    }
  })

  it('resets the sub view when the view is changed', async () => {
    await mountFields()
    await setView('finding', 'Web')
    selectByLabel(t('selectView')).vm.$emit('update:modelValue', 'section')
    await flushPromises()
    expect(wrapper.vm.newCustomField.display).toBe('section')
    expect(wrapper.vm.newCustomField.displaySub).toBe('')
  })

  it('hides the creation form without the create permission', async () => {
    await mountFields({}, ['custom-fields:read'])
    expect(ref('select-component').exists()).toBe(false)
    expect(buttonByLabel('Add')).toBeUndefined()
    expect(selectByLabel(t('selectView')).exists()).toBe(true)
  })

  it('requires a component and a label', async () => {
    vi.spyOn(DataService, 'createCustomField')
    await mountFields()
    await buttonByLabel('Add').trigger('click')
    await flushPromises()
    expect(DataService.createCustomField).not.toHaveBeenCalled()
    expect(wrapper.text().match(/Field is required/g)).toHaveLength(2)
    ref('select-component').vm.$emit('update:modelValue', 'input')
    await flushPromises()
    wrapper.vm.createCustomField()
    await flushPromises()
    expect(DataService.createCustomField).not.toHaveBeenCalled() // No label
  })

  it('creates a field at the end of the list and resets its label and options', async () => {
    const notify = mockNotify()
    let sent
    vi.spyOn(DataService, 'createCustomField').mockImplementation((customField) => { sent = JSON.parse(JSON.stringify(customField)); return ok('created') })
    await mountFields()
    await setView('finding', 'Web')
    ref('select-component').vm.$emit('update:modelValue', 'select')
    await flushPromises()
    await ref('input-label').find('input').setValue('Exploitabilité')
    await inputByLabel(t('description')).find('input').setValue('Niveau « facile »')
    selectByLabel(t('size')).vm.$emit('update:modelValue', 4)
    selectByLabel(t('offset')).vm.$emit('update:modelValue', 2)
    wrapper.findAllComponents(QToggle).find((toggle) => toggle.props('label') === t('required')).vm.$emit('update:modelValue', true)
    await inputByLabel(t('addOption')).find('input').setValue('Facile')
    await inputByLabel(t('addOption')).find('input').trigger('keyup', { key: 'Enter' })
    selectByLabel(t('optionsLanguage')).vm.$emit('update:modelValue', 'fr')
    await flushPromises()
    await inputByLabel(t('addOption')).find('input').setValue('Difficile')
    await buttonByLabel('+').trigger('click')
    await buttonByLabel('Add').trigger('click')
    await flushPromises()
    expect(sent).toEqual({
      label: 'Exploitabilité', fieldType: 'select', display: 'finding', displaySub: 'Web', size: 4, offset: 2, required: true,
      description: 'Niveau « facile »', text: [], options: [{ locale: 'en', value: 'Facile' }, { locale: 'fr', value: 'Difficile' }],
      position: FIELDS.length
    })
    expect(wrapper.vm.newCustomField).toMatchObject({ label: '', options: [], fieldType: 'select', display: 'finding', displaySub: 'Web' })
    expect(DataService.getCustomFields).toHaveBeenCalledTimes(2)
    expect(lastNotification(notify)).toMatchObject({ message: 'Custom Field created successfully', color: 'positive' })
  })

  it('creates a space without label', async () => {
    mockNotify()
    vi.spyOn(DataService, 'createCustomField').mockImplementation(() => ok('created'))
    await mountFields()
    ref('select-component').vm.$emit('update:modelValue', 'space')
    await flushPromises()
    expect(ref('input-label').exists()).toBe(false)
    expect(wrapper.findAllComponents(QToggle).some((toggle) => toggle.props('label') === t('required'))).toBe(false)
    await buttonByLabel('Add').trigger('click')
    await flushPromises()
    expect(DataService.createCustomField).toHaveBeenCalledWith(expect.objectContaining({ fieldType: 'space', label: '' }))
  })

  it('notifies the error of the creation', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'createCustomField').mockRejectedValue(apiError(422, 'Custom Field already exists'))
    await mountFields()
    ref('select-component').vm.$emit('update:modelValue', 'input')
    await flushPromises()
    await ref('input-label').find('input').setValue('Client contact')
    wrapper.vm.createCustomField()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Custom Field already exists', color: 'negative' })
    expect(wrapper.vm.newCustomField.label).toBe('Client contact')
  })

  it('manages the options of each language', async () => {
    await mountFields()
    ref('select-component').vm.$emit('update:modelValue', 'radio')
    await flushPromises()
    expect(selectByLabel(t('optionsLanguage')).props('modelValue')).toBe('en')
    wrapper.vm.newCustomOption = 'Oui'
    wrapper.vm.addCustomFieldOption(wrapper.vm.newCustomField.options)
    wrapper.vm.cfLocale = 'fr'
    wrapper.vm.newCustomOption = 'Non'
    wrapper.vm.addCustomFieldOption(wrapper.vm.newCustomField.options)
    expect(wrapper.vm.newCustomOption).toBe('')
    await flushPromises()
    expect(wrapper.vm.newCustomFieldLangOptions).toEqual([{ locale: 'fr', value: 'Non' }])
    const removeButtons = wrapper.findAllComponents(QBtn).filter((b) => b.props('label') === 'X')
    expect(removeButtons).toHaveLength(1)
    await removeButtons[0].trigger('click')
    expect(wrapper.vm.newCustomField.options).toEqual([{ locale: 'en', value: 'Oui' }])
  })

  it('removes only the option of the language', async () => {
    await mountFields()
    const options = [{ locale: 'en', value: 'Yes' }, { locale: 'fr', value: 'Yes' }]
    wrapper.vm.removeCustomFieldOption(options, { locale: 'fr', value: 'Yes' })
    expect(options).toEqual([{ locale: 'en', value: 'Yes' }])
  })

  it('does not remove another option when the option is not found', async () => {
    await mountFields()
    const options = [{ locale: 'en', value: 'Yes' }, { locale: 'en', value: 'No' }]
    wrapper.vm.removeCustomFieldOption(options, { locale: 'fr', value: 'Oui' })
    expect(options).toEqual([{ locale: 'en', value: 'Yes' }, { locale: 'en', value: 'No' }])
  })

  it('does not add an empty or duplicated option', async () => {
    await mountFields()
    const options = []
    wrapper.vm.newCustomOption = ''
    wrapper.vm.addCustomFieldOption(options)
    wrapper.vm.newCustomOption = 'Low'
    wrapper.vm.addCustomFieldOption(options)
    wrapper.vm.newCustomOption = 'Low'
    wrapper.vm.addCustomFieldOption(options)
    expect(options).toEqual([{ locale: 'en', value: 'Low' }])
  })
})

describe('custom fields preview', () => {
  it('shows the fields of the general view with the default values of the language', async () => {
    await mountFields()
    expect(selectByLabel(t('languageForDefaultText')).props('modelValue')).toBe('en')
    expect(displayedLabels()).toEqual(['Client contact', 'Priorité', '', 'Tags'])
    const contact = wrapper.findAllComponents(QInput).find((i) => i.props('label') === 'Client contact')
    expect(contact.props('modelValue')).toBe('John')
    expect(selectByLabel('Priorité').props('options').map((o) => o.value)).toEqual(['Low', 'High'])
    expect(selectByLabel('Tags').props('multiple')).toBe(true)
    expect(selectByLabel('Tags').props('modelValue')).toEqual([]) // Default value created for the language
    expect(draggable().find('.col-md-6').exists()).toBe(true) // Size of the field
  })

  it('shows the default values of another language', async () => {
    await mountFields()
    selectByLabel(t('languageForDefaultText')).vm.$emit('update:modelValue', 'fr')
    await flushPromises()
    expect(wrapper.findAllComponents(QInput).find((i) => i.props('label') === 'Client contact').props('modelValue')).toBe('Jean')
    expect(selectByLabel('Priorité').props('options').map((o) => o.value)).toEqual(['Basse'])
    expect(wrapper.vm.customFields.find((f) => f._id === 'g2').text).toContainEqual({ locale: 'fr', value: '' })
  })

  it('edits the default value of the language', async () => {
    await mountFields()
    await wrapper.findAllComponents(QInput).find((i) => i.props('label') === 'Client contact').find('input').setValue('Jane Ünicode')
    expect(wrapper.vm.customFields[0].text).toEqual([{ locale: 'en', value: 'Jane Ünicode' }, { locale: 'fr', value: 'Jean' }])
    selectByLabel('Priorité').vm.$emit('update:modelValue', 'High')
    expect(wrapper.vm.customFields[1].text).toEqual([{ locale: 'en', value: 'High' }])
  })

  it('shows the editor, the checkboxes and the radios with their default values', async () => {
    await mountFields()
    await setView('finding')
    expect(wrapper.findComponent(EditorStub).props('modelValue')).toBe('<p>Impact</p>')
    wrapper.findComponent(EditorStub).vm.$emit('update:modelValue', '<p>Nouveau</p>')
    expect(wrapper.vm.customFields.find((f) => f._id === 'f1').text[0].value).toBe('<p>Nouveau</p>')
    await setView('vulnerability')
    expect(wrapper.findComponent(QOptionGroup).props()).toMatchObject({ type: 'checkbox', modelValue: [] })
    expect(wrapper.findComponent(QOptionGroup).props('options')).toEqual([{ label: 'A01', value: 'A01' }, { label: 'A02', value: 'A02' }])
    await setView('finding', 'Web')
    // Checkboxes of the vulnerabilities (all the categories) then radios of the category Web
    expect(wrapper.findAllComponents(QOptionGroup).map((group) => group.props('type'))).toEqual(['checkbox', 'radio'])
  })

  it('shows the fields of the section view', async () => {
    await mountFields()
    await setView('section', 'Périmètre')
    expect(displayedLabels()).toEqual(['Date de revue'])
    expect(wrapper.findAllComponents(QInput).find((i) => i.props('label') === 'Date de revue').exists()).toBe(true)
  })

  it('does not show the preview without field to display', async () => {
    await mountFields({ customFields: [FIELDS[5]] })
    expect(wrapper.vm.canDisplayCustomFields()).toBe(false)
    expect(draggable().exists()).toBe(false)
  })

  it('decides which fields can be displayed in a view', async () => {
    await mountFields()
    const can = (id) => wrapper.vm.canDisplayCustomField(FIELDS.find((f) => f._id === id))
    await setView('finding', 'Web')
    expect(['f1', 'v1', 'w1', 'g1', 's1'].map(can)).toEqual([true, true, true, false, false])
    await setView('vulnerability', 'Réseau')
    expect(['f1', 'v1', 'w1'].map(can)).toEqual([false, true, false])
  })

  it('shows in the finding view of a category the fields of all the categories and of the vulnerabilities', async () => {
    await mountFields()
    await setView('finding', 'Web')
    expect(displayedLabels()).toHaveLength(3) // Web only (radio), Impact (editor), OWASP (checkboxes)
    expect(wrapper.findComponent(EditorStub).exists()).toBe(true)
  })

  it('gives the index of the default value of the language, created if missing', async () => {
    await mountFields()
    expect(wrapper.vm.getFieldLocaleText(0)).toBe(0)
    wrapper.vm.cfLocale = 'de'
    expect(wrapper.vm.getFieldLocaleText(0)).toBe(2)
    expect(wrapper.vm.customFields[0].text[2]).toEqual({ locale: 'de', value: '' })
    expect(wrapper.vm.getFieldLocaleText(7)).toBe(1) // select-multiple: m1 has text [en: []] created by the preview
    expect(wrapper.vm.customFields[7].text.at(-1)).toEqual({ locale: 'de', value: [] })
  })

  it('reorders the fields and saves their positions', async () => {
    const notify = mockNotify()
    let sent
    vi.spyOn(DataService, 'updateCustomFields').mockImplementation((fields) => { sent = JSON.parse(JSON.stringify(fields)); return ok('updated') })
    await mountFields()
    draggable().vm.$emit('update:modelValue', [...wrapper.vm.customFields].reverse())
    await flushPromises()
    await buttonByLabel(t('btn.save')).trigger('click')
    await flushPromises()
    expect(sent.map((f) => [f._id, f.position])).toEqual([['m1', 0], ['sp', 1], ['s1', 2], ['w1', 3], ['v1', 4], ['f1', 5], ['g2', 6], ['g1', 7]])
    expect(DataService.getCustomFields).toHaveBeenCalledTimes(2)
    expect(lastNotification(notify)).toMatchObject({ message: 'Custom Fields updated successfully', color: 'positive' })
  })

  it('notifies the error of the update', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'updateCustomFields').mockRejectedValue(apiError(422, 'Missing required parameters: label, fieldType'))
    await mountFields()
    wrapper.vm.updateCustomFields()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Missing required parameters: label, fieldType', color: 'negative' })
  })

  it('sends the custom fields to the API', async () => {
    mockNotify()
    await mountFields()
    wrapper.vm.updateCustomFields()
    await flushPromises()
    const [url, fields] = api.put.mock.calls[0]
    expect(url).toBe('data/custom-fields/')
    expect(fields.map((f) => [f._id, f.position])).toEqual(FIELDS.map((f, index) => [f._id, index]))
  })

  it.each([
    ['*', true],
    [['custom-fields:read', 'custom-fields:create'], false]
  ])('shows the edit, delete and save actions allowed by the roles %j', async (roles, canUpdate) => {
    await mountFields({}, roles)
    expect(wrapper.findAllComponents(QBtn).some((b) => b.props('icon') === 'mdi-pencil')).toBe(canUpdate)
    expect(wrapper.findAllComponents(QBtn).some((b) => b.props('icon') === 'mdi-delete')).toBe(canUpdate)
    expect(!!buttonByLabel(t('btn.save'))).toBe(canUpdate)
  })
})

describe('custom field deletion', () => {
  it('deletes the field after confirmation and notifies the number of vulnerabilities changed', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(DataService, 'deleteCustomField').mockImplementation(() => ok({ msg: 'deleted', vulnCount: 12 }))
    await mountFields()
    await wrapper.findAllComponents(QBtn).find((b) => b.props('icon') === 'mdi-delete').trigger('click')
    expect(dialogs[0].options.message).toContain('Custom Field <strong>Client contact</strong> will be permanently deleted')
    expect(DataService.deleteCustomField).not.toHaveBeenCalled()
    dialogs[0].ok()
    await flushPromises()
    expect(DataService.deleteCustomField).toHaveBeenCalledWith('g1')
    expect(DataService.getCustomFields).toHaveBeenCalledTimes(2)
    expect(lastNotification(notify)).toMatchObject({ color: 'positive', html: true })
    expect(lastNotification(notify).message).toContain('<strong>12</strong> Vulnerabilities were affected')
  })

  it('does not delete when cancelled', async () => {
    const dialogs = mockDialog()
    vi.spyOn(DataService, 'deleteCustomField')
    await mountFields()
    wrapper.vm.deleteCustomField(FIELDS[1])
    dialogs[0].cancel()
    expect(DataService.deleteCustomField).not.toHaveBeenCalled()
  })

  it.each([
    [{ msg: 'Custom field not found' }, 'Custom field not found'],
    ['Insufficient privileges', 'Insufficient privileges']
  ])('notifies the error of the deletion %j', async (datas, message) => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(DataService, 'deleteCustomField').mockRejectedValue(apiError(404, datas))
    await mountFields()
    wrapper.vm.deleteCustomField(FIELDS[1])
    dialogs[0].ok()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message, color: 'negative' })
  })

  it('escapes the label of the field in the HTML of the confirmation', async () => {
    const dialogs = mockDialog()
    await mountFields()
    wrapper.vm.deleteCustomField({ _id: 'x', label: '<img src=x onerror=alert(1)>' })
    expect(dialogs[0].options.html).toBe(true)
    expect(dialogs[0].options.message).not.toContain('<img src=x onerror=alert(1)>')
    expect(dialogs[0].options.message).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})

describe('custom sections', () => {
  async function mountSections(data = {}, roles = '*') {
    wrapper = await mountCustomPage(CustomPage, { sections: SECTIONS, ...data }, { roles, tab: 'custom-sections' })
    return wrapper
  }
  const editButton = () => wrapper.findAllComponents(QBtn).find((b) => b.props('icon') === 'fa fa-edit')
  const creationInput = (label) => wrapper.findAllComponents(QInput).find((i) => i.props('label') === label && !i.props('readonly'))

  it('asks to create a language first', async () => {
    await mountSections({ languages: [] })
    expect(wrapper.text()).toContain(t('createAtLeastOneLanguage'))
  })

  it('lists the sections (read only)', async () => {
    await mountSections()
    const values = wrapper.findAllComponents(QInput).filter((i) => i.props('readonly')).map((i) => i.props('modelValue'))
    expect(values).toEqual(['Périmètre', 'scope', 'mdi-target', 'Synthèse', 'summary', ''])
  })

  it.each([
    ['*', true, true],
    [['sections:read'], false, false],
    [['sections:read', 'sections:create'], true, false],
    [['sections:read', 'sections:update'], false, true]
  ])('shows the creation form and the edit button allowed by the roles %j', async (roles, canCreate, canUpdate) => {
    await mountSections({}, roles)
    expect(!!creationInput(t('fieldForTemplate'))).toBe(canCreate)
    expect(!!editButton()).toBe(canUpdate)
  })

  it('requires a name and a field', async () => {
    vi.spyOn(DataService, 'createSection')
    await mountSections()
    await wrapper.findAllComponents(QBtn).find((b) => b.props('label') === '+').trigger('click')
    expect(wrapper.vm.errors).toMatchObject({ sectionName: 'Name required', sectionField: 'Field required' })
    expect(wrapper.text()).toContain('Field required')
    await creationInput(t('name')).find('input').setValue('Annexes')
    wrapper.vm.createSection()
    expect(wrapper.vm.errors).toMatchObject({ sectionName: '', sectionField: 'Field required' })
    expect(DataService.createSection).not.toHaveBeenCalled()
  })

  it('creates a section, resets the form and reloads the sections', async () => {
    const notify = mockNotify()
    let sent
    vi.spyOn(DataService, 'createSection').mockImplementation((section) => { sent = { ...section }; return ok('created') })
    await mountSections()
    await creationInput(t('name')).find('input').setValue('Recommandations générales')
    await creationInput(t('fieldForTemplate')).find('input').setValue('recommandations_generales')
    await creationInput(t('customIcon')).find('input').setValue('mdi-lightbulb')
    await creationInput(t('customIcon')).find('input').trigger('keyup', { key: 'Enter' })
    await flushPromises()
    expect(sent).toEqual({ name: 'Recommandations générales', field: 'recommandations_generales', icon: 'mdi-lightbulb' })
    expect(wrapper.vm.newSection).toEqual({ field: '', name: '', icon: '' })
    expect(DataService.getSections).toHaveBeenCalledTimes(2)
    expect(lastNotification(notify)).toMatchObject({ message: 'Section created successfully', color: 'positive' })
  })

  it('notifies the error of the creation and keeps the form', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'createSection').mockRejectedValue(apiError(422, 'Section field already exists'))
    await mountSections()
    Object.assign(wrapper.vm.newSection, { name: 'Scope', field: 'scope' })
    wrapper.vm.createSection()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Section field already exists', color: 'negative' })
    expect(wrapper.vm.newSection.field).toBe('scope')
  })

  it('edits, removes, reorders and saves the sections', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'updateSections').mockImplementation(() => ok('updated'))
    const sections = [...SECTIONS, { field: 'annex', name: 'Annexes', icon: 'attach_file' }]
    await mountSections({ sections })
    await editButton().trigger('click')
    expect(wrapper.vm.editSection).toBe(true)
    expect(wrapper.vm.editSections).toEqual(sections)
    wrapper.vm.editSections[0].name = 'Périmètre technique'
    expect(wrapper.vm.sections[0].name).toBe('Périmètre') // Copy
    await wrapper.findAllComponents(QBtn).filter((b) => b.props('label') === 'x')[1].trigger('click')
    expect(wrapper.vm.editSections.map((s) => s.field)).toEqual(['scope', 'annex'])
    draggable().vm.$emit('update:modelValue', [...wrapper.vm.editSections].reverse())
    await wrapper.findAllComponents(QBtn).find((b) => b.text() === t('btn.save')).trigger('click')
    await flushPromises()
    expect(DataService.updateSections).toHaveBeenCalledWith([
      { field: 'annex', name: 'Annexes', icon: 'attach_file' },
      { field: 'scope', name: 'Périmètre technique', icon: 'mdi-target' }
    ])
    expect(wrapper.vm.editSection).toBe(false)
    expect(wrapper.vm.sections.map((s) => s.field)).toEqual(['annex', 'scope'])
    expect(DataService.getSections).toHaveBeenCalledTimes(1) // List kept without reload
    expect(lastNotification(notify)).toMatchObject({ message: 'Sections updated successfully', color: 'positive' })
  })

  it('cancels the edition and notifies the errors of the update', async () => {
    const notify = mockNotify()
    vi.spyOn(DataService, 'updateSections').mockRejectedValue(apiError(422, 'Missing required parameters: name, field'))
    await mountSections()
    await editButton().trigger('click')
    wrapper.vm.editSections[0].field = ''
    wrapper.vm.updateSections()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Missing required parameters: name, field', color: 'negative' })
    expect(wrapper.vm.editSection).toBe(true)
    await wrapper.findAllComponents(QBtn).find((b) => b.text() === t('btn.cancel')).trigger('click')
    expect(wrapper.vm.editSection).toBe(false)
    expect(wrapper.vm.sections[0].field).toBe('scope')
  })
})
