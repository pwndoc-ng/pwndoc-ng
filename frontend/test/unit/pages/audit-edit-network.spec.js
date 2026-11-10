// pages/audits/edit/network: hosts of the scopes of the audit (import of Nmap / Nessus scans, hosts and services,
// save, ctrl+s, unsaved changes, read-only states). API services mocked.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import _ from 'lodash'
import { QBtn, QSelect, QChip, QTable, QBtnDropdown } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import NetworkPage from 'pages/audits/edit/network'
import AuditService from '@/services/audit'
import UserService from '@/services/user'
import Utils from '@/services/utils'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'
import { installAppGlobals, fakeSocket, settings, route, pressSave, apiError, ok } from '../../helpers/audit-edit'

const S = Utils.AUDIT_VIEW_STATE

// General data: the scope is given as names by the API
const GENERAL = { _id: 'a1', name: 'Pentest Été', auditType: 'Web', language: 'fr', scope: ['LAN', 'DMZ 🌐'] }
const SSH = { port: '22', protocol: 'tcp', name: 'ssh', product: 'OpenSSH', version: '9.6' }
const NETWORK = {
  _id: 'a1',
  scope: [
    { name: 'LAN', hosts: [{ ip: '10.0.0.1', hostname: 'srv-01', os: 'Linux', services: [SSH, { port: '443', protocol: 'tcp', name: 'https', product: 'nginx', version: '1.25' }] }] },
    { name: 'DMZ 🌐', hosts: [] }
  ]
}

const NMAP = `<?xml version="1.0"?>
<nmaprun>
  <host><status state="up"/><address addr="10.0.0.5" addrtype="ipv4"/>
    <hostnames><hostname name="user.local" type="user"/><hostname name="web.acme.fr" type="PTR"/></hostnames>
    <ports>
      <port protocol="tcp" portid="80"><state state="open"/><service name="http" product="Apache httpd" version="2.4.58"/></port>
      <port protocol="tcp" portid="25"><state state="closed"/><service name="smtp"/></port>
      <port protocol="udp" portid="161"><state state="open"/></port>
    </ports>
    <os><osmatch><osclass osfamily="Linux"/></osmatch></os>
  </host>
  <host><status state="down"/><address addr="10.0.0.6" addrtype="ipv4"/></host>
  <host><status state="up"/><address addr="10.0.0.7" addrtype="ipv4"/><ports></ports><os></os></host>
</nmaprun>`

const NESSUS = `<?xml version="1.0"?>
<NessusClientData_v2><Report name="scan">
  <ReportHost name="192.168.1.10"><HostProperties>
    <tag name="host-ip">192.168.1.10</tag><tag name="operating-system">Windows Server 2022</tag>
    <tag name="netbios-name">DC01</tag><tag name="host-fqdn">dc01.corp.local</tag>
  </HostProperties>
    <ReportItem port="0" protocol="tcp" svc_name="general"/>
    <ReportItem port="445" protocol="tcp" svc_name="cifs" svc_product="Samba" svc_version="4.19"/>
    <ReportItem port="445" protocol="tcp" svc_name="cifs" svc_product="Samba" svc_version="4.19"/>
    <ReportItem port="3389" protocol="tcp"/>
  </ReportHost>
  <ReportHost name="fileserver"><HostProperties><tag name="netbios-name">FS01</tag></HostProperties></ReportHost>
</Report></NessusClientData_v2>`

let wrapper
let socket

function mockApi({ general = GENERAL, network = NETWORK } = {}) {
  vi.spyOn(AuditService, 'getAuditGeneral').mockImplementation(() => ok(_.cloneDeep(general)))
  if (network && network.response) vi.spyOn(AuditService, 'getAuditNetwork').mockRejectedValue(network)
  else vi.spyOn(AuditService, 'getAuditNetwork').mockImplementation(() => ok(_.cloneDeep(network)))
}

async function mountNetwork({ state = S.EDIT, routeName = 'network', ...api } = {}) {
  UserService.user = { id: 'u1', username: 'author', roles: '*' }
  mockApi(api)
  socket = fakeSocket()
  wrapper = mount(NetworkPage, {
    props: { frontEndAuditState: state, parentState: 'EDIT', parentApprovals: [] },
    global: { mocks: { $route: route(routeName), $router: { push: vi.fn() }, $settings: settings(), $socket: socket, $_: _ } }
  })
  await flushPromises()
  return wrapper
}

