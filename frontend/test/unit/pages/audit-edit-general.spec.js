// pages/audits/edit/general: general information of an audit (loading, save, read-only states, ctrl+s, unsaved
// changes, company / client selection, collaborators / reviewers, dates, scope, custom fields). API services mocked.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import _ from 'lodash'
import { QInput, QSelect, QBtn, QChip, QExpansionItem } from 'quasar'

vi.mock('components/editor', () => import('../../helpers/editor-stub'))
vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import GeneralPage from 'pages/audits/edit/general'
import CustomFields from 'components/custom-fields'
import TextareaArray from 'components/textarea-array'
import AuditService from '@/services/audit'
import ClientService from '@/services/client'
import CompanyService from '@/services/company'
import CollabService from '@/services/collaborator'
import ReviewerService from '@/services/reviewer'
import TemplateService from '@/services/template'
import DataService from '@/services/data'
import UserService from '@/services/user'
import Utils from '@/services/utils'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'
import { installAppGlobals, fakeSocket, settings, route, pressSave, apiError, ok } from '../../helpers/audit-edit'

const S = Utils.AUDIT_VIEW_STATE

const AUTHOR = { _id: 'u1', username: 'author', firstname: 'Ada', lastname: 'Lovelace' }
const BOB = { _id: 'u2', username: 'bob', firstname: 'Bob', lastname: 'Martin' }
const NO_NAME = { _id: 'u3', username: 'noname' }
const CLIENTS = [
  { _id: 'cl1', email: 'jo@acme.com', company: { name: 'ACME' } },
  { _id: 'cl2', email: 'zoé@globex.com', company: { name: 'Globex Été' } },
  { _id: 'cl3', email: 'free@nowhere.com' }
]
const COMPANIES = [{ _id: 'c1', name: 'ACME' }, { _id: 'c2', name: 'Globex Été' }]
const REQUIRED_FIELD = { customField: { _id: 'cf1', label: 'Contract', fieldType: 'input', required: true, size: 12, offset: 0, options: [] }, text: '' }

function generalData(overrides = {}) {
  return {
    _id: 'a1', name: 'Pentest Été', auditType: 'Web', creator: AUTHOR, collaborators: [BOB], reviewers: [],
    client: CLIENTS[0], company: COMPANIES[0], date: '2024-03-01', date_start: '2024-02-01', date_end: '2024-02-15',
    scope: ['10.0.0.0/24', 'app.acme.com'], language: 'en', template: 't1', customFields: [],
    ...overrides
  }
}

let wrapper
let socket
let router

function mockApi({ audit = generalData(), customFields = [] } = {}) {
  vi.spyOn(DataService, 'getCustomFields').mockImplementation(() => ok(customFields))
  if (audit && audit.response) vi.spyOn(AuditService, 'getAuditGeneral').mockRejectedValue(audit)
  else vi.spyOn(AuditService, 'getAuditGeneral').mockImplementation(() => ok(_.cloneDeep(audit)))
  vi.spyOn(TemplateService, 'getTemplates').mockImplementation(() => ok([{ _id: 't1', name: 'Default', ext: 'docx' }, { _id: 't2', name: 'Modèle FR' }]))
  vi.spyOn(DataService, 'getLanguages').mockImplementation(() => ok([{ locale: 'en', language: 'English' }, { locale: 'fr', language: 'Français' }]))
  vi.spyOn(DataService, 'getAuditTypes').mockImplementation(() => ok([{ name: 'Web' }]))
  vi.spyOn(CollabService, 'getCollabs').mockImplementation(() => ok([AUTHOR, BOB, NO_NAME]))
  vi.spyOn(ReviewerService, 'getReviewers').mockImplementation(() => ok([AUTHOR, { _id: 'u4', username: 'rev', firstname: 'Rita', lastname: 'Review' }]))
  vi.spyOn(ClientService, 'getClients').mockImplementation(() => ok(CLIENTS))
  vi.spyOn(CompanyService, 'getCompanies').mockImplementation(() => ok(COMPANIES))
}

