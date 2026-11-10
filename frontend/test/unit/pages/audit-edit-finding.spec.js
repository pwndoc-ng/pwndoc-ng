// pages/audits/edit/findings/edit: edition of a finding (loading, custom fields, tabs, CVSS, status, save, ctrl+s,
// unsaved changes, deletion and navigation, proposal to the vulnerabilities database, read-only states).
// The TipTap editor and the proposal review dialog are stubbed, API services mocked.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import _ from 'lodash'
import { QBtn, QInput, QSelect, QToggle, QChip, QTab } from 'quasar'

vi.mock('components/editor', () => import('../../helpers/editor-stub'))
vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import EditFinding from 'pages/audits/edit/findings/edit'
import CustomFields from 'components/custom-fields'
import CvssCalculator from 'components/cvsscalculator'
import TextareaArray from 'components/textarea-array'
import EditorStub from '../../helpers/editor-stub'
import AuditService from '@/services/audit'
import DataService from '@/services/data'
import VulnService from '@/services/vulnerability'
import UserService from '@/services/user'
import Utils from '@/services/utils'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'
import { installAppGlobals, fakeSocket, settings, route, pressSave, apiError, ok } from '../../helpers/audit-edit'

const S = Utils.AUDIT_VIEW_STATE
const CRITICAL = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'

const CUSTOM_FIELDS = [
  { _id: 'cf1', label: 'Impact', fieldType: 'input', display: 'vulnerability', displaySub: '', size: 12, offset: 0, required: false, text: [{ locale: 'fr', value: 'Moyen' }, { locale: 'en', value: 'Medium' }] },
  { _id: 'cf2', label: 'Owner', fieldType: 'input', display: 'finding', displaySub: '', size: 12, offset: 0, required: false, text: [] },
  { _id: 'cf3', label: 'Tags', fieldType: 'select-multiple', display: 'finding', displaySub: 'Injection', size: 12, offset: 0, required: false, options: [] },
  { _id: 'cf4', label: 'Network only', fieldType: 'input', display: 'finding', displaySub: 'Réseau', size: 12, offset: 0 },
  { _id: 'cf5', label: 'Audit field', fieldType: 'input', display: 'general', displaySub: '', size: 12, offset: 0 }
]

function findingData(overrides = {}) {
  return {
    _id: 'f1', identifier: 1, title: 'Injection SQL', vulnType: 'Applicatif', description: '<p>Description</p>', observation: '<p>Observation</p>',
    references: ['https://owasp.org'], status: 1, poc: '<p>PoC</p>', scope: '<p>10.0.0.1</p>', cvssv3: CRITICAL,
    remediationComplexity: 2, priority: 3, remediation: '<p>Correctif</p>', category: 'Injection',
    customFields: [{ customField: { _id: 'cf2', label: 'Owner', fieldType: 'input' }, text: 'Équipe rouge' }],
    ...overrides
  }
}

const ProposalReviewStub = { name: 'ProposalReview', emits: ['changed'], methods: { open: vi.fn() }, template: '<div class="proposal-review-stub" />' }

let wrapper
let socket
let router

function mockApi({ finding = findingData(), proposal = null, customFields = CUSTOM_FIELDS } = {}) {
  vi.spyOn(VulnService, 'getFindingProposal').mockImplementation(() => ok(proposal))
  if (customFields && customFields.response) vi.spyOn(DataService, 'getCustomFields').mockRejectedValue(customFields)
  else vi.spyOn(DataService, 'getCustomFields').mockImplementation(() => ok(_.cloneDeep(customFields)))
  vi.spyOn(AuditService, 'getFinding').mockImplementation(() => ok(_.cloneDeep(finding)))
  vi.spyOn(AuditService, 'getAudit').mockImplementation(() => ok({ _id: 'a1', name: 'Pentest Été', auditType: 'Web', language: 'fr' }))
  vi.spyOn(DataService, 'getVulnerabilityTypes').mockImplementation(() => ok([{ locale: 'fr', name: 'Applicatif' }, { locale: 'fr', name: 'Système' }, { locale: 'en', name: 'Web' }]))
}

const globalOptions = (routeName = 'editFinding', provide = {}) => ({
  mocks: {
    $route: route(routeName, { findingId: 'f1' }), $router: router, $socket: socket, $_: _,
    $settings: settings({ report: { extendCvssTemporalEnvironment: false, cvssColors: {} } })
  },
  stubs: { ProposalReview: ProposalReviewStub },
  provide
})

