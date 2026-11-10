// pages/audits/edit/sections: custom fields of a section of an audit (or its text for the sections of the old
// versions): loading, save, ctrl+s, unsaved changes, read-only states. Editor stubbed, API services mocked.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import _ from 'lodash'
import { QBtn, QInput } from 'quasar'

vi.mock('components/editor', () => import('../../helpers/editor-stub'))
vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import SectionPage from 'pages/audits/edit/sections'
import CustomFields from 'components/custom-fields'
import EditorStub from '../../helpers/editor-stub'
import AuditService from '@/services/audit'
import DataService from '@/services/data'
import UserService from '@/services/user'
import Utils from '@/services/utils'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'
import { installAppGlobals, fakeSocket, settings, route, pressSave, apiError, ok } from '../../helpers/audit-edit'

const S = Utils.AUDIT_VIEW_STATE
const AUDIT = { _id: 'a1', name: 'Pentest Été', auditType: 'Web', language: 'fr', findings: [] }

const field = (id, fieldType, text, extra = {}) => ({
  customField: { _id: id, label: `Champ ${id}`, fieldType, size: 12, offset: 0, required: false, options: [], description: '', ...extra },
  text
})

function sectionData(overrides = {}) {
  return {
    _id: 's1', field: 'intro', name: 'Introduction',
    customFields: [field('cf1', 'input', 'Synthèse 🔒'), field('cf2', 'text', '<p>Contexte</p>'), field('cf3', 'checkbox', ['A'], { options: [{ locale: 'fr', value: 'A' }, { locale: 'fr', value: 'B' }] })],
    ...overrides
  }
}

let wrapper
let socket

function mockApi({ section = sectionData() } = {}) {
  vi.spyOn(DataService, 'getCustomFields').mockImplementation(() => ok([]))
  if (section && section.response) vi.spyOn(AuditService, 'getSection').mockRejectedValue(section)
  else vi.spyOn(AuditService, 'getSection').mockImplementation(() => ok(_.cloneDeep(section)))
}

async function mountSection({ state = S.EDIT, routeName = 'editSection', routeSection = 's1', audit = AUDIT, ...api } = {}) {
  UserService.user = { id: 'u1', username: 'author', roles: '*' }
  mockApi(api)
  socket = fakeSocket()
  const $route = route(routeName, { sectionId: 's1' })
  wrapper = mount(SectionPage, {
    props: { audit, frontEndAuditState: state, parentState: 'EDIT', parentApprovals: [] },
    global: { mocks: { $route, $router: { push: vi.fn() }, $settings: settings(), $socket: socket, $_: _ } }
  })
  await flushPromises()
  $route.params.sectionId = routeSection // Route of the page now displayed
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
const guard = (name = 'beforeRouteLeave') => {
  const next = vi.fn()
  SectionPage[name].call(wrapper.vm, { name: 'editSection', params: { sectionId: 's2' } }, { name: 'editSection' }, next)
  return next
}

beforeAll(() => installAppGlobals())
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => unmountPage())

