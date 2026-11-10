// pages/data/clients: clients table (filters, count), creation / update dialogs (validation, errors), deletion
// Dialogs replaced by a stub rendering their content, API services mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { QInput, QBtn, QSelect } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import ClientsPage from 'pages/data/clients'
import ClientService from '@/services/client'
import CompanyService from '@/services/company'
import { api, resetApi } from '../../helpers/api-mock'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'
import { mountPage, ok, apiError, tableRows, dialog } from '../../helpers/data-pages'

const COMPANIES = [{ _id: 'c1', name: 'ACME' }, { _id: 'c2', name: 'Société Générale' }]
const CLIENTS = [
  { _id: 'cl1', firstname: 'Jean', lastname: 'Dupont', email: 'jean@acme.com', phone: '0102030405', cell: '', title: 'CISO', company: { _id: 'c1', name: 'ACME' } },
  { _id: 'cl2', firstname: 'Élodie', lastname: 'Müller', email: 'elodie@sg.fr', company: { _id: 'c2', name: 'Société Générale' } },
  { _id: 'cl3', firstname: 'Bob', lastname: 'Smith', email: 'bob@nocompany.io', company: null }
]

let wrapper

async function mountClients({ clients = CLIENTS, companies = COMPANIES, roles = '*' } = {}) {
  vi.spyOn(ClientService, 'getClients').mockImplementation(() => ok(clients))
  vi.spyOn(CompanyService, 'getCompanies').mockImplementation(() => ok(companies))
  wrapper = await mountPage(ClientsPage, { roles })
  return wrapper
}

const t = (key, ...args) => wrapper.vm.$t(key, ...args)
const input = (label) => wrapper.findAllComponents(QInput).find((component) => component.props('label') === label)
const button = (label) => wrapper.findAllComponents(QBtn).filter((component) => component.text() === label).at(-1)
const filter = (terms) => wrapper.vm.customFilter(CLIENTS, { firstname: '', lastname: '', email: '', 'company.name': '', ...terms }).map((c) => c._id)

async function fillCreateForm(values) {
  for (const [label, value] of Object.entries(values))
    await input(label).find('input').setValue(value)
}