async function mountFinding({ state = S.EDIT, routeName = 'editFinding', provide, ...api } = {}) {
  UserService.user = { id: 'u1', username: 'author', roles: '*' }
  mockApi(api)
  socket = fakeSocket()
  router = { push: vi.fn(() => Promise.resolve()) }
  wrapper = mount(EditFinding, {
    props: { audit: { _id: 'a1', language: 'fr' }, frontEndAuditState: state, parentState: 'EDIT', parentApprovals: [] },
    global: globalOptions(routeName, provide)
  })
  await flushPromises()
  return wrapper
}

const vm = () => wrapper.findComponent(EditFinding).vm
const t = (key) => vm().$t(key)
const buttonLabels = () => wrapper.findAllComponents(QBtn).map((button) => button.props('label')).filter(Boolean)
const button = (label) => wrapper.findAllComponents(QBtn).find((b) => b.props('label') === label)
const saveButton = () => button(`${t('btn.save')} (ctrl+s)`)
const editor = (idUnique) => wrapper.findAllComponents(EditorStub).find((e) => e.props('idUnique') === idUnique)
const selectTab = async (name) => {
  vm().selectedTab = name
  await flushPromises()
}
const leave = (guard = 'beforeRouteLeave') => {
  const next = vi.fn()
  EditFinding[guard].call(vm(), { name: 'editFinding', params: { findingId: 'f2' } }, { name: 'editFinding' }, next)
  return next
}
// Editors ready (the description editor tells when the initial value is loaded)
const editorsReady = async () => {
  editor('basiceditor_description').vm.$emit('ready')
  await flushPromises()
}
const customFieldIds = () => vm().finding.customFields.map((field) => field.customField._id)

beforeAll(() => installAppGlobals())
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('finding edit loading', () => {
  it('loads the finding after the custom fields, the audit, the vulnerability types and the last proposal', async () => {
    await mountFinding()
    expect(VulnService.getFindingProposal).toHaveBeenCalledWith('f1')
    expect(DataService.getCustomFields).toHaveBeenCalled()
    expect(AuditService.getFinding).toHaveBeenCalledWith('a1', 'f1')
    expect(AuditService.getAudit).toHaveBeenCalledWith('a1')
    expect(DataService.getVulnerabilityTypes).toHaveBeenCalled()
    expect(DataService.getCustomFields.mock.invocationCallOrder[0]).toBeLessThan(AuditService.getFinding.mock.invocationCallOrder[0])
    expect(socket.emit).toHaveBeenCalledWith('menu', { menu: 'editFinding', finding: 'f1', room: 'a1' })
    expect(vm().finding.title).toBe('Injection SQL')
    expect(wrapper.text()).toContain('Pentest Été (Web)')
  })

  it('shows the fields of the finding', async () => {
    await mountFinding()
    expect(wrapper.findAllComponents(QInput).find((input) => input.props('label') === `${t('title')} *`).props('modelValue')).toBe('Injection SQL')
    expect(wrapper.findAllComponents(QSelect).find((s) => s.props('label') === t('type')).props('modelValue')).toBe('Applicatif')
    expect(editor('basiceditor_description').props('modelValue')).toBe('<p>Description</p>')
    expect(editor('basiceditor_observation').props('modelValue')).toBe('<p>Observation</p>')
    expect(wrapper.findComponent(TextareaArray).props('modelValue')).toEqual(['https://owasp.org'])
  })

  it('initializes the missing texts and references of the finding', async () => {
    const finding = findingData()
    for (const field of ['description', 'observation', 'poc', 'scope', 'remediation', 'references', 'customFields']) delete finding[field]
    await mountFinding({ finding })
    expect(vm().finding).toMatchObject({ description: '', observation: '', poc: '', scope: '', remediation: '', references: [] })
    expect(customFieldIds()).toEqual(['cf1', 'cf2', 'cf3'])
  })

  it('shows an empty finding when the server returns nothing', async () => {
    await mountFinding({ finding: null })
    expect(vm().finding).toMatchObject({ description: '', references: [] })
    expect(customFieldIds()).toEqual(['cf1', 'cf2']) // Fields without category
  })

  it('shows a default title while the audit is loading', async () => {
    UserService.user = { id: 'u1', username: 'author', roles: '*' }
    mockApi()
    AuditService.getAudit.mockReturnValue(new Promise(() => {}))
    socket = fakeSocket()
    router = { push: vi.fn() }
    wrapper = mount(EditFinding, { props: { audit: {}, frontEndAuditState: S.EDIT }, global: globalOptions() })
    await flushPromises()
    expect(wrapper.text()).toContain('Loading...')
  })

  // Custom fields that cannot be loaded: the finding is loaded anyway (with its custom fields as received: they would
  // be emptied at the next save otherwise), the error is notified
  it('loads the finding even when the custom fields cannot be loaded', async () => {
    const notify = mockNotify()
    await mountFinding({ customFields: apiError(500, 'Internal error') })
    expect(AuditService.getFinding).toHaveBeenCalledWith('a1', 'f1')
    expect(vm().finding.title).toBe('Injection SQL')
    expect(vm().finding.customFields).toEqual(findingData().customFields)
    expect(notify.mock.calls.map(([options]) => options)).toContainEqual(expect.objectContaining({ message: 'Internal error', color: 'negative' }))
  })
})