async function mountGeneral({ state = S.EDIT, reviews = true, routeName = 'general', ...api } = {}) {
  UserService.user = { id: 'u1', username: 'author', roles: '*' }
  mockApi(api)
  socket = fakeSocket()
  router = { push: vi.fn(() => Promise.resolve()) }
  wrapper = mount(GeneralPage, {
    props: { frontEndAuditState: state, parentState: 'EDIT', parentApprovals: [] },
    global: { mocks: { $route: route(routeName), $router: router, $settings: settings({ reviews }), $socket: socket, $_: _ } }
  })
  await flushPromises()
  return wrapper
}

const vm = () => wrapper.vm
const t = (key) => wrapper.vm.$t(key)
const select = (label) => wrapper.findAllComponents(QSelect).find((s) => s.props('label') === label)
const input = (label) => wrapper.findAllComponents(QInput).find((i) => i.props('label') === label)
const saveButton = () => wrapper.findAllComponents(QBtn).find((button) => button.props('label') === `${t('btn.save')} (ctrl+s)`)
const leave = () => {
  const next = vi.fn()
  GeneralPage.beforeRouteLeave.call(wrapper.vm, { name: 'network' }, { name: 'general' }, next)
  return next
}

beforeAll(() => installAppGlobals())
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
// Unmounts the page (its ctrl+s listener also removed by the test: no listener left to the next tests if it is not)
function unmountPage() {
  if (!wrapper) return
  const listener = wrapper.vm._listener
  wrapper.unmount()
  document.removeEventListener('keydown', listener, false)
  wrapper = null
}

afterEach(() => unmountPage())

describe('general page loading', () => {
  it('loads the audit, its lists and tells the other users which page is open', async () => {
    await mountGeneral()
    expect(DataService.getCustomFields).toHaveBeenCalled()
    expect(AuditService.getAuditGeneral).toHaveBeenCalledWith('a1')
    expect(TemplateService.getTemplates).toHaveBeenCalled()
    expect(DataService.getLanguages).toHaveBeenCalled()
    expect(DataService.getAuditTypes).toHaveBeenCalled()
    expect(socket.emit).toHaveBeenCalledWith('menu', { menu: 'general', room: 'a1' })
    expect(vm().audit.name).toBe('Pentest Été')
    expect(vm().auditOrig).toEqual(vm().audit)
    expect(vm().auditOrig).not.toBe(vm().audit)
  })

  it('offers the collaborators and reviewers except the creator of the audit', async () => {
    await mountGeneral()
    expect(vm().collaborators.map((user) => user._id)).toEqual(['u2', 'u3'])
    expect(vm().reviewers.map((user) => user._id)).toEqual(['u4'])
  })

  it('offers all the users when the creator is unknown', async () => {
    await mountGeneral({ audit: generalData({ creator: {} }) })
    expect(vm().collaborators.map((user) => user._id)).toEqual(['u1', 'u2', 'u3'])
    expect(vm().reviewers.map((user) => user._id)).toEqual(['u1', 'u4'])
  })

  // Creator of the audit null (user deleted: populate gives null)
  it('shows the audit of a deleted creator', async () => {
    await mountGeneral({ audit: generalData({ creator: null }) })
    expect(vm().collaborators.map((user) => user._id)).toEqual(['u1', 'u2', 'u3'])
    expect(input(`${t('name')} *`).props('modelValue')).toBe('Pentest Été')
  })

  it('shows the information of the audit', async () => {
    await mountGeneral()
    expect(wrapper.text()).toContain('Pentest Été (Web)')
    expect(input(`${t('name')} *`).props('modelValue')).toBe('Pentest Été')
    expect(input(t('startDate')).props('modelValue')).toBe('2024-02-01')
    expect(input(t('endDate')).props('modelValue')).toBe('2024-02-15')
    expect(input(t('reportingDate')).props('modelValue')).toBe('2024-03-01')
    expect(wrapper.findComponent(TextareaArray).props('modelValue')).toEqual(['10.0.0.0/24', 'app.acme.com'])
    expect(select(t('language')).props('modelValue')).toBe('en')
    expect(select(t('template')).props('modelValue')).toBe('t1')
    expect(select(t('template')).props('options').map((tpl) => tpl.name)).toEqual(['Default', 'Modèle FR'])
    // Creator shown beside the collaborators
    expect(wrapper.findAllComponents(QChip).map((chip) => chip.text())).toContain('Ada Lovelace')
  })

  it('names the users without first or last name "Undefined User"', async () => {
    await mountGeneral()
    const optionLabel = select(t('collaborators')).props('optionLabel')
    expect(optionLabel(BOB)).toBe('Bob Martin')
    expect(optionLabel(NO_NAME)).toBe('Undefined User')
    expect(optionLabel(null)).toBe('Undefined User')
  })

  it('shows a default title when the audit type is not set', async () => {
    await mountGeneral({ audit: generalData({ auditType: '' }) })
    expect(wrapper.text()).toContain('Pentest Été (Audit Type not set)')
  })

  it('shows the reviewers only when the reviews are enabled', async () => {
    await mountGeneral({ reviews: true })
    expect(select(t('reviewers'))).toBeDefined()
    unmountPage()
    await mountGeneral({ reviews: false })
    expect(select(t('reviewers'))).toBeUndefined()
  })

  it('keeps an empty audit when it cannot be loaded', async () => {
    await mountGeneral({ audit: apiError(404, 'Audit not found') })
    expect(vm().audit.name).toBe('')
    expect(CollabService.getCollabs).not.toHaveBeenCalled()
    expect(ClientService.getClients).not.toHaveBeenCalled()
    expect(saveButton().exists()).toBe(true)
  })

  // Audit of another user: the audit page redirects to the 403 page, the general page must not block it with an
  // "unsaved changes" confirmation, nor show the empty client and company as objects
  it('does not block the redirection when the audit cannot be loaded', async () => {
    const dialogs = mockDialog()
    await mountGeneral({ audit: apiError(403, 'Insufficient Privileges') })
    expect(leave()).toHaveBeenCalled()
    expect(dialogs).toHaveLength(0)
    expect(wrapper.text()).not.toContain('[object Object]')
    expect(saveButton().props('disable')).toBe(true)
  })

  it('keeps empty lists when they cannot be loaded', async () => {
    UserService.user = { id: 'u1', username: 'author', roles: '*' }
    mockApi()
    TemplateService.getTemplates.mockRejectedValue(apiError(500, 'error'))
    DataService.getLanguages.mockRejectedValue(apiError(500, 'error'))
    CompanyService.getCompanies.mockRejectedValue(apiError(500, 'error'))
    wrapper = mount(GeneralPage, {
      props: { frontEndAuditState: S.EDIT },
      global: { mocks: { $route: route('general'), $router: { push: vi.fn() }, $settings: settings(), $socket: fakeSocket(), $_: _ } }
    })
    await flushPromises()
    expect(vm().templates).toEqual([])
    expect(vm().languages).toEqual([])
    expect(vm().companies).toEqual([])
    expect(vm().audit.name).toBe('Pentest Été')
  })
})

