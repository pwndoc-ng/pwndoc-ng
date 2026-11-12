// pages/vulnerabilities: tabs (vulnerabilities / proposals / archives), filters, sort, actions
// The editor, the proposals list and the dialogs are stubbed, API services mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import _ from 'lodash'
import { QTab, QBtn, QBtnDropdown } from 'quasar'

vi.mock('components/editor', () => import('../../helpers/editor-stub'))
vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import VulnerabilitiesPage from '@/pages/vulnerabilities'
import VulnerabilityService from '@/services/vulnerability'
import DataService from '@/services/data'
import UserService from '@/services/user'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'

const vuln = (id, title, extra = {}, details = {}) => ({
  _id: id, status: 0, category: null, updatedAt: '2024-01-10T10:00:00Z',
  details: [{ locale: 'en', title, vulnType: 'Web', ...details }],
  ...extra
})

const VULNS = [
  vuln('v1', 'SQL Injection', { category: 'Injection', updatedAt: '2024-12-15T10:00:00Z' }),
  vuln('v2', 'Élévation de privilèges', { status: 1, updatedAt: '2025-01-02T10:00:00Z' }, { vulnType: 'System' }),
  vuln('v3', 'Old XSS', { archived: true }),
  vuln('v4', 'Updated vuln', { status: 2, updatedAt: '2024-03-01T10:00:00Z' }),
  { _id: 'v5', status: 0, details: [{ locale: 'fr', title: 'Seulement en français' }] }
]

// Dialogs replaced by a stub exposing show() / hide() (their content is not rendered)
const DialogStub = { name: 'QDialog', template: '<div class="dialog-stub" :data-open="open" />', data: () => ({ open: false }), methods: { show() { this.open = true }, hide() { this.open = false } } }

let wrapper
let router

async function mountPage(roles = '*') {
  UserService.user = { username: 'admin', roles }
  router = { push: vi.fn() }
  vi.spyOn(VulnerabilityService, 'getVulnerabilities').mockResolvedValue({ data: { datas: VULNS } })
  vi.spyOn(VulnerabilityService, 'getProposalsCount').mockResolvedValue({ data: { datas: { pending: 3 } } })
  vi.spyOn(DataService, 'getLanguages').mockResolvedValue({ data: { datas: [{ locale: 'en', language: 'English' }, { locale: 'fr', language: 'Français' }] } })
  vi.spyOn(DataService, 'getVulnerabilityTypes').mockResolvedValue({ data: { datas: [{ locale: 'en', name: 'Web' }, { locale: 'fr', name: 'Applicatif' }] } })
  vi.spyOn(DataService, 'getVulnerabilityCategories').mockResolvedValue({ data: { datas: [{ name: 'Injection' }] } })
  vi.spyOn(DataService, 'getCustomFields').mockResolvedValue({ data: { datas: [] } })
  wrapper = mount(VulnerabilitiesPage, {
    global: {
      mocks: { $_: _, $router: router, $settings: { report: { public: {} } } },
      stubs: { QDialog: DialogStub, ProposalsList: { name: 'ProposalsList', props: ['vulnerabilityFilter'], template: '<div class="proposals-list-stub" />' } },
      directives: { sticky: {} } // vue3-sticky-directive (boot/sticky)
    }
  })
  await flushPromises()
  return wrapper
}

