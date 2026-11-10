// pages/data/templates: report templates table (filters, permissions), upload (creation / update), download, deletion
// Dialogs and uploaders replaced by stubs, API services mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { QInput, QBtn } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import TemplatesPage from 'pages/data/templates'
import TemplateService from '@/services/template'
import { api, resetApi } from '../../helpers/api-mock'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'
import { mountPage, ok, apiError, tableRows, dialog, UploaderStub, waitFileReader } from '../../helpers/data-pages'

const TEMPLATES = [
  { _id: 't1', name: 'Default', ext: 'docx' },
  { _id: 't2', name: 'Rapport été', ext: 'docm' },
  { _id: 't3', name: 'Slides', ext: 'pptx' },
  { _id: 't4', name: 'Legacy' } // Template created before the extensions (docx)
]

let wrapper
let downloads

async function mountTemplates({ templates = TEMPLATES, roles = '*' } = {}) {
  vi.spyOn(TemplateService, 'getTemplates').mockImplementation(() => ok(templates))
  wrapper = await mountPage(TemplatesPage, { roles })
  return wrapper
}

const t = (key, ...args) => wrapper.vm.$t(key, ...args)
const input = (label) => wrapper.findAllComponents(QInput).find((component) => component.props('label') === label)
const button = (label) => wrapper.findAllComponents(QBtn).filter((component) => component.text() === label).at(-1)
const rowOf = (text) => wrapper.findAll('tbody tr').find((tr) => tr.text().includes(text))
const icons = (row) => row.findAllComponents(QBtn).map((b) => b.props('icon'))
const filter = (terms) => wrapper.vm.customFilter(TEMPLATES, { name: '', ext: '', ...terms }).map((tpl) => tpl._id)
const docxFile = (name = 'report.docx', content = 'PK docx') => new File([content], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })

beforeEach(() => {
  resetApi()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  downloads = []
  URL.createObjectURL = vi.fn(() => 'blob:template')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { downloads.push(this.getAttribute('download')) })
})
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('templates list', () => {
  it('loads the templates and shows their name and extension', async () => {
    await mountTemplates()
    expect(TemplateService.getTemplates).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.loading).toBe(false)
    expect(tableRows(wrapper).map((row) => row.slice(0, 2))).toEqual([['Default', 'docx'], ['Legacy', ''], ['Rapport été', 'docm'], ['Slides', 'pptx']])
    expect(wrapper.text()).toContain('4 Templates')
  })

  it('shows the singular for one template and an empty table without template', async () => {
    await mountTemplates({ templates: [TEMPLATES[0]] })
    expect(wrapper.text()).toContain('1 Template')
    expect(wrapper.text()).not.toContain('1 Templates')
    wrapper.unmount()
    await mountTemplates({ templates: [] })
    expect(wrapper.text()).toContain('No matching records found')
  })

  it('does not crash when the templates cannot be loaded', async () => {
    vi.spyOn(TemplateService, 'getTemplates').mockRejectedValue(apiError(403, 'Insufficient privileges'))
    wrapper = await mountPage(TemplatesPage)
    expect(wrapper.vm.templates).toEqual([])
    expect(console.log).toHaveBeenCalled()
  })

  it('filters by name and extension (case insensitive)', async () => {
    await mountTemplates()
    expect(filter({ name: 'DEF' })).toEqual(['t1'])
    expect(filter({ name: 'été' })).toEqual(['t2'])
    expect(filter({ ext: 'pp' })).toContain('t3')
    expect(filter({ name: 's', ext: 'pptx' })).toEqual(['t3'])
    expect(filter({ name: null, ext: null })).toEqual(['t1', 't2', 't3', 't4'])
    expect(filter({ name: 'unknown' })).toEqual([])
    expect(wrapper.vm.customFilter(TEMPLATES, null)).toBe(TEMPLATES)
  })

  it('filters the templates without extension as docx templates', async () => {
    await mountTemplates()
    expect(filter({ ext: 'pptx' })).toEqual(['t3'])
    expect(filter({ ext: 'docx' })).toEqual(['t1', 't4'])
  })

  it('filters the table with the search inputs', async () => {
    await mountTemplates()
    const searchRow = wrapper.findAll('tbody tr').find((row) => row.find('input').exists())
    await searchRow.findAll('input')[0].setValue('slid')
    expect(tableRows(wrapper).map((row) => row[0])).toEqual(['Slides'])
  })

  it.each([
    ['*', ['fa fa-edit', 'fa fa-download', 'fa fa-trash'], true],
    [['templates:read'], ['fa fa-download'], false],
    [['templates:read', 'templates:update'], ['fa fa-edit', 'fa fa-download'], false],
    [['templates:read', 'templates:delete', 'templates:create'], ['fa fa-download', 'fa fa-trash'], true]
  ])('shows the actions allowed by the roles %j', async (roles, actions, canCreate) => {
    await mountTemplates({ roles })
    expect(icons(rowOf('Default'))).toEqual(actions)
    expect(wrapper.findAllComponents(QBtn).some((b) => b.text() === t('createTemplate'))).toBe(canCreate)
  })
})

