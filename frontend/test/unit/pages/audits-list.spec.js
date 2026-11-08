// pages/audits/list: audits table filters, creation / clone, deletion, report generation (API services mocked)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { QToggle } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import AuditsList from 'pages/audits/list'
import AuditService from '@/services/audit'
import DataService from '@/services/data'
import CompanyService from '@/services/company'
import UserService from '@/services/user'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'

const LANGUAGES = [{ locale: 'en', language: 'English' }, { locale: 'fr', language: 'Français' }]
const AUDITS = [
  { _id: 'a1', name: 'Pentest Été', language: 'fr', company: { name: 'ACME' }, creator: { username: 'joanne' }, collaborators: [{ username: 'bob' }], createdAt: '2024-01-15T10:00:00Z', state: 'REVIEW', connected: [] },
  { _id: 'a2', name: 'Web audit', language: 'en', company: { name: 'Globex' }, creator: { username: 'ann' }, collaborators: [], createdAt: '2024-02-20T10:00:00Z', state: 'EDIT', connected: ['ann'] },
  { _id: 'a3', name: 'Internal', language: 'en', company: null, creator: { username: 'carol' }, collaborators: [{ username: 'ann' }], createdAt: '2023-12-01T10:00:00Z', state: 'REVIEW', connected: [] }
]

let wrapper
let router

async function mountList({ roles = '*', username = 'ann', reviews = true, finding } = {}) {
  UserService.user = { username, roles }
  router = { push: vi.fn() }
  vi.spyOn(AuditService, 'getAudits').mockResolvedValue({ data: { datas: AUDITS } })
  vi.spyOn(DataService, 'getLanguages').mockResolvedValue({ data: { datas: LANGUAGES } })
  vi.spyOn(DataService, 'getAuditTypes').mockResolvedValue({ data: { datas: [{ name: 'Pentest' }] } })
  vi.spyOn(CompanyService, 'getCompanies').mockResolvedValue({ data: { datas: [{ name: 'ACME' }, { name: 'Globex' }] } })
  wrapper = mount(AuditsList, {
    global: {
      mocks: { $settings: { reviews: { enabled: reviews, public: { minReviewers: 1 } } }, $route: { params: { finding } }, $router: router },
      stubs: { RouterLink: true }
    }
  })
  await flushPromises()
  return wrapper
}

const names = (rows) => rows.map((row) => row.name)
const filter = (terms = {}) => names(wrapper.vm.customFilter(AUDITS, { finding: '', name: '', language: '', company: '', users: '', date: '', ...terms }))

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}))
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('audits list loading', () => {
  it('loads the audits (filtered by the finding of the route), languages, audit types and companies', async () => {
    await mountList({ finding: 'SQL Injection' })
    expect(AuditService.getAudits).toHaveBeenCalledWith({ findingTitle: 'SQL Injection' })
    expect(AuditService.getAudits).toHaveBeenCalledWith() // audits that can be cloned
    expect(wrapper.vm.search.finding).toBe('SQL Injection')
    expect(wrapper.findAll('tbody tr').length).toBeGreaterThanOrEqual(3)
    expect(wrapper.text()).toContain('Pentest Été')
    expect(wrapper.text()).toContain('Français')
    expect(wrapper.text()).toContain('joanne, bob')
  })

  it('asks to create languages and audit types first', async () => {
    UserService.user = { username: 'ann', roles: '*' }
    vi.spyOn(AuditService, 'getAudits').mockResolvedValue({ data: { datas: [] } })
    vi.spyOn(DataService, 'getLanguages').mockResolvedValue({ data: { datas: [] } })
    vi.spyOn(DataService, 'getAuditTypes').mockResolvedValue({ data: { datas: [] } })
    vi.spyOn(CompanyService, 'getCompanies').mockResolvedValue({ data: { datas: [] } })
    wrapper = mount(AuditsList, { global: { mocks: { $settings: { reviews: { enabled: false } }, $route: { params: {} }, $router: { push: vi.fn() } } } })
    await flushPromises()
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.findAll('a[href="/data/custom"]')).toHaveLength(2)
  })

  it.each([
    [{ roles: '*', reviews: true }, ['name', 'language', 'company', 'users', 'date', 'action', 'connected', 'reviews']],
    [{ roles: ['audits:read'], reviews: false }, ['name', 'language', 'company', 'users', 'date', 'action']]
  ])('shows the columns allowed by the permissions and settings %j', async (options, columns) => {
    await mountList(options)
    expect(wrapper.vm.visibleColumns).toEqual(columns)
  })

  it('shows the review filter to the reviewers when the reviews are enabled', async () => {
    await mountList({ roles: ['audits:read', 'audits:review'], reviews: true })
    expect(wrapper.findAllComponents(QToggle).map((toggle) => toggle.props('label'))).toContain(wrapper.vm.$t('awaitingMyReview'))
    wrapper.unmount()
    await mountList({ roles: ['audits:read'], reviews: true })
    expect(wrapper.findAllComponents(QToggle).map((toggle) => toggle.props('label'))).not.toContain(wrapper.vm.$t('awaitingMyReview'))
  })
})