describe('finding custom fields', () => {
  it('adds the custom fields of the category with the texts of the finding and the defaults of the language', async () => {
    await mountFinding()
    expect(customFieldIds()).toEqual(['cf1', 'cf2', 'cf3'])
    const texts = Object.fromEntries(vm().finding.customFields.map((field) => [field.customField._id, field.text]))
    expect(texts).toEqual({ cf1: 'Moyen', cf2: 'Équipe rouge', cf3: [] })
    expect(vm().finding.customFields[0].customField.text).toBeUndefined() // Default texts not copied in the definition
  })

  it('initializes the custom fields of a finding without custom field (each field once)', async () => {
    await mountFinding({ finding: findingData({ customFields: [] }) })
    expect(customFieldIds()).toEqual(['cf1', 'cf2', 'cf3'])
  })

  it('uses only the fields of all categories for a finding without category', async () => {
    await mountFinding({ finding: findingData({ category: undefined, customFields: [] }) })
    expect(customFieldIds()).toEqual(['cf1', 'cf2'])
  })

  it('drops the texts of the deleted custom fields', async () => {
    const customFields = [{ customField: { _id: 'deleted', label: 'Old' }, text: 'x' }, { customField: 'cf2', text: 'Id only' }]
    await mountFinding({ finding: findingData({ customFields }) })
    expect(customFieldIds()).toEqual(['cf1', 'cf2', 'cf3'])
    expect(vm().finding.customFields[1].text).toBe('Id only')
  })

  it('shows the custom fields in the language of the audit, with comment targets of the finding', async () => {
    await mountFinding()
    expect(wrapper.findComponent(CustomFields).props()).toMatchObject({ locale: 'fr', readonly: false, commentTarget: { kind: 'finding', findingId: 'f1' } })
  })

  it('requires the required custom fields before saving', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'updateFinding').mockResolvedValue({})
    const customFields = _.cloneDeep(CUSTOM_FIELDS)
    customFields[1].required = true
    await mountFinding({ customFields, finding: findingData({ customFields: [] }) })
    vm().updateFinding()
    await flushPromises()
    expect(AuditService.updateFinding).not.toHaveBeenCalled()
    expect(lastNotification(notify)).toMatchObject({ message: t('msg.fieldRequired'), color: 'negative' })
  })
})