describe('template download', () => {
  it.each([
    [TEMPLATES[0], 'Default.docx'],
    [TEMPLATES[1], 'Rapport été.docm'],
    [TEMPLATES[3], 'Legacy.docx']
  ])('downloads the file of the template %j', async (template, fileName) => {
    vi.spyOn(TemplateService, 'downloadTemplate').mockResolvedValue({ data: new Blob(['PK']) })
    await mountTemplates()
    wrapper.vm.downloadTemplate(template)
    await flushPromises()
    expect(TemplateService.downloadTemplate).toHaveBeenCalledWith(template._id)
    expect(downloads).toEqual([fileName])
  })

  it('downloads the template from the download button (as a blob)', async () => {
    await mountTemplates()
    api.get.mockResolvedValueOnce({ data: new Blob(['PK']) })
    await rowOf('Slides').findAllComponents(QBtn).find((b) => b.props('icon') === 'fa fa-download').trigger('click')
    await flushPromises()
    expect(api.get).toHaveBeenLastCalledWith('templates/download/t3', { responseType: 'blob' })
    expect(downloads).toEqual(['Slides.pptx'])
  })

  it('notifies a template not found', async () => {
    const notify = mockNotify()
    vi.spyOn(TemplateService, 'downloadTemplate').mockRejectedValue(apiError(404, new Blob(['{}'])))
    await mountTemplates()
    wrapper.vm.downloadTemplate(TEMPLATES[0])
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Template Not Found', color: 'negative' })
    expect(downloads).toEqual([])
  })

  it('logs the other errors of the server', async () => {
    mockNotify()
    vi.spyOn(TemplateService, 'downloadTemplate').mockRejectedValue(apiError(500, new Blob(['{}'])))
    await mountTemplates()
    wrapper.vm.downloadTemplate(TEMPLATES[0])
    await flushPromises()
    expect(console.log).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }))
  })

  it('notifies the message of the server read in the Blob of the answer', async () => {
    const notify = mockNotify()
    // Download requested as a Blob: the answer of the error is the Blob of the JSON of the server
    const body = new Blob([JSON.stringify({ status: 'error', datas: 'Insufficient privileges' })])
    vi.spyOn(TemplateService, 'downloadTemplate').mockRejectedValue(Object.assign(new Error('Request failed with status code 403'), { response: { status: 403, data: body } }))
    await mountTemplates()
    wrapper.vm.downloadTemplate(TEMPLATES[0])
    await vi.waitFor(() => expect(notify).toHaveBeenCalled())
    expect(lastNotification(notify)).toMatchObject({ message: 'Insufficient privileges', color: 'negative' })
    expect(downloads).toEqual([])
  })

  it('notifies the other errors of the download', async () => {
    const notify = mockNotify()
    vi.spyOn(TemplateService, 'downloadTemplate').mockRejectedValue(apiError(500, new Blob(['{}'])))
    await mountTemplates()
    wrapper.vm.downloadTemplate(TEMPLATES[0])
    await flushPromises()
    expect(lastNotification(notify).color).toBe('negative')
  })

  it('notifies when the browser cannot save the file', async () => {
    const notify = mockNotify()
    HTMLAnchorElement.prototype.click.mockImplementation(() => { throw new Error('Download blocked') })
    vi.spyOn(TemplateService, 'downloadTemplate').mockResolvedValue({ data: new Blob(['PK']) })
    await mountTemplates()
    wrapper.vm.downloadTemplate(TEMPLATES[0])
    await flushPromises()
    expect(lastNotification(notify).color).toBe('negative')
    expect(window.status).toBe('')
  })
})