beforeEach(() => {
  resetApi()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('clients list', () => {
  it('loads the clients and the companies and shows them in the table', async () => {
    await mountClients()
    expect(ClientService.getClients).toHaveBeenCalledTimes(1)
    expect(CompanyService.getCompanies).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.loading).toBe(false)
    const rows = tableRows(wrapper)
    expect(rows).toHaveLength(3)
    expect(rows).toContainEqual(expect.arrayContaining(['Élodie', 'Müller', 'elodie@sg.fr', 'Société Générale']))
    expect(rows.find((row) => row[0] === 'Bob')[3]).toBe('') // Client without company
    expect(wrapper.text()).toContain('3 Clients')
  })

  it('sorts the clients by firstname', async () => {
    await mountClients()
    const firstnames = tableRows(wrapper).map((row) => row[0])
    expect(firstnames.indexOf('Bob')).toBeLessThan(firstnames.indexOf('Jean'))
  })

  it('shows the singular for one client and an empty table without client', async () => {
    await mountClients({ clients: [CLIENTS[0]] })
    expect(wrapper.text()).toContain('1 Client')
    expect(wrapper.text()).not.toContain('1 Clients')
    wrapper.unmount()
    await mountClients({ clients: [] })
    expect(tableRows(wrapper).filter((row) => row.length > 1)).toHaveLength(0)
    expect(wrapper.vm.clients).toEqual([])
    expect(wrapper.text()).toContain('No matching records found') // Message of the table instead of the bottom slot
  })

  it('offers the companies in the company search', async () => {
    await mountClients()
    const search = wrapper.findAllComponents(QSelect).find((select) => select.props('label') === t('search'))
    expect(search.props('options')).toEqual(COMPANIES)
    expect(search.props('optionValue')).toBe('name')
    expect(search.props('emitValue')).toBe(true)
  })

  it('does not crash when the clients cannot be loaded', async () => {
    vi.spyOn(ClientService, 'getClients').mockRejectedValue(apiError(500, 'Internal error'))
    vi.spyOn(CompanyService, 'getCompanies').mockRejectedValue(apiError(403, 'Insufficient privileges'))
    wrapper = await mountPage(ClientsPage)
    expect(wrapper.vm.clients).toEqual([])
    expect(wrapper.vm.companies).toEqual([])
    expect(console.log).toHaveBeenCalledTimes(2)
  })

  it('notifies the error of the loading of the clients and stops the loading state', async () => {
    const notify = mockNotify()
    vi.spyOn(ClientService, 'getClients').mockRejectedValue(apiError(500, 'Internal error'))
    vi.spyOn(CompanyService, 'getCompanies').mockImplementation(() => ok(COMPANIES))
    wrapper = await mountPage(ClientsPage)
    expect(wrapper.vm.loading).toBe(false)
    expect(lastNotification(notify)).toMatchObject({ message: 'Internal error', color: 'negative' })
  })

  it('shows the HTML of the names as text', async () => {
    await mountClients({ clients: [{ _id: 'x', firstname: '<img src=x onerror=alert(1)>', lastname: '<b>Bold</b>', email: 'x@x', company: { name: '<i>Corp</i>' } }] })
    expect(tableRows(wrapper)[0].slice(0, 4)).toEqual(['<img src=x onerror=alert(1)>', '<b>Bold</b>', 'x@x', '<i>Corp</i>'])
    expect(wrapper.find('tbody img').exists()).toBe(false)
    expect(wrapper.find('tbody b').exists()).toBe(false)
  })
})

describe('clients filters', () => {
  it('filters by firstname and lastname (case and accent insensitive)', async () => {
    await mountClients()
    expect(filter({ firstname: 'ELODIE' })).toEqual(['cl2'])
    expect(filter({ lastname: 'muller' })).toEqual(['cl2'])
    expect(filter({ firstname: 'o' })).toEqual(['cl2', 'cl3'])
  })

  it('filters by email and company name, the clients without company being excluded', async () => {
    await mountClients()
    expect(filter({ email: '@SG.FR' })).toEqual(['cl2'])
    expect(filter({ 'company.name': 'societe' })).toEqual(['cl2'])
    expect(filter({ 'company.name': 'a' })).toEqual(['cl1', 'cl2'])
  })

  it('combines the filters and accepts the cleared (null) search fields', async () => {
    await mountClients()
    expect(filter({ firstname: 'jean', email: 'acme' })).toEqual(['cl1'])
    expect(filter({ firstname: 'jean', email: 'sg.fr' })).toEqual([])
    expect(filter({ firstname: null, 'company.name': null })).toEqual(['cl1', 'cl2', 'cl3'])
  })

  it('filters the table with the search inputs', async () => {
    await mountClients()
    const searchRow = wrapper.findAll('tbody tr').find((row) => row.find('input').exists())
    await searchRow.findAll('input')[1].setValue('dup')
    expect(tableRows(wrapper).map((row) => row[0])).toEqual(['Jean'])
    await searchRow.findAll('input')[1].setValue('<script>')
    expect(tableRows(wrapper).filter((row) => row.length > 1)).toHaveLength(0)
  })
})

describe('client creation', () => {
  it('opens the creation dialog with an empty client', async () => {
    await mountClients()
    Object.assign(wrapper.vm.currentClient, { firstname: 'Old', email: 'old@x' })
    await button(t('addClient')).trigger('click')
    expect(dialog(wrapper, 'createModal').open).toBe(true)
    expect(wrapper.vm.currentClient).toEqual({ lastname: '', firstname: '', email: '', phone: '', cell: '', title: '', company: { name: '' } })
  })

  it('requires the firstname, lastname and email', async () => {
    vi.spyOn(ClientService, 'createClients')
    await mountClients()
    await button(t('addClient')).trigger('click')
    await button(t('btn.create')).trigger('click')
    expect(wrapper.vm.errors).toEqual({ lastname: 'Lastname required', firstname: 'Firstname required', email: 'Email required' })
    expect(ClientService.createClients).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Firstname required')
    expect(dialog(wrapper, 'createModal').open).toBe(true)
  })

  it('requires the email even when the names are given', async () => {
    vi.spyOn(ClientService, 'createClients')
    await mountClients()
    await button(t('addClient')).trigger('click')
    await fillCreateForm({ [`${t('firstname')} *`]: 'Ann', [`${t('lastname')} *`]: 'Lee' })
    wrapper.vm.createClient()
    expect(wrapper.vm.errors).toEqual({ lastname: '', firstname: '', email: 'Email required' })
    expect(ClientService.createClients).not.toHaveBeenCalled()
  })

  it('creates the client with its company, reloads the list and closes the dialog', async () => {
    const notify = mockNotify()
    vi.spyOn(ClientService, 'createClients').mockImplementation(() => ok('Client created'))
    await mountClients()
    await button(t('addClient')).trigger('click')
    await fillCreateForm({
      [`${t('firstname')} *`]: 'Zoë',
      [`${t('lastname')} *`]: 'Ōtsuka 大塚',
      [`${t('email')} *`]: 'zoe@example.jp',
      [t('function')]: 'RSSI',
      [t('phone')]: '+33 1 02 03 04 05',
      [t('cell')]: '06'
    })
    wrapper.findAllComponents(QSelect).find((select) => select.props('label') === t('company')).vm.$emit('update:modelValue', COMPANIES[1])
    await button(t('btn.create')).trigger('click')
    await flushPromises()
    expect(ClientService.createClients).toHaveBeenCalledWith([{
      firstname: 'Zoë', lastname: 'Ōtsuka 大塚', email: 'zoe@example.jp', title: 'RSSI', phone: '+33 1 02 03 04 05', cell: '06', company: COMPANIES[1]
    }])
    expect(ClientService.getClients).toHaveBeenCalledTimes(2)
    expect(dialog(wrapper, 'createModal').open).toBe(false)
    expect(lastNotification(notify)).toMatchObject({ message: 'Client created successfully', color: 'positive' })
  })

  it('creates the client with the Enter key', async () => {
    mockNotify()
    vi.spyOn(ClientService, 'createClients').mockImplementation(() => ok('Client created'))
    await mountClients()
    await button(t('addClient')).trigger('click')
    await fillCreateForm({ [`${t('firstname')} *`]: 'A', [`${t('lastname')} *`]: 'B', [`${t('email')} *`]: 'a@b.c' })
    await input(`${t('email')} *`).find('input').trigger('keyup', { key: 'Enter' })
    await flushPromises()
    expect(ClientService.createClients).toHaveBeenCalledTimes(1)
  })

  it.each([
    [422, 'Client email already exists'],
    [403, 'Insufficient privileges'],
    [500, 'Internal Server Error']
  ])('notifies the error %i of the server and keeps the dialog open', async (status, message) => {
    const notify = mockNotify()
    vi.spyOn(ClientService, 'createClients').mockRejectedValue(apiError(status, message))
    await mountClients()
    await button(t('addClient')).trigger('click')
    Object.assign(wrapper.vm.currentClient, { firstname: 'A', lastname: 'B', email: 'jean@acme.com' })
    wrapper.vm.createClient()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message, color: 'negative' })
    expect(dialog(wrapper, 'createModal').open).toBe(true)
    expect(ClientService.getClients).toHaveBeenCalledTimes(1)
  })

  it('sends one request for a double click (second click ignored while the creation is pending)', async () => {
    const notify = mockNotify()
    vi.spyOn(ClientService, 'createClients')
      .mockImplementationOnce(() => ok('Client created'))
      .mockRejectedValueOnce(apiError(422, 'Client email already exists'))
    await mountClients()
    await button(t('addClient')).trigger('click')
    Object.assign(wrapper.vm.currentClient, { firstname: 'A', lastname: 'B', email: 'a@b.c' })
    wrapper.vm.createClient()
    wrapper.vm.createClient()
    await flushPromises()
    expect(ClientService.createClients).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls.map(([options]) => options.color)).toEqual(['positive'])
  })

  it('cleans the errors when the dialog is closed', async () => {
    await mountClients()
    await button(t('addClient')).trigger('click')
    wrapper.vm.createClient()
    expect(wrapper.vm.errors.email).toBe('Email required')
    dialog(wrapper, 'createModal').hide()
    expect(wrapper.vm.errors).toEqual({ lastname: '', firstname: '', email: '' })
  })
})

