// Hurried user on the audit edit pages (index.vue, general, findings add / edit, network, sections): answers of the
// API delayed and resolved by the test (in any order), navigation and double clicks while requests are pending,
// typing before the end of the loading, save followed by a navigation.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import _ from 'lodash'
import { QLayout, QInput, QSelect, QBtn, QChip } from 'quasar'

vi.mock('components/editor', () => import('../../helpers/editor-stub'))
vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))
vi.mock('@/boot/socketio', () => ({ connectSocket: vi.fn(), disconnectSocket: vi.fn(), socket: {} }))

import EditPage from 'pages/audits/edit'
import GeneralPage from 'pages/audits/edit/general'
import AddPage from 'pages/audits/edit/findings/add'
import EditFinding from 'pages/audits/edit/findings/edit'
import NetworkPage from 'pages/audits/edit/network'
import SectionPage from 'pages/audits/edit/sections'
import EditorStub from '../../helpers/editor-stub'
import AuditService from '@/services/audit'
import DataService from '@/services/data'
import VulnService from '@/services/vulnerability'
import ClientService from '@/services/client'
import CompanyService from '@/services/company'
import CollabService from '@/services/collaborator'
import ReviewerService from '@/services/reviewer'
import TemplateService from '@/services/template'
import UserService from '@/services/user'
import Utils from '@/services/utils'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'
import { installAppGlobals, fakeSocket, settings, route, pressSave, apiError, ok, controlled } from '../../helpers/audit-edit'

const S = Utils.AUDIT_VIEW_STATE
const ChildPage = { name: 'ChildPage', props: ['frontEndAuditState', 'parentState', 'parentApprovals', 'audit'], template: '<div class="child-page" />' }
const ProposalReviewStub = { name: 'ProposalReview', emits: ['changed'], methods: { open() {} }, template: '<div />' }

let wrapper
let socket
let dialogs
let notify

beforeAll(() => {
  installAppGlobals()
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function () {} // Quasar tables (jsdom)
})
beforeEach(() => {
  UserService.user = { id: 'u-author', username: 'author', roles: ['audits:read', 'audits:update'] }
  socket = fakeSocket()
  dialogs = mockDialog()
  notify = mockNotify()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  if (wrapper) {
    // Ctrl+s listener of the page also removed by the test: no listener left to the next tests if the page leaves it
    const page = [GeneralPage, NetworkPage, SectionPage].map((c) => wrapper.findComponent(c)).find((c) => c.exists())
    const listener = page && page.vm._listener
    wrapper.unmount()
    if (listener) document.removeEventListener('keydown', listener, false)
  }
  wrapper = null
  document.body.innerHTML = ''
})

// Route guard of a page: {next, dialog shown}
function leave(component, vm) {
  const next = vi.fn()
  const before = dialogs.length
  component.beforeRouteLeave.call(vm, { name: 'other', params: {} }, { name: 'current', params: {} }, next)
  return { next, dialog: dialogs[before] }
}

const pageMocks = (routeName, params = {}) => ({
  $route: route(routeName, params), $router: { push: vi.fn(() => Promise.resolve()) }, $socket: socket, $_: _,
  $settings: settings({ report: { cvssColors: {}, extendCvssTemporalEnvironment: false } })
})

// ------------------------------------------------------------------------------------------------------------------
// Audit edit page (index.vue)
// ------------------------------------------------------------------------------------------------------------------

const AUDIT = {
  _id: 'a1', name: 'Pentest', auditType: 'Web', language: 'en', state: 'EDIT',
  creator: { _id: 'u-author', username: 'author' }, collaborators: [], reviewers: [{ _id: 'u-reviewer' }], approvals: [],
  findings: [{ _id: 'f1', title: 'A', cvssv3: '', category: 'Web' }], sections: [], sortFindings: []
}