describe('template creation', () => {
  it('opens the creation dialog', async () => {
    await mountTemplates()
    await button(t('createTemplate')).trigger('click')
    expect(dialog(wrapper, 'createModal').open).toBe(true)
    expect(wrapper.findComponent(UploaderStub).props('accept')).toBe('.doc,.docx,.docm,.ppt,.pptx')
  })

  it('resets the template when the creation dialog is opened', async () => {
    await mountTemplates()
    wrapper.vm.currentTemplate.name = 'Stale'
    await button(t('createTemplate')).trigger('click')
    expect(wrapper.vm.currentTemplate.name).toBe('')
  })

  it('requires a name and a file', async () => {
    vi.spyOn(TemplateService, 'createTemplate')
    await mountTemplates()
    await button(t('createTemplate')).trigger('click')
    await button(t('btn.create')).trigger('click')
    expect(wrapper.vm.errors).toEqual({ name: 'Name required', file: 'File required' })
    expect(wrapper.text()).toContain('File required')
    expect(TemplateService.createTemplate).not.toHaveBeenCalled()
  })

  it('requires a file when the name is given', async () => {
    vi.spyOn(TemplateService, 'createTemplate')
    await mountTemplates()
    await button(t('createTemplate')).trigger('click')
    await input(`${t('name')} *`).find('input').setValue('Nouveau')
    wrapper.vm.createTemplate()
    expect(wrapper.vm.errors).toEqual({ name: '', file: 'File required' })
    expect(TemplateService.createTemplate).not.toHaveBeenCalled()
  })

  it.each([
    ['report.docx', 'docx'],
    ['Rapport.final.DOCM', 'DOCM'],
    ['slides.pptx', 'pptx']
  ])('reads the uploaded file %s (base64 content and extension)', async (fileName, ext) => {
    await mountTemplates()
    await button(t('createTemplate')).trigger('click')
    wrapper.findComponent(UploaderStub).vm.$emit('added', [docxFile(fileName, 'contenu é')])
    expect(wrapper.vm.currentTemplate.ext).toBe(ext)
    await waitFileReader(() => wrapper.vm.currentTemplate.file)
    expect(wrapper.vm.currentTemplate.file).toBe(Buffer.from('contenu é').toString('base64'))
  })

  it('uploads the template, reloads the list and closes the dialog', async () => {
    const notify = mockNotify()
    vi.spyOn(TemplateService, 'createTemplate').mockImplementation(() => ok('Template created'))
    await mountTemplates()
    await button(t('createTemplate')).trigger('click')
    await input(`${t('name')} *`).find('input').setValue('Modèle Été')
    wrapper.findComponent(UploaderStub).vm.$emit('added', [docxFile('modele.docx', 'PK')])
    await waitFileReader(() => wrapper.vm.currentTemplate.file)
    await input(`${t('name')} *`).find('input').trigger('keyup', { key: 'Enter' })
    await flushPromises()
    expect(TemplateService.createTemplate).toHaveBeenCalledWith({ name: 'Modèle Été', file: btoa('PK'), ext: 'docx' })
    expect(TemplateService.getTemplates).toHaveBeenCalledTimes(2)
    expect(dialog(wrapper, 'createModal').open).toBe(false)
    expect(wrapper.vm.currentTemplate).toEqual({ name: '', file: '', ext: '' }) // Reset when closed
    expect(lastNotification(notify)).toMatchObject({ message: 'Template created successfully', color: 'positive' })
  })

  it.each([
    [422, 'Bad name or ext format'],
    [422, 'Template name already exists'],
    [413, 'Request entity too large'],
    [403, 'Insufficient privileges']
  ])('notifies the error %i "%s" and keeps the dialog open', async (status, message) => {
    const notify = mockNotify()
    vi.spyOn(TemplateService, 'createTemplate').mockRejectedValue(apiError(status, message))
    await mountTemplates()
    await button(t('createTemplate')).trigger('click')
    Object.assign(wrapper.vm.currentTemplate, { name: 'x/../y', file: 'UEs=', ext: 'docx' })
    wrapper.vm.createTemplate()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message, color: 'negative' })
    expect(dialog(wrapper, 'createModal').open).toBe(true)
    expect(wrapper.vm.currentTemplate.name).toBe('x/../y')
  })

  it('cleans the template and the errors when the dialog is closed', async () => {
    await mountTemplates()
    await button(t('createTemplate')).trigger('click')
    wrapper.vm.currentTemplate.name = 'Draft'
    wrapper.vm.createTemplate()
    await button(t('btn.cancel')).trigger('click')
    expect(wrapper.vm.currentTemplate).toEqual({ name: '', file: '', ext: '' })
    expect(wrapper.vm.errors).toEqual({ name: '', file: '' })
  })
})

