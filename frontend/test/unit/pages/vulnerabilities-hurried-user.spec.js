// Hurried user on pages/vulnerabilities: API answers delayed and given by the test (in any order), double clicks,
// tab changes and navigation while a request is in progress, dialogs opened one after the other
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import _ from 'lodash'

vi.mock('components/editor', () => import('../../helpers/editor-stub'))
vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import VulnerabilitiesPage from '@/pages/vulnerabilities'
import VulnerabilityService from '@/services/vulnerability'
import DataService from '@/services/data'
import UserService from '@/services/user'
import { mockDialog, mockNotify } from '../../helpers/quasar'
import { deferredCalls, catchWindowErrors } from '../../helpers/misc'

const ok = (datas) => ({ data: { datas } })
const vuln = (id, title, extra = {}) => ({ _id: id, status: 0, category: null, details: [{ locale: 'en', title, vulnType: 'Web' }], ...extra })
const A = vuln('a', 'SQL Injection')
const B = vuln('b', 'Cross-Site Scripting')
const C = vuln('c', 'Élévation de privilèges')
const LIST = [A, B, C]
const CUSTOM_FIELDS = [{ _id: 'cf1', label: 'Asset', display: 'vulnerability', displaySub: '', fieldType: 'input', text: [], size: 12, offset: 0 }]

// Dialogs replaced by a stub exposing show() / hide(), emitting hide as QDialog (cleanCurrentVulnerability)
const DialogStub = {
  name: 'QDialog',
  emits: ['hide'],
  template: '<div class="dialog-stub" :data-open="open" />',
  data: () => ({ open: false }),
  methods: {
    show() { this.open = true },
    hide() {
      if (!this.open) return
      this.open = false
      this.$emit('hide')
    }
  }
}

let wrapper
let lists
let notify

async function mountPage({ customFields = () => Promise.resolve(ok(CUSTOM_FIELDS)) } = {}) {
  UserService.user = { username: 'admin', roles: '*' }
  lists = deferredCalls(vi.spyOn(VulnerabilityService, 'getVulnerabilities'))
  vi.spyOn(VulnerabilityService, 'getProposalsCount').mockResolvedValue(ok({ pending: 0 }))
  vi.spyOn(DataService, 'getLanguages').mockResolvedValue(ok([{ locale: 'en', language: 'English' }]))
  vi.spyOn(DataService, 'getVulnerabilityTypes').mockResolvedValue(ok([{ locale: 'en', name: 'Web' }]))
  vi.spyOn(DataService, 'getVulnerabilityCategories').mockResolvedValue(ok([]))
  vi.spyOn(DataService, 'getCustomFields').mockImplementation(customFields)
  wrapper = mount(VulnerabilitiesPage, {
    global: {
      mocks: { $_: _, $router: { push: vi.fn() }, $settings: { report: { public: {} } } },
      stubs: { QDialog: DialogStub, ProposalsList: true },
      directives: { sticky: {} }
    }
  })
  await flushPromises()
}

async function mountLoaded(options) {
  await mountPage(options)
  lists[0].resolve(ok(LIST))
  await flushPromises()
}

const titles = () => wrapper.vm.computedVulnerabilities.map((row) => wrapper.vm.getDtTitle(row))
const resolveAll = (deferreds, value = {}) => deferreds.forEach((d) => d.resolve(value))

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  notify = mockNotify()
})
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('vulnerabilities list loading', () => {
  it('shows the loading state until the list answers', async () => {
    await mountPage()
    expect(wrapper.vm.loading).toBe(true)
    lists[0].resolve(ok(LIST))
    await flushPromises()
    expect(wrapper.vm.loading).toBe(false)
    expect(titles()).toEqual(['SQL Injection', 'Cross-Site Scripting', 'Élévation de privilèges'])
  })

  it('shows the tab chosen during the loading once the list answers', async () => {
    await mountPage()
    wrapper.vm.mainTab = 'archives'
    lists[0].resolve(ok([A, { ...B, archived: true }]))
    await flushPromises()
    expect(titles()).toEqual(['Cross-Site Scripting'])
  })

  it('applies the filter typed during the loading once the list answers', async () => {
    await mountPage()
    const filter = { title: 'elevation', type: '', category: '', updatedAt: '', valid: 0, new: 1, updates: 2 }
    lists[0].resolve(ok(LIST))
    await flushPromises()
    expect(wrapper.vm.customFilter(wrapper.vm.computedVulnerabilities, filter).map((row) => row._id)).toEqual(['c'])
  })

  it('ignores a list answered after leaving the page', async () => {
    await mountPage()
    wrapper.unmount()
    wrapper = null
    const errors = await catchWindowErrors(async () => {
      lists[0].resolve(ok(LIST))
      await flushPromises()
    })
    expect(errors).toEqual([])
  })

  it('shows the list of the last refresh when the refreshes answer out of order', async () => {
    vi.spyOn(VulnerabilityService, 'archiveVulnerability').mockResolvedValue({})
    vi.spyOn(VulnerabilityService, 'deleteVulnerability').mockResolvedValue({})
    await mountLoaded()
    wrapper.vm.setArchived(A, true)
    await flushPromises() // Refresh 1
    wrapper.vm.deleteVulnerability('b')
    await flushPromises() // Refresh 2
    lists[2].resolve(ok([{ ...A, archived: true }, C]))
    await flushPromises()
    lists[1].resolve(ok([{ ...A, archived: true }, B, C]))
    await flushPromises()
    expect(titles()).toEqual(['Élévation de privilèges'])
  })
})

