// pages/data/dump: import / export of the data, backups tab (BackupsManager stubbed, API services mocked)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import _ from 'lodash'
import YAML from 'js-yaml'
import { QTab } from 'quasar'

vi.mock('components/editor', () => import('../../helpers/editor-stub'))
vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import DumpPage from 'pages/data/dump'
import VulnerabilityService from '@/services/vulnerability'
import CompanyService from '@/services/company'
import ClientService from '@/services/client'
import UserService from '@/services/user'
import CollabService from '@/services/collaborator'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'
import { trackFileReads } from '../../helpers/data-pages'

let wrapper
let fileReadsDone

function mountPage(roles = '*') {
  UserService.user = { username: 'admin', roles }
  wrapper = mount(DumpPage, { global: { mocks: { $_: _ }, stubs: { BackupsManager: { name: 'BackupsManager', template: '<div class="backups-manager-stub" />' } } } })
  return wrapper
}

// Files read by FileReader (asynchronous in jsdom): waits for the end of the readings
async function importFiles(method, files) {
  wrapper.vm[method](files)
  await fileReadsDone()
}

const yamlFile = (content, name = 'vulns.yml') => new File([content], name, { type: 'application/yaml' })

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  fileReadsDone = trackFileReads()
})
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('data dump tabs', () => {
  it.each([
    ['*', true],
    [['backups:read'], true],
    [['backups:create'], true],
    [['vulnerabilities:read', 'companies:read'], false]
  ])('shows the backups tab according to the permissions %j', (roles, visible) => {
    mountPage(roles)
    const tabs = wrapper.findAllComponents(QTab).map((tab) => tab.props('name'))
    expect(tabs).toEqual(visible ? ['vulnerabilities', 'companies', 'collaborators', 'backup'] : ['vulnerabilities', 'companies', 'collaborators'])
  })

  it('shows the vulnerabilities tab first and the backups manager in its tab', async () => {
    mountPage()
    expect(wrapper.vm.selectedTab).toBe('vulnerabilities')
    expect(wrapper.find('.backups-manager-stub').exists()).toBe(false)
    wrapper.vm.selectedTab = 'backup'
    await flushPromises()
    expect(wrapper.find('.backups-manager-stub').exists()).toBe(true)
  })
})