const titles = (rows) => rows.map((row) => wrapper.vm.getDtTitle(row))
const filter = (terms = {}) => titles(wrapper.vm.customFilter(wrapper.vm.computedVulnerabilities, { title: '', type: '', category: '', updatedAt: '', valid: 0, new: 1, updates: 2, ...terms }))

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}))
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('vulnerabilities page tabs', () => {
  it('loads the data and shows the vulnerabilities of the first language, without the archived ones', async () => {
    await mountPage()
    expect(wrapper.vm.dtLanguage).toBe('en')
    expect(titles(wrapper.vm.computedVulnerabilities)).toEqual(['SQL Injection', 'Élévation de privilèges', 'Updated vuln'])
    expect(wrapper.text()).toContain('SQL Injection')
    expect(wrapper.text()).not.toContain('Old XSS')
  })

  it('shows the number of pending proposals and archived vulnerabilities in the tabs', async () => {
    await mountPage()
    const tabs = wrapper.findAllComponents(QTab)
    expect(tabs.map((tab) => tab.props('name'))).toEqual(['vulnerabilities', 'proposals', 'archives'])
    expect(tabs[1].text()).toContain('3')
    expect(tabs[2].text()).toContain('1')
    expect(wrapper.vm.archivedCount).toBe(1)
  })

  it('shows only the archived vulnerabilities in the archives tab', async () => {
    await mountPage()
    wrapper.vm.mainTab = 'archives'
    await flushPromises()
    expect(titles(wrapper.vm.computedVulnerabilities)).toEqual(['Old XSS'])
    expect(wrapper.text()).toContain(wrapper.vm.$t('archives.info'))
    expect(wrapper.findAllComponents(QBtnDropdown)).toHaveLength(0) // No creation in the archives
  })

  it('shows the proposals list in the proposals tab', async () => {
    await mountPage()
    expect(wrapper.find('.proposals-list-stub').exists()).toBe(false)
    wrapper.vm.mainTab = 'proposals'
    await flushPromises()
    expect(wrapper.find('.proposals-list-stub').exists()).toBe(true)
  })

  it('shows the vulnerabilities of the selected language', async () => {
    await mountPage()
    wrapper.vm.dtLanguage = 'fr'
    expect(titles(wrapper.vm.computedVulnerabilities)).toEqual(['Seulement en français'])
    expect(wrapper.vm.vulnTypeOptions).toEqual(['Undefined', 'Applicatif'])
  })

  it('asks to create a language first', async () => {
    UserService.user = { username: 'admin', roles: '*' }
    vi.spyOn(VulnerabilityService, 'getVulnerabilities').mockResolvedValue({ data: { datas: [] } })
    vi.spyOn(VulnerabilityService, 'getProposalsCount').mockResolvedValue({ data: { datas: { pending: 0 } } })
    vi.spyOn(DataService, 'getLanguages').mockResolvedValue({ data: { datas: [] } })
    vi.spyOn(DataService, 'getVulnerabilityTypes').mockResolvedValue({ data: { datas: [] } })
    vi.spyOn(DataService, 'getVulnerabilityCategories').mockResolvedValue({ data: { datas: [] } })
    vi.spyOn(DataService, 'getCustomFields').mockResolvedValue({ data: { datas: [] } })
    wrapper = mount(VulnerabilitiesPage, { global: { mocks: { $_: _, $router: { push: vi.fn() }, $settings: {} }, stubs: { QDialog: DialogStub, ProposalsList: true }, directives: { sticky: {} } } })
    await flushPromises()
    expect(wrapper.text()).toContain(wrapper.vm.$t('noLanguage'))
    expect(wrapper.find('a[href="/data/custom"]').exists()).toBe(true)
  })
})