describe('vulnerabilities double submissions', () => {
  it('creates the vulnerability once for a double click on create', async () => {
    deferredCalls(vi.spyOn(VulnerabilityService, 'createVulnerabilities'))
    await mountLoaded()
    wrapper.vm.cleanCurrentVulnerability()
    wrapper.vm.currentVulnerability.details[0].title = 'Nouvelle vulnérabilité'
    wrapper.vm.$refs.createModal.show()
    wrapper.vm.createVulnerability()
    wrapper.vm.createVulnerability()
    expect(VulnerabilityService.createVulnerabilities).toHaveBeenCalledTimes(1)
  })

  it('keeps a consistent state after a double click on update', async () => {
    const updates = deferredCalls(vi.spyOn(VulnerabilityService, 'updateVulnerability'))
    await mountLoaded()
    wrapper.vm.dblClick(A)
    wrapper.vm.currentVulnerability.details[0].title = 'SQL Injection (mise à jour)'
    wrapper.vm.updateVulnerability()
    wrapper.vm.updateVulnerability()
    VulnerabilityService.updateVulnerability.mock.calls.forEach(([id, sent]) => {
      expect(id).toBe('a')
      expect(sent.details[0].title).toBe('SQL Injection (mise à jour)')
    })
    resolveAll(updates)
    await flushPromises()
    expect(wrapper.vm.$refs.editModal.open).toBe(false)
    expect(notify.mock.calls.every(([options]) => options.color === 'positive')).toBe(true)
  })

  it('keeps a consistent state after a double click on archive', async () => {
    const archives = deferredCalls(vi.spyOn(VulnerabilityService, 'archiveVulnerability'))
    await mountLoaded()
    wrapper.vm.setArchived(A, !A.archived)
    wrapper.vm.setArchived(A, !A.archived)
    expect(VulnerabilityService.archiveVulnerability.mock.calls).toEqual(VulnerabilityService.archiveVulnerability.mock.calls.map(() => ['a', true]))
    resolveAll(archives)
    await flushPromises()
    resolveAll(lists.slice(1), ok([{ ...A, archived: true }, B, C]))
    await flushPromises()
    expect(titles()).toEqual(['Cross-Site Scripting', 'Élévation de privilèges'])
  })

  it('merges once for a double click on merge', async () => {
    deferredCalls(vi.spyOn(VulnerabilityService, 'mergeVulnerability'))
    await mountLoaded()
    Object.assign(wrapper.vm, { mergeLanguageLeft: 'en', mergeLanguageRight: 'en', mergeVulnLeft: 'a', mergeVulnRight: 'b' })
    wrapper.vm.mergeVulnerabilities()
    wrapper.vm.mergeVulnerabilities()
    expect(VulnerabilityService.mergeVulnerability).toHaveBeenCalledTimes(1)
  })

  it('deletes once: the confirmation dialog answers a single time', async () => {
    const dialogs = mockDialog()
    const deletions = deferredCalls(vi.spyOn(VulnerabilityService, 'deleteVulnerability'))
    await mountLoaded()
    wrapper.vm.confirmDeleteVulnerability(A)
    dialogs[0].ok()
    expect(deletions).toHaveLength(1)
  })
})

