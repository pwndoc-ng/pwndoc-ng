// pages/audits/edit/findings/add: findings added from the vulnerabilities database (search by language, category,
// type) or created manually (with or without category). API services mocked.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import _ from 'lodash'
import { QSelect, QInput, QBtn, QItem, QTable } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import AddPage from 'pages/audits/edit/findings/add'
import AuditService from '@/services/audit'
import VulnService from '@/services/vulnerability'
import DataService from '@/services/data'
import UserService from '@/services/user'
import Utils from '@/services/utils'
import { mockNotify, lastNotification } from '../../helpers/quasar'
import { installAppGlobals, fakeSocket, settings, route, apiError, ok } from '../../helpers/audit-edit'

const S = Utils.AUDIT_VIEW_STATE
const CRITICAL = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'

const vuln = (id, title, extra = {}, detail = {}) => ({
  _id: id, cvssv3: '', priority: 2, remediationComplexity: 1,
  detail: { locale: 'fr', title, vulnType: 'Web', description: '<p>Description</p>', observation: '<p>Observation</p>', remediation: '<p>Correctif</p>', references: ['https://owasp.org'], customFields: [], ...detail },
  ...extra
})

const VULNS = [
  vuln('v1', 'Injection SQL', { category: 'Injection', cvssv3: CRITICAL }, { customFields: [{ customField: 'cf1', text: 'Élevé' }] }),
  vuln('v2', 'Élévation de privilèges', {}, { vulnType: 'Système' }),
  vuln('v3', 'XSS stockée', { category: 'Injection' }, { vulnType: undefined, description: '<p>ok</p><img src=x onerror="alert(1)"><script>alert(2)</script>' }),
  { _id: 'v4', category: 'Injection', detail: { locale: 'fr' } } // Without title in this language
]
const CATEGORIES = [{ name: 'Injection' }, { name: 'Réseau' }]
// Custom fields of the audit edit page (index.vue): fields of the findings and vulnerabilities
const CUSTOM_FIELDS = [
  { _id: 'cf1', label: 'Impact', fieldType: 'input', display: 'vulnerability', displaySub: '', text: [{ locale: 'fr', value: 'Moyen' }] },
  { _id: 'cf2', label: 'Owner', fieldType: 'input', display: 'finding', displaySub: '', text: [] },
  { _id: 'cf3', label: 'Injection only', fieldType: 'select-multiple', display: 'finding', displaySub: 'Injection' },
  { _id: 'cf4', label: 'Audit field', fieldType: 'input', display: 'general', displaySub: '' }
]

let wrapper
let socket

function mockApi({ vulns = VULNS, audit = { _id: 'a1', name: 'Audit', language: 'fr' } } = {}) {
  vi.spyOn(DataService, 'getLanguages').mockImplementation(() => ok([{ locale: 'en', language: 'English' }, { locale: 'fr', language: 'Français' }]))
  vi.spyOn(AuditService, 'getAudit').mockImplementation(() => ok(audit))
  if (vulns && vulns.response) vi.spyOn(VulnService, 'getVulnByLanguage').mockRejectedValue(vulns)
  else vi.spyOn(VulnService, 'getVulnByLanguage').mockImplementation(() => ok(_.cloneDeep(vulns)))
  vi.spyOn(DataService, 'getVulnerabilityCategories').mockImplementation(() => ok(CATEGORIES))
}

const globalOptions = () => ({ mocks: { $route: route('addFindings'), $router: { push: vi.fn() }, $settings: settings(), $socket: socket, $_: _ } })

async function mountAdd(api = {}) {
  UserService.user = { id: 'u1', username: 'author', roles: '*' }
  mockApi(api)
  socket = fakeSocket()
  wrapper = mount(AddPage, { props: { frontEndAuditState: S.EDIT }, global: globalOptions() })
  await flushPromises()
  return wrapper
}

// Page rendered directly by a parent holding the custom fields (as the router-view of vue-router 3 did)
async function mountInParent(api = {}) {
  UserService.user = { id: 'u1', username: 'author', roles: '*' }
  mockApi(api)
  socket = fakeSocket()
  wrapper = mount({ components: { AddPage }, data: () => ({ customFields: CUSTOM_FIELDS }), template: '<add-page :frontEndAuditState="0" />' }, { global: globalOptions() })
  await flushPromises()
  return wrapper.findComponent(AddPage).vm
}