describe('vulnerabilities import', () => {
  beforeEach(() => {
    mockNotify()
    vi.spyOn(VulnerabilityService, 'createVulnerabilities').mockResolvedValue({ data: { datas: { created: 2, duplicates: 0 } } })
  })

  it('imports a YAML file and copies the global references into the details without references', async () => {
    mountPage()
    const content = YAML.safeDump([
      { cvssv3: 'CVSS:3.1/AV:N', references: ['https://owasp.org'], details: [{ locale: 'en', title: 'SQLi' }, { locale: 'fr', title: 'Injection', references: ['https://anssi.fr'] }] },
      { details: [{ locale: 'en', title: 'XSS', references: [] }] }
    ])
    await importFiles('importVulnerabilities', [yamlFile(content)])
    const [sent] = VulnerabilityService.createVulnerabilities.mock.calls[0]
    expect(sent[0].details.map((d) => d.references)).toEqual([['https://owasp.org'], ['https://anssi.fr']])
    expect(sent[1].details[0].references).toEqual([])
  })

  it('imports a YAML file containing a single vulnerability', async () => {
    mountPage()
    await importFiles('importVulnerabilities', [yamlFile(YAML.safeDump({ details: [{ locale: 'en', title: 'One' }] }))])
    expect(VulnerabilityService.createVulnerabilities).toHaveBeenCalledWith([{ details: [{ locale: 'en', title: 'One' }] }])
  })

  it('imports a JSON export of pwndoc', async () => {
    mountPage()
    const vulns = [{ details: [{ locale: 'en', title: 'JSON vuln' }] }]
    await importFiles('importVulnerabilities', [new File([JSON.stringify(vulns)], 'export.json')])
    expect(VulnerabilityService.createVulnerabilities).toHaveBeenCalledWith(vulns)
  })

  it('converts a Serpico JSON export', async () => {
    mountPage()
    const serpico = [{
      id: 1, title: 'Weak <h4>TLS</h4>', language: 'English', type: 'Network', c3_vs: 'CVSS:3.0/AV:N',
      overview: '<paragraph>Intro</paragraph><paragraph><bullet>point</bullet></paragraph>',
      poc: '[[[openssl s_client]]]', remediation: '<paragraph><italics>Disable</italics> &amp; renew</paragraph>\n',
      references: '<paragraph>https://a</paragraph><paragraph>https://b</paragraph>'
    }]
    await importFiles('importVulnerabilities', [new File([JSON.stringify(serpico)], 'serpico.json')])
    expect(VulnerabilityService.createVulnerabilities).toHaveBeenCalledWith([{
      cvssv3: 'CVSS:3.0/AV:N', priority: null, remediationComplexity: null,
      details: [{
        locale: 'en', title: 'Weak <b>TLS</b>', vulnType: 'Network',
        description: '<p>Intro</p><li><p>point</p></li>', observation: '<pre><code>openssl s_client</code></pre>',
        remediation: '<p><i>Disable</i> & renew</p>', references: ['https://a', 'https://b']
      }]
    }])
  })

  it('formats the Serpico texts', () => {
    mountPage()
    const { formatSerpicoText } = wrapper.vm
    expect(formatSerpicoText(null)).toBeNull()
    expect(formatSerpicoText('French')).toBe('fr')
    expect(formatSerpicoText('<indented>code</indented>')).toBe('    code')
    expect(formatSerpicoText('<paragraph><bullet1>nested</bullet1></paragraph>')).toBe('<li><p>nested</p></li>')
    expect(formatSerpicoText('l&#39;injection')).toBe("l'injection")
  })

  it('notifies the YAML syntax errors with their position and imports nothing', async () => {
    const notify = mockNotify()
    mountPage()
    await importFiles('importVulnerabilities', [yamlFile('- details: [\n  bad: : yaml')])
    expect(VulnerabilityService.createVulnerabilities).not.toHaveBeenCalled()
    expect(lastNotification(notify).message).toMatch(/^Parsing Error: line \d+, column: \d+$/)
    expect(lastNotification(notify).color).toBe('negative')
  })

  it('notifies the JSON syntax errors and imports nothing', async () => {
    const notify = mockNotify()
    mountPage()
    await importFiles('importVulnerabilities', [new File(['{not json'], 'bad.json')])
    expect(VulnerabilityService.createVulnerabilities).not.toHaveBeenCalled()
    expect(lastNotification(notify).message).toMatch(/^Parsing Error:\s.*JSON/) // (non-breaking space in the message)
  })

  it.each([
    [{ created: 3, duplicates: 0 }, 'positive'],
    [{ created: 1, duplicates: ['dup'] }, 'orange']
  ])('notifies the result of the import %j', async (result, color) => {
    const notify = mockNotify()
    VulnerabilityService.createVulnerabilities.mockResolvedValue({ data: { datas: result } })
    mountPage()
    wrapper.vm.vulnerabilities = [{}]
    wrapper.vm.createVulnerabilities()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ color, html: true })
  })

  it('notifies the error of the server', async () => {
    const notify = mockNotify()
    VulnerabilityService.createVulnerabilities.mockRejectedValue({ response: { data: { datas: 'Vulnerability title already exists: SQLi' } } })
    mountPage()
    wrapper.vm.createVulnerabilities()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Vulnerability title already exists: SQLi', color: 'negative' })
  })
})

describe('exports', () => {
  let saved
  beforeEach(() => {
    saved = []
    URL.createObjectURL = vi.fn((blob) => { saved.push(blob); return 'blob:export' })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { saved.name = this.download })
  })

  it.each([
    ['getVulnerabilities', VulnerabilityService, 'exportVulnerabilities', 'vulnerabilities.yml'],
    ['getCompanies', CompanyService, 'exportCompanies', 'companies.yml'],
    ['getClients', ClientService, 'exportClients', 'clients.yml'],
    ['getCollaborators', UserService, 'exportUsers', 'users.yml']
  ])('%s downloads the export as YAML', async (method, service, exportFn, fileName) => {
    const data = [{ name: 'ACME', details: [{ title: 'été' }] }]
    vi.spyOn(service, exportFn).mockResolvedValue({ data: { datas: data } })
    mountPage()
    wrapper.vm[method]()
    await flushPromises()
    expect(saved.name).toBe(fileName)
    expect(saved[0].type).toBe('application/yaml')
    expect(YAML.safeLoad(await saved[0].text())).toEqual(data)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export')
  })
})