describe('audit edit page with delayed answers', () => {
  let router
  let audits

  async function mountEdit() {
    vi.spyOn(DataService, 'getCustomFields').mockImplementation(() => ok([]))
    vi.spyOn(DataService, 'getAuditTypes').mockImplementation(() => ok([]))
    vi.spyOn(DataService, 'getVulnerabilityCategories').mockImplementation(() => ok([]))
    vi.spyOn(DataService, 'getSections').mockImplementation(() => ok([]))
    vi.spyOn(AuditService, 'getComments').mockImplementation(() => ok([]))
    audits = controlled(AuditService, 'getAudit')
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/audits', component: ChildPage },
        { path: '/audits/:auditId', component: EditPage, children: [{ path: 'general', name: 'general', component: ChildPage }] }
      ]
    })
    router.push('/audits/a1/general')
    await router.isReady()
    wrapper = mount({ components: { QLayout }, template: '<q-layout><router-view /></q-layout>' }, {
      global: { plugins: [router], mocks: { $settings: settings(), $socket: socket }, stubs: { CommentsPanel: true } }
    })
    await flushPromises()
  }

  const vm = () => wrapper.findComponent(EditPage).vm

  async function loaded(audit = AUDIT) {
    await mountEdit()
    audits[0].resolve(_.cloneDeep(audit))
    await flushPromises()
  }

  it('does not throw when the audit arrives after the user left it', async () => {
    await mountEdit()
    await router.push('/audits')
    audits[0].resolve(_.cloneDeep(AUDIT))
    await flushPromises()
    expect(wrapper.findComponent(EditPage).exists()).toBe(false)
  })

  // Audit left before it is loaded: its late answer must not join the room nor register listeners on the global socket
  it('does not join the room of the audit when it arrives after the user left it', async () => {
    await mountEdit()
    await router.push('/audits')
    audits[0].resolve(_.cloneDeep(AUDIT))
    await flushPromises()
    expect(socket.emit).not.toHaveBeenCalledWith('join', expect.anything())
    expect(Object.keys(socket.handlers)).toEqual([])
  })

  it('removes its listeners when left during a reload of the audit, without joining the room again', async () => {
    await loaded()
    socket.trigger('updateAudit')
    await flushPromises()
    await router.push('/audits')
    expect(socket.emit).toHaveBeenLastCalledWith('leave', { username: 'author', room: 'a1' })
    audits[1].resolve(_.cloneDeep(AUDIT))
    await flushPromises()
    expect(socket.emit.mock.calls.filter(([event]) => event === 'join')).toHaveLength(1)
    expect(Object.keys(socket.handlers)).toEqual([])
  })

  it('shows the last version of the audit when the reloads are answered in order', async () => {
    await loaded()
    socket.trigger('updateAudit')
    socket.trigger('updateAudit')
    await flushPromises()
    audits[1].resolve({ ...AUDIT, findings: [] })
    audits[2].resolve({ ...AUDIT, findings: [...AUDIT.findings, { _id: 'f2', title: 'B', cvssv3: '' }] })
    await flushPromises()
    expect(vm().audit.findings.map((f) => f._id)).toEqual(['f1', 'f2'])
  })

  // Reloads of the audit (socket 'updateAudit', moves of the findings): an older answer arriving last must not replace
  // the menu with an outdated audit
  it('shows the last version of the audit when the reloads are answered out of order', async () => {
    await loaded()
    socket.trigger('updateAudit')
    socket.trigger('updateAudit')
    await flushPromises()
    audits[2].resolve({ ...AUDIT, findings: [...AUDIT.findings, { _id: 'f2', title: 'B', cvssv3: '' }] })
    await flushPromises()
    audits[1].resolve({ ...AUDIT, findings: [] }) // Older version
    await flushPromises()
    expect(vm().audit.findings.map((f) => f._id)).toEqual(['f1', 'f2'])
  })

  it('updates the state once when the review is asked once', async () => {
    await loaded()
    const requests = controlled(AuditService, 'updateReadyForReview')
    vm().toggleAskReview()
    requests[0].resolve('ok')
    await flushPromises()
    expect(vm().audit.state).toBe('REVIEW')
    expect(vm().frontEndAuditState).toBe(S.REVIEW_EDITOR)
  })

  // A double click on "Submit review" sends {state: 'REVIEW'} twice: the page must not go back to EDIT at the second
  // answer (editable, "Submit review" shown again while the server is in review)
  it('stays in review after a double click on "Submit review"', async () => {
    await loaded()
    const requests = controlled(AuditService, 'updateReadyForReview')
    vm().toggleAskReview()
    vm().toggleAskReview()
    requests.forEach((request) => request.resolve('ok'))
    await flushPromises()
    expect(requests.map((request) => request.args[1])).toEqual(expect.arrayContaining([{ state: 'REVIEW' }]))
    expect(vm().audit.state).toBe('REVIEW')
    expect(vm().frontEndAuditState).toBe(S.REVIEW_EDITOR)
  })

  // A second request sent while the first one is pending would remove the approval (toggle)
  it('sends one approval request for a double click on "Approve"', async () => {
    UserService.user = { id: 'u-reviewer', username: 'reviewer', roles: ['audits:read', 'audits:review'] }
    await loaded({ ...AUDIT, state: 'REVIEW' })
    expect(vm().frontEndAuditState).toBe(S.REVIEW)
    const requests = controlled(AuditService, 'toggleApproval')
    const approve = wrapper.findAllComponents(QBtn).find((button) => button.props('label') === vm().$t('btn.topButtonSection.approve'))
    await approve.trigger('click')
    await approve.trigger('click')
    expect(requests).toHaveLength(1)
    expect(requests[0].args).toEqual(['a1', { approved: true }])
  })

  it('generates the report once for a double click', async () => {
    await loaded()
    const reports = controlled(AuditService, 'generateAuditReport')
    vm().generateReport()
    vm().generateReport()
    expect(reports).toHaveLength(1)
    reports[0].reject(new Error('Network Error'))
    await flushPromises()
    vm().generateReport() // Possible again once answered
    expect(reports).toHaveLength(2)
  })

  // Generation answered before the second click of the double click (120 ms apart): not generated again
  it('ignores the second click of a double click on the report button, even when the first one is answered', async () => {
    await loaded()
    const reports = controlled(AuditService, 'generateAuditReport')
    const button = wrapper.findAllComponents(QBtn).find((b) => b.find('.fa-download').exists())
    button.vm.$emit('click', new MouseEvent('click', { detail: 1 }))
    reports[0].reject(new Error('Network Error'))
    await flushPromises()
    button.vm.$emit('click', new MouseEvent('click', { detail: 2 }))
    expect(reports).toHaveLength(1)
    button.vm.$emit('click', new MouseEvent('click', { detail: 1 })) // New click later: generated again
    expect(reports).toHaveLength(2)
  })

  it('notifies the answer of a review request arriving after the user left the audit', async () => {
    await loaded()
    const requests = controlled(AuditService, 'updateReadyForReview')
    vm().toggleAskReview()
    const page = vm()
    await router.push('/audits')
    requests[0].resolve('ok')
    await flushPromises()
    expect(page.audit.state).toBe('REVIEW')
    expect(lastNotification(notify)).toMatchObject({ message: page.$t('msg.auditReviewUpdateOk'), color: 'positive' })
  })
})