describe('general page read-only states', () => {
  it('can be edited in edition', async () => {
    await mountGeneral({ state: S.EDIT })
    expect(saveButton()).toBeDefined()
    expect(wrapper.findAllComponents(QInput).every((i) => i.props('readonly') === false)).toBe(true)
    expect(wrapper.findAllComponents(QSelect).every((s) => s.props('readonly') === false)).toBe(true)
    expect(wrapper.findComponent(TextareaArray).props('readonly')).toBe(false)
  })

  it.each([S.EDIT_READONLY, S.REVIEW, S.REVIEW_EDITOR, S.REVIEW_APPROVED, S.REVIEW_ADMIN, S.REVIEW_ADMIN_APPROVED, S.REVIEW_READONLY, S.APPROVED, S.APPROVED_APPROVED, S.APPROVED_READONLY])(
    'is read only in the state %i', async (state) => {
      await mountGeneral({ state, audit: generalData({ customFields: [REQUIRED_FIELD] }) })
      expect(saveButton()).toBeUndefined()
      expect(wrapper.findAllComponents(QInput).every((i) => i.props('readonly') === true)).toBe(true)
      expect(wrapper.findAllComponents(QSelect).every((s) => s.props('readonly') === true)).toBe(true)
      expect(wrapper.findComponent(TextareaArray).props('readonly')).toBe(true)
      expect(wrapper.findComponent(CustomFields).props('readonly')).toBe(true)
      // Selected users cannot be removed
      expect(wrapper.findAllComponents(QChip).filter((chip) => chip.props('removable'))).toHaveLength(0)
    })

  it('lets the editors remove the collaborators', async () => {
    await mountGeneral()
    const chips = wrapper.findAllComponents(QChip).filter((chip) => chip.props('removable'))
    expect(chips.map((chip) => chip.find('.q-chip__content').text())).toEqual(['Bob Martin'])
  })
})