describe('section page loading', () => {
  it('loads the section and tells the other users which section is open', async () => {
    await mountSection()
    expect(DataService.getCustomFields).toHaveBeenCalled()
    expect(AuditService.getSection).toHaveBeenCalledWith('a1', 's1')
    expect(socket.emit).toHaveBeenCalledWith('menu', { menu: 'editSection', section: 's1', room: 'a1' })
    expect(vm().section.name).toBe('Introduction')
    expect(vm().sectionOrig).toEqual(vm().section)
    expect(wrapper.text()).toContain('Pentest Été (Web)')
  })

  it('shows the custom fields of the section in the language of the audit', async () => {
    await mountSection()
    const customFields = wrapper.findComponent(CustomFields)
    expect(customFields.props()).toMatchObject({ locale: 'fr', readonly: false, commentTarget: { kind: 'section', sectionId: 's1' }, noSyncEditor: true })
    expect(wrapper.findComponent(QInput).props('modelValue')).toBe('Synthèse 🔒')
    expect(wrapper.findComponent(EditorStub).props('modelValue')).toBe('<p>Contexte</p>')
  })

  it('shows the text of the sections of the old versions in an editor', async () => {
    await mountSection({ section: sectionData({ text: '<p>Ancien texte</p>', customFields: [] }) })
    expect(wrapper.findComponent(CustomFields).exists()).toBe(false)
    const editor = wrapper.findComponent(EditorStub)
    expect(editor.props()).toMatchObject({ modelValue: '<p>Ancien texte</p>', editable: true, commentTarget: { kind: 'section', sectionId: 's1', field: 'text' } })
    // Field of the shared document of the audit: same for all the users of the section, different for each section
    expect(editor.props('idUnique')).toBe('s1-section-text')
  })

  it('shows a section without custom field', async () => {
    await mountSection({ section: sectionData({ customFields: [] }) })
    expect(wrapper.findComponent(CustomFields).exists()).toBe(true)
    expect(wrapper.findAllComponents(QInput)).toHaveLength(0)
  })

  it('keeps an empty section when it cannot be loaded', async () => {
    await mountSection({ section: apiError(404, 'Section not found') })
    expect(vm().section).toEqual({ field: '', name: '', customFields: [] })
    expect(saveButton()).toBeDefined()
  })

  it('cannot save the empty section of the page before the section is loaded', async () => {
    vi.spyOn(AuditService, 'updateSection').mockResolvedValue({})
    await mountSection({ section: apiError(404, 'Section not found') })
    expect(saveButton().props('disable')).toBe(true)
    pressSave()
    vm().updateSection()
    await flushPromises()
    expect(AuditService.updateSection).not.toHaveBeenCalled()
  })

  // Audit of the edit page not loaded yet (default prop {}): "Loading...", not "undefined (Audit Type not set)"
  it('shows a default title while the audit is loading', async () => {
    await mountSection({ audit: { findings: {} } })
    expect(wrapper.text()).toContain('Loading...')
    expect(wrapper.text()).not.toContain('undefined')
  })
})

describe('section page save', () => {
  it('saves the section and notifies it', async () => {
    const notify = mockNotify()
    const dialogs = mockDialog()
    vi.spyOn(AuditService, 'updateSection').mockResolvedValue({})
    await mountSection()
    vm().section.customFields[0].text = 'Nouvelle synthèse – 漢字'
    await saveButton().trigger('click')
    await flushPromises()
    const [auditId, sectionId, section] = AuditService.updateSection.mock.calls[0]
    expect([auditId, sectionId]).toEqual(['a1', 's1'])
    expect(section.customFields[0].text).toBe('Nouvelle synthèse – 漢字')
    expect(lastNotification(notify)).toMatchObject({ message: t('msg.sectionUpdateOk'), color: 'positive' })
    expect(guard()).toHaveBeenCalled() // Nothing left to save
    expect(dialogs).toHaveLength(0)
  })

  it('notifies the error of the server and keeps the changes unsaved', async () => {
    const notify = mockNotify()
    mockDialog()
    vi.spyOn(AuditService, 'updateSection').mockRejectedValue(apiError(403, 'Audit not found or Insufficient Privileges'))
    await mountSection()
    vm().section.customFields[2].text = ['A', 'B']
    vm().updateSection()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Audit not found or Insufficient Privileges', color: 'negative' })
    expect(guard()).not.toHaveBeenCalled()
  })

  it('requires the required custom fields', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'updateSection').mockResolvedValue({})
    await mountSection({ section: sectionData({ customFields: [field('cf1', 'input', '', { required: true })] }) })
    vm().updateSection()
    await flushPromises()
    expect(AuditService.updateSection).not.toHaveBeenCalled()
    expect(lastNotification(notify)).toMatchObject({ message: t('msg.fieldRequired'), color: 'negative' })
  })

  it('saves a section of an old version (text) without custom field validation', async () => {
    mockNotify()
    vi.spyOn(AuditService, 'updateSection').mockResolvedValue({})
    await mountSection({ section: sectionData({ text: '<p>Ancien texte</p>', customFields: [] }) })
    vm().updateSection()
    await flushPromises()
    expect(AuditService.updateSection).toHaveBeenCalledWith('a1', 's1', expect.objectContaining({ text: '<p>Ancien texte</p>' }))
  })

  it('saves with ctrl+s in edition', async () => {
    mockNotify()
    vi.spyOn(AuditService, 'updateSection').mockResolvedValue({})
    await mountSection()
    pressSave()
    await flushPromises()
    expect(AuditService.updateSection).toHaveBeenCalledTimes(1)
  })

  it.each([
    [S.REVIEW, 'editSection', 's1'],
    [S.EDIT, 'editFinding', 's1'],
    [S.EDIT, 'editSection', 's2'] // Another section displayed
  ])('does not save with ctrl+s in the state %i on the page %s (section %s)', async (state, routeName, routeSection) => {
    vi.spyOn(AuditService, 'updateSection').mockResolvedValue({})
    await mountSection({ state, routeName, routeSection })
    pressSave()
    await flushPromises()
    expect(AuditService.updateSection).not.toHaveBeenCalled()
  })

  // A listener left by a previous visit would save the stale data of this visit
  it('stops listening to ctrl+s when unmounted', async () => {
    mockNotify()
    vi.spyOn(AuditService, 'updateSection').mockResolvedValue({})
    await mountSection()
    const listener = wrapper.vm._listener
    wrapper.unmount()
    wrapper = null
    pressSave()
    document.removeEventListener('keydown', listener, false)
    await flushPromises()
    expect(AuditService.updateSection).not.toHaveBeenCalled()
  })
})