describe('vulnerabilities page filters and sort', () => {
  it('filters by title (case and accent insensitive), category and type', async () => {
    await mountPage()
    expect(filter({ title: 'elevation' })).toEqual(['Élévation de privilèges'])
    expect(filter({ category: 'inject' })).toEqual(['SQL Injection'])
    expect(filter({ category: 'no category' })).toEqual(['Élévation de privilèges', 'Updated vuln'])
    expect(filter({ type: 'system' })).toEqual(['Élévation de privilèges'])
  })

  it('filters by status (valid, new, updates) and counts the filtered rows', async () => {
    await mountPage()
    expect(filter({ valid: false })).toEqual(['Élévation de privilèges', 'Updated vuln'])
    expect(filter({ valid: false, new: false })).toEqual(['Updated vuln'])
    expect(wrapper.vm.filteredRowsCount).toBe(1)
  })

  it('filters by last update date (day-month-year as displayed)', async () => {
    await mountPage()
    expect(wrapper.vm.getDtUpdatedAt(VULNS[0])).toBe('15-12-2024')
    expect(filter({ updatedAt: '15-12' })).toEqual(['SQL Injection'])
    expect(wrapper.vm.getDtUpdatedAt({})).toBe('Undefined')
  })

  it('sorts by title, type and category', async () => {
    await mountPage()
    const rows = wrapper.vm.computedVulnerabilities
    expect(titles(wrapper.vm.customSort(rows, 'title', false))).toEqual(['Élévation de privilèges', 'SQL Injection', 'Updated vuln'])
    expect(titles(wrapper.vm.customSort(rows, 'title', true))).toEqual(['Updated vuln', 'SQL Injection', 'Élévation de privilèges'])
    expect(titles(wrapper.vm.customSort(rows, 'type', false))[0]).toBe('Élévation de privilèges')
    expect(titles(wrapper.vm.customSort(rows, 'category', false))[0]).toBe('SQL Injection')
    expect(wrapper.vm.customSort(undefined, 'title')).toBeUndefined()
  })

  it('sorts by last update date chronologically', async () => {
    await mountPage()
    expect(titles(wrapper.vm.customSort(wrapper.vm.computedVulnerabilities, 'updatedAt', false))).toEqual(['Updated vuln', 'SQL Injection', 'Élévation de privilèges'])
  })

  it('gives the title and type of the selected language', async () => {
    await mountPage()
    expect(wrapper.vm.getDtTitle(VULNS[4])).toBe(wrapper.vm.$t('err.notDefinedLanguage'))
    expect(wrapper.vm.getDtType({ details: [{ locale: 'en', title: 'x' }] })).toBe('Undefined')
    expect(wrapper.vm.getVulnTitleLocale(VULNS[4], 'fr')).toBe('Seulement en français')
    expect(wrapper.vm.getVulnTitleLocale(VULNS[4], 'en')).toBe('undefined')
    expect(wrapper.vm.getVulnTitleLocale(null, 'en')).toBe('undefined')
  })
})