// ------------------------------------------------------------------------------------------------------------------
// General page
// ------------------------------------------------------------------------------------------------------------------

const GENERAL = {
  _id: 'a1', name: 'Pentest Été', auditType: 'Web', creator: { _id: 'u1', firstname: 'Ada', lastname: 'L' }, collaborators: [], reviewers: [],
  client: null, company: null, date: '', date_start: '', date_end: '', scope: ['10.0.0.0/24'], language: 'fr', template: '', customFields: []
}

describe('general page with delayed answers', () => {
  let loads
  let saves

  async function mountGeneral() {
    vi.spyOn(DataService, 'getCustomFields').mockImplementation(() => ok([]))
    loads = controlled(AuditService, 'getAuditGeneral')
    saves = controlled(AuditService, 'updateAuditGeneral')
    for (const [service, method] of [[TemplateService, 'getTemplates'], [DataService, 'getLanguages'], [DataService, 'getAuditTypes'], [CollabService, 'getCollabs'], [ReviewerService, 'getReviewers'], [ClientService, 'getClients'], [CompanyService, 'getCompanies']])
      vi.spyOn(service, method).mockImplementation(() => ok([]))
    wrapper = mount(GeneralPage, { props: { frontEndAuditState: S.EDIT, parentState: 'EDIT' }, global: { mocks: pageMocks('general') } })
    await flushPromises()
  }

  const vm = () => wrapper.vm
  const nameInput = () => wrapper.findAllComponents(QInput).find((input) => input.props('label') === `${vm().$t('name')} *`)

  async function loaded() {
    await mountGeneral()
    loads[0].resolve(_.cloneDeep(GENERAL))
    await flushPromises()
  }

  async function save() {
    vm().updateAuditGeneral()
    await flushPromises() // Save sent after nextTick
  }

  // The late answer of the audit would replace what the user typed meanwhile
  it('keeps what the user typed before the audit was loaded (or does not let him type)', async () => {
    await mountGeneral()
    const readonlyBeforeLoad = nameInput().props('readonly')
    nameInput().vm.$emit('update:modelValue', 'Nom saisi')
    loads[0].resolve(_.cloneDeep(GENERAL))
    await flushPromises()
    expect(readonlyBeforeLoad || vm().audit.name === 'Nom saisi').toBe(true)
    expect(nameInput().props('readonly')).toBe(false) // Editable once loaded
  })

  it('does not save the empty audit of the page before the audit is loaded', async () => {
    await mountGeneral()
    expect(saveButton(wrapper).props('disable')).toBe(true)
    pressSave()
    vm().updateAuditGeneral()
    await flushPromises()
    expect(saves).toHaveLength(0)
  })

  it('does not throw when the audit arrives after the user left the page', async () => {
    await mountGeneral()
    const page = vm()
    const listener = page._listener
    wrapper.unmount()
    wrapper = null
    document.removeEventListener('keydown', listener, false)
    loads[0].resolve(_.cloneDeep(GENERAL))
    await flushPromises()
    expect(page.audit.name).toBe('Pentest Été')
  })

  it('keeps a coherent state after a double click on save', async () => {
    await loaded()
    vm().audit.name = 'Renommé'
    await saveButton(wrapper).trigger('click')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(saves).toHaveLength(2)
    expect(saves.map((s) => s.sent[1].name)).toEqual(['Renommé', 'Renommé'])
    saves.forEach((s) => s.resolve('ok'))
    await flushPromises()
    expect(leave(GeneralPage, vm()).next).toHaveBeenCalled()
    expect(notify.mock.calls.filter(([options]) => options.color === 'negative')).toHaveLength(0)
  })

  it('does not lose a save confirmed before leaving the page', async () => {
    await loaded()
    vm().audit.name = 'Renommé'
    await save()
    const page = vm()
    const { next, dialog } = leave(GeneralPage, page)
    if (dialog) dialog.ok()
    expect(next).toHaveBeenCalled()
    saves[0].resolve('ok')
    await flushPromises()
    expect(saves[0].sent).toEqual(['a1', expect.objectContaining({ name: 'Renommé' })])
    expect(lastNotification(notify)).toMatchObject({ message: page.$t('msg.auditUpdateOk'), color: 'positive' })
  })

  it('notifies a save failing after the user left the page', async () => {
    await loaded()
    vm().audit.name = 'Renommé'
    await save()
    const { next, dialog } = leave(GeneralPage, vm())
    if (dialog) dialog.ok()
    expect(next).toHaveBeenCalled()
    saves[0].reject(apiError(500, 'Internal error'))
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Internal error', color: 'negative' })
  })

  // Leaving right after a click on save (or ctrl+s): the changes being saved are not "unsaved changes"
  it('does not warn about unsaved changes while they are being saved', async () => {
    await loaded()
    vm().audit.name = 'Renommé'
    await save()
    const { next, dialog } = leave(GeneralPage, vm())
    saves[0].resolve('ok')
    await flushPromises()
    expect(dialog).toBeUndefined()
    expect(next).toHaveBeenCalled()
  })

  // At the answer of a save, the saved version is the data sent: what was typed while the save was pending stays unsaved
  it('keeps the changes typed during a save as unsaved', async () => {
    await loaded()
    vm().audit.name = 'Version envoyée'
    await save()
    vm().audit.name = 'Saisie pendant la sauvegarde'
    saves[0].resolve('ok')
    await flushPromises()
    const { next, dialog } = leave(GeneralPage, vm())
    expect(next).not.toHaveBeenCalled()
    expect(dialog).toBeDefined()
  })

  // The older save answered last is not the saved version: no false "unsaved changes"
  it('keeps the last version sent as saved when two saves are answered out of order', async () => {
    await loaded()
    vm().audit.name = 'Première'
    await save()
    vm().audit.name = 'Seconde'
    await save()
    saves[1].resolve('ok')
    await flushPromises()
    saves[0].resolve('ok')
    await flushPromises()
    expect(vm().auditOrig.name).toBe('Seconde')
    const { next, dialog } = leave(GeneralPage, vm())
    expect(dialog).toBeUndefined()
    expect(next).toHaveBeenCalled()
  })

  it('saves with ctrl+s the data typed so far', async () => {
    await loaded()
    vm().audit.name = 'Avant ctrl+s'
    pressSave()
    await flushPromises()
    expect(saves[0].sent[1].name).toBe('Avant ctrl+s')
  })
})