describe('finding tabs', () => {
  it('shows the definition, proofs and details tabs', async () => {
    await mountFinding()
    expect(wrapper.findAllComponents(QTab).map((tab) => tab.props('name'))).toEqual(['definition', 'proofs', 'details'])
    expect(vm().selectedTab).toBe('definition')
    await selectTab('proofs')
    expect(editor('basiceditor_poc').props('modelValue')).toBe('<p>PoC</p>')
    await selectTab('details')
    expect(editor('basiceditor_remediation').props('modelValue')).toBe('<p>Correctif</p>')
    expect(editor('basiceditor_scope').props('modelValue')).toBe('<p>10.0.0.1</p>')
  })

  it('edits the CVSS vector with the calculator', async () => {
    await mountFinding()
    await selectTab('details')
    const calculator = wrapper.findComponent(CvssCalculator)
    expect(calculator.props()).toMatchObject({ modelValue: CRITICAL, readonly: false })
    calculator.vm.$emit('update:modelValue', 'CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N')
    expect(vm().finding.cvssv3).toBe('CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N')
  })

  it('selects the remediation complexity and the priority', async () => {
    await mountFinding()
    await selectTab('details')
    const [complexity, priority] = wrapper.findAllComponents(QSelect).filter((s) => [t('remediationDifficulty'), t('priority')].includes(s.props('label')))
    expect(complexity.props('options').map((o) => o.value)).toEqual([1, 2, 3])
    expect(priority.props('options').map((o) => o.value)).toEqual([1, 2, 3, 4])
    expect(complexity.props('modelValue')).toBe(2)
    priority.vm.$emit('update:modelValue', 4)
    expect(vm().finding.priority).toBe(4)
  })

  it('opens the tab of the field of a review comment of this finding', async () => {
    const store = reactive({ focus: null, forTarget: () => [], openCountForTarget: () => 0, openTarget: vi.fn() })
    await mountFinding({ provide: { auditComments: store } })
    store.focus = { kind: 'finding', findingId: 'f1', field: 'poc' }
    await flushPromises()
    expect(vm().selectedTab).toBe('proofs')
    store.focus = { kind: 'finding', findingId: 'f1', field: 'cvssv3' }
    await flushPromises()
    expect(vm().selectedTab).toBe('details')
    store.focus = { kind: 'finding', findingId: 'f1', field: 'customFields.cf1' }
    await flushPromises()
    expect(vm().selectedTab).toBe('definition')
    store.focus = { kind: 'finding', findingId: 'f2', field: 'poc' } // Other finding
    await flushPromises()
    expect(vm().selectedTab).toBe('definition')
    store.focus = { kind: 'general', field: 'name' }
    await flushPromises()
    expect(vm().selectedTab).toBe('definition')
  })

  it('opens the tab of a comment selected before the page was opened', async () => {
    const store = reactive({ focus: { kind: 'finding', findingId: 'f1', field: 'remediation' }, forTarget: () => [], openCountForTarget: () => 0, openTarget: vi.fn() })
    await mountFinding({ provide: { auditComments: store } })
    expect(vm().selectedTab).toBe('details')
  })

  it('gives stable comment targets to the fields', async () => {
    await mountFinding()
    expect(vm().commentTargets.base).toEqual({ kind: 'finding', findingId: 'f1' })
    expect(vm().commentTargets.poc).toEqual({ kind: 'finding', findingId: 'f1', field: 'poc' })
    expect(vm().commentTargets).toBe(vm().commentTargets)
  })

  it('takes the initial proofs and details as saved values when their tab is opened the first time', async () => {
    await mountFinding()
    vm().finding.poc = '<p>PoC normalized by the editor</p>'
    vm().selectedTab = 'proofs'
    vm().updateOrig()
    expect(vm().findingOrig.poc).toBe('<p>PoC normalized by the editor</p>')
    vm().finding.poc = '<p>Changed later</p>'
    vm().updateOrig()
    expect(vm().findingOrig.poc).toBe('<p>PoC normalized by the editor</p>') // Only the first time
    vm().finding.remediation = null
    vm().selectedTab = 'details'
    vm().updateOrig()
    expect(vm().finding.remediation).toBe('')
    expect(vm().findingOrig.remediation).toBe('')
  })
})

describe('finding vulnerability types', () => {
  it('offers the types of the language of the audit', async () => {
    await mountFinding()
    expect(vm().vulnTypesLang.map((type) => type.name)).toEqual(['Applicatif', 'Système'])
    expect(vm().filteredVulnTypes.map((type) => type.name)).toEqual(['Applicatif', 'Système'])
  })

  it('filters the types typed in the select (case insensitive)', async () => {
    await mountFinding()
    const update = (fn) => fn()
    vm().filterType('SYS', update)
    expect(vm().filteredVulnTypes.map((type) => type.name)).toEqual(['Système'])
    vm().filterType('', update)
    expect(vm().filteredVulnTypes).toHaveLength(2)
    vm().filterType('absent', update)
    expect(vm().filteredVulnTypes).toEqual([])
  })
})