describe('vulnerabilities page actions', () => {
  it('shows the actions allowed by the permissions', async () => {
    await mountPage(['vulnerabilities:read'])
    const icons = () => wrapper.findAllComponents(QBtn).map((button) => button.props('icon'))
    expect(icons()).toContain('fa fa-eye')
    expect(icons()).toContain('fa fa-fingerprint')
    expect(icons()).not.toContain('fa fa-edit')
    expect(icons()).not.toContain('fa fa-trash')
    expect(icons()).not.toContain('mdi-archive-arrow-down-outline')
    expect(wrapper.findAllComponents(QBtnDropdown)).toHaveLength(0)
    wrapper.unmount()
    await mountPage('*')
    expect(icons()).toEqual(expect.arrayContaining(['fa fa-edit', 'fa fa-trash', 'mdi-archive-arrow-down-outline']))
    expect(wrapper.findAllComponents(QBtnDropdown)).toHaveLength(1)
  })

  it('opens the proposals of an updated vulnerability for the reviewers', async () => {
    await mountPage()
    wrapper.vm.dblClick(VULNS[3])
    expect(wrapper.vm.mainTab).toBe('proposals')
    expect(wrapper.vm.proposalsFilter).toEqual({ id: 'v4', title: 'Updated vuln' })
  })

  it('opens the vulnerability in the edit dialog otherwise', async () => {
    await mountPage(['vulnerabilities:read'])
    wrapper.vm.dblClick(VULNS[3])
    expect(wrapper.vm.mainTab).toBe('vulnerabilities')
    expect(wrapper.vm.vulnerabilityId).toBe('v4')
    expect(wrapper.vm.currentVulnerability.details[0].title).toBe('Updated vuln')
    expect(wrapper.vm.currentVulnerability).not.toBe(VULNS[3]) // Copy edited
    expect(wrapper.vm.$refs.editModal.open).toBe(true)
  })

  it('lists the audits containing a vulnerability', async () => {
    await mountPage()
    wrapper.vm.goToAudits(VULNS[0])
    expect(router.push).toHaveBeenCalledWith({ name: 'audits_by_find', params: { finding: 'SQL Injection' } })
  })

  it('archives and restores a vulnerability', async () => {
    const notify = mockNotify()
    vi.spyOn(VulnerabilityService, 'archiveVulnerability').mockResolvedValue({})
    await mountPage()
    const row = wrapper.findAll('tbody tr').find((tr) => tr.text().includes('SQL Injection'))
    await row.findAllComponents(QBtn).find((button) => button.props('icon') === 'mdi-archive-arrow-down-outline').trigger('click')
    await flushPromises()
    expect(VulnerabilityService.archiveVulnerability).toHaveBeenCalledWith('v1', true)
    expect(lastNotification(notify)).toMatchObject({ message: wrapper.vm.$t('archives.archivedOk', ['SQL Injection']), color: 'positive' })
    expect(VulnerabilityService.getVulnerabilities).toHaveBeenCalledTimes(2)
    wrapper.vm.setArchived(VULNS[2], false)
    await flushPromises()
    expect(VulnerabilityService.archiveVulnerability).toHaveBeenLastCalledWith('v3', false)
  })

  it('deletes a vulnerability after confirmation', async () => {
    const dialogs = mockDialog()
    mockNotify()
    vi.spyOn(VulnerabilityService, 'deleteVulnerability').mockResolvedValue({})
    await mountPage()
    wrapper.vm.confirmDeleteVulnerability(VULNS[0])
    expect(VulnerabilityService.deleteVulnerability).not.toHaveBeenCalled()
    dialogs[0].ok()
    await flushPromises()
    expect(VulnerabilityService.deleteVulnerability).toHaveBeenCalledWith('v1')
  })

  it('requires a title to create a vulnerability', async () => {
    vi.spyOn(VulnerabilityService, 'createVulnerabilities')
    await mountPage()
    wrapper.vm.cleanCurrentVulnerability()
    wrapper.vm.createVulnerability()
    expect(wrapper.vm.errors.title).toBe(wrapper.vm.$t('err.titleRequired'))
    expect(VulnerabilityService.createVulnerabilities).not.toHaveBeenCalled()
  })

  it('creates a vulnerability with the details of the current language and the category', async () => {
    mockNotify()
    vi.spyOn(VulnerabilityService, 'createVulnerabilities').mockResolvedValue({})
    await mountPage()
    wrapper.vm.currentCategory = { name: 'Injection' }
    wrapper.vm.cleanCurrentVulnerability()
    wrapper.vm.currentVulnerability.details[0].title = 'New vuln'
    wrapper.vm.$refs.createModal.show()
    wrapper.vm.createVulnerability()
    await flushPromises()
    const [[[sent]]] = VulnerabilityService.createVulnerabilities.mock.calls // createVulnerabilities([vulnerability])
    expect(sent).toMatchObject({ category: 'Injection', details: [{ locale: 'en', title: 'New vuln', references: [], customFields: [] }] })
    expect(wrapper.vm.$refs.createModal.open).toBe(false)
  })

  it('merges two vulnerabilities', async () => {
    mockNotify()
    vi.spyOn(VulnerabilityService, 'mergeVulnerability').mockResolvedValue({})
    await mountPage()
    Object.assign(wrapper.vm, { mergeVulnLeft: 'v1', mergeVulnRight: 'v5', mergeLanguageRight: 'fr', mergeLanguageLeft: 'en' })
    expect(wrapper.vm.filteredVulnerabilitiesRight.map((v) => v._id)).toEqual(['v5'])
    expect(wrapper.vm.filteredVulnerabilitiesLeft.map((v) => v._id)).toEqual(['v1', 'v2', 'v3', 'v4'])
    wrapper.vm.mergeVulnerabilities()
    await flushPromises()
    expect(VulnerabilityService.mergeVulnerability).toHaveBeenCalledWith('v1', 'v5', 'fr')
  })
})

