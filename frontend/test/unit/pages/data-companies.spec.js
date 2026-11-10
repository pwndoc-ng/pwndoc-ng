// pages/data/companies: companies table (logos, search), creation / update dialogs (validation, logo upload, errors), deletion
// Dialogs and uploaders replaced by stubs, API services mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { QInput, QBtn } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import CompaniesPage from 'pages/data/companies'
import CompanyService from '@/services/company'
import { api, resetApi } from '../../helpers/api-mock'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'
import { mountPage, ok, apiError, tableRows, dialog, UploaderStub, waitFileReader } from '../../helpers/data-pages'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const COMPANIES = [
  { _id: 'c1', name: 'ACME', shortName: 'AC', address: '1 rue de la Paix', postalCode: '75001', city: 'Paris', logo: PNG },
  { _id: 'c2', name: 'Société Générale', shortName: 'SG', city: 'Nanterre' },
  { _id: 'c3', name: 'Globex', logo: 'not-an-image' }
]

let wrapper

async function mountCompanies({ companies = COMPANIES, roles = '*' } = {}) {
  vi.spyOn(CompanyService, 'getCompanies').mockImplementation(() => ok(companies))
  wrapper = await mountPage(CompaniesPage, { roles })
  return wrapper
}

const t = (key, ...args) => wrapper.vm.$t(key, ...args)
const input = (label) => wrapper.findAllComponents(QInput).find((component) => component.props('label') === label)
const button = (label) => wrapper.findAllComponents(QBtn).filter((component) => component.text() === label).at(-1)
const rowOf = (text) => wrapper.findAll('tbody tr').find((tr) => tr.text().includes(text))
const filter = (name) => wrapper.vm.customFilter(COMPANIES, { name }).map((c) => c._id)