describe('template update', () => {
  it('opens the template with the edit button (name only, no file)', async () => {
    await mountTemplates()
    await rowOf('Rapport').findAllComponents(QBtn).find((b) => b.props('icon') === 'fa fa-edit').trigger('click')
    expect(dialog(wrapper, 'editModal').open).toBe(true)
    expect(wrapper.vm.templateId).toBe('t2')
    expect(wrapper.vm.currentTemplate).toEqual({ name: 'Rapport été', file: '', ext: '' })
  })

  it('opens the template with a double click only with the update permission', async () => {
    await mountTemplates({ roles: ['templates:read'] })
    await rowOf('Slides').trigger('dblclick')
    expect(dialog(wrapper, 'editModal').open).toBe(false)
    wrapper.unmount()
    await mountTemplates({ roles: ['templates:read', 'templates:update'] })
    await rowOf('Slides').trigger('dblclick')
    expect(dialog(wrapper, 'editModal').open).toBe(true)
    expect(wrapper.vm.templateId).toBe('t3')
  })

  it('requires a name but no file', async () => {
    vi.spyOn(TemplateService, 'updateTemplate').mockImplementation(() => ok('updated'))
    mockNotify()
    await mountTemplates()
    wrapper.vm.dblClick(null, TEMPLATES[0])
    await flushPromises()
    await input(`${t('name')} *`).find('input').setValue('')
    await button(t('btn.update')).trigger('click')
    expect(wrapper.vm.errors.name).toBe('Name required')
    expect(TemplateService.updateTemplate).not.toHaveBeenCalled()
    await input(`${t('name')} *`).find('input').setValue('Renamed')
    await button(t('btn.update')).trigger('click')
    await flushPromises()
    expect(TemplateService.updateTemplate).toHaveBeenCalledWith('t1', { name: 'Renamed', file: '', ext: '' })
  })

  it('replaces the file of the template', async () => {
    const notify = mockNotify()
    vi.spyOn(TemplateService, 'updateTemplate').mockImplementation(() => ok('updated'))
    await mountTemplates()
    wrapper.vm.dblClick(null, TEMPLATES[3])
    await flushPromises()
    wrapper.findComponent(UploaderStub).vm.$emit('added', [docxFile('new.pptx', 'PPT')])
    await waitFileReader(() => wrapper.vm.currentTemplate.file)
    wrapper.vm.updateTemplate()
    await flushPromises()
    expect(TemplateService.updateTemplate).toHaveBeenCalledWith('t4', { name: 'Legacy', file: btoa('PPT'), ext: 'pptx' })
    expect(TemplateService.getTemplates).toHaveBeenCalledTimes(2)
    expect(dialog(wrapper, 'editModal').open).toBe(false)
    expect(lastNotification(notify)).toMatchObject({ message: 'Template updated successfully', color: 'positive' })
  })

  it('sends the update to the API of the templates', async () => {
    mockNotify()
    await mountTemplates()
    wrapper.vm.dblClick(null, TEMPLATES[1])
    wrapper.vm.updateTemplate()
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('templates/t2', { name: 'Rapport été', file: '', ext: '' })
  })

  it('notifies the error of the update and keeps the dialog open', async () => {
    const notify = mockNotify()
    vi.spyOn(TemplateService, 'updateTemplate').mockRejectedValue(apiError(404, 'Template not found'))
    await mountTemplates()
    wrapper.vm.dblClick(null, TEMPLATES[1])
    wrapper.vm.updateTemplate()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Template not found', color: 'negative' })
    expect(dialog(wrapper, 'editModal').open).toBe(true)
  })
})

describe('template deletion', () => {
  it('asks for a confirmation with the name of the template', async () => {
    const dialogs = mockDialog()
    vi.spyOn(TemplateService, 'deleteTemplate')
    await mountTemplates()
    await rowOf('Rapport').findAllComponents(QBtn).find((b) => b.props('icon') === 'fa fa-trash').trigger('click')
    expect(dialogs[0].options.message).toBe('Template «Rapport été» will be permanently deleted')
    expect(dialogs[0].options.html).toBeFalsy()
    dialogs[0].cancel()
    expect(TemplateService.deleteTemplate).not.toHaveBeenCalled()
  })

  it('deletes the template and notifies the message of the server', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(TemplateService, 'deleteTemplate').mockImplementation(() => ok('Template deleted successfully'))
    await mountTemplates()
    wrapper.vm.confirmDeleteTemplate(TEMPLATES[2])
    dialogs[0].ok()
    await flushPromises()
    expect(TemplateService.deleteTemplate).toHaveBeenCalledWith('t3')
    expect(TemplateService.getTemplates).toHaveBeenCalledTimes(2)
    expect(lastNotification(notify)).toMatchObject({ message: 'Template deleted successfully', color: 'positive' })
  })

  it('notifies the error of the deletion', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(TemplateService, 'deleteTemplate').mockRejectedValue(apiError(404, 'Template not found'))
    await mountTemplates()
    wrapper.vm.confirmDeleteTemplate(TEMPLATES[2])
    dialogs[0].ok()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Template not found', color: 'negative' })
    expect(TemplateService.getTemplates).toHaveBeenCalledTimes(1)
  })
})