describe('general page save', () => {
  it('saves the audit and notifies it', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'updateAuditGeneral').mockResolvedValue({})
    await mountGeneral()
    vm().audit.name = '渗透测试 🔒'
    await saveButton().trigger('click')
    await flushPromises()
    expect(AuditService.updateAuditGeneral).toHaveBeenCalledWith('a1', expect.objectContaining({ name: '渗透测试 🔒', scope: ['10.0.0.0/24', 'app.acme.com'] }))
    expect(lastNotification(notify)).toMatchObject({ message: t('msg.auditUpdateOk'), color: 'positive' })
    expect(vm().auditOrig.name).toBe('渗透测试 🔒')
    expect(leave()).toHaveBeenCalled() // Nothing left to save
  })

  it('notifies the error of the server and keeps the changes unsaved', async () => {
    const notify = mockNotify()
    const dialogs = mockDialog()
    vi.spyOn(AuditService, 'updateAuditGeneral').mockRejectedValue(apiError(422, 'Audit name already exists'))
    await mountGeneral()
    vm().audit.name = 'Duplicate'
    vm().updateAuditGeneral()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Audit name already exists', color: 'negative' })
    expect(vm().auditOrig.name).toBe('Pentest Été')
    expect(leave()).not.toHaveBeenCalled()
    expect(dialogs).toHaveLength(1)
  })

  it('requires the required custom fields', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'updateAuditGeneral').mockResolvedValue({})
    await mountGeneral({ audit: generalData({ customFields: [_.cloneDeep(REQUIRED_FIELD)] }) })
    vm().updateAuditGeneral()
    await flushPromises()
    expect(AuditService.updateAuditGeneral).not.toHaveBeenCalled()
    expect(lastNotification(notify)).toMatchObject({ message: t('msg.fieldRequired'), color: 'negative' })
    vm().audit.customFields[0].text = 'Contrat n°42'
    vm().updateAuditGeneral()
    await flushPromises()
    expect(AuditService.updateAuditGeneral).toHaveBeenCalledTimes(1)
  })

  it('shows the custom fields of the audit in its language', async () => {
    await mountGeneral({ audit: generalData({ language: 'fr', customFields: [REQUIRED_FIELD] }) })
    expect(wrapper.findComponent(QExpansionItem).props('label')).toBe(t('customFields'))
    expect(wrapper.findComponent(CustomFields).props()).toMatchObject({ locale: 'fr', readonly: false, commentTarget: { kind: 'general' } })
  })

  it('hides the custom fields section without custom field', async () => {
    await mountGeneral()
    expect(wrapper.findComponent(CustomFields).exists()).toBe(false)
    expect(wrapper.findComponent(QExpansionItem).exists()).toBe(false)
  })

  it('saves with ctrl+s in edition', async () => {
    vi.spyOn(AuditService, 'updateAuditGeneral').mockResolvedValue({})
    mockNotify()
    await mountGeneral()
    const event = pressSave()
    await flushPromises()
    expect(event.defaultPrevented).toBe(true)
    expect(AuditService.updateAuditGeneral).toHaveBeenCalledTimes(1)
  })

  it('saves with cmd+s on Mac', async () => {
    vi.spyOn(AuditService, 'updateAuditGeneral').mockResolvedValue({})
    vi.spyOn(Navigator.prototype, 'platform', 'get').mockReturnValue('MacIntel')
    mockNotify()
    await mountGeneral()
    pressSave({ ctrl: true, meta: false })
    await flushPromises()
    expect(AuditService.updateAuditGeneral).not.toHaveBeenCalled()
    pressSave({ meta: true })
    await flushPromises()
    expect(AuditService.updateAuditGeneral).toHaveBeenCalledTimes(1)
  })

  it.each([[S.EDIT_READONLY, 'general'], [S.REVIEW_EDITOR, 'general'], [S.EDIT, 'network']])(
    'does not save with ctrl+s in the state %i on the page %s', async (state, routeName) => {
      vi.spyOn(AuditService, 'updateAuditGeneral').mockResolvedValue({})
      await mountGeneral({ state, routeName })
      const event = pressSave()
      await flushPromises()
      expect(event.defaultPrevented).toBe(true) // Browser save dialog prevented anyway
      expect(AuditService.updateAuditGeneral).not.toHaveBeenCalled()
    })

  it('ignores the other keys', async () => {
    vi.spyOn(AuditService, 'updateAuditGeneral').mockResolvedValue({})
    await mountGeneral()
    const event = new KeyboardEvent('keydown', { ctrlKey: true, cancelable: true })
    Object.defineProperty(event, 'keyCode', { value: 80 }) // ctrl+p
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(AuditService.updateAuditGeneral).not.toHaveBeenCalled()
  })

  // A listener left by a previous visit would save the stale audit of this visit
  it('stops listening to ctrl+s when unmounted', async () => {
    vi.spyOn(AuditService, 'updateAuditGeneral').mockResolvedValue({})
    mockNotify()
    await mountGeneral()
    const listener = wrapper.vm._listener
    wrapper.unmount()
    wrapper = null
    pressSave()
    document.removeEventListener('keydown', listener, false)
    await flushPromises()
    expect(AuditService.updateAuditGeneral).not.toHaveBeenCalled()
  })
})