describe('section page read-only states', () => {
  it.each([S.EDIT_READONLY, S.REVIEW, S.REVIEW_EDITOR, S.APPROVED, S.APPROVED_READONLY])('cannot be modified in the state %i', async (state) => {
    await mountSection({ state })
    expect(saveButton()).toBeUndefined()
    expect(wrapper.findComponent(CustomFields).props('readonly')).toBe(true)
    expect(wrapper.findComponent(QInput).props('readonly')).toBe(true)
  })

  it('shows the text of an old section read only', async () => {
    await mountSection({ state: S.REVIEW_READONLY, section: sectionData({ text: '<p>Ancien</p>' }) })
    expect(wrapper.findComponent(EditorStub).props('editable')).toBe(false)
  })
})

describe('section page unsaved changes', () => {
  it.each(['beforeRouteLeave', 'beforeRouteUpdate'])('%s leaves without confirmation when nothing changed', async (name) => {
    const dialogs = mockDialog()
    await mountSection()
    expect(guard(name)).toHaveBeenCalled()
    expect(dialogs).toHaveLength(0)
  })

  it.each(['beforeRouteLeave', 'beforeRouteUpdate'])('%s asks a confirmation after a change of a custom field', async (name) => {
    const dialogs = mockDialog()
    await mountSection()
    wrapper.findComponent(QInput).vm.$emit('update:modelValue', 'Modifié')
    const next = guard(name)
    expect(next).not.toHaveBeenCalled()
    expect(dialogs[0].options).toMatchObject({ title: t('msg.thereAreUnsavedChanges'), message: t('msg.doYouWantToLeave') })
    dialogs[0].cancel()
    expect(next).not.toHaveBeenCalled()
    dialogs[0].ok()
    expect(next).toHaveBeenCalled()
  })

  it('detects the changes of the text editors of the custom fields', async () => {
    const dialogs = mockDialog()
    await mountSection()
    wrapper.findComponent(EditorStub).vm.$emit('update:modelValue', '<p>Contexte modifié</p>')
    expect(guard()).not.toHaveBeenCalled()
    expect(dialogs).toHaveLength(1)
  })

  it('asks a confirmation after a change of the text of an old section', async () => {
    const dialogs = mockDialog()
    await mountSection({ section: sectionData({ text: '<p>Ancien texte</p>', customFields: [] }) })
    wrapper.findComponent(EditorStub).vm.$emit('update:modelValue', '<p>Texte modifié</p>')
    expect(guard()).not.toHaveBeenCalled()
    expect(dialogs).toHaveLength(1)
  })

  // The editor normalizes the HTML loaded (old versions): not a change of the user
  it('takes the text shown by the editor of an old section as saved', async () => {
    const dialogs = mockDialog()
    await mountSection({ section: sectionData({ text: '<p>Ancien <b>texte</b></p>', customFields: [] }) })
    const editor = wrapper.findComponent(EditorStub)
    editor.vm.updateHTML = () => editor.vm.$emit('update:modelValue', '<p>Ancien <strong>texte</strong></p>')
    editor.vm.$emit('ready')
    expect(guard()).toHaveBeenCalled()
    expect(dialogs).toHaveLength(0)
  })
})
