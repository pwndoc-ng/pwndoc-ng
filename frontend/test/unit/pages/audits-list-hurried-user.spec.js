// Hurried user on the audits list (pages/audits/list): creation and clone of an audit with double clicks and delayed
// answers, searches answered out of order, deletion confirmed twice, answers arriving after leaving the page.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { QDialog } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import AuditsList from 'pages/audits/list'
import AuditService from '@/services/audit'
import DataService from '@/services/data'
import CompanyService from '@/services/company'
import UserService from '@/services/user'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'
import { settings, apiError, ok, controlled } from '../../helpers/audit-edit'

const AUDITS = [
  { _id: 'a1', name: 'Pentest Été', language: 'fr', company: { name: 'ACME' }, creator: { username: 'ann' }, collaborators: [], createdAt: '2024-01-15T10:00:00Z', state: 'EDIT' },
  { _id: 'a2', name: 'Web audit', language: 'en', company: null, creator: { username: 'bob' }, collaborators: [], createdAt: '2024-02-20T10:00:00Z', state: 'EDIT' }
]
const PENTEST = { name: 'Pentest', hidden: [] } // Audit types are returned without _id

let wrapper
let router
let audits
let notify

async function mountList() {
  UserService.user = { username: 'ann', roles: '*' }
  router = { push: vi.fn(() => Promise.resolve()) }
  audits = controlled(AuditService, 'getAudits')
  vi.spyOn(DataService, 'getLanguages').mockImplementation(() => ok([{ locale: 'fr', language: 'Français' }]))
  vi.spyOn(DataService, 'getAuditTypes').mockImplementation(() => ok([PENTEST]))
  vi.spyOn(CompanyService, 'getCompanies').mockImplementation(() => ok([]))
  wrapper = mount(AuditsList, {
    global: { mocks: { $settings: settings({ reviews: false }), $route: { params: {} }, $router: router }, stubs: { RouterLink: true } }
  })
  await flushPromises()
}

// Both getAudits of the loading answered (audits of the table, audits to clone)
async function loaded() {
  await mountList()
  audits[0].resolve(AUDITS)
  audits[1].resolve(AUDITS)
  await flushPromises()
}

const vm = () => wrapper.vm
const fill = (name = 'Nouvel audit 🔒') => Object.assign(vm().currentAudit, { name, language: 'fr', auditType: PENTEST })

// "Create" button of the creation dialog (rendered in the body, label in the display language)
async function createButton() {
  vm().showCreateModal = true
  await flushPromises()
  return [...document.body.querySelectorAll('.q-dialog button')].find((button) => button.textContent.includes(vm().$t('btn.create')))
}