// Unmounts the page (its ctrl+s listener also removed by the test: no listener left to the next tests if it is not)
function unmountPage() {
  if (!wrapper) return
  const listener = wrapper.vm._listener
  wrapper.unmount()
  document.removeEventListener('keydown', listener, false)
  wrapper = null
}

const vm = () => wrapper.vm
const t = (key) => wrapper.vm.$t(key)
const saveButton = () => wrapper.findAllComponents(QBtn).find((button) => button.props('label') === `${t('btn.save')} (ctrl+s)`)
const leave = () => {
  const next = vi.fn()
  NetworkPage.beforeRouteLeave.call(wrapper.vm, { name: 'general' }, { name: 'network' }, next)
  return next
}

// Import menu opened (its items are rendered in the body)
async function openImportMenu() {
  await wrapper.findComponent(QBtnDropdown).find('button').trigger('click')
  await flushPromises()
  return [...document.body.querySelectorAll('input[type="file"]')]
}

// Import of a scan file with the hidden file input of the import menu
async function importFile(type, content, name) {
  const input = (await openImportMenu()).find((element) => element.accept === (type === 'nmap' ? '.xml' : '.nessus'))
  Object.defineProperty(input, 'files', { value: [new File([content], name)], configurable: true })
  input.dispatchEvent(new Event('change'))
  await new Promise((resolve) => setTimeout(resolve, 30)) // FileReader
  await flushPromises()
}

const hostChips = () => wrapper.findAllComponents(QChip).filter((chip) => chip.props('square'))

const hostsOf = (scopeName) => vm().audit.scope.find((scope) => scope.name === scopeName).hosts

beforeAll(() => {
  installAppGlobals()
  // Scroll of the hosts table (Quasar), not implemented by jsdom
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function () {}
})
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  unmountPage()
  document.body.innerHTML = '' // Menus rendered in the body
})

describe('network page loading', () => {
  it('loads the general data then the network data and tells the other users which page is open', async () => {
    await mountNetwork()
    expect(AuditService.getAuditGeneral).toHaveBeenCalledWith('a1')
    expect(AuditService.getAuditNetwork).toHaveBeenCalledWith('a1')
    expect(AuditService.getAuditGeneral.mock.invocationCallOrder[0]).toBeLessThan(AuditService.getAuditNetwork.mock.invocationCallOrder[0])
    expect(socket.emit).toHaveBeenCalledWith('menu', { menu: 'network', room: 'a1' })
    expect(vm().auditOrig).toEqual(vm().audit)
  })

  it('shows the scopes and their hosts', async () => {
    await mountNetwork()
    expect(wrapper.findAll('.text-h6').map((title) => title.text())).toEqual(['LAN', 'DMZ 🌐'])
    expect(hostChips().map((chip) => chip.find('.q-chip__content').text())).toEqual(['10.0.0.1'])
    expect(wrapper.findComponent(QTable).exists()).toBe(false) // No host selected
  })

  // The network data (scope only) is merged into the general data loaded before
  it('shows the name of the audit in the title', async () => {
    await mountNetwork()
    expect(wrapper.text()).toContain('Pentest Été (Web)')
    expect(wrapper.text()).not.toContain('Loading...')
  })

  it('shows an audit without scope', async () => {
    await mountNetwork({ network: { _id: 'a1', scope: [] } })
    expect(wrapper.findAll('.text-h6')).toHaveLength(0)
    expect(saveButton()).toBeDefined()
  })

  it('keeps the general data when the network data cannot be loaded', async () => {
    await mountNetwork({ network: apiError(500, 'Internal error') })
    expect(vm().audit.name).toBe('Pentest Été')
    expect(wrapper.text()).toContain('Pentest Été (Web)')
  })

  it('asks to import the hosts before selecting them', async () => {
    await mountNetwork()
    expect(vm().selectHostsLabel).toBe(t('msg.importHostsFirst'))
    expect(wrapper.findAllComponents(QSelect).map((s) => s.props('label'))).toEqual([t('msg.importHostsFirst'), t('msg.importHostsFirst')])
    vm().targetsOptions = [{ label: '10.0.0.5', value: '10.0.0.5', host: { ip: '10.0.0.5' } }]
    expect(vm().selectHostsLabel).toBe(t('msg.selectHost'))
  })
})