describe('finding save', () => {
  it('can be saved only once the editors are ready', async () => {
    await mountFinding()
    expect(saveButton().props('disable')).toBe(true)
    await editorsReady()
    expect(saveButton().props('disable')).toBe(false)
  })

  it('saves the finding and notifies it', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'updateFinding').mockResolvedValue({})
    await mountFinding()
    await editorsReady()
    vm().finding.title = 'Injection SQL – 漢字 🔒'
    editor('basiceditor_description').vm.$emit('editorchange')
    expect(vm().needSave).toBe(true)
    await saveButton().trigger('click')
    await flushPromises()
    expect(AuditService.updateFinding).toHaveBeenCalledWith('a1', 'f1', expect.objectContaining({ title: 'Injection SQL – 漢字 🔒', cvssv3: CRITICAL }))
    expect(lastNotification(notify)).toMatchObject({ message: t('msg.findingUpdateOk'), color: 'positive' })
    expect(vm().needSave).toBe(false)
    expect(vm().findingOrig.title).toBe('Injection SQL – 漢字 🔒')
  })

  it('notifies the error of the server and keeps the changes to save', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'updateFinding').mockRejectedValue(apiError(422, 'Invalid CVSS vector'))
    await mountFinding()
    await editorsReady()
    editor('basiceditor_observation').vm.$emit('editorchange')
    vm().updateFinding()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Invalid CVSS vector', color: 'negative' })
    expect(vm().needSave).toBe(true)
  })

  // Network cut: the request has no answer, the user must be told that the finding was not saved
  it('notifies a save failing without answer (network error)', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'updateFinding').mockRejectedValue(new Error('Network Error'))
    await mountFinding()
    vm().updateFinding()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Network Error', color: 'negative' })
  })

  it('proposes the finding once for a double click', async () => {
    mockNotify()
    vi.spyOn(VulnService, 'backupFinding').mockReturnValue(new Promise(() => {}))
    await mountFinding()
    await button(t('btn.backupFinding')).trigger('click')
    await button(t('btn.backupFinding')).trigger('click')
    vm().backupFinding()
    expect(VulnService.backupFinding).toHaveBeenCalledTimes(1)
  })

  it('saves with ctrl+s in edition on the finding page only', async () => {
    mockNotify()
    vi.spyOn(AuditService, 'updateFinding').mockResolvedValue({})
    await mountFinding()
    pressSave()
    await flushPromises()
    expect(AuditService.updateFinding).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    await mountFinding({ routeName: 'general' })
    pressSave()
    await flushPromises()
    expect(AuditService.updateFinding).toHaveBeenCalledTimes(1)
  })

  it('does not save with ctrl+s in a read-only state', async () => {
    vi.spyOn(AuditService, 'updateFinding').mockResolvedValue({})
    await mountFinding({ state: S.REVIEW_EDITOR })
    pressSave()
    await flushPromises()
    expect(AuditService.updateFinding).not.toHaveBeenCalled()
  })

  it('stops listening to ctrl+s when unmounted', async () => {
    vi.spyOn(AuditService, 'updateFinding').mockResolvedValue({})
    await mountFinding()
    wrapper.unmount()
    wrapper = null
    pressSave()
    await flushPromises()
    expect(AuditService.updateFinding).not.toHaveBeenCalled()
  })

  it('marks the finding as completed', async () => {
    await mountFinding()
    const toggle = wrapper.findComponent(QToggle)
    expect(toggle.props()).toMatchObject({ modelValue: 1, trueValue: 0, falseValue: 1, label: t('completed') })
    await toggle.trigger('click')
    expect(vm().finding.status).toBe(0)
  })
})