beforeEach(() => {
  notify = mockNotify()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('audit creation by a hurried user', () => {
  it('sends one creation request for a double click on "Créer"', async () => {
    await loaded()
    const creations = controlled(AuditService, 'createAudit')
    fill()
    const button = await createButton()
    button.click()
    button.click()
    await flushPromises()
    expect(creations).toHaveLength(1)
    expect(creations[0].sent).toEqual([{ name: 'Nouvel audit 🔒', language: 'fr', auditType: 'Pentest' }])
    expect(vm().errors).toMatchObject({ name: '', language: '', auditType: '' }) // No error shown by the second click
    creations[0].resolve({ audit: { _id: 'new' } })
    await flushPromises()
    expect(router.push).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith('/audits/new')
    expect(vm().showCreateModal).toBe(false)
  })

  // The type chosen in the select is kept after a refused creation (name already used...): a new click on "Créer" must
  // not fail with "Assessment required"
  it('creates the audit again after a refused creation', async () => {
    await loaded()
    const creations = controlled(AuditService, 'createAudit')
    fill('Pentest Été')
    vm().createAudit()
    creations[0].reject(apiError(422, 'Audit name already exists'))
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Audit name already exists', color: 'negative' })
    vm().currentAudit.name = 'Pentest Été 2'
    vm().createAudit()
    expect(vm().errors.auditType).toBe('')
    expect(creations).toHaveLength(2)
    expect(creations[1].sent).toEqual([{ name: 'Pentest Été 2', language: 'fr', auditType: 'Pentest' }])
  })

  // A second request sent while the clone is pending would clone the audit twice
  it('clones the audit once for a double click on "Créer"', async () => {
    await loaded()
    const clones = controlled(AuditService, 'createClonedAudit')
    vm().cloneExistingReport = true
    vm().selectedAuditToClone = 'a1'
    vm().currentAudit.name = 'Copie'
    const button = await createButton()
    button.click()
    button.click()
    await flushPromises()
    expect(clones).toHaveLength(1)
  })

  it('opens the audit created even when the list was left meanwhile', async () => {
    await loaded()
    const creations = controlled(AuditService, 'createAudit')
    fill()
    vm().createAudit()
    wrapper.unmount()
    wrapper = null
    creations[0].resolve({ audit: { _id: 'new' } })
    await flushPromises()
    expect(router.push).toHaveBeenCalledWith('/audits/new')
  })

  it('reloads the list after the creation without error when it arrives after the navigation', async () => {
    await loaded()
    const creations = controlled(AuditService, 'createAudit')
    fill()
    vm().createAudit()
    creations[0].resolve({ audit: { _id: 'new' } })
    await flushPromises()
    const page = vm()
    wrapper.unmount()
    wrapper = null
    audits[2].resolve([...AUDITS, { _id: 'new', name: 'Nouvel audit 🔒' }])
    await flushPromises()
    expect(page.audits).toHaveLength(3)
  })

  it('keeps the dialog open with the error when the creation fails', async () => {
    await loaded()
    const creations = controlled(AuditService, 'createAudit')
    fill()
    vm().showCreateModal = true
    vm().createAudit()
    creations[0].reject(apiError(500, 'Internal error'))
    await flushPromises()
    expect(vm().showCreateModal).toBe(true)
    expect(router.push).not.toHaveBeenCalled()
    expect(lastNotification(notify)).toMatchObject({ message: 'Internal error', color: 'negative' })
  })
})

describe('creation dialog', () => {
  // Second click of a double click on "New Audit": on the backdrop of the dialog just opened, it would close it
  it('shows its buttons in the display language and is not closed by a click outside', async () => {
    await loaded()
    vm().showCreateModal = true
    await flushPromises()
    const labels = [...document.body.querySelectorAll('.q-dialog button')].map((button) => button.textContent.trim())
    expect(labels).toEqual(expect.arrayContaining([vm().$t('btn.cancel'), vm().$t('btn.create')]))
    expect(wrapper.findComponent(QDialog).props('noBackdropDismiss')).toBe(true)
  })
})

describe('report of an audit of the list', () => {
  it('generates the report once for a double click, even when the first click is answered', async () => {
    await loaded()
    const reports = controlled(AuditService, 'generateAuditReport')
    vm().generateReport('a1', new MouseEvent('click', { detail: 1 }))
    vm().generateReport('a1', new MouseEvent('click', { detail: 1 })) // Generation pending
    expect(reports).toHaveLength(1)
    reports[0].reject(new Error('Network Error'))
    await flushPromises()
    vm().generateReport('a1', new MouseEvent('click', { detail: 2 })) // Second click of the double click, answered first
    expect(reports).toHaveLength(1)
    vm().generateReport('a2') // Other audit
    vm().generateReport('a1') // New click later
    expect(reports.map((report) => report.args[0])).toEqual(['a1', 'a2', 'a1'])
  })
})

describe('audits list loading and searches', () => {
  it('shows the audits of the last search when answered in order', async () => {
    await loaded()
    vm().search.finding = 'SQL'
    vm().getAudits()
    vm().search.finding = 'XSS'
    vm().getAudits()
    audits[2].resolve([AUDITS[0]])
    audits[3].resolve([AUDITS[1]])
    await flushPromises()
    expect(audits[3].args).toEqual([{ findingTitle: 'XSS' }])
    expect(vm().audits.map((a) => a._id)).toEqual(['a2'])
    expect(vm().loading).toBe(false)
  })

  // Searches (finding title, Enter pressed twice, cleared search): the answer of the previous search arriving last must
  // not replace the results of the last one, nor end the loading
  it('shows the audits of the last search when answered out of order', async () => {
    await loaded()
    vm().search.finding = 'SQL'
    vm().getAudits()
    vm().search.finding = 'XSS'
    vm().getAudits()
    audits[2].resolve([AUDITS[0]]) // Previous search, answered first: not shown
    await flushPromises()
    expect(vm().loading).toBe(true)
    audits[3].resolve([AUDITS[1]])
    await flushPromises()
    expect(vm().loading).toBe(false)
    expect(vm().audits.map((a) => a._id)).toEqual(['a2'])
  })

  it('ignores the previous search answered after the last one', async () => {
    await loaded()
    vm().search.finding = 'SQL'
    vm().getAudits()
    vm().search.finding = 'XSS'
    vm().getAudits()
    audits[3].resolve([AUDITS[1]])
    await flushPromises()
    audits[2].resolve([AUDITS[0]]) // Previous search, late
    await flushPromises()
    expect(vm().audits.map((a) => a._id)).toEqual(['a2'])
  })

  it('keeps loading while a search is pending', async () => {
    await mountList()
    expect(vm().loading).toBe(true)
    audits[1].resolve(AUDITS) // Audits to clone: not the table
    await flushPromises()
    expect(vm().loading).toBe(true)
    audits[0].resolve(AUDITS)
    await flushPromises()
    expect(vm().loading).toBe(false)
  })

  // Audits that cannot be loaded (error 500, network): the table would keep its loading state, nothing notified
  it('stops loading and notifies the error when the audits cannot be loaded', async () => {
    await mountList()
    audits[0].reject(apiError(500, 'Internal error'))
    audits[1].resolve(AUDITS)
    await flushPromises()
    expect(vm().loading).toBe(false)
    expect(notify).toHaveBeenCalled()
    expect(lastNotification(notify)).toMatchObject({ message: 'Internal error', color: 'negative' })
  })

  it('does not throw when the audits arrive after the user left the list', async () => {
    await mountList()
    const page = vm()
    wrapper.unmount()
    wrapper = null
    audits[0].resolve(AUDITS)
    audits[1].resolve(AUDITS)
    await flushPromises()
    expect(page.audits).toHaveLength(2)
  })
})

describe('audit deletion by a hurried user', () => {
  it('deletes the audit once and notifies the error of a second confirmation', async () => {
    const dialogs = mockDialog()
    await loaded()
    const deletions = controlled(AuditService, 'deleteAudit')
    vm().confirmDeleteAudit(AUDITS[0])
    vm().confirmDeleteAudit(AUDITS[0]) // Double click on the trash
    dialogs[0].ok()
    dialogs[1].ok()
    expect(deletions.map((d) => d.args)).toEqual([['a1'], ['a1']])
    deletions[0].resolve('ok')
    deletions[1].reject(apiError(404, 'Audit not found'))
    await flushPromises()
    expect(notify.mock.calls.map(([options]) => options.color)).toEqual(['positive', 'negative'])
    expect(lastNotification(notify).message).toBe('Audit not found')
    audits[2].resolve([AUDITS[1]])
    await flushPromises()
    expect(vm().audits.map((a) => a._id)).toEqual(['a2'])
  })

  it('does not delete when the confirmation is closed', async () => {
    const dialogs = mockDialog()
    await loaded()
    const deletions = controlled(AuditService, 'deleteAudit')
    vm().confirmDeleteAudit(AUDITS[0])
    dialogs[0].cancel()
    expect(deletions).toHaveLength(0)
  })
})