describe('client update', () => {
  it('opens a copy of the client in the edition dialog with the edit button', async () => {
    await mountClients()
    const row = wrapper.findAll('tbody tr').find((tr) => tr.text().includes('Dupont'))
    await row.findAllComponents(QBtn).find((b) => b.props('icon') === 'fa fa-edit').trigger('click')
    expect(dialog(wrapper, 'editModal').open).toBe(true)
    expect(wrapper.vm.idUpdate).toBe('cl1')
    expect(wrapper.vm.currentClient).toEqual(CLIENTS[0])
    expect(wrapper.vm.currentClient).not.toBe(CLIENTS[0])
    expect(input(`${t('email')} *`).props('modelValue')).toBe('jean@acme.com')
  })

  it('opens the client with a double click on its row', async () => {
    await mountClients()
    await wrapper.findAll('tbody tr').find((tr) => tr.text().includes('Müller')).trigger('dblclick')
    expect(dialog(wrapper, 'editModal').open).toBe(true)
    expect(wrapper.vm.idUpdate).toBe('cl2')
  })

  it('does not change the list while the client is edited', async () => {
    await mountClients()
    wrapper.vm.clone(CLIENTS[0])
    wrapper.vm.currentClient.firstname = 'Changed'
    expect(CLIENTS[0].firstname).toBe('Jean')
  })

  it('validates the required fields before the update', async () => {
    vi.spyOn(ClientService, 'updateClient')
    await mountClients()
    wrapper.vm.dblClick(null, CLIENTS[0])
    await flushPromises()
    await input(`${t('email')} *`).find('input').setValue('')
    await button(t('btn.update')).trigger('click')
    expect(wrapper.vm.errors.email).toBe('Email required')
    expect(ClientService.updateClient).not.toHaveBeenCalled()
  })

  it('updates the client, reloads the list and closes the dialog', async () => {
    const notify = mockNotify()
    vi.spyOn(ClientService, 'updateClient').mockImplementation(() => ok('Client updated'))
    await mountClients()
    wrapper.vm.dblClick(null, CLIENTS[1])
    await flushPromises()
    await input(`${t('lastname')} *`).find('input').setValue('Müller-Lüdenscheidt')
    await input(`${t('lastname')} *`).find('input').trigger('keyup', { key: 'Enter' })
    await flushPromises()
    expect(ClientService.updateClient).toHaveBeenCalledWith('cl2', expect.objectContaining({ lastname: 'Müller-Lüdenscheidt', email: 'elodie@sg.fr' }))
    expect(ClientService.getClients).toHaveBeenCalledTimes(2)
    expect(dialog(wrapper, 'editModal').open).toBe(false)
    expect(lastNotification(notify)).toMatchObject({ message: 'Client updated successfully', color: 'positive' })
  })

  it('notifies the error of the update and keeps the dialog open', async () => {
    const notify = mockNotify()
    vi.spyOn(ClientService, 'updateClient').mockRejectedValue(apiError(404, 'Client Id not found'))
    await mountClients()
    wrapper.vm.dblClick(null, CLIENTS[2])
    wrapper.vm.updateClient()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Client Id not found', color: 'negative' })
    expect(dialog(wrapper, 'editModal').open).toBe(true)
  })

  it('sends the update to the API of the client', async () => {
    mockNotify()
    await mountClients()
    wrapper.vm.dblClick(null, CLIENTS[0])
    wrapper.vm.updateClient()
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('clients/cl1', expect.objectContaining({ firstname: 'Jean' }))
  })
})