describe('finding read-only states', () => {
  it.each([S.EDIT_READONLY, S.REVIEW, S.REVIEW_EDITOR, S.REVIEW_ADMIN, S.APPROVED, S.APPROVED_READONLY])('cannot be modified in the state %i', async (state) => {
    await mountFinding({ state })
    expect(buttonLabels()).not.toContain(t('btn.delete'))
    expect(saveButton()).toBeUndefined()
    expect(wrapper.findComponent(QToggle).exists()).toBe(false)
    expect(wrapper.findAllComponents(QInput).every((input) => input.props('readonly') === true)).toBe(true)
    expect(wrapper.findAllComponents(EditorStub).every((e) => e.props('editable') === false)).toBe(true)
    expect(wrapper.findComponent(CustomFields).props('readonly')).toBe(true)
    expect(wrapper.findComponent(TextareaArray).props('readonly')).toBe(true)
    await selectTab('details')
    expect(wrapper.findComponent(CvssCalculator).props('readonly')).toBe(true)
    // The finding can still be proposed to the vulnerabilities database
    expect(buttonLabels()).toContain(t('btn.backupFinding'))
  })

  it('can be modified in edition', async () => {
    await mountFinding()
    expect(buttonLabels()).toEqual(expect.arrayContaining([t('btn.backupFinding'), t('btn.delete'), `${t('btn.save')} (ctrl+s)`]))
    expect(wrapper.findAllComponents(EditorStub).every((e) => e.props('editable') === true)).toBe(true)
  })
})

describe('finding unsaved changes', () => {
  it('leaves without confirmation when nothing changed', async () => {
    const dialogs = mockDialog()
    await mountFinding()
    await editorsReady()
    expect(leave()).toHaveBeenCalled()
    expect(dialogs).toHaveLength(0)
  })

  it('ignores the changes of the editors before they are ready (initial value)', async () => {
    mockDialog()
    await mountFinding()
    editor('basiceditor_description').vm.$emit('editorchange')
    expect(vm().needSave).toBe(false)
    expect(leave()).toHaveBeenCalled()
  })

  it.each(['beforeRouteLeave', 'beforeRouteUpdate'])('%s asks a confirmation after a change of an editor', async (guard) => {
    const dialogs = mockDialog()
    await mountFinding()
    await editorsReady()
    await selectTab('proofs')
    editor('basiceditor_poc').vm.$emit('editorchange')
    const next = leave(guard)
    expect(next).not.toHaveBeenCalled()
    expect(dialogs[0].options).toMatchObject({ title: t('msg.thereAreUnsavedChanges') })
    dialogs[0].cancel()
    expect(next).not.toHaveBeenCalled()
    dialogs[0].ok()
    expect(next).toHaveBeenCalled()
  })

  // Fields other than the editors: compared to the saved version
  it.each([
    ['title', (finding) => { finding.title = 'Renamed' }],
    ['cvssv3', (finding) => { finding.cvssv3 = '' }],
    ['status', (finding) => { finding.status = 0 }],
    ['references', (finding) => { finding.references.push('CWE-89') }],
    ['custom fields', (finding) => { finding.customFields[1].text = 'Équipe bleue' }]
  ])('asks a confirmation after a change of the %s', async (field, change) => {
    const dialogs = mockDialog()
    await mountFinding()
    await editorsReady()
    change(vm().finding)
    const next = leave()
    expect(next).not.toHaveBeenCalled()
    expect(dialogs).toHaveLength(1)
  })

  // Values normalized by the editors when they load them (rich texts, custom fields of type text): no change of the user
  it('ignores the values of the editors without their change event', async () => {
    const dialogs = mockDialog()
    const customFields = [...CUSTOM_FIELDS, { _id: 'cf6', label: 'Notes', fieldType: 'text', display: 'finding', displaySub: '', size: 12, offset: 0 }]
    await mountFinding({ customFields })
    await editorsReady()
    vm().finding.description = '<p>Description</p><p></p>'
    vm().finding.customFields.find((field) => field.customField._id === 'cf6').text = '<p></p>'
    expect(leave()).toHaveBeenCalled()
    expect(dialogs).toHaveLength(0)
  })

  // The CVSS calculator rewrites the vector it shows (CVSS 3.0 vector, other order of the metrics)
  it('ignores the vector rewritten by the CVSS calculator', async () => {
    const dialogs = mockDialog()
    await mountFinding({ finding: findingData({ cvssv3: 'CVSS:3.0/AC:L/AV:N/PR:N/UI:N/S:U/C:H/I:H/A:H' }) })
    await editorsReady()
    await selectTab('details')
    expect(vm().finding.cvssv3).toBe(CRITICAL)
    expect(leave()).toHaveBeenCalled()
    expect(dialogs).toHaveLength(0)
    wrapper.findComponent(CvssCalculator).vm.$emit('update:modelValue', 'CVSS:3.1/AV:L/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')
    expect(leave()).not.toHaveBeenCalled()
  })

  it('asks a confirmation after a change of a custom field of type text', async () => {
    const dialogs = mockDialog()
    await mountFinding()
    await editorsReady()
    wrapper.findComponent(CustomFields).vm.$emit('editorchange')
    expect(leave()).not.toHaveBeenCalled()
    expect(dialogs).toHaveLength(1)
  })
})