describe('general page unsaved changes', () => {
  it('leaves without confirmation when nothing changed', async () => {
    const dialogs = mockDialog()
    await mountGeneral()
    expect(leave()).toHaveBeenCalled()
    expect(dialogs).toHaveLength(0)
  })

  it.each([
    ['name', (audit) => { audit.name = 'Renamed' }],
    ['scope', (audit) => { audit.scope.push('192.168.1.1') }],
    ['date', (audit) => { audit.date_end = '2024-12-31' }],
    ['collaborators', (audit) => { audit.collaborators = [] }]
  ])('asks a confirmation to leave after a change of the %s', async (field, change) => {
    const dialogs = mockDialog()
    await mountGeneral()
    change(vm().audit)
    const next = leave()
    expect(next).not.toHaveBeenCalled()
    expect(dialogs[0].options).toMatchObject({ title: t('msg.thereAreUnsavedChanges'), message: t('msg.doYouWantToLeave') })
    dialogs[0].ok()
    expect(next).toHaveBeenCalled()
  })

  it('stays on the page when the confirmation is cancelled', async () => {
    const dialogs = mockDialog()
    await mountGeneral()
    vm().audit.name = 'Renamed'
    const next = leave()
    dialogs[0].cancel()
    expect(next).not.toHaveBeenCalled()
  })
})