describe('quality checks of the vulnerability database', () => {
  const ISSUES = [
    { fingerprint: 'a'.repeat(20), check: 'duplicates', severity: 'warning', code: 'duplicateTitle', params: { other: 'sql-injection', otherId: 'v9' }, location: { kind: 'vulnerability', id: 'v1', name: 'SQL Injection', field: null, label: null, locale: 'en' } },
    { fingerprint: 'b'.repeat(20), check: 'references', severity: 'warning', code: 'referenceInvalid', params: { reference: 'htps://x.y' }, location: { kind: 'vulnerability', id: 'v4', name: 'Updated vuln', field: 'references', label: null, locale: 'en' } },
    { fingerprint: 'c'.repeat(20), check: 'duplicates', severity: 'info', code: 'similarTitle', params: { other: 'x' }, location: { kind: 'vulnerability', id: 'v404', name: 'Deleted', field: null, label: null, locale: 'en' } }
  ]

  it('is offered to the users allowed to update the vulnerabilities', async () => {
    await mountPage(['vulnerabilities:read'])
    expect(wrapper.find('.vulnerabilities-qa-button').exists()).toBe(false)
    wrapper.unmount()
    await mountPage()
    expect(wrapper.find('.vulnerabilities-qa-button').exists()).toBe(true)
  })

  it('lists the issues of the database with their place and message, and their counts', async () => {
    vi.spyOn(VulnerabilityService, 'getVulnerabilitiesQa').mockResolvedValue({ data: { datas: { issues: ISSUES } } })
    await mountPage()
    wrapper.vm.openQa()
    await flushPromises()
    expect(wrapper.vm.qa.show).toBe(true)
    expect(wrapper.vm.qa.issues).toEqual(ISSUES)
    expect(wrapper.vm.qaSummary).toBe('0 errors, 2 warnings, 1 information')
    expect(ISSUES.map((issue) => [wrapper.vm.qaPlace(issue), wrapper.vm.qaMessage(issue)])).toEqual([
      ['SQL Injection (en)', 'Same title as "sql-injection"'],
      ['Updated vuln (en) · References', 'Invalid link: "htps://x.y"'],
      ['Deleted (en)', 'Title very similar to "x"']
    ])
  })

  it('opens the vulnerability of an issue (edition, or proposals of an updated vulnerability)', async () => {
    vi.spyOn(VulnerabilityService, 'getVulnerabilitiesQa').mockResolvedValue({ data: { datas: { issues: ISSUES } } })
    await mountPage()
    const proposals = vi.spyOn(wrapper.vm, 'openVulnerabilityProposals').mockImplementation(() => {})
    wrapper.vm.openQa()
    await flushPromises()
    wrapper.vm.openQaIssue(ISSUES[0])
    expect(wrapper.vm.qa.show).toBe(false)
    expect(wrapper.vm.vulnerabilityId).toBe('v1')
    expect(wrapper.vm.$refs.editModal.open).toBe(true)
    wrapper.vm.openQaIssue(ISSUES[1])
    expect(proposals).toHaveBeenCalledWith(expect.objectContaining({ _id: 'v4' }))
    wrapper.vm.qa.show = true
    wrapper.vm.openQaIssue(ISSUES[2]) // Deleted meanwhile: nothing opened
    expect(wrapper.vm.qa.show).toBe(true)
  })

  it('shows the error of the checks', async () => {
    vi.spyOn(VulnerabilityService, 'getVulnerabilitiesQa').mockRejectedValue({ response: { data: { datas: 'Insufficient privileges' } } })
    await mountPage()
    wrapper.vm.openQa()
    await flushPromises()
    expect(wrapper.vm.qa.error).toBe('Insufficient privileges')
  })
})