const vm = () => wrapper.findComponent(AddPage).vm
const t = (key) => vm().$t(key)
const terms = (search = {}) => ({ title: '', category: '', vulnType: '', ...search })
const filterTitles = (search) => vm().customFilter(vm().vulnerabilities, terms(search)).map((row) => row.detail.title)
const rowsText = () => wrapper.findAll('tbody tr').map((row) => row.text())

beforeAll(() => installAppGlobals())
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('add findings page loading', () => {
  it('loads the vulnerabilities of the language of the audit', async () => {
    await mountAdd()
    expect(DataService.getLanguages).toHaveBeenCalled()
    expect(AuditService.getAudit).toHaveBeenCalledWith('a1')
    expect(VulnService.getVulnByLanguage).toHaveBeenCalledWith('fr')
    expect(DataService.getVulnerabilityCategories).toHaveBeenCalled()
    expect(socket.emit).toHaveBeenCalledWith('menu', { menu: 'addFindings', room: 'a1' })
    expect(vm().dtLanguage).toBe('fr')
    expect(vm().loading).toBe(false)
  })

  it('shows the vulnerabilities with their category and type', async () => {
    await mountAdd()
    const text = wrapper.find('tbody').text()
    expect(text).toContain('Injection SQL')
    expect(text).toContain('Élévation de privilèges')
    expect(text).toContain(t('noCategory'))
    expect(text).toContain('Système')
    expect(text).toContain(t('undefined'))
    expect(wrapper.findAllComponents(QBtn).filter((button) => button.props('icon') === 'fa fa-plus-circle')).toHaveLength(3)
  })

  it('loads the vulnerabilities of the language selected in the table', async () => {
    await mountAdd()
    const language = wrapper.findAllComponents(QSelect).find((s) => s.props('label') === t('language'))
    expect(language.props('options').map((l) => l.locale)).toEqual(['en', 'fr'])
    language.vm.$emit('update:modelValue', 'en')
    await flushPromises()
    expect(vm().dtLanguage).toBe('en')
    expect(VulnService.getVulnByLanguage).toHaveBeenLastCalledWith('en')
  })

  it('shows an empty database', async () => {
    await mountAdd({ vulns: [] })
    expect(vm().vulnerabilities).toEqual([])
    expect(vm().vulnCategoriesOptions).toEqual([])
    expect(vm().vulnTypeOptions).toEqual([])
    expect(wrapper.find('.q-table__bottom--nodata').exists()).toBe(true)
  })

  it('shows the number of vulnerabilities of a database with a single vulnerability', async () => {
    await mountAdd({ vulns: [VULNS[0]] })
    expect(wrapper.text()).toContain(`1 / 1 ${t('vulnerabilityNum1')}`)
  })

  // Footer: number of the rows shown by the filters of the table (not "0 / N vulnerabilities")
  it('shows the number of vulnerabilities shown by the filters in the footer', async () => {
    await mountAdd()
    expect(wrapper.text()).toContain(`3 / 4 ${t('vulnerabilitiesNums')}`)
    vm().search.title = 'injection'
    await flushPromises()
    expect(wrapper.text()).toContain(`1 / 4 ${t('vulnerabilitiesNums')}`)
  })

  // The table would keep its loading bar, nothing notified
  it('stops loading when the vulnerabilities cannot be loaded', async () => {
    const notify = mockNotify()
    await mountAdd({ vulns: apiError(500, 'Internal error') })
    expect(vm().loading).toBe(false)
    expect(lastNotification(notify)).toMatchObject({ message: 'Internal error', color: 'negative' })
  })

  it('keeps the previous list when the vulnerabilities of a language cannot be loaded', async () => {
    await mountAdd()
    VulnService.getVulnByLanguage.mockRejectedValue(apiError(500, 'Internal error'))
    vm().dtLanguage = 'en'
    vm().getVulnerabilities()
    await flushPromises()
    expect(vm().vulnerabilities).toHaveLength(4)
  })

  it('shows the description of the vulnerabilities sanitized', async () => {
    await mountAdd()
    const descriptions = wrapper.findAll('.editor__content').map((element) => element.html())
    const xss = descriptions.find((html) => html.includes('<p>ok</p>'))
    expect(xss).toContain('<p>ok</p><img>') // Invalid image source removed too
    expect(xss).not.toContain('onerror')
    expect(xss).not.toContain('<script')
  })
})

