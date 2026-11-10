// Hurried user on the lists of the data pages (clients, companies, collaborators, templates): navigation while a
// request is pending, answers in disorder, double submissions, input before the end of a loading, items opened quickly.
// The answers of the API are delayed and given by the test (controlled promises).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import ClientsPage from 'pages/data/clients'
import CompaniesPage from 'pages/data/companies'
import CollaboratorsPage from 'pages/data/collaborators'
import TemplatesPage from 'pages/data/templates'
import ClientService from '@/services/client'
import CompanyService from '@/services/company'
import CollabService from '@/services/collaborator'
import TemplateService from '@/services/template'
import DataService from '@/services/data'
import { resetApi } from '../../helpers/api-mock'
import { mockDialog, mockNotify } from '../../helpers/quasar'
import { mountPage, ok, controlled, trackUnhandledRejections, settle, tableRows, dialog, UploaderStub, waitFileReader, trackFileReads } from '../../helpers/data-pages'

// The four list pages: services, methods and data of each
const PAGES = {
  clients: {
    page: ClientsPage, service: ClientService, list: 'getClients', items: 'clients', current: 'currentClient', clean: 'cleanCurrentClient',
    create: ['createClient', 'createClients'], update: ['updateClient', 'updateClient'], remove: ['confirmDeleteClient', 'deleteClient'],
    rows: [
      { _id: 'a', firstname: 'Ana', lastname: 'Alves', email: 'ana@a.io', company: null },
      { _id: 'b', firstname: 'Bénédicte', lastname: 'Böhm', email: 'bene@b.io', company: { name: 'Globex' } }
    ],
    valid: { firstname: 'New', lastname: 'Client', email: 'new@c.io' },
    edited: 'firstname',
    setup: () => vi.spyOn(CompanyService, 'getCompanies').mockImplementation(() => ok([{ name: 'Globex' }]))
  },
  companies: {
    page: CompaniesPage, service: CompanyService, list: 'getCompanies', items: 'companies', current: 'currentCompany', clean: 'cleanCurrentCompany',
    create: ['createCompany', 'createCompanies'], update: ['updateCompany', 'updateCompany'], remove: ['confirmDeleteCompany', 'deleteCompany'],
    rows: [{ _id: 'a', name: 'ACME', city: 'Paris' }, { _id: 'b', name: 'Société B', city: 'Lyon', logo: 'data:image/png;base64,QkI=' }],
    valid: { name: 'Initech' },
    edited: 'name',
    setup: () => {}
  },
  collaborators: {
    page: CollaboratorsPage, service: CollabService, list: 'getCollabs', items: 'collabs', current: 'currentCollab', clean: 'cleanCurrentCollab',
    create: ['createCollab', 'createCollab'], update: ['updateCollab', 'updateCollab'], remove: null,
    rows: [
      { _id: 'a', username: 'ana', firstname: 'Ana', lastname: 'Alves', role: 'user', enabled: true },
      { _id: 'b', username: 'bob', firstname: 'Bob', lastname: 'Brown', role: 'admin', enabled: true }
    ],
    valid: { username: 'new', firstname: 'New', lastname: 'User', password: 'Str0ngPassword' },
    edited: 'lastname',
    setup: () => vi.spyOn(DataService, 'getRoles').mockImplementation(() => ok(['user', 'admin']))
  },
  templates: {
    page: TemplatesPage, service: TemplateService, list: 'getTemplates', items: 'templates', current: 'currentTemplate', clean: 'cleanCurrentTemplate',
    create: ['createTemplate', 'createTemplate'], update: ['updateTemplate', 'updateTemplate'], remove: ['confirmDeleteTemplate', 'deleteTemplate'],
    rows: [{ _id: 'a', name: 'Alpha', ext: 'docx' }, { _id: 'b', name: 'Bêta', ext: 'pptx' }],
    valid: { name: 'Nouveau', file: 'UEs=', ext: 'docx' },
    edited: 'name',
    setup: () => {}
  }
}
const ALL = Object.keys(PAGES)
const WITH_DELETION = ALL.filter((name) => PAGES[name].remove)

let wrapper
let notify
let errors
let fileReadsDone

// Mounts the page with its list answered by the test (loads[0]: loading of the page)
async function mountHurried(name) {
  const config = PAGES[name]
  config.setup()
  const loads = controlled(config.service, config.list)
  wrapper = await mountPage(config.page)
  return { config, loads, vm: wrapper.vm }
}