beforeEach(() => {
  resetApi()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('companies list', () => {
  it('loads the companies and shows them in the table', async () => {
    await mountCompanies()
    expect(CompanyService.getCompanies).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.loading).toBe(false)
    const rows = tableRows(wrapper)
    expect(rows).toHaveLength(3)
    expect(rows).toContainEqual(expect.arrayContaining(['ACME', 'AC', '1 rue de la Paix', '75001', 'Paris']))
    expect(wrapper.text()).toContain('3 Companies')
  })

  it('shows the logos stored as images and the other values as text', async () => {
    await mountCompanies()
    expect(rowOf('ACME').find('img').attributes('src')).toBe(PNG)
    expect(rowOf('Globex').find('img').exists()).toBe(false)
    expect(rowOf('Globex').text()).toContain('not-an-image')
    expect(rowOf('Société').find('img').exists()).toBe(false)
  })

  it('shows the HTML of the names and of the logos as text', async () => {
    await mountCompanies({ companies: [{ _id: 'x', name: '<img src=x onerror=alert(1)>', logo: '<svg onload=alert(1)>' }] })
    expect(tableRows(wrapper)[0][0]).toBe('<img src=x onerror=alert(1)>')
    expect(tableRows(wrapper)[0][5]).toBe('<svg onload=alert(1)>')
    expect(wrapper.find('tbody img').exists()).toBe(false)
    expect(wrapper.find('tbody svg').exists()).toBe(false)
  })

  it('builds the source of the logos', async () => {
    await mountCompanies()
    expect(wrapper.vm.isBase64Image(PNG)).toBe(true)
    expect(wrapper.vm.isBase64Image('iVBORw0KGgo=')).toBe(false)
    expect(wrapper.vm.isBase64Image(null)).toBe(false)
    expect(wrapper.vm.getImageSrc(PNG)).toBe(PNG)
    expect(wrapper.vm.getImageSrc('iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('shows the singular for one company', async () => {
    await mountCompanies({ companies: [COMPANIES[1]] })
    expect(wrapper.text()).toContain('1 Company')
    expect(wrapper.text()).not.toContain('1 Companies')
  })

  it('shows an empty table without company', async () => {
    await mountCompanies({ companies: [] })
    expect(wrapper.vm.companies).toEqual([])
    expect(wrapper.text()).toContain('No matching records found')
  })

  it('does not crash when the companies cannot be loaded', async () => {
    vi.spyOn(CompanyService, 'getCompanies').mockRejectedValue(apiError(403, 'Insufficient privileges'))
    wrapper = await mountPage(CompaniesPage)
    expect(wrapper.vm.companies).toEqual([])
    expect(console.log).toHaveBeenCalled()
  })

  it('filters by name (case and accent insensitive)', async () => {
    await mountCompanies()
    expect(filter('SOCIETE')).toEqual(['c2'])
    expect(filter('o')).toEqual(['c2', 'c3'])
    expect(filter('')).toEqual(['c1', 'c2', 'c3'])
    expect(filter(null)).toEqual(['c1', 'c2', 'c3'])
    const search = wrapper.findAll('tbody tr').find((row) => row.find('input').exists()).find('input')
    await search.setValue('glob')
    expect(tableRows(wrapper).map((row) => row[0])).toEqual(['Globex'])
  })
})

describe('company creation', () => {
  it('opens the creation dialog with an empty company', async () => {
    await mountCompanies()
    wrapper.vm.clone(COMPANIES[0])
    await button(t('addCompany')).trigger('click')
    expect(dialog(wrapper, 'createModal').open).toBe(true)
    expect(wrapper.vm.currentCompany).toMatchObject({ name: '', shortName: '', address: '', postalCode: '', city: '', logo: '' })
  })

  it('requires a name', async () => {
    vi.spyOn(CompanyService, 'createCompanies')
    await mountCompanies()
    await button(t('addCompany')).trigger('click')
    await input(t('shortName')).find('input').setValue('X')
    await button(t('btn.create')).trigger('click')
    expect(wrapper.vm.errors.name).toBe('Name required')
    expect(wrapper.text()).toContain('Name required')
    expect(CompanyService.createCompanies).not.toHaveBeenCalled()
  })

  it('accepts only images as logo', async () => {
    await mountCompanies()
    await button(t('addCompany')).trigger('click')
    expect(wrapper.findComponent(UploaderStub).props('accept')).toBe('.gif,.jpg,.jpeg,.png')
  })

  it('creates the company with its logo read as a data URL', async () => {
    const notify = mockNotify()
    vi.spyOn(CompanyService, 'createCompanies').mockImplementation(() => ok('Companies created'))
    await mountCompanies()
    await button(t('addCompany')).trigger('click')
    await input(`${t('name')} *`).find('input').setValue('Ünïcødé 株式会社')
    await input(t('city')).find('input').setValue('Köln')
    wrapper.findComponent(UploaderStub).vm.$emit('added', [new File(['logo'], 'logo.png', { type: 'image/png' })])
    await waitFileReader(() => wrapper.vm.currentCompany.logo)
    expect(wrapper.vm.currentCompany.logo).toBe(`data:image/png;base64,${btoa('logo')}`)
    await button(t('btn.create')).trigger('click')
    await flushPromises()
    expect(CompanyService.createCompanies).toHaveBeenCalledWith([{
      name: 'Ünïcødé 株式会社', shortName: '', address: '', postalCode: '', city: 'Köln', logo: `data:image/png;base64,${btoa('logo')}`
    }])
    expect(CompanyService.getCompanies).toHaveBeenCalledTimes(2)
    expect(dialog(wrapper, 'createModal').open).toBe(false)
    expect(lastNotification(notify)).toMatchObject({ message: 'Company created successfully', color: 'positive' })
  })

  it('creates the company with the Enter key', async () => {
    mockNotify()
    await mountCompanies()
    await button(t('addCompany')).trigger('click')
    await input(`${t('name')} *`).find('input').setValue('Initech')
    await input(`${t('name')} *`).find('input').trigger('keyup', { key: 'Enter' })
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('companies', [expect.objectContaining({ name: 'Initech' })])
  })

  it('notifies the error of the creation and keeps the dialog open', async () => {
    const notify = mockNotify()
    vi.spyOn(CompanyService, 'createCompanies').mockRejectedValue(apiError(422, 'Company name already exists'))
    await mountCompanies()
    await button(t('addCompany')).trigger('click')
    wrapper.vm.currentCompany.name = 'ACME'
    wrapper.vm.createCompany()
    await flushPromises()
    expect(lastNotification(notify).color).toBe('negative')
    expect(dialog(wrapper, 'createModal').open).toBe(true)
    expect(CompanyService.getCompanies).toHaveBeenCalledTimes(1)
  })

  it('notifies the message of the server when the company cannot be created', async () => {
    const notify = mockNotify()
    vi.spyOn(CompanyService, 'createCompanies').mockRejectedValue(apiError(422, 'Company name already exists'))
    await mountCompanies()
    wrapper.vm.currentCompany.name = 'ACME'
    wrapper.vm.createCompany()
    await flushPromises()
    expect(lastNotification(notify).message).toBe('Company name already exists')
  })

  it('cleans the errors when the dialog is closed', async () => {
    await mountCompanies()
    await button(t('addCompany')).trigger('click')
    wrapper.vm.createCompany()
    expect(wrapper.vm.errors.name).toBe('Name required')
    dialog(wrapper, 'createModal').hide()
    expect(wrapper.vm.errors.name).toBe('')
  })
})

describe('company update', () => {
  it('opens the company in the edition dialog with the edit button', async () => {
    await mountCompanies()
    await rowOf('ACME').findAllComponents(QBtn).find((b) => b.props('icon') === 'fa fa-edit').trigger('click')
    expect(dialog(wrapper, 'editModal').open).toBe(true)
    expect(wrapper.vm.idUpdate).toBe('c1')
    expect(wrapper.vm.currentCompany).toMatchObject({ name: 'ACME', city: 'Paris', logo: PNG })
  })

  it('does not keep the values of the previously edited company', async () => {
    await mountCompanies()
    wrapper.vm.dblClick(null, COMPANIES[0])
    wrapper.vm.dblClick(null, COMPANIES[1])
    expect(wrapper.vm.idUpdate).toBe('c2')
    expect(wrapper.vm.currentCompany).toMatchObject({ name: 'Société Générale', shortName: 'SG', address: '', postalCode: '', city: 'Nanterre', logo: '' })
    wrapper.vm.currentCompany.city = 'Paris'
    expect(COMPANIES[1].city).toBe('Nanterre') // Copy edited
  })

  it('opens the company with a double click on its row', async () => {
    await mountCompanies()
    await rowOf('Globex').trigger('dblclick')
    expect(dialog(wrapper, 'editModal').open).toBe(true)
    expect(wrapper.vm.idUpdate).toBe('c3')
  })

  it('requires a name', async () => {
    vi.spyOn(CompanyService, 'updateCompany')
    await mountCompanies()
    wrapper.vm.dblClick(null, COMPANIES[0])
    await flushPromises()
    await input(`${t('name')} *`).find('input').setValue('')
    await button(t('btn.update')).trigger('click')
    expect(wrapper.vm.errors.name).toBe('Name required')
    expect(CompanyService.updateCompany).not.toHaveBeenCalled()
  })

  it('updates the company with a new logo', async () => {
    const notify = mockNotify()
    vi.spyOn(CompanyService, 'updateCompany').mockImplementation(() => ok('Company updated'))
    await mountCompanies()
    wrapper.vm.dblClick(null, COMPANIES[1])
    await flushPromises()
    wrapper.findComponent(UploaderStub).vm.$emit('added', [new File(['gif'], 'new.gif', { type: 'image/gif' })])
    await waitFileReader(() => wrapper.vm.currentCompany.logo)
    await button(t('btn.update')).trigger('click')
    await flushPromises()
    expect(CompanyService.updateCompany).toHaveBeenCalledWith('c2', expect.objectContaining({ name: 'Société Générale', logo: `data:image/gif;base64,${btoa('gif')}` }))
    expect(CompanyService.getCompanies).toHaveBeenCalledTimes(2)
    expect(dialog(wrapper, 'editModal').open).toBe(false)
    expect(lastNotification(notify)).toMatchObject({ message: 'Company updated successfully', color: 'positive' })
  })

  it('sends the update to the API of the companies', async () => {
    mockNotify()
    await mountCompanies()
    wrapper.vm.dblClick(null, COMPANIES[2])
    wrapper.vm.updateCompany()
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('companies/c3', expect.objectContaining({ name: 'Globex' }))
  })

  it('notifies the error of the update and keeps the dialog open', async () => {
    const notify = mockNotify()
    vi.spyOn(CompanyService, 'updateCompany').mockRejectedValue(apiError(422, 'Company name already exists'))
    await mountCompanies()
    wrapper.vm.dblClick(null, COMPANIES[2])
    wrapper.vm.currentCompany.name = 'ACME'
    wrapper.vm.updateCompany()
    await flushPromises()
    expect(lastNotification(notify).color).toBe('negative')
    expect(dialog(wrapper, 'editModal').open).toBe(true)
  })

  it('notifies the message of the server when the company cannot be updated', async () => {
    const notify = mockNotify()
    vi.spyOn(CompanyService, 'updateCompany').mockRejectedValue(apiError(422, 'Company name already exists'))
    await mountCompanies()
    wrapper.vm.dblClick(null, COMPANIES[2])
    wrapper.vm.updateCompany()
    await flushPromises()
    expect(lastNotification(notify).message).toBe('Company name already exists')
  })
})

describe('company deletion', () => {
  it('asks for a confirmation with the name of the company (as text)', async () => {
    const dialogs = mockDialog()
    vi.spyOn(CompanyService, 'deleteCompany')
    await mountCompanies()
    await rowOf('Société').findAllComponents(QBtn).find((b) => b.props('icon') === 'fa fa-trash').trigger('click')
    expect(dialogs[0].options.message).toBe('Company «Société Générale» will be permanently deleted')
    expect(dialogs[0].options.html).toBeFalsy()
    dialogs[0].cancel()
    expect(CompanyService.deleteCompany).not.toHaveBeenCalled()
  })

  it('deletes the company after confirmation and reloads the list', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(CompanyService, 'deleteCompany').mockImplementation(() => ok('Company deleted'))
    await mountCompanies()
    wrapper.vm.confirmDeleteCompany(COMPANIES[0])
    dialogs[0].ok()
    await flushPromises()
    expect(CompanyService.deleteCompany).toHaveBeenCalledWith('c1')
    expect(CompanyService.getCompanies).toHaveBeenCalledTimes(2)
    expect(lastNotification(notify)).toMatchObject({ message: 'Company deleted successfully', color: 'positive' })
  })

  it('notifies the error of the deletion', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(CompanyService, 'deleteCompany').mockRejectedValue(apiError(404, 'Company not found'))
    await mountCompanies()
    wrapper.vm.confirmDeleteCompany(COMPANIES[0])
    dialogs[0].ok()
    await flushPromises()
    expect(lastNotification(notify).color).toBe('negative')
    expect(CompanyService.getCompanies).toHaveBeenCalledTimes(1)
  })

  it('notifies the message of the server when the company cannot be deleted', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(CompanyService, 'deleteCompany').mockRejectedValue(apiError(404, 'Company not found'))
    await mountCompanies()
    wrapper.vm.confirmDeleteCompany(COMPANIES[0])
    dialogs[0].ok()
    await flushPromises()
    expect(lastNotification(notify).message).toBe('Company not found')
  })
})