describe('add findings filters', () => {
  it('excludes the vulnerabilities without title and filters by title, category and type (case insensitive)', async () => {
    await mountAdd()
    expect(filterTitles()).toEqual(['Injection SQL', 'Élévation de privilèges', 'XSS stockée'])
    expect(vm().filteredRowsCount).toBe(3)
    expect(filterTitles({ title: 'INJECTION' })).toEqual(['Injection SQL'])
    expect(filterTitles({ title: 'élévation' })).toEqual(['Élévation de privilèges'])
    expect(filterTitles({ category: 'inject' })).toEqual(['Injection SQL', 'XSS stockée'])
    expect(filterTitles({ vulnType: 'sys' })).toEqual(['Élévation de privilèges'])
    expect(filterTitles({ title: 'xss', category: 'injection' })).toEqual(['XSS stockée'])
    expect(filterTitles({ title: 'absent' })).toEqual([])
    expect(vm().filteredRowsCount).toBe(0)
  })

  it('filters the rows of the table with the search inputs', async () => {
    await mountAdd()
    vm().search.title = 'stockée'
    await flushPromises()
    expect(rowsText().some((text) => text.includes('XSS stockée'))).toBe(true)
    expect(rowsText().some((text) => text.includes('Injection SQL'))).toBe(false)
  })

  it('offers the categories and types of the vulnerabilities (once each)', async () => {
    await mountAdd()
    expect(vm().vulnCategoriesOptions).toEqual(['Injection', t('noCategory')])
    expect(vm().vulnTypeOptions).toEqual(['Web', 'Système', t('undefined')])
  })

  // The "No Category" (and "Undefined" type) options of the filters match the empty categories / types
  it('shows the vulnerabilities without category with the "No Category" filter', async () => {
    await mountAdd()
    expect(filterTitles({ category: t('noCategory') })).toEqual(['Élévation de privilèges'])
    expect(filterTitles({ vulnType: t('undefined') })).toEqual(['XSS stockée'])
  })

  it('handles the cleared filters (null values of the clearable inputs)', async () => {
    await mountAdd()
    expect(vm().customFilter(vm().vulnerabilities, { title: null, category: null, vulnType: null })).toHaveLength(3)
  })
})

describe('findings added from the database', () => {
  it('adds a vulnerability of the database to the audit', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'createFinding').mockResolvedValue({})
    await mountAdd()
    const row = wrapper.findAll('tbody tr').find((tr) => tr.text().includes('Injection SQL'))
    await row.findAllComponents(QBtn).find((button) => button.props('icon') === 'fa fa-plus-circle').trigger('click')
    await flushPromises()
    expect(AuditService.createFinding).toHaveBeenCalledWith('a1', {
      title: 'Injection SQL', vulnType: 'Web', description: '<p>Description</p>', observation: '<p>Observation</p>',
      remediation: '<p>Correctif</p>', remediationComplexity: 1, priority: 2, references: ['https://owasp.org'],
      cvssv3: CRITICAL, category: 'Injection', customFields: [{ customField: 'cf1', text: 'Élevé' }]
    })
    expect(lastNotification(notify)).toMatchObject({ message: t('msg.findingCreateOk'), color: 'positive' })
  })

  it('notifies the error of the server', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'createFinding').mockRejectedValue(apiError(403, 'Audit not found or Insufficient Privileges'))
    await mountAdd()
    vm().addFindingFromVuln(VULNS[1])
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Audit not found or Insufficient Privileges', color: 'negative' })
  })

  it('does nothing without vulnerability', async () => {
    vi.spyOn(AuditService, 'createFinding')
    await mountAdd()
    vm().addFindingFromVuln(null)
    expect(AuditService.createFinding).not.toHaveBeenCalled()
  })
})