describe('client deletion', () => {
  it('asks for a confirmation with the name of the client (as text)', async () => {
    const dialogs = mockDialog()
    vi.spyOn(ClientService, 'deleteClient')
    await mountClients()
    wrapper.vm.confirmDeleteClient({ _id: 'x', firstname: '<img src=x onerror=alert(1)>', lastname: 'Ü' })
    expect(dialogs[0].options.message).toBe('Client «<img src=x onerror=alert(1)> Ü» will be permanently deleted')
    expect(dialogs[0].options.html).toBeFalsy()
    dialogs[0].cancel()
    expect(ClientService.deleteClient).not.toHaveBeenCalled()
  })

  it('deletes the client from the trash button after confirmation', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(ClientService, 'deleteClient').mockImplementation(() => ok('Client deleted'))
    await mountClients()
    const row = wrapper.findAll('tbody tr').find((tr) => tr.text().includes('Smith'))
    await row.findAllComponents(QBtn).find((b) => b.props('icon') === 'fa fa-trash').trigger('click')
    dialogs[0].ok()
    await flushPromises()
    expect(ClientService.deleteClient).toHaveBeenCalledWith('cl3')
    expect(ClientService.getClients).toHaveBeenCalledTimes(2)
    expect(lastNotification(notify)).toMatchObject({ message: 'Client deleted successfully', color: 'positive' })
  })

  it('notifies the error of the deletion', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(ClientService, 'deleteClient').mockRejectedValue(apiError(404, 'Client not found'))
    await mountClients()
    wrapper.vm.confirmDeleteClient(CLIENTS[0])
    dialogs[0].ok()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Client not found', color: 'negative' })
    expect(ClientService.getClients).toHaveBeenCalledTimes(1)
  })
})