describe('finding deletion', () => {
  const FINDINGS = [{ _id: 'f0' }, { _id: 'f1' }, { _id: 'f2' }]

  // Page rendered by a parent holding the audit (as the router-view of vue-router 3 did)
  async function mountInParent(findings) {
    UserService.user = { id: 'u1', username: 'author', roles: '*' }
    mockApi()
    socket = fakeSocket()
    router = { push: vi.fn(() => Promise.resolve()) }
    wrapper = mount({
      components: { EditFinding },
      data: () => ({ auditId: 'a1', audit: { _id: 'a1', language: 'fr', findings } }),
      template: '<edit-finding :audit="audit" :frontEndAuditState="0" />'
    }, { global: globalOptions() })
    await flushPromises()
  }

  it('asks a confirmation and does nothing when cancelled', async () => {
    const dialogs = mockDialog()
    vi.spyOn(AuditService, 'deleteFinding')
    await mountFinding()
    await button(t('btn.delete')).trigger('click')
    expect(dialogs[0].options).toMatchObject({ title: t('msg.deleteFindingConfirm'), message: t('msg.deleteFindingNotice') })
    dialogs[0].cancel()
    expect(AuditService.deleteFinding).not.toHaveBeenCalled()
  })

  it.each([
    [FINDINGS, '/audits/a1/findings/f2'], // Next finding
    [[{ _id: 'f0' }, { _id: 'f1' }], '/audits/a1/findings/f0'], // Last finding: previous one
    [[{ _id: 'f1' }], '/audits/a1/findings/add'] // Only finding: add page
  ])('deletes the finding and opens the next one (%j)', async (findings, path) => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(AuditService, 'deleteFinding').mockResolvedValue({})
    await mountInParent(findings)
    vm().deleteFinding()
    dialogs[0].ok()
    await flushPromises()
    expect(AuditService.deleteFinding).toHaveBeenCalledWith('a1', 'f1')
    expect(lastNotification(notify)).toMatchObject({ message: t('msg.findingDeleteOk'), color: 'positive' })
    expect(router.push).toHaveBeenCalledWith(path)
  })

  it('leaves without confirmation after the deletion', async () => {
    const dialogs = mockDialog()
    mockNotify()
    vi.spyOn(AuditService, 'deleteFinding').mockResolvedValue({})
    await mountInParent(FINDINGS)
    vm().deleteFinding()
    dialogs[0].ok()
    await flushPromises()
    expect(vm().findingOrig).toBe(vm().finding)
  })

  it('asks no confirmation to leave a deleted finding changed before', async () => {
    const dialogs = mockDialog()
    mockNotify()
    vi.spyOn(AuditService, 'deleteFinding').mockResolvedValue({})
    await mountInParent(FINDINGS)
    await editorsReady()
    editor('basiceditor_description').vm.$emit('editorchange')
    vm().finding.title = 'Changed'
    vm().deleteFinding()
    dialogs[0].ok()
    await flushPromises()
    expect(leave()).toHaveBeenCalled()
    expect(dialogs).toHaveLength(1) // Confirmation of the deletion only
  })

  it('notifies the error of the deletion and stays on the finding', async () => {
    const dialogs = mockDialog()
    const notify = mockNotify()
    vi.spyOn(AuditService, 'deleteFinding').mockRejectedValue(apiError(403, 'Insufficient Privileges'))
    await mountInParent(FINDINGS)
    vm().deleteFinding()
    dialogs[0].ok()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Insufficient Privileges', color: 'negative' })
    expect(router.push).not.toHaveBeenCalled()
  })

  // With vue-router 4 the parent of the page is the RouterView: the findings are read from the 'audit' prop
  it('opens the next finding after the deletion when rendered by the router-view of the audit page', async () => {
    const dialogs = mockDialog()
    mockNotify()
    vi.spyOn(AuditService, 'deleteFinding').mockResolvedValue({})
    UserService.user = { id: 'u1', username: 'author', roles: '*' }
    mockApi()
    socket = fakeSocket()
    const EditPage = { data: () => ({ auditId: 'a1', audit: { _id: 'a1', language: 'fr', findings: FINDINGS } }), template: '<router-view :audit="audit" :frontEndAuditState="0" />' }
    const realRouter = createRouter({ history: createMemoryHistory(), routes: [{ path: '/audits/:auditId', component: EditPage, children: [{ path: 'findings/:findingId', name: 'editFinding', component: EditFinding }] }] })
    realRouter.push('/audits/a1/findings/f1')
    await realRouter.isReady()
    const push = vi.spyOn(realRouter, 'push')
    wrapper = mount({ template: '<router-view />' }, { global: { plugins: [realRouter], mocks: { $socket: socket, $_: _, $settings: settings({ report: { cvssColors: {} } }) }, stubs: { ProposalReview: ProposalReviewStub } } })
    await flushPromises()
    vm().deleteFinding()
    dialogs[0].ok()
    await flushPromises()
    expect(push).toHaveBeenCalledWith('/audits/a1/findings/f2')
  })
})