function saveButton(w) {
  return w.findAllComponents(QBtn).find((button) => /\(ctrl\+s\)$/.test(button.props('label') || ''))
}

// ------------------------------------------------------------------------------------------------------------------
// Findings: add page
// ------------------------------------------------------------------------------------------------------------------

const vuln = (id, title, locale) => ({ _id: id, cvssv3: '', category: 'Web', detail: { locale, title, vulnType: 'Web', description: '', references: [], customFields: [] } })

describe('add findings page with delayed answers', () => {
  let vulns

  async function mountAdd() {
    vi.spyOn(DataService, 'getLanguages').mockImplementation(() => ok([{ locale: 'en', language: 'English' }, { locale: 'fr', language: 'Français' }]))
    vi.spyOn(AuditService, 'getAudit').mockImplementation(() => ok({ _id: 'a1', language: 'fr' }))
    vi.spyOn(DataService, 'getVulnerabilityCategories').mockImplementation(() => ok([]))
    vulns = controlled(VulnService, 'getVulnByLanguage')
    wrapper = mount(AddPage, { props: { frontEndAuditState: S.EDIT }, global: { mocks: pageMocks('addFindings') } })
    await flushPromises()
  }

  const vm = () => wrapper.vm

  it('shows the vulnerabilities of the last language chosen when answered in order', async () => {
    await mountAdd()
    vulns[0].resolve([vuln('v1', 'Injection SQL', 'fr')])
    vm().dtLanguage = 'en'
    vm().getVulnerabilities()
    vulns[1].resolve([vuln('v2', 'SQL injection', 'en')])
    await flushPromises()
    expect(vm().vulnerabilities.map((v) => v.detail.title)).toEqual(['SQL injection'])
    expect(vm().loading).toBe(false)
  })

  // Language changed quickly: the answer of the previous language arriving last must not be shown under the language
  // selected (and added to the audit in this language)
  it('shows the vulnerabilities of the last language chosen when answered out of order', async () => {
    await mountAdd()
    expect(vulns[0].args).toEqual(['fr'])
    vm().dtLanguage = 'en'
    vm().getVulnerabilities()
    vulns[1].resolve([vuln('v2', 'SQL injection', 'en')])
    await flushPromises()
    vulns[0].resolve([vuln('v1', 'Injection SQL', 'fr')]) // Previous language, late
    await flushPromises()
    expect(vm().dtLanguage).toBe('en')
    expect(vm().vulnerabilities.map((v) => v.detail.title)).toEqual(['SQL injection'])
  })

  it('does not throw when the vulnerabilities arrive after the user left the page', async () => {
    await mountAdd()
    const page = vm()
    wrapper.unmount()
    wrapper = null
    vulns[0].resolve([vuln('v1', 'Injection SQL', 'fr')])
    await flushPromises()
    expect(page.vulnerabilities).toHaveLength(1)
  })

  // A second request sent while the first one is pending would add the vulnerability twice to the audit
  it('adds a vulnerability of the database once for a double click', async () => {
    await mountAdd()
    vulns[0].resolve([vuln('v1', 'Injection SQL', 'fr'), vuln('v2', 'XSS', 'fr')])
    await flushPromises()
    const creations = controlled(AuditService, 'createFinding')
    const add = wrapper.findAllComponents(QBtn).find((button) => button.props('icon') === 'fa fa-plus-circle')
    await add.trigger('click')
    await add.trigger('click')
    expect(creations).toHaveLength(1)
    vm().addFindingFromVuln(vm().vulnerabilities[1]) // Other vulnerability added meanwhile
    expect(creations.map((creation) => creation.args[1].title)).toEqual(['Injection SQL', 'XSS'])
    creations[0].resolve('ok')
    await flushPromises()
    await add.trigger('click') // Added again on purpose once answered
    expect(creations).toHaveLength(3)
  })

  // Creation answered before the second click of the double click (about 100 ms apart): not added again
  it('ignores the second click of a double click on "+", even when the first one is answered', async () => {
    await mountAdd()
    vulns[0].resolve([vuln('v1', 'Injection SQL', 'fr')])
    await flushPromises()
    const creations = controlled(AuditService, 'createFinding')
    const add = wrapper.findAllComponents(QBtn).find((button) => button.props('icon') === 'fa fa-plus-circle')
    add.vm.$emit('click', new MouseEvent('click', { detail: 1 }))
    creations[0].resolve('ok')
    await flushPromises()
    add.vm.$emit('click', new MouseEvent('click', { detail: 2 }))
    expect(creations).toHaveLength(1)
    add.vm.$emit('click', new MouseEvent('click', { detail: 1 })) // New click later: added again on purpose
    expect(creations).toHaveLength(2)
  })

  // Manual creation: the title is cleared at the answer, a second Enter (or click on a category) then creates nothing
  it('creates the manual finding once when the second Enter comes after the answer', async () => {
    await mountAdd()
    const creations = controlled(AuditService, 'createFinding')
    vm().findingTitle = 'Titre'
    vm().addFinding()
    creations[0].resolve('ok')
    await flushPromises()
    vm().addFinding()
    vm().addFinding({ name: 'Web' })
    expect(creations).toHaveLength(1)
  })

  it('notifies a finding created after the user left the page', async () => {
    await mountAdd()
    const creations = controlled(AuditService, 'createFinding')
    vm().findingTitle = 'Titre'
    vm().addFinding()
    const page = vm()
    const message = page.$t('msg.findingCreateOk')
    wrapper.unmount()
    wrapper = null
    creations[0].resolve('ok')
    await flushPromises()
    expect(page.findingTitle).toBe('')
    expect(lastNotification(notify)).toMatchObject({ message, color: 'positive' })
  })
})