describe('network scans import', () => {
  it('offers the Nmap and Nessus imports', async () => {
    await mountNetwork()
    expect(wrapper.findComponent(QBtnDropdown).props('label')).toBe(t('import'))
    expect((await openImportMenu()).map((input) => input.accept)).toEqual(['.xml', '.nessus'])
  })

  it('opens the file selection of the chosen import', async () => {
    await mountNetwork()
    await openImportMenu()
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const item = [...document.body.querySelectorAll('.q-item')].find((element) => element.textContent.includes('Nessus'))
    item.click()
    expect(click).toHaveBeenCalledTimes(1)
    expect(click.mock.contexts[0].accept).toBe('.nessus')
  })

  it('imports the hosts up of a Nmap scan with their open services', async () => {
    const notify = mockNotify()
    await mountNetwork()
    await importFile('nmap', NMAP, 'scan.xml')
    expect(vm().targetsOptions.map((option) => option.value)).toEqual(['10.0.0.5', '10.0.0.7'])
    expect(vm().targetsOptions[0]).toEqual({
      label: '10.0.0.5', value: '10.0.0.5',
      host: {
        ip: '10.0.0.5', hostname: 'web.acme.fr', os: 'Linux',
        services: [
          { protocol: 'tcp', port: '80', state: 'open', product: 'Apache httpd', name: 'http', version: '2.4.58' },
          { protocol: 'udp', port: '161', state: 'open', product: 'Unknown', name: 'Unknown', version: 'Unknown' }
        ]
      }
    })
    expect(vm().targetsOptions[1].host).toEqual({ ip: '10.0.0.7', hostname: 'Unknown', os: '', services: [] })
    expect(lastNotification(notify)).toMatchObject({ message: 'Successfully imported 2 hosts', color: 'positive' })
    expect(vm().selectHostsLabel).toBe(t('msg.selectHost'))
  })

  it('names the hosts without PTR record "Unknown"', async () => {
    mockNotify()
    await mountNetwork()
    vm().parseXmlNmap('<nmaprun><host><status state="up"/><address addr="::1"/><hostnames><hostname name="x" type="user"/></hostnames><ports/></host></nmaprun>')
    expect(vm().targetsOptions[0].host).toMatchObject({ ip: '::1', hostname: 'Unknown', services: [] })
    expect(vm().targetsOptions[0].host.os).toBeUndefined()
  })

  it.each([
    ['without host', '<nmaprun></nmaprun>'],
    ['not XML', 'this is not { xml'],
    ['host without address', '<nmaprun><host><status state="up"/><ports/></host></nmaprun>'],
    ['host without ports (ping scan)', '<nmaprun><host><status state="up"/><address addr="10.0.0.1"/></host></nmaprun>'],
    ['host without status', '<nmaprun><host><address addr="10.0.0.1"/><ports/></host></nmaprun>']
  ])('notifies an error for a Nmap scan %s and keeps the previous hosts', async (name, xml) => {
    const notify = mockNotify()
    await mountNetwork()
    vm().targetsOptions = [{ label: 'kept', value: 'kept' }]
    vm().parseXmlNmap(xml)
    expect(lastNotification(notify)).toMatchObject({ message: 'Error parsing Nmap', color: 'negative' })
    expect(vm().targetsOptions).toEqual([{ label: 'kept', value: 'kept' }])
  })

  it('imports the hosts of a Nessus scan with their services', async () => {
    const notify = mockNotify()
    await mountNetwork()
    await importFile('nessus', NESSUS, 'scan.nessus')
    expect(vm().targetsOptions.map((option) => option.value)).toEqual(['192.168.1.10', 'fileserver'])
    expect(vm().targetsOptions[0].host).toEqual({
      ip: '192.168.1.10', os: 'Windows Server 2022', hostname: 'dc01.corp.local',
      services: [
        { protocol: 'tcp', port: '445', name: 'cifs', product: 'Samba', version: '4.19' }, // Items of the same port merged
        { protocol: 'tcp', port: '3389', name: 'n/a', product: 'n/a', version: 'n/a' }
      ]
    })
    // IP from the name of the host, hostname from the NetBIOS name
    expect(vm().targetsOptions[1].host).toEqual({ ip: 'fileserver', hostname: 'FS01', services: [] })
    expect(lastNotification(notify)).toMatchObject({ message: 'Successfully imported 2 hosts', color: 'positive' })
  })

  // Same port in TCP and UDP (53/tcp and 53/udp for a DNS server): two services
  it('keeps the TCP and UDP services of the same port', async () => {
    mockNotify()
    await mountNetwork()
    vm().parseXmlNessus(`<NessusClientData_v2><ReportHost name="ns1"><HostProperties><tag name="host-ip">10.0.0.53</tag></HostProperties>
      <ReportItem port="53" protocol="tcp" svc_name="dns"/><ReportItem port="53" protocol="udp" svc_name="dns"/></ReportHost></NessusClientData_v2>`)
    expect(vm().targetsOptions[0].host.services.map((service) => `${service.port}/${service.protocol}`)).toEqual(['53/tcp', '53/udp'])
  })

  it.each([
    ['without host', '<NessusClientData_v2></NessusClientData_v2>'],
    ['host without properties', '<NessusClientData_v2><ReportHost name="x"></ReportHost></NessusClientData_v2>']
  ])('notifies an error for a Nessus scan %s', async (name, xml) => {
    const notify = mockNotify()
    await mountNetwork()
    vm().parseXmlNessus(xml)
    expect(lastNotification(notify)).toMatchObject({ message: 'Error parsing Nessus', color: 'negative' })
    expect(vm().targetsOptions).toEqual([])
  })

  it('reads the unicode of the scans', async () => {
    mockNotify()
    await mountNetwork()
    await importFile('nessus', '<NessusClientData_v2><ReportHost name="h"><HostProperties><tag name="host-ip">10.1.1.1</tag><tag name="netbios-name">SERVEUR-ÉTÉ</tag></HostProperties></ReportHost></NessusClientData_v2>', 'été.nessus')
    expect(vm().targetsOptions[0].host.hostname).toBe('SERVEUR-ÉTÉ')
  })
})