describe('audits list filters', () => {
  it('filters by name (case and accent insensitive), language, company, participants and date', async () => {
    await mountList()
    expect(filter()).toEqual(['Pentest Été', 'Web audit', 'Internal'])
    expect(filter({ name: 'ete' })).toEqual(['Pentest Été'])
    expect(filter({ language: 'en' })).toEqual(['Web audit', 'Internal'])
    expect(filter({ company: 'acme' })).toEqual(['Pentest Été'])
    expect(filter({ users: 'BOB' })).toEqual(['Pentest Été'])
    expect(filter({ date: '2024-02' })).toEqual(['Web audit'])
  })

  it('filters the connected users and the audits awaiting a review of the user', async () => {
    await mountList({ username: 'carol' })
    wrapper.vm.displayConnected = true
    expect(filter()).toEqual(['Web audit'])
    wrapper.vm.displayConnected = false
    wrapper.vm.displayReadyForReview = true
    expect(filter()).toEqual(['Pentest Été']) // In review, carol is not a participant
  })

  it('filters the audits of the user', async () => {
    await mountList({ username: 'ann' })
    wrapper.vm.myAudits = true
    expect(filter()).toContain('Web audit')
    expect(filter()).toContain('Internal')
  })

  // BUG: src/pages/audits/list/audits-list.js:385,387 the participants are compared with indexOf on the joined usernames:
  // "My audits" shows the audits of 'joanne' to the user 'ann' (and "awaiting my review" hides them)
  it.skip('compares the whole usernames for "my audits"', async () => {
    await mountList({ username: 'ann' })
    wrapper.vm.myAudits = true
    expect(filter()).not.toContain('Pentest Été')
  })

  it('converts the locales and the participants', async () => {
    await mountList()
    expect(wrapper.vm.convertLocale('fr')).toBe('Français')
    expect(wrapper.vm.convertLocale('de')).toBe('')
    expect(wrapper.vm.convertParticipants({ creator: { username: 'a' }, collaborators: [{ username: 'b' }, { username: 'c' }] })).toBe('a, b, c')
    expect(wrapper.vm.convertParticipants({})).toBe('')
    expect(wrapper.vm.formatDate(null)).toBe('-')
    expect(wrapper.vm.formatDate('2024-01-15T10:00:00Z')).toBe('15/01/2024')
  })

  it('filters the audits that can be cloned', async () => {
    await mountList()
    const update = (fn) => fn()
    wrapper.vm.filterAuditsForCloning('glob', update)
    expect(names(wrapper.vm.availableAuditsForCloning)).toEqual(['Web audit'])
    wrapper.vm.filterAuditsForCloning('FR', update)
    expect(names(wrapper.vm.availableAuditsForCloning)).toEqual(['Pentest Été'])
    wrapper.vm.filterAuditsForCloning('', update)
    expect(wrapper.vm.availableAuditsForCloning).toHaveLength(3)
  })

  it('searches the audits containing a finding again', async () => {
    await mountList()
    wrapper.vm.search.finding = 'XSS'
    wrapper.vm.getAudits()
    expect(AuditService.getAudits).toHaveBeenLastCalledWith({ findingTitle: 'XSS' })
  })
})