describe('companies and clients import', () => {
  beforeEach(() => mockNotify())

  it('imports the companies of a YAML file', async () => {
    vi.spyOn(CompanyService, 'createCompanies').mockResolvedValue({ data: { datas: { created: 1, duplicates: 0 } } })
    mountPage()
    await importFiles('importCompanies', [yamlFile(YAML.safeDump([{ name: 'ACME', shortName: 'AC' }]), 'companies.yml')])
    expect(CompanyService.createCompanies).toHaveBeenCalledWith([{ name: 'ACME', shortName: 'AC' }])
  })

  it('imports the clients of a YAML file', async () => {
    vi.spyOn(ClientService, 'createClients').mockResolvedValue({ data: { datas: { created: 1, duplicates: 0 } } })
    mountPage()
    await importFiles('importClients', [yamlFile(YAML.safeDump({ email: 'a@acme.com', company: { name: 'ACME' } }), 'clients.yml')])
    expect(ClientService.createClients).toHaveBeenCalledWith([{ email: 'a@acme.com', company: { name: 'ACME' } }])
  })

  it('imports the companies, clients and collaborators of JSON files (several files merged)', async () => {
    vi.spyOn(CompanyService, 'createCompanies').mockResolvedValue({ data: { datas: { created: 2, duplicates: 0 } } })
    vi.spyOn(CollabService, 'createCollab').mockResolvedValue({ data: { datas: { created: 1, duplicates: 0 } } })
    mountPage()
    await importFiles('importCompanies', [
      new File([JSON.stringify([{ name: 'ACME' }])], 'companies.json'),
      yamlFile(YAML.safeDump({ name: 'Globex' }), 'more.yml')
    ])
    expect(CompanyService.createCompanies).toHaveBeenCalledTimes(1)
    expect(_.sortBy(CompanyService.createCompanies.mock.calls[0][0], 'name')).toEqual([{ name: 'ACME' }, { name: 'Globex' }])
    await importFiles('importCollaborators', [new File([JSON.stringify({ username: 'bob' })], 'users.JSON')])
    expect(CollabService.createCollab).toHaveBeenCalledWith([{ username: 'bob' }])
  })

  it('shows the error of an unreadable JSON file and sends nothing', async () => {
    const notify = mockNotify()
    vi.spyOn(ClientService, 'createClients')
    mountPage()
    await importFiles('importClients', [new File(['[{"email": '], 'clients.json')])
    expect(ClientService.createClients).not.toHaveBeenCalled()
    expect(lastNotification(notify).color).toBe('negative')
    expect(lastNotification(notify).message).toMatch(/^Parsing Error/)
    await importFiles('importClients', [new File(['"text"'], 'clients.json')])
    expect(lastNotification(notify).message).toBe('Invalid JSON format detected')
    expect(ClientService.createClients).not.toHaveBeenCalled()
  })
})

describe('delete all', () => {
  it.each([
    ['deleteAllVulnerabilities', VulnerabilityService, 'deleteAllVulnerabilities'],
    ['deleteAllCompanies', CompanyService, 'deleteAllCompanies'],
    ['deleteAllClients', ClientService, 'deleteAllClients']
  ])('%s asks for a confirmation before deleting', async (method, service, deleteFn) => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(service, deleteFn).mockResolvedValue({})
    mountPage()
    wrapper.vm[method]()
    expect(service[deleteFn]).not.toHaveBeenCalled()
    expect(dialogs[0].options.ok.color).toBe('negative')
    dialogs[0].ok()
    await flushPromises()
    expect(service[deleteFn]).toHaveBeenCalledTimes(1)
    expect(lastNotification(notify).color).toBe('positive')
  })

  it('does not delete when cancelled', () => {
    const dialogs = mockDialog()
    vi.spyOn(VulnerabilityService, 'deleteAllVulnerabilities')
    mountPage()
    wrapper.vm.deleteAllVulnerabilities()
    dialogs[0].cancel()
    expect(VulnerabilityService.deleteAllVulnerabilities).not.toHaveBeenCalled()
  })
})