// Mounts the page with its list loaded
async function mountLoaded(name) {
  const context = await mountHurried(name)
  await context.loads[0].resolve(context.config.rows)
  return context
}

function unmount() {
  wrapper.unmount()
  wrapper = null
}

beforeEach(() => {
  resetApi()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  notify = mockNotify()
  fileReadsDone = trackFileReads()
  errors = trackUnhandledRejections()
})
afterEach(() => {
  errors.stop()
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('navigation while a request is pending', () => {
  it.each(ALL)('%s: the list answered after leaving the page changes nothing and throws nothing', async (name) => {
    const { config, loads } = await mountHurried(name)
    unmount()
    await loads[0].resolve(config.rows)
    await settle()
    expect(errors).toEqual([])
    expect(notify).not.toHaveBeenCalled()
  })

  it.each(ALL)('%s: the list failing after leaving the page throws nothing', async (name) => {
    const { loads } = await mountHurried(name)
    unmount()
    await loads[0].reject(500, 'Internal error')
    await settle()
    expect(errors).toEqual([])
    expect(notify).not.toHaveBeenCalled()
  })

  it.each(WITH_DELETION)('%s: a deletion answered after leaving the page throws nothing', async (name) => {
    const dialogs = mockDialog()
    const { config, vm } = await mountLoaded(name)
    const deletions = controlled(config.service, config.remove[1])
    vm[config.remove[0]](config.rows[0])
    dialogs[0].ok()
    unmount()
    await deletions[0].resolve('deleted')
    await settle()
    expect(errors).toEqual([])
    expect(notify).toHaveBeenCalledTimes(1) // The deletion was done: success notified
    expect(notify.mock.calls[0][0].color).toBe('positive')
  })

  it.each(ALL)('%s: a creation refused after leaving the page is notified without exception', async (name) => {
    const { config, vm } = await mountLoaded(name)
    const creations = controlled(config.service, config.create[1])
    Object.assign(vm[config.current], config.valid)
    vm[config.create[0]]()
    unmount()
    await creations[0].reject(422, 'Already exists')
    await settle()
    expect(errors).toEqual([])
    expect(notify.mock.calls.at(-1)[0].color).toBe('negative')
  })

  it.each(ALL.flatMap((name) => [[name, 'create'], [name, 'update']]))('%s: a %s answered after leaving the page throws nothing and is notified', async (name, action) => {
    const { config, vm } = await mountLoaded(name)
    const requests = controlled(config.service, config[action][1])
    if (action === 'update') vm.dblClick(null, config.rows[0])
    Object.assign(vm[config.current], config.valid)
    vm[config[action][0]]()
    unmount()
    await requests[0].resolve('ok')
    await settle()
    expect(errors).toEqual([])
    expect(notify.mock.calls.at(-1)[0].color).toBe('positive')
  })
})

describe('answers in disorder', () => {
  it.each(ALL)('%s: the list displayed is the answer of the last loading', async (name) => {
    const { config, loads, vm } = await mountHurried(name)
    vm[config.list]() // Refresh (after a creation, a deletion...)
    const latest = [...config.rows, { ...config.rows[0], _id: 'c' }]
    await loads[1].resolve(latest)
    await loads[0].resolve(config.rows.slice(0, 1)) // Stale answer of the first loading
    expect(vm[config.items].map((item) => item._id)).toEqual(['a', 'b', 'c'])
  })

  it.each(ALL)('%s: the list answered in order is displayed', async (name) => {
    const { config, loads, vm } = await mountHurried(name)
    vm[config.list]()
    await loads[0].resolve(config.rows.slice(0, 1))
    await loads[1].resolve(config.rows)
    expect(vm[config.items].map((item) => item._id)).toEqual(['a', 'b'])
    expect(vm.loading).toBe(false)
  })

  it('filters the table with the last search typed quickly', async () => {
    await mountLoaded('clients')
    const search = wrapper.findAll('tbody tr').find((row) => row.find('input').exists()).findAll('input')[0]
    for (const value of ['B', 'Bé', 'Bén', 'A', 'An'])
      search.setValue(value) // Not awaited: typed faster than the rendering
    await flushPromises()
    expect(wrapper.vm.search.firstname).toBe('An')
    expect(tableRows(wrapper).map((row) => row[0])).toEqual(['Ana'])
  })
})

describe('double submission', () => {
  it.each(ALL)('%s: a double click on "Create" sends one request', async (name) => {
    const { config, vm } = await mountLoaded(name)
    const creations = controlled(config.service, config.create[1])
    vm.$refs.createModal.show()
    Object.assign(vm[config.current], config.valid)
    vm[config.create[0]]()
    vm[config.create[0]]()
    expect(creations).toHaveLength(1)
  })

  it.each(ALL)('%s: "Create" sends the request again after a refusal', async (name) => {
    const { config, vm } = await mountLoaded(name)
    const creations = controlled(config.service, config.create[1])
    vm.$refs.createModal.show()
    Object.assign(vm[config.current], config.valid)
    vm[config.create[0]]()
    await creations[0].reject(422, 'Already exists')
    vm[config.create[0]]()
    expect(creations).toHaveLength(2)
  })

  it.each(WITH_DELETION)('%s: a deletion refused can be confirmed again', async (name) => {
    const dialogs = mockDialog()
    const { config, vm } = await mountLoaded(name)
    const deletions = controlled(config.service, config.remove[1])
    vm[config.remove[0]](config.rows[0])
    dialogs[0].ok()
    await deletions[0].reject(403, 'Insufficient privileges')
    vm[config.remove[0]](config.rows[0])
    dialogs[1].ok()
    expect(deletions).toHaveLength(2)
  })

  it.each(ALL)('%s: after a double click on "Create" the dialog is closed and the list is the one of the server', async (name) => {
    const { config, loads, vm } = await mountLoaded(name)
    const creations = controlled(config.service, config.create[1])
    vm.$refs.createModal.show()
    Object.assign(vm[config.current], config.valid)
    vm[config.create[0]]()
    vm[config.create[0]]()
    expect(creations).toHaveLength(1) // Second click ignored while the creation is pending
    await creations[0].resolve('created')
    expect(dialog(wrapper, 'createModal').open).toBe(false)
    expect(loads).toHaveLength(2) // One refresh (successful creation)
    await loads[1].resolve([...config.rows, { _id: 'new', ...config.valid }])
    expect(vm[config.items].map((item) => item._id)).toEqual(['a', 'b', 'new']) // No duplicate displayed
    expect(errors).toEqual([])
  })

  it.each(WITH_DELETION)('%s: a deletion confirmed twice sends one request', async (name) => {
    const dialogs = mockDialog()
    const { config, vm } = await mountLoaded(name)
    const deletions = controlled(config.service, config.remove[1])
    vm[config.remove[0]](config.rows[0])
    vm[config.remove[0]](config.rows[0])
    dialogs.forEach((confirmation) => confirmation.ok())
    expect(deletions).toHaveLength(1)
  })
})

describe('input before the end of a loading', () => {
  it.each(ALL)('%s: the values typed in the edition dialog are kept when a refresh of the list arrives', async (name) => {
    const { config, loads, vm } = await mountLoaded(name)
    vm.dblClick(null, config.rows[0])
    vm[config.list]()
    vm[config.current][config.edited] = 'Saisie rapide ✓'
    await loads[1].resolve(config.rows.map((row) => ({ ...row, [config.edited]: `Server ${row._id}` })))
    expect(vm[config.current][config.edited]).toBe('Saisie rapide ✓')
    expect(dialog(wrapper, 'editModal').open).toBe(true)
    const updates = controlled(config.service, config.update[1])
    vm[config.update[0]]()
    expect(updates[0].args[0]).toBe('a')
    expect(updates[0].args[1][config.edited]).toBe('Saisie rapide ✓')
  })

  it('collaborators: the user typed in the creation dialog is kept when the roles arrive late', async () => {
    const roles = controlled(DataService, 'getRoles')
    const loads = controlled(CollabService, 'getCollabs')
    wrapper = await mountPage(CollaboratorsPage)
    wrapper.vm.cleanCurrentCollab()
    wrapper.vm.$refs.createModal.show()
    Object.assign(wrapper.vm.currentCollab, PAGES.collaborators.valid)
    await roles[0].resolve(['user', 'admin'])
    await loads[0].resolve(PAGES.collaborators.rows)
    expect(wrapper.vm.currentCollab).toMatchObject({ ...PAGES.collaborators.valid, role: 'user' })
    expect(dialog(wrapper, 'createModal').open).toBe(true)
  })
})

describe('items opened quickly', () => {
  it.each(ALL)('%s: an update answered after another item was opened does not close its dialog', async (name) => {
    const { config, vm } = await mountLoaded(name)
    const updates = controlled(config.service, config.update[1])
    vm.dblClick(null, config.rows[0])
    vm[config.update[0]]()
    vm.$refs.editModal.hide() // Closed without waiting for the answer
    vm.dblClick(null, config.rows[1])
    await updates[0].resolve('ok')
    expect(dialog(wrapper, 'editModal').open).toBe(true)
    expect(vm[config.current][config.edited]).toBe(config.rows[1][config.edited])
    expect(notify.mock.calls.at(-1)[0].color).toBe('positive')
  })

  it.each(ALL)('%s: a creation answered after the dialog was opened again does not close it', async (name) => {
    const { config, vm } = await mountLoaded(name)
    const creations = controlled(config.service, config.create[1])
    vm[config.clean]()
    vm.$refs.createModal.show()
    Object.assign(vm[config.current], config.valid)
    vm[config.create[0]]()
    vm.$refs.createModal.hide() // Closed without waiting for the answer, then opened again for another item
    vm[config.clean]()
    vm.$refs.createModal.show()
    vm[config.current][config.edited] = 'Saisie en cours'
    await creations[0].resolve('created')
    expect(dialog(wrapper, 'createModal').open).toBe(true)
    expect(vm[config.current][config.edited]).toBe('Saisie en cours')
  })

  it.each(ALL)('%s: the dialog shows and saves the last item opened', async (name) => {
    const { config, vm } = await mountLoaded(name)
    const rows = wrapper.findAll('tbody tr').filter((row) => !row.find('input').exists())
    await rows.find((row) => row.text().includes(config.rows[0][config.edited])).trigger('dblclick')
    await rows.find((row) => row.text().includes(config.rows[1][config.edited])).trigger('dblclick')
    expect(dialog(wrapper, 'editModal').open).toBe(true)
    expect(vm[config.current][config.edited]).toBe(config.rows[1][config.edited])
    const updates = controlled(config.service, config.update[1])
    vm[config.update[0]]()
    expect(updates).toHaveLength(1)
    expect(updates[0].args[0]).toBe('b')
  })

  it('companies: the edition of a company does not keep the logo of the previous one', async () => {
    const { vm } = await mountLoaded('companies')
    vm.dblClick(null, PAGES.companies.rows[1])
    vm.dblClick(null, PAGES.companies.rows[0])
    expect(vm.currentCompany.logo).toBe('')
  })

  it('companies: a logo added to a company is not written in the company opened just after', async () => {
    const { vm } = await mountLoaded('companies')
    vm.dblClick(null, PAGES.companies.rows[0])
    await flushPromises()
    wrapper.findComponent(UploaderStub).vm.$emit('added', [new File(['logo A'], 'a.png', { type: 'image/png' })])
    vm.$refs.editModal.hide()
    vm.dblClick(null, PAGES.companies.rows[1])
    await fileReadsDone() // End of the reading of the logo
    expect(vm.currentCompany.logo).toBe(PAGES.companies.rows[1].logo)
  })

  it('templates: a file chosen for a template is not written in the template opened just after', async () => {
    const { vm } = await mountLoaded('templates')
    vm.dblClick(null, PAGES.templates.rows[0])
    await flushPromises()
    wrapper.findComponent(UploaderStub).vm.$emit('added', [new File(['file A'], 'a.docx')])
    vm.$refs.editModal.hide()
    vm.dblClick(null, PAGES.templates.rows[1])
    await fileReadsDone() // End of the reading of the file
    expect(vm.currentTemplate.file).toBe('')
  })

  it('templates: the file read is kept when the dialog stays open', async () => {
    const { vm } = await mountLoaded('templates')
    vm.dblClick(null, PAGES.templates.rows[0])
    await flushPromises()
    wrapper.findComponent(UploaderStub).vm.$emit('added', [new File(['file A'], 'a.docx')])
    await waitFileReader(() => vm.currentTemplate.file)
    expect(vm.currentTemplate).toEqual({ name: 'Alpha', file: btoa('file A'), ext: 'docx' })
  })
})