describe('findings created manually', () => {
  const titleInput = () => wrapper.findAllComponents(QInput).find((input) => input.props('label') === t('title'))

  it('requires a title', async () => {
    vi.spyOn(AuditService, 'createFinding')
    await mountAdd()
    vm().addFinding()
    vm().addFinding({ name: 'Injection' })
    expect(AuditService.createFinding).not.toHaveBeenCalled()
  })

  it('creates a finding without category with Enter and clears the title', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'createFinding').mockResolvedValue({})
    await mountAdd()
    await titleInput().find('input').setValue('Mot de passe faible 🔑')
    await titleInput().find('input').trigger('keyup', { key: 'Enter' })
    await flushPromises()
    const [auditId, finding] = AuditService.createFinding.mock.calls[0]
    expect(auditId).toBe('a1')
    expect(finding).toMatchObject({ title: 'Mot de passe faible 🔑', vulnType: '', description: '', references: [], cvssv3: '' })
    expect(finding.category).toBeUndefined()
    expect(vm().findingTitle).toBe('')
    expect(lastNotification(notify)).toMatchObject({ message: t('msg.findingCreateOk'), color: 'positive' })
  })

  it('creates a finding in a category of the menu', async () => {
    mockNotify()
    vi.spyOn(AuditService, 'createFinding').mockResolvedValue({})
    await mountAdd()
    vm().findingTitle = 'Port ouvert'
    vm().addFinding(CATEGORIES[1])
    await flushPromises()
    expect(AuditService.createFinding.mock.calls[0][1]).toMatchObject({ title: 'Port ouvert', category: 'Réseau' })
  })

  it('lists the categories in the creation menu', async () => {
    await mountAdd()
    expect(vm().vulnCategories.map((category) => category.name)).toEqual(['Injection', 'Réseau'])
  })

  it('keeps the title when the creation fails', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'createFinding').mockRejectedValue(apiError(500, 'Internal error'))
    await mountAdd()
    vm().findingTitle = 'Titre'
    vm().addFinding()
    await flushPromises()
    expect(vm().findingTitle).toBe('Titre')
    expect(lastNotification(notify)).toMatchObject({ message: 'Internal error', color: 'negative' })
  })

  it('gives the custom fields of the audit edit page with the default texts of the language', async () => {
    mockNotify()
    vi.spyOn(AuditService, 'createFinding').mockResolvedValue({})
    const page = await mountInParent()
    page.findingTitle = 'Titre'
    page.addFinding()
    await flushPromises()
    const fields = AuditService.createFinding.mock.calls[0][1].customFields
    expect(fields.map((field) => field.customField._id)).toEqual(expect.arrayContaining(['cf1', 'cf2']))
    expect(fields.map((field) => field.customField._id)).not.toContain('cf3') // Other category
    expect(fields.map((field) => field.customField._id)).not.toContain('cf4') // Not a finding field
    expect(fields.find((field) => field.customField._id === 'cf1').text).toBe('Moyen')
  })

  // The custom fields of the 'finding' page already contain the 'vulnerability' fields (Utils.filterCustomFields)
  it('gives each custom field once', async () => {
    mockNotify()
    vi.spyOn(AuditService, 'createFinding').mockResolvedValue({})
    const page = await mountInParent()
    page.findingTitle = 'Titre'
    page.addFinding({ name: 'Injection' })
    await flushPromises()
    const ids = AuditService.createFinding.mock.calls[0][1].customFields.map((field) => field.customField._id)
    expect(ids.sort()).toEqual(['cf1', 'cf2', 'cf3'])
  })

  // With vue-router 4 the parent of the page is the RouterView, not the audit edit page
  it('gives the custom fields of the audit edit page when rendered by its router-view', async () => {
    mockNotify()
    vi.spyOn(AuditService, 'createFinding').mockResolvedValue({})
    mockApi()
    socket = fakeSocket()
    const EditPage = { data: () => ({ customFields: CUSTOM_FIELDS }), template: '<router-view :frontEndAuditState="0" />' }
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/audits/:auditId', component: EditPage, children: [{ path: 'findings/add', name: 'addFindings', component: AddPage }] }] })
    router.push('/audits/a1/findings/add')
    await router.isReady()
    wrapper = mount({ template: '<router-view />' }, { global: { plugins: [router], mocks: { $settings: settings(), $socket: socket, $_: _ } } })
    await flushPromises()
    vm().findingTitle = 'Titre'
    vm().addFinding()
    await flushPromises()
    expect(AuditService.createFinding.mock.calls[0][1].customFields.map((field) => field.customField._id)).toEqual(expect.arrayContaining(['cf1', 'cf2']))
  })

  // The title is cleared only when the server answers: Enter pressed twice (or two clicks on a category) while the
  // creation is pending would create the finding twice
  it('creates the finding once when Enter is pressed twice', async () => {
    mockNotify()
    vi.spyOn(AuditService, 'createFinding').mockReturnValue(new Promise(() => {}))
    await mountAdd()
    vm().findingTitle = 'Doublon'
    vm().addFinding()
    vm().addFinding()
    vm().addFinding(CATEGORIES[0])
    expect(AuditService.createFinding).toHaveBeenCalledTimes(1)
  })

  it('creates another finding once the creation is answered, even after a failure', async () => {
    mockNotify()
    vi.spyOn(AuditService, 'createFinding').mockRejectedValue(apiError(500, 'Internal error'))
    await mountAdd()
    vm().findingTitle = 'Titre'
    vm().addFinding()
    await flushPromises()
    vm().addFinding()
    expect(AuditService.createFinding).toHaveBeenCalledTimes(2)
  })
})