describe('vulnerability dialogs opened quickly', () => {
  it('updates the last vulnerability opened when two rows are opened one after the other', async () => {
    vi.spyOn(VulnerabilityService, 'updateVulnerability').mockResolvedValue({})
    await mountLoaded()
    wrapper.vm.dblClick(A)
    wrapper.vm.dblClick(B)
    wrapper.vm.currentVulnerability.details[0].title = 'XSS réfléchie'
    wrapper.vm.updateVulnerability()
    expect(VulnerabilityService.updateVulnerability).toHaveBeenCalledWith('b', expect.objectContaining({ _id: 'b' }))
    expect(VulnerabilityService.updateVulnerability.mock.calls[0][1].details[0].title).toBe('XSS réfléchie')
    expect(A.details[0].title).toBe('SQL Injection') // Row of the list not changed (copy edited)
  })

  it('does not close the dialog of another vulnerability opened during an update', async () => {
    const updates = deferredCalls(vi.spyOn(VulnerabilityService, 'updateVulnerability'))
    await mountLoaded()
    wrapper.vm.dblClick(A)
    wrapper.vm.updateVulnerability()
    wrapper.vm.$refs.editModal.hide() // Closed without waiting for the answer
    wrapper.vm.dblClick(B)
    wrapper.vm.currentVulnerability.details[0].title = 'XSS en cours de saisie'
    updates[0].resolve({})
    await flushPromises()
    expect(wrapper.vm.$refs.editModal.open).toBe(true)
    expect(wrapper.vm.currentVulnerability.details[0].title).toBe('XSS en cours de saisie')
  })

  it('adds the custom fields answered after the creation dialog was opened', async () => {
    let answerFields
    await mountLoaded({ customFields: () => new Promise((resolve) => { answerFields = resolve }) })
    wrapper.vm.cleanCurrentVulnerability()
    wrapper.vm.$refs.createModal.show()
    answerFields(ok(CUSTOM_FIELDS))
    await flushPromises()
    expect(wrapper.vm.currentVulnerability.details[0].customFields.map((field) => field.customField.label)).toEqual(['Asset'])
  })

  it('keeps the custom fields of a vulnerability opened before their loading', async () => {
    let answerFields
    await mountLoaded({ customFields: () => new Promise((resolve) => { answerFields = resolve }) })
    const ldap = vuln('d', 'Injection LDAP', { details: [{ locale: 'en', title: 'Injection LDAP', vulnType: 'Web', customFields: [{ customField: 'cf1', text: 'Annuaire Ω' }] }] })
    wrapper.vm.dblClick(ldap)
    answerFields(ok(CUSTOM_FIELDS))
    await flushPromises()
    expect(wrapper.vm.currentVulnerability.details[0].customFields).toEqual([{ customField: expect.objectContaining({ _id: 'cf1', label: 'Asset' }), text: 'Annuaire Ω' }])
  })

  it('does not close the creation dialog opened again during a creation', async () => {
    const creations = deferredCalls(vi.spyOn(VulnerabilityService, 'createVulnerabilities'))
    await mountLoaded()
    wrapper.vm.cleanCurrentVulnerability()
    wrapper.vm.$refs.createModal.show()
    wrapper.vm.currentVulnerability.details[0].title = 'Première'
    wrapper.vm.createVulnerability()
    wrapper.vm.$refs.createModal.hide() // Closed without waiting for the answer, then opened again
    wrapper.vm.cleanCurrentVulnerability()
    wrapper.vm.$refs.createModal.show()
    wrapper.vm.currentVulnerability.details[0].title = 'Deuxième en cours'
    creations[0].resolve({})
    await flushPromises()
    expect(wrapper.vm.$refs.createModal.open).toBe(true)
    expect(wrapper.vm.currentVulnerability.details[0].title).toBe('Deuxième en cours')
  })

  it('gives the custom fields to a vulnerability created after their loading', async () => {
    await mountLoaded()
    wrapper.vm.cleanCurrentVulnerability()
    expect(wrapper.vm.currentVulnerability.details[0].customFields.map((field) => field.customField.label)).toEqual(['Asset'])
  })

  it('clears the creation dialog when it is closed during the creation request, then notifies the answer', async () => {
    const creations = deferredCalls(vi.spyOn(VulnerabilityService, 'createVulnerabilities'))
    await mountLoaded()
    wrapper.vm.cleanCurrentVulnerability()
    wrapper.vm.$refs.createModal.show()
    wrapper.vm.currentVulnerability.details[0].title = 'Créée'
    wrapper.vm.createVulnerability()
    wrapper.vm.$refs.createModal.hide()
    expect(wrapper.vm.currentVulnerability.details[0].title).toBe('')
    creations[0].resolve({})
    await flushPromises()
    expect(notify.mock.calls.at(-1)[0]).toMatchObject({ color: 'positive' })
    expect(lists).toHaveLength(2) // List refreshed
  })

  it('notifies an update answered after leaving the page', async () => {
    const updates = deferredCalls(vi.spyOn(VulnerabilityService, 'updateVulnerability'))
    await mountLoaded()
    wrapper.vm.dblClick(A)
    wrapper.vm.updateVulnerability()
    wrapper.unmount()
    wrapper = null
    updates[0].resolve({})
    await flushPromises()
    expect(notify.mock.calls.at(-1)[0]).toMatchObject({ message: 'Vulnerability updated successfully', color: 'positive' })
  })

  it('notifies an update error answered after leaving the page without exception', async () => {
    const updates = deferredCalls(vi.spyOn(VulnerabilityService, 'updateVulnerability'))
    await mountLoaded()
    wrapper.vm.dblClick(A)
    wrapper.vm.updateVulnerability()
    wrapper.unmount()
    wrapper = null
    const errors = await catchWindowErrors(async () => {
      updates[0].reject({ response: { status: 500, data: { datas: 'Internal error' } } })
      await flushPromises()
    })
    expect(errors).toEqual([])
    expect(notify.mock.calls.at(-1)[0]).toMatchObject({ message: 'Internal error', color: 'negative' })
  })
})