describe('finding proposal to the vulnerabilities database', () => {
  it('proposes the finding in the language of the audit and shows the new proposal', async () => {
    const notify = mockNotify()
    vi.spyOn(VulnService, 'backupFinding').mockResolvedValue({ data: { datas: 'Proposal created' } })
    await mountFinding()
    VulnService.getFindingProposal.mockImplementation(() => ok({ _id: 'p1', status: 'pending' }))
    await button(t('btn.backupFinding')).trigger('click')
    await flushPromises()
    expect(VulnService.backupFinding).toHaveBeenCalledWith('fr', expect.objectContaining({ title: 'Injection SQL', auditId: 'a1', findingId: 'f1' }))
    expect(lastNotification(notify)).toMatchObject({ message: 'Proposal created', color: 'positive' })
    expect(VulnService.getFindingProposal).toHaveBeenCalledTimes(2)
    expect(wrapper.findComponent(QChip).text()).toContain(t('proposals.status.pending'))
  })

  it('notifies the error of the proposal', async () => {
    const notify = mockNotify()
    vi.spyOn(VulnService, 'backupFinding').mockRejectedValue(apiError(422, 'A proposal is already pending'))
    await mountFinding()
    vm().backupFinding()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'A proposal is already pending', color: 'negative' })
  })

  it.each([
    ['pending', 'orange-8'], ['accepted', 'green'], ['partial', 'teal'], ['rejected', 'negative'], [undefined, 'orange-8']
  ])('shows the status %s of the last proposal', async (status, color) => {
    await mountFinding({ proposal: { _id: 'p1', status, reviewComment: 'Doublon de « XSS »' } })
    const chip = wrapper.findComponent(QChip)
    expect(chip.props('color')).toBe(color)
    expect(chip.text()).toContain(t(`proposals.status.${status || 'pending'}`))
  })

  it('opens the review of the last proposal', async () => {
    await mountFinding({ proposal: { _id: 'p1', status: 'rejected' } })
    await wrapper.findComponent(QChip).trigger('click')
    expect(ProposalReviewStub.methods.open).toHaveBeenCalledWith('p1')
  })

  it('shows no status without proposal and reloads it when the review changed', async () => {
    await mountFinding()
    expect(wrapper.findComponent(QChip).exists()).toBe(false)
    VulnService.getFindingProposal.mockImplementation(() => ok({ _id: 'p1', status: 'accepted' }))
    wrapper.findComponent(ProposalReviewStub).vm.$emit('changed')
    await flushPromises()
    expect(wrapper.findComponent(QChip).props('color')).toBe('green')
  })

  it('keeps no status when the proposal cannot be loaded', async () => {
    UserService.user = { id: 'u1', username: 'author', roles: '*' }
    mockApi()
    VulnService.getFindingProposal.mockRejectedValue(apiError(404, 'Not found'))
    socket = fakeSocket()
    router = { push: vi.fn() }
    wrapper = mount(EditFinding, { props: { audit: { language: 'fr' }, frontEndAuditState: S.EDIT }, global: globalOptions() })
    await flushPromises()
    expect(vm().findingProposal).toBeNull()
    expect(vm().finding.title).toBe('Injection SQL')
  })
})