// ------------------------------------------------------------------------------------------------------------------
// Findings: edit page
// ------------------------------------------------------------------------------------------------------------------

const finding = (id, title, extra = {}) => ({
  _id: id, title, vulnType: '', description: `<p>${title}</p>`, observation: '', references: [], status: 1, poc: '', scope: '',
  cvssv3: '', remediationComplexity: null, priority: null, remediation: '', category: undefined, customFields: [], ...extra
})

function mockFindingApi() {
  vi.spyOn(VulnService, 'getFindingProposal').mockImplementation(() => ok(null))
  vi.spyOn(DataService, 'getCustomFields').mockImplementation(() => ok([{ _id: 'cf1', label: 'Owner', fieldType: 'input', display: 'finding', displaySub: '', size: 12, offset: 0, text: [] }]))
  vi.spyOn(AuditService, 'getAudit').mockImplementation(() => ok({ _id: 'a1', name: 'Pentest', language: 'fr' }))
  vi.spyOn(DataService, 'getVulnerabilityTypes').mockImplementation(() => ok([]))
  return { loads: controlled(AuditService, 'getFinding'), saves: controlled(AuditService, 'updateFinding') }
}

describe('finding page with delayed answers', () => {
  let loads
  let saves

  async function mountFinding() {
    ({ loads, saves } = mockFindingApi())
    wrapper = mount(EditFinding, {
      props: { audit: { _id: 'a1', language: 'fr' }, frontEndAuditState: S.EDIT },
      global: { mocks: pageMocks('editFinding', { findingId: 'f1' }), stubs: { ProposalReview: ProposalReviewStub } }
    })
    await flushPromises()
  }

  const vm = () => wrapper.vm
  const editor = (id) => wrapper.findAllComponents(EditorStub).find((e) => e.props('idUnique') === id)
  const titleInput = () => wrapper.findAllComponents(QInput).find((input) => input.props('label') === `${vm().$t('title')} *`)

  async function loadedAndChanged() {
    await mountFinding()
    loads[0].resolve(finding('f1', 'Injection SQL'))
    await flushPromises()
    editor('basiceditor_description').vm.$emit('ready')
    editor('basiceditor_description').vm.$emit('editorchange')
    await flushPromises()
    expect(vm().needSave).toBe(true)
  }

  async function save() {
    vm().updateFinding()
    await flushPromises()
  }

  // The late answer of the finding would replace what the user typed meanwhile
  it('keeps the title typed before the finding was loaded (or does not let the user type it)', async () => {
    await mountFinding()
    const readonlyBeforeLoad = titleInput().props('readonly')
    titleInput().vm.$emit('update:modelValue', 'Titre saisi')
    loads[0].resolve(finding('f1', 'Injection SQL'))
    await flushPromises()
    expect(readonlyBeforeLoad || vm().finding.title === 'Titre saisi').toBe(true)
    expect(titleInput().props('readonly')).toBe(false) // Editable once loaded
    expect(editor('basiceditor_description').props()).toMatchObject({ editable: true, loading: false })
  })

  it('makes the editors wait for the finding to load their content', async () => {
    await mountFinding()
    const editors = wrapper.findAllComponents(EditorStub)
    expect(editors.length).toBeGreaterThan(0)
    expect(editors.every((e) => e.props('loading') === true)).toBe(true)
    loads[0].resolve(finding('f1', 'Injection SQL'))
    await flushPromises()
    expect(editors.every((e) => e.props('loading') === false)).toBe(true)
    expect(editor('basiceditor_description').props('modelValue')).toBe('<p>Injection SQL</p>')
  })

  // Ctrl+S pressed right after opening a finding (slow network), or Save enabled by the editors synchronized before the
  // answer of the finding: the empty finding of the page would erase the saved one
  it('does not save the empty finding of the page before the finding is loaded', async () => {
    await mountFinding()
    editor('basiceditor_description').vm.$emit('ready') // Editors ready before the answer of the finding
    await flushPromises()
    expect(editor('basiceditor_description').props('editable')).toBe(false)
    expect(saveButton(wrapper).props('disable')).toBe(true)
    pressSave()
    vm().updateFinding()
    await flushPromises()
    expect(saves).toHaveLength(0)
    loads[0].resolve(finding('f1', 'Injection SQL'))
    await flushPromises()
    expect(saveButton(wrapper).props('disable')).toBe(false)
  })

  it('does not throw when the finding arrives after the user left the page', async () => {
    await mountFinding()
    const page = vm()
    wrapper.unmount()
    wrapper = null
    loads[0].resolve(finding('f1', 'Injection SQL'))
    await flushPromises()
    expect(page.finding.title).toBe('Injection SQL')
    pressSave() // Listener removed
    await flushPromises()
    expect(saves).toHaveLength(0)
  })

  it('keeps a coherent state after a double click on save', async () => {
    await loadedAndChanged()
    await saveButton(wrapper).trigger('click')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(saves.map((s) => s.args.slice(0, 2))).toEqual([['a1', 'f1'], ['a1', 'f1']])
    saves.forEach((s) => s.resolve('ok'))
    await flushPromises()
    expect(vm().needSave).toBe(false)
  })

  it('does not lose a save confirmed before leaving the page', async () => {
    await loadedAndChanged()
    await save()
    const page = vm()
    const { next, dialog } = leave(EditFinding, page)
    if (dialog) dialog.ok()
    expect(next).toHaveBeenCalled()
    saves[0].resolve('ok')
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: page.$t('msg.findingUpdateOk'), color: 'positive' })
  })

  // Leaving right after a save: the changes being saved are not "unsaved changes"
  it('does not warn about unsaved changes while they are being saved', async () => {
    await loadedAndChanged()
    await save()
    const { next, dialog } = leave(EditFinding, vm())
    saves[0].resolve('ok')
    await flushPromises()
    expect(dialog).toBeUndefined()
    expect(next).toHaveBeenCalled()
  })

  // The changes made while the save is pending stay to save after its answer
  it('keeps the changes made during a save as unsaved', async () => {
    await loadedAndChanged()
    await save()
    editor('basiceditor_description').vm.$emit('update:modelValue', '<p>Saisi pendant la sauvegarde</p>')
    editor('basiceditor_description').vm.$emit('editorchange')
    saves[0].resolve('ok')
    await flushPromises()
    const { next } = leave(EditFinding, vm())
    expect(next).not.toHaveBeenCalled()
  })

  it('keeps the title typed during a save as unsaved', async () => {
    await loadedAndChanged()
    await save()
    titleInput().vm.$emit('update:modelValue', 'Titre saisi pendant la sauvegarde')
    saves[0].resolve('ok')
    await flushPromises()
    expect(leave(EditFinding, vm()).next).not.toHaveBeenCalled()
  })

  it('keeps the last version sent as saved when two saves are answered out of order', async () => {
    await loadedAndChanged()
    titleInput().vm.$emit('update:modelValue', 'Premier')
    await save()
    titleInput().vm.$emit('update:modelValue', 'Second')
    await save()
    saves[1].resolve('ok')
    await flushPromises()
    saves[0].resolve('ok')
    await flushPromises()
    expect(vm().findingOrig.title).toBe('Second')
    expect(leave(EditFinding, vm()).next).toHaveBeenCalled()
  })

  it('keeps the changes of the editors to save when the save fails', async () => {
    await loadedAndChanged()
    await save()
    saves[0].reject(apiError(500, 'Internal error'))
    await flushPromises()
    expect(vm().needSave).toBe(true)
    expect(leave(EditFinding, vm()).next).not.toHaveBeenCalled()
  })
})