describe('hosts of the scopes', () => {
  async function withImportedHosts() {
    mockNotify()
    await mountNetwork()
    vm().parseXmlNmap(NMAP)
    await flushPromises()
  }

  it('adds the selected hosts to a scope', async () => {
    await withImportedHosts()
    vm().selectedTargets['DMZ 🌐'] = [vm().targetsOptions[0]]
    const scope = vm().audit.scope[1]
    vm().updateScopeHosts(scope)
    await flushPromises()
    expect(scope.hosts.map((host) => host.ip)).toEqual(['10.0.0.5'])
    expect(hostChips().map((chip) => chip.find('.q-chip__content').text())).toEqual(['10.0.0.1', '10.0.0.5'])
  })

  it('adds the hosts selected in the select of the scope with its add button', async () => {
    await withImportedHosts()
    const select = wrapper.findAllComponents(QSelect)[0]
    select.vm.$emit('update:modelValue', vm().targetsOptions)
    await flushPromises()
    await select.findAllComponents(QBtn).find((button) => button.props('icon') === 'add').trigger('click')
    expect(hostsOf('LAN').map((host) => host.ip)).toEqual(['10.0.0.1', '10.0.0.5', '10.0.0.7'])
  })

  it('does nothing for a scope without selection', async () => {
    await withImportedHosts()
    vm().updateScopeHosts(vm().audit.scope[0])
    expect(hostsOf('LAN')).toHaveLength(1)
    expect(console.error).toHaveBeenCalled()
  })

  // Add button clicked twice: the same host would appear several times in the scope (and in the report)
  it('does not add a host twice to a scope', async () => {
    await withImportedHosts()
    vm().selectedTargets.LAN = [vm().targetsOptions[0]]
    vm().updateScopeHosts(vm().audit.scope[0])
    vm().updateScopeHosts(vm().audit.scope[0])
    expect(hostsOf('LAN').map((host) => host.ip)).toEqual(['10.0.0.1', '10.0.0.5'])
  })

  it('shows the services of the host clicked', async () => {
    await mountNetwork()
    await hostChips()[0].trigger('click') // Click on the host (parent of the chip)
    const table = wrapper.findComponent(QTable)
    expect(table.props('title')).toBe('10.0.0.1 (srv-01)')
    expect(table.props('rows').map((service) => service.port)).toEqual(['22', '443'])
    expect(table.text()).toContain('ssh')
    expect(table.text()).toContain('9.6')
  })

  it('sorts the services by port number', async () => {
    await mountNetwork()
    const sort = vm().dtHostHeaders.find((header) => header.name === 'port').sort
    expect(['8080', '22', '443'].sort(sort)).toEqual(['22', '443', '8080'])
  })

  it('shows a host saved as a simple address', async () => {
    await mountNetwork()
    vm().onHostClick('172.16.0.1', vm().audit.scope[0])
    await flushPromises()
    expect(vm().currentHost).toEqual({ ip: '172.16.0.1', hostname: 'Unknown', services: [] })
    expect(wrapper.findComponent(QTable).props('title')).toBe('172.16.0.1 (Unknown)')
  })

  it('removes a host from a scope and asks a confirmation to leave without saving', async () => {
    const dialogs = mockDialog()
    await mountNetwork()
    hostChips()[0].vm.$emit('remove')
    await flushPromises()
    expect(hostsOf('LAN')).toEqual([])
    const next = leave()
    expect(next).not.toHaveBeenCalled()
    dialogs[0].ok()
    expect(next).toHaveBeenCalled()
  })
})