describe('company and client', () => {
  it('offers the clients of the company of the audit', async () => {
    await mountGeneral()
    expect(vm().selectClientsFromCompany.map((client) => client.email)).toEqual(['jo@acme.com'])
    vm().audit.company = COMPANIES[1]
    await flushPromises() // Watcher of the company
    expect(vm().selectClientsFromCompany.map((client) => client.email)).toEqual(['zoé@globex.com'])
  })

  it('offers all the clients without company', async () => {
    await mountGeneral({ audit: generalData({ company: null, client: null }) })
    expect(vm().selectClientsFromCompany.map((client) => client.email)).toEqual(['jo@acme.com', 'zoé@globex.com', 'free@nowhere.com'])
    vm().audit.company = { name: 'Unknown Corp' }
    await flushPromises()
    expect(vm().selectClientsFromCompany).toEqual([])
  })

  it('sets the company of the selected client', async () => {
    await mountGeneral({ audit: generalData({ company: null, client: null }) })
    vm().setCompanyFromClient(CLIENTS[1])
    expect(vm().audit.company).toEqual(COMPANIES[1])
    expect(vm().audit.company).not.toBe(vm().companies[1]) // Copy
  })

  it('keeps the company for a client without company, an unknown company or no client', async () => {
    await mountGeneral()
    vm().setCompanyFromClient(CLIENTS[2])
    vm().setCompanyFromClient({ email: 'x@y.z', company: { name: 'Unknown' } })
    vm().setCompanyFromClient(null)
    expect(vm().audit.company).toEqual(COMPANIES[0])
  })

  // Quasar 2 emits 'update:model-value' (not the '@input' of Quasar 1)
  it('sets the company when a client is chosen in the select', async () => {
    await mountGeneral({ audit: generalData({ company: null, client: null }) })
    select(t('client')).vm.$emit('update:modelValue', CLIENTS[1])
    await flushPromises()
    expect(vm().audit.client).toEqual(CLIENTS[1])
    expect(vm().audit.company).toEqual(COMPANIES[1])
  })

  it('binds the client chosen in the select', async () => {
    await mountGeneral({ audit: generalData({ company: null, client: null }) })
    select(t('client')).vm.$emit('update:modelValue', CLIENTS[1])
    await flushPromises()
    expect(vm().audit.client).toEqual(CLIENTS[1])
  })

  it('uses an existing company for a typed name (case and accent insensitive), a new name otherwise', async () => {
    await mountGeneral()
    const done = vi.fn()
    vm().createSelectCompany('acme', done)
    expect(done).toHaveBeenLastCalledWith(COMPANIES[0], 'add-unique')
    vm().createSelectCompany('GLOBEX ETE', done)
    expect(done).toHaveBeenLastCalledWith(COMPANIES[1], 'add-unique')
    vm().createSelectCompany('Nouvelle Société', done)
    expect(done).toHaveBeenLastCalledWith('Nouvelle Société', 'add-unique')
  })

  it('filters the companies and clients typed in the selects (case and accent insensitive)', async () => {
    await mountGeneral({ audit: generalData({ company: null, client: null }) })
    const update = (fn) => fn()
    vm().filterSelectCompany('globex ete', update)
    expect(vm().selectCompanies.map((company) => company.name)).toEqual(['Globex Été'])
    vm().filterSelectCompany('', update)
    expect(vm().selectCompanies).toHaveLength(2)
    vm().filterSelectCompany('nothing', update)
    expect(vm().selectCompanies).toEqual([])
    vm().filterSelectClient('ZOE', update)
    expect(vm().selectClients.map((client) => client.email)).toEqual(['zoé@globex.com'])
    vm().filterSelectClient('', update)
    expect(vm().selectClients).toHaveLength(3)
  })

  it('clears the client and the company', async () => {
    await mountGeneral()
    const reset = vi.spyOn(vm().$refs.select_client, 'reset')
    vm().clearClient()
    expect(vm().audit.client).toBeNull()
    expect(reset).toHaveBeenCalled()
    vm().clearCompany()
    expect(vm().audit.company).toBeNull()
    expect(vm().audit.name).toBe('Pentest Été')
    await flushPromises()
    expect(vm().selectClientsFromCompany).toHaveLength(3)
  })
})

describe('general page fields', () => {
  it('updates the dates, the name and the scope', async () => {
    await mountGeneral()
    input(t('startDate')).vm.$emit('update:modelValue', '2025-01-06')
    input(`${t('name')} *`).vm.$emit('update:modelValue', 'Audit 2025')
    wrapper.findComponent(TextareaArray).vm.$emit('update:modelValue', ['srv-01', 'srv-02'])
    await flushPromises()
    expect(vm().audit).toMatchObject({ date_start: '2025-01-06', name: 'Audit 2025', scope: ['srv-01', 'srv-02'] })
  })

  it('selects the language and the template by their identifier', async () => {
    await mountGeneral()
    select(t('language')).vm.$emit('update:modelValue', 'fr')
    select(t('template')).vm.$emit('update:modelValue', 't2')
    await flushPromises()
    expect(vm().audit).toMatchObject({ language: 'fr', template: 't2' })
    expect(select(t('language')).props()).toMatchObject({ optionValue: 'locale', optionLabel: 'language', emitValue: true, mapOptions: true })
  })

  it('displays the options of the selects as text (no options-html)', async () => {
    await mountGeneral()
    expect(wrapper.findAllComponents(QSelect).filter((s) => s.props('optionsHtml')).map((s) => s.props('label'))).toEqual([])
    expect(wrapper.findAllComponents(QSelect).filter((s) => s.props('displayValueHtml')).map((s) => s.props('label'))).toEqual([])
  })
})