describe('navigation between findings with delayed answers', () => {
  let router
  let loads
  let saves

  // Audit edit page rendering the finding pages with a router-view keyed by the route (as index.vue)
  async function mountAudit(path) {
    ({ loads, saves } = mockFindingApi())
    const Audit = {
      data: () => ({ auditId: 'a1', audit: { _id: 'a1', language: 'fr', findings: [{ _id: 'f1' }, { _id: 'f2' }] } }),
      template: '<router-view :key="$route.fullPath" :audit="audit" :frontEndAuditState="0" />'
    }
    router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/audits/:auditId', component: Audit, children: [{ path: 'findings/:findingId', name: 'editFinding', component: EditFinding }] }] })
    router.push(path)
    await router.isReady()
    wrapper = mount({ template: '<router-view />' }, { global: { plugins: [router], mocks: { $socket: socket, $_: _, $settings: settings({ report: { cvssColors: {} } }) }, stubs: { ProposalReview: ProposalReviewStub } } })
    await flushPromises()
  }

  const page = () => wrapper.findComponent(EditFinding).vm

  it('shows the finding opened last when the previous one arrives late', async () => {
    await mountAudit('/audits/a1/findings/f1')
    expect(loads[0].args).toEqual(['a1', 'f1'])
    await router.push('/audits/a1/findings/f2') // Before the answer of f1
    await flushPromises()
    expect(loads[1].args).toEqual(['a1', 'f2'])
    loads[1].resolve(finding('f2', 'XSS'))
    await flushPromises()
    loads[0].resolve(finding('f1', 'Injection SQL')) // Late answer of the previous finding
    await flushPromises()
    expect(wrapper.findAllComponents(EditFinding)).toHaveLength(1)
    expect(page().findingId).toBe('f2')
    expect(page().finding.title).toBe('XSS')
    expect(socket.emit).toHaveBeenLastCalledWith('menu', { menu: 'editFinding', finding: 'f2', room: 'a1' })
  })

  it('saves the finding displayed on its own identifier', async () => {
    await mountAudit('/audits/a1/findings/f1')
    await router.push('/audits/a1/findings/f2')
    await flushPromises()
    loads[1].resolve(finding('f2', 'XSS', { customFields: [{ customField: 'cf1', text: 'Équipe f2' }] }))
    loads[0].resolve(finding('f1', 'Injection SQL', { customFields: [{ customField: 'cf1', text: 'Équipe f1' }] }))
    await flushPromises()
    pressSave()
    await flushPromises()
    expect(saves).toHaveLength(1) // Listener of f1 removed
    const [auditId, findingId, sent] = saves[0].args
    expect([auditId, findingId, sent.title]).toEqual(['a1', 'f2', 'XSS'])
    expect(sent.customFields.map((field) => field.text)).toEqual(['Équipe f2'])
  })

  it('opens the next finding while the save of the previous one is pending, then notifies it', async () => {
    await mountAudit('/audits/a1/findings/f1')
    loads[0].resolve(finding('f1', 'Injection SQL'))
    await flushPromises()
    page().updateFinding()
    await flushPromises()
    await router.push('/audits/a1/findings/f2')
    await flushPromises()
    expect(page().findingId).toBe('f2')
    saves[0].resolve('ok')
    await flushPromises()
    expect(saves[0].args.slice(0, 2)).toEqual(['a1', 'f1'])
    expect(lastNotification(notify).color).toBe('positive')
  })
})