describe('network page save', () => {
  it('saves the scopes and notifies it', async () => {
    const notify = mockNotify()
    const dialogs = mockDialog()
    vi.spyOn(AuditService, 'updateAuditNetwork').mockResolvedValue({})
    await mountNetwork()
    hostsOf('DMZ 🌐').push({ ip: '203.0.113.10', hostname: 'www', services: [] })
    await saveButton().trigger('click')
    await flushPromises()
    expect(AuditService.updateAuditNetwork).toHaveBeenCalledWith('a1', expect.objectContaining({ scope: expect.arrayContaining([expect.objectContaining({ name: 'DMZ 🌐', hosts: [{ ip: '203.0.113.10', hostname: 'www', services: [] }] })]) }))
    expect(lastNotification(notify)).toMatchObject({ message: t('msg.auditUpdateOk'), color: 'positive' })
    expect(leave()).toHaveBeenCalled()
    expect(dialogs).toHaveLength(0)
  })

  it('notifies the error of the server and keeps the changes unsaved', async () => {
    const notify = mockNotify()
    mockDialog()
    vi.spyOn(AuditService, 'updateAuditNetwork').mockRejectedValue(apiError(403, 'Audit not found or Insufficient Privileges'))
    await mountNetwork()
    hostsOf('LAN').pop()
    vm().updateAuditNetwork()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Audit not found or Insufficient Privileges', color: 'negative' })
    expect(leave()).not.toHaveBeenCalled()
  })

  it('saves with ctrl+s in edition', async () => {
    mockNotify()
    vi.spyOn(AuditService, 'updateAuditNetwork').mockResolvedValue({})
    await mountNetwork()
    pressSave()
    await flushPromises()
    expect(AuditService.updateAuditNetwork).toHaveBeenCalledTimes(1)
  })

  it.each([[S.REVIEW_EDITOR, 'network'], [S.EDIT, 'general']])('does not save with ctrl+s in the state %i on the page %s', async (state, routeName) => {
    vi.spyOn(AuditService, 'updateAuditNetwork').mockResolvedValue({})
    await mountNetwork({ state, routeName })
    pressSave()
    await flushPromises()
    expect(AuditService.updateAuditNetwork).not.toHaveBeenCalled()
  })

  // A listener left by a previous visit would save the stale network data of this visit
  it('stops listening to ctrl+s when unmounted', async () => {
    mockNotify()
    vi.spyOn(AuditService, 'updateAuditNetwork').mockResolvedValue({})
    await mountNetwork()
    const listener = wrapper.vm._listener
    wrapper.unmount()
    wrapper = null
    pressSave()
    document.removeEventListener('keydown', listener, false)
    await flushPromises()
    expect(AuditService.updateAuditNetwork).not.toHaveBeenCalled()
  })

  // Review, approved, users without edit right: save, imports, hosts selection and removal unavailable
  it.each([S.EDIT_READONLY, S.REVIEW_EDITOR, S.APPROVED_READONLY])('cannot be modified in the read-only state %i', async (state) => {
    await mountNetwork({ state })
    expect(saveButton()).toBeUndefined()
    expect(wrapper.findComponent(QBtnDropdown).exists()).toBe(false)
    expect(hostChips()).toHaveLength(1) // Hosts still shown
    expect(hostChips().filter((chip) => chip.props('removable'))).toHaveLength(0)
    expect(wrapper.findAllComponents(QSelect)).toHaveLength(0)
  })

  it('cannot be saved before the network data is loaded', async () => {
    vi.spyOn(AuditService, 'updateAuditNetwork').mockResolvedValue({})
    await mountNetwork({ network: apiError(500, 'Internal error') })
    expect(saveButton().props('disable')).toBe(true)
    expect(wrapper.findAll('.text-h6')).toHaveLength(0) // Scopes of the general data (names only) not shown
    pressSave()
    vm().updateAuditNetwork()
    await flushPromises()
    expect(AuditService.updateAuditNetwork).not.toHaveBeenCalled()
  })
})