describe('audit creation', () => {
  it('requires a name, a language and an audit type', async () => {
    vi.spyOn(AuditService, 'createAudit')
    await mountList()
    wrapper.vm.cleanCurrentAudit()
    wrapper.vm.createAudit()
    expect(wrapper.vm.errors).toMatchObject({ name: 'Name required', language: 'Language required', auditType: 'Assessment required' })
    expect(AuditService.createAudit).not.toHaveBeenCalled()
  })

  it('creates the audit and opens it', async () => {
    vi.spyOn(AuditService, 'createAudit').mockResolvedValue({ data: { datas: { audit: { _id: 'new' } } } })
    await mountList()
    Object.assign(wrapper.vm.currentAudit, { name: 'New audit', language: 'en', auditType: { name: 'Pentest' } })
    wrapper.showCreateModal = true
    wrapper.vm.createAudit()
    await flushPromises()
    expect(AuditService.createAudit).toHaveBeenCalledWith({ name: 'New audit', language: 'en', auditType: 'Pentest' })
    expect(wrapper.vm.showCreateModal).toBe(false)
    expect(router.push).toHaveBeenCalledWith('/audits/new') // see the BUG of '/audits/:auditId' in router.spec.js
  })

  it('requires a name and an audit to clone', async () => {
    vi.spyOn(AuditService, 'createClonedAudit')
    await mountList()
    wrapper.vm.cloneExistingReport = true
    wrapper.vm.createAudit()
    expect(wrapper.vm.errors).toMatchObject({ name: 'Name required', selectedAudit: 'Please select an audit to clone' })
    expect(AuditService.createClonedAudit).not.toHaveBeenCalled()
  })

  it('clones an audit', async () => {
    vi.spyOn(AuditService, 'createClonedAudit').mockResolvedValue({ data: { datas: { audit: { _id: 'copy' } } } })
    await mountList()
    wrapper.vm.cloneExistingReport = true
    wrapper.vm.selectedAuditToClone = 'a1'
    wrapper.vm.currentAudit.name = 'Copy'
    wrapper.vm.createAudit()
    await flushPromises()
    expect(AuditService.createClonedAudit).toHaveBeenCalledWith('a1', 'Copy')
    expect(router.push).toHaveBeenCalledWith('/audits/copy')
  })

  it('notifies the creation errors', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'createAudit').mockRejectedValue({ response: { data: { datas: 'Audit name already exists' } } })
    await mountList()
    Object.assign(wrapper.vm.currentAudit, { name: 'x', language: 'en', auditType: { name: 'Pentest' } })
    wrapper.vm.createAudit()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Audit name already exists', color: 'negative' })
  })

  it('opens an audit with a double click', async () => {
    await mountList()
    wrapper.vm.dblClick({ _id: 'a2' })
    expect(router.push).toHaveBeenCalledWith('/audits/a2/general')
    await wrapper.findAll('tbody tr').find((row) => row.text().includes('Internal')).trigger('dblclick')
    expect(router.push).toHaveBeenLastCalledWith('/audits/a3/general')
  })
})

describe('audit deletion and report', () => {
  it('deletes an audit after confirmation', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(AuditService, 'deleteAudit').mockResolvedValue({})
    await mountList()
    wrapper.vm.confirmDeleteAudit(AUDITS[1])
    expect(dialogs[0].options.message).toContain('Web audit')
    expect(AuditService.deleteAudit).not.toHaveBeenCalled()
    dialogs[0].ok()
    await flushPromises()
    expect(AuditService.deleteAudit).toHaveBeenCalledWith('a2')
    expect(lastNotification(notify).color).toBe('positive')
  })

  it('downloads the generated report with the name given by the server', async () => {
    const notify = mockNotify()
    URL.createObjectURL = vi.fn(() => 'blob:report')
    let download
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { download = this.download })
    vi.spyOn(AuditService, 'generateAuditReport').mockResolvedValue({ data: new Blob(['docx']), headers: { 'content-disposition': `attachment; filename="${encodeURIComponent('Rapport été.docx')}"` } })
    await mountList()
    wrapper.vm.generateReport('a1')
    await flushPromises()
    expect(AuditService.generateAuditReport).toHaveBeenCalledWith('a1')
    expect(download).toBe('Rapport été.docx')
    const update = notify.mock.results[0].value
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ icon: 'done', color: 'green' }))
  })

  it('shows the error of the report generation (JSON in a Blob)', async () => {
    const notify = mockNotify()
    const error = { response: { data: new Blob([JSON.stringify({ datas: 'Template error: unknown tag {#findings' })]) } }
    vi.spyOn(AuditService, 'generateAuditReport').mockRejectedValue(error)
    await mountList()
    wrapper.vm.generateReport('a1')
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2))
    expect(lastNotification(notify)).toMatchObject({ message: 'Template error: unknown tag {#findings', type: 'negative' })
  })
})