// ------------------------------------------------------------------------------------------------------------------
// Network page
// ------------------------------------------------------------------------------------------------------------------

const NETWORK = { _id: 'a1', scope: [{ name: 'LAN', hosts: [{ ip: '10.0.0.1', hostname: 'srv', services: [] }] }, { name: 'DMZ', hosts: [] }] }

describe('network page with delayed answers', () => {
  let networks
  let saves

  async function mountNetwork() {
    vi.spyOn(AuditService, 'getAuditGeneral').mockImplementation(() => ok({ _id: 'a1', name: 'Pentest', auditType: 'Web', scope: ['LAN', 'DMZ'] }))
    networks = controlled(AuditService, 'getAuditNetwork')
    saves = controlled(AuditService, 'updateAuditNetwork')
    wrapper = mount(NetworkPage, { props: { frontEndAuditState: S.EDIT, parentState: 'EDIT' }, global: { mocks: pageMocks('network') } })
    await flushPromises()
  }

  const vm = () => wrapper.vm
  const hosts = (name) => vm().audit.scope.find((scope) => scope.name === name).hosts

  async function loaded() {
    await mountNetwork()
    networks[0].resolve(_.cloneDeep(NETWORK))
    await flushPromises()
  }

  async function save() {
    vm().updateAuditNetwork()
    await flushPromises()
  }

  // Until the network data arrives, the scopes of the general data are names only: no empty title, and adding the hosts
  // imported meanwhile must not throw (scope.hosts of a string)
  it('does not offer to add hosts to the scopes before the network data is loaded', async () => {
    await mountNetwork()
    vm().parseXmlNmap('<nmaprun><host><status state="up"/><address addr="10.0.0.9"/><ports/></host></nmaprun>')
    vm().selectedTargets[undefined] = vm().targetsOptions
    expect(() => vm().audit.scope.forEach((scope) => vm().updateScopeHosts(scope))).not.toThrow()
    expect(wrapper.findAll('.text-h6').map((title) => title.text()).filter((title) => !title)).toEqual([])
    networks[0].resolve(_.cloneDeep(NETWORK))
    await flushPromises()
    expect(wrapper.findAll('.text-h6').map((title) => title.text())).toEqual(['LAN', 'DMZ'])
  })

  it('does not throw when the network data arrives after the user left the page', async () => {
    await mountNetwork()
    const page = vm()
    const listener = page._listener
    wrapper.unmount()
    wrapper = null
    document.removeEventListener('keydown', listener, false)
    networks[0].resolve(_.cloneDeep(NETWORK))
    await flushPromises()
    expect(page.audit.scope).toHaveLength(2)
  })

  it('does not lose a save confirmed before leaving the page', async () => {
    await loaded()
    hosts('LAN').pop()
    await save()
    const { next, dialog } = leave(NetworkPage, vm())
    if (dialog) dialog.ok()
    expect(next).toHaveBeenCalled()
    saves[0].resolve('ok')
    await flushPromises()
    expect(saves[0].sent[1].scope[0].hosts).toEqual([])
    expect(lastNotification(notify).color).toBe('positive')
  })

  // Leaving right after a save: the changes being saved are not "unsaved changes"
  it('does not warn about unsaved changes while they are being saved', async () => {
    await loaded()
    hosts('LAN').pop()
    await save()
    const { next, dialog } = leave(NetworkPage, vm())
    saves[0].resolve('ok')
    await flushPromises()
    expect(dialog).toBeUndefined()
    expect(next).toHaveBeenCalled()
  })

  // The hosts changed while the save is pending stay unsaved after its answer
  it('keeps the hosts changed during a save as unsaved', async () => {
    await loaded()
    hosts('LAN').pop()
    await save()
    hosts('DMZ').push({ ip: '203.0.113.1', hostname: 'www', services: [] })
    saves[0].resolve('ok')
    await flushPromises()
    expect(leave(NetworkPage, vm()).next).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------------------------------------------------------
// Sections page
// ------------------------------------------------------------------------------------------------------------------

const SECTION = { _id: 's1', field: 'intro', name: 'Introduction', customFields: [{ customField: { _id: 'cf1', label: 'Synthèse', fieldType: 'input', size: 12, offset: 0, options: [] }, text: 'Texte' }] }

describe('section page with delayed answers', () => {
  let loads
  let saves

  async function mountSection() {
    vi.spyOn(DataService, 'getCustomFields').mockImplementation(() => ok([]))
    loads = controlled(AuditService, 'getSection')
    saves = controlled(AuditService, 'updateSection')
    wrapper = mount(SectionPage, { props: { audit: { name: 'Pentest', auditType: 'Web', language: 'fr' }, frontEndAuditState: S.EDIT }, global: { mocks: pageMocks('editSection', { sectionId: 's1' }) } })
    await flushPromises()
  }

  const vm = () => wrapper.vm
  const input = () => wrapper.findComponent(QInput)

  async function loaded() {
    await mountSection()
    loads[0].resolve(_.cloneDeep(SECTION))
    await flushPromises()
  }

  async function save() {
    vm().updateSection()
    await flushPromises()
  }

  it('shows no field to type in before the section is loaded', async () => {
    await mountSection()
    expect(wrapper.findAllComponents(QInput)).toHaveLength(0)
    expect(wrapper.findAllComponents(EditorStub)).toHaveLength(0)
    loads[0].resolve(_.cloneDeep(SECTION))
    await flushPromises()
    expect(input().props('modelValue')).toBe('Texte')
  })

  it('does not throw when the section arrives after the user left the page', async () => {
    await mountSection()
    const page = vm()
    const listener = page._listener
    wrapper.unmount()
    wrapper = null
    document.removeEventListener('keydown', listener, false)
    loads[0].resolve(_.cloneDeep(SECTION))
    await flushPromises()
    expect(page.section.name).toBe('Introduction')
  })

  it('does not lose a save confirmed before leaving the page', async () => {
    await loaded()
    input().vm.$emit('update:modelValue', 'Nouveau texte')
    await save()
    const { next, dialog } = leave(SectionPage, vm())
    if (dialog) dialog.ok()
    expect(next).toHaveBeenCalled()
    saves[0].resolve('ok')
    await flushPromises()
    expect(saves[0].sent[2].customFields[0].text).toBe('Nouveau texte')
    expect(lastNotification(notify).color).toBe('positive')
  })

  // Leaving right after a save: the changes being saved are not "unsaved changes"
  it('does not warn about unsaved changes while they are being saved', async () => {
    await loaded()
    input().vm.$emit('update:modelValue', 'Nouveau texte')
    await save()
    const { next, dialog } = leave(SectionPage, vm())
    saves[0].resolve('ok')
    await flushPromises()
    expect(dialog).toBeUndefined()
    expect(next).toHaveBeenCalled()
  })

  // What is typed while the save is pending stays unsaved after its answer
  it('keeps the changes typed during a save as unsaved', async () => {
    await loaded()
    input().vm.$emit('update:modelValue', 'Version envoyée')
    await save()
    input().vm.$emit('update:modelValue', 'Saisie pendant la sauvegarde')
    saves[0].resolve('ok')
    await flushPromises()
    expect(leave(SectionPage, vm()).next).not.toHaveBeenCalled()
  })
})
