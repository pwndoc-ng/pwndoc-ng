// pages/audits/edit/index.vue: menu of the audit (sections, findings, review state and buttons, sort of the findings,
// users connected with the socket, review comments counts, report). Mounted in a real router (child pages stubbed).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { QLayout, QBtn, QItem, QChip, QBadge, QPageSticky } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))
vi.mock('@/boot/socketio', () => ({ connectSocket: vi.fn(), disconnectSocket: vi.fn(), socket: {} }))

import EditPage from 'pages/audits/edit'
import AuditService from '@/services/audit'
import DataService from '@/services/data'
import UserService from '@/services/user'
import Utils from '@/services/utils'
import { connectSocket } from '@/boot/socketio'
import { mockNotify, lastNotification } from '../../helpers/quasar'
import { installAppGlobals, fakeSocket, settings, apiError, ok } from '../../helpers/audit-edit'

const S = Utils.AUDIT_VIEW_STATE
const CRITICAL = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' // 9.8
const MEDIUM = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N' // 6.1
// Base 9.8 Critical, temporal 7.8 High, environmental 4.0 Medium
const WITH_TEMPORAL = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/E:U/RL:O/RC:U/MAV:P/CR:L/IR:L/AR:L'

const USERS = {
  author: { id: 'u-author', username: 'author', roles: ['audits:read', 'audits:update'] },
  collaborator: { id: 'u-collab', username: 'collab', roles: ['audits:read', 'audits:update'] },
  reviewer: { id: 'u-reviewer', username: 'reviewer', roles: ['audits:read', 'audits:review'] },
  admin: { id: 'u-admin', username: 'admin', roles: '*' },
  other: { id: 'u-other', username: 'other', roles: ['audits:read'] }
}

const finding = (id, title, extra = {}) => ({ _id: id, title, cvssv3: '', status: 1, customFields: [], ...extra })

function auditData(overrides = {}) {
  return {
    _id: 'a1', name: 'Pentest Été', auditType: 'Web', language: 'en', state: 'EDIT',
    creator: { _id: 'u-author', username: 'author' },
    collaborators: [{ _id: 'u-collab', username: 'collab' }],
    reviewers: [{ _id: 'u-reviewer', username: 'reviewer' }],
    approvals: [],
    findings: [
      finding('f1', 'SQL Injection', { category: 'Web', cvssv3: CRITICAL, status: 0 }),
      finding('f2', 'XSS réfléchie', { category: 'Web', cvssv3: MEDIUM }),
      finding('f3', 'Weak TLS 🔒')
    ],
    sections: [{ _id: 's1', field: 'intro', name: 'Introduction' }, { _id: 's2', field: 'unknown', name: 'Conclusion' }],
    sortFindings: [{ category: 'Web', sortValue: 'cvssScore', sortOrder: 'desc', sortAuto: true }],
    ...overrides
  }
}

const ChildPage = { name: 'ChildPage', props: ['frontEndAuditState', 'parentState', 'parentApprovals', 'audit'], template: '<div class="child-page" />' }

let wrapper
let router
let socket

function newRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/audits', name: 'audits', component: ChildPage },
      { path: '/audits/:auditId', component: EditPage, children: [
        { path: 'general', name: 'general', component: ChildPage },
        { path: 'network', name: 'network', component: ChildPage },
        { path: 'findings/add', name: 'addFindings', component: ChildPage },
        { path: 'findings/:findingId', name: 'editFinding', component: ChildPage },
        { path: 'sections/:sectionId', name: 'editSection', component: ChildPage }
      ] },
      { path: '/403', name: '403', component: ChildPage },
      { path: '/404', name: '404', component: ChildPage }
    ]
  })
}

function mockApi({ audit = auditData(), comments = [], customFields = [], auditTypes = [{ name: 'Web', hidden: [] }], categories = [] } = {}) {
  vi.spyOn(DataService, 'getCustomFields').mockImplementation(() => ok(customFields))
  vi.spyOn(DataService, 'getAuditTypes').mockImplementation(() => ok(auditTypes))
  vi.spyOn(DataService, 'getVulnerabilityCategories').mockImplementation(() => ok(categories))
  vi.spyOn(DataService, 'getSections').mockImplementation(() => ok([{ field: 'intro', icon: 'mdi-book-open' }]))
  vi.spyOn(AuditService, 'getComments').mockImplementation(() => ok(comments))
  if (audit instanceof Error || (audit && audit.response))
    vi.spyOn(AuditService, 'getAudit').mockRejectedValue(audit)
  else
    vi.spyOn(AuditService, 'getAudit').mockImplementation(() => ok(audit))
}

async function mountEdit({ user = 'author', path = '/audits/a1/general', $settings = settings(), ...api } = {}) {
  UserService.user = { ...USERS[user] }
  mockApi(api)
  socket = fakeSocket()
  router = newRouter()
  router.push(path)
  await router.isReady()
  wrapper = mount({ components: { QLayout }, template: '<q-layout view="hHh lpR fFf"><router-view /></q-layout>' }, {
    global: { plugins: [router], mocks: { $settings, $socket: socket }, stubs: { CommentsPanel: true } }
  })
  await flushPromises()
  return wrapper
}

const page = () => wrapper.findComponent(EditPage)
const vm = () => page().vm
const buttonLabels = () => page().findAllComponents(QBtn).map((button) => button.props('label')).filter(Boolean)
const t = (key, ...args) => vm().$t(key, ...args)

beforeAll(() => installAppGlobals())
// The drawers opened or closed by the tests start an animation timer of the Quasar layout (155 ms) that uses the
// document: let it end before the environment is torn down
afterAll(() => new Promise((resolve) => setTimeout(resolve, 200)))
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('audit edit menu loading', () => {
  it('loads the custom fields, audit types, vulnerability categories, audit, sections and comments', async () => {
    await mountEdit()
    expect(DataService.getCustomFields).toHaveBeenCalled()
    expect(DataService.getAuditTypes).toHaveBeenCalled()
    expect(DataService.getVulnerabilityCategories).toHaveBeenCalled()
    expect(AuditService.getAudit).toHaveBeenCalledWith('a1')
    expect(DataService.getSections).toHaveBeenCalled()
    expect(AuditService.getComments).toHaveBeenCalledWith('a1')
    expect(vm().audit.name).toBe('Pentest Été')
    expect(vm().loading).toBe(false)
  })

  it('joins the room of the audit with the socket once loaded', async () => {
    await mountEdit()
    expect(connectSocket).toHaveBeenCalled()
    expect(socket.emit).toHaveBeenCalledWith('join', { username: 'author', room: 'a1' })
    expect(Object.keys(socket.handlers)).toEqual(expect.arrayContaining(['roomUsers', 'updateUsers', 'updateAudit', 'updateComments', 'disconnect']))
  })

  it('gives the state of the audit to the child page', async () => {
    await mountEdit({ audit: auditData({ state: 'REVIEW', approvals: [{ _id: 'u-reviewer' }] }) })
    const child = wrapper.findComponent(ChildPage)
    expect(child.props()).toMatchObject({ frontEndAuditState: S.REVIEW_EDITOR, parentState: 'REVIEW', parentApprovals: [{ _id: 'u-reviewer' }] })
    expect(child.props('audit').name).toBe('Pentest Été')
  })

  it('links to the general information, network, findings and sections of the audit', async () => {
    await mountEdit()
    const links = page().findAllComponents(QItem).map((item) => item.props('to')).filter(Boolean)
    expect(links).toEqual(['/audits/a1/general', '/audits/a1/network', '/audits/a1/findings/f1', '/audits/a1/findings/f2', '/audits/a1/findings/f3', '/audits/a1/sections/s1', '/audits/a1/sections/s2'])
    expect(page().text()).toContain(`${t('findings')} (3)`)
    expect(page().text()).toContain('Introduction')
    expect(page().text()).toContain('Weak TLS 🔒')
  })

  it('uses the icon of the section definitions (notes by default)', async () => {
    await mountEdit()
    expect(vm().getSectionIcon({ field: 'intro' })).toBe('mdi-book-open')
    expect(vm().getSectionIcon({ field: 'unknown' })).toBe('notes')
    vm().sections = [{ field: 'intro' }]
    expect(vm().getSectionIcon({ field: 'intro' })).toBe('notes')
  })

  it('hides the network and findings menus hidden by the audit type', async () => {
    await mountEdit({ auditTypes: [{ name: 'Web', hidden: ['network', 'findings'] }] })
    const links = page().findAllComponents(QItem).map((item) => item.props('to')).filter(Boolean)
    expect(links).toEqual(['/audits/a1/general', '/audits/a1/sections/s1', '/audits/a1/sections/s2'])
    expect(page().text()).not.toContain(t('networkScan'))
  })

  it('shows the network and findings menus when the audit type is unknown', async () => {
    await mountEdit({ auditTypes: [] })
    expect(vm().currentAuditType).toBeUndefined()
    expect(page().text()).toContain(t('networkScan'))
    expect(page().text()).toContain(t('findings'))
  })

  it('shows an audit without findings nor sections', async () => {
    await mountEdit({ audit: auditData({ findings: [], sections: [], sortFindings: [] }) })
    expect(vm().findingList).toEqual([])
    expect(page().text()).toContain(`${t('findings')} (0)`)
  })

  it('redirects to the 403 page when the audit is not allowed', async () => {
    const error = apiError(403, 'Insufficient privileges')
    UserService.user = { ...USERS.other }
    mockApi({ audit: error })
    socket = fakeSocket()
    router = newRouter()
    router.push('/audits/a1/general')
    await router.isReady()
    const push = vi.spyOn(router, 'push')
    wrapper = mount({ components: { QLayout }, template: '<q-layout><router-view /></q-layout>' }, { global: { plugins: [router], mocks: { $settings: settings(), $socket: socket }, stubs: { CommentsPanel: true } } })
    await flushPromises()
    expect(push).toHaveBeenCalledWith({ name: '403', params: { error: 'Insufficient privileges' } })
    expect(socket.emit).not.toHaveBeenCalledWith('join', expect.anything())
  })

  it('redirects to the 404 page when the audit does not exist', async () => {
    UserService.user = { ...USERS.author }
    mockApi({ audit: apiError(404, 'Audit not found') })
    socket = fakeSocket()
    router = newRouter()
    router.push('/audits/a1/general')
    await router.isReady()
    const push = vi.spyOn(router, 'push')
    wrapper = mount({ components: { QLayout }, template: '<q-layout><router-view /></q-layout>' }, { global: { plugins: [router], mocks: { $settings: settings(), $socket: socket }, stubs: { CommentsPanel: true } } })
    await flushPromises()
    expect(push).toHaveBeenCalledWith({ name: '404', params: { error: 'Audit not found' } })
  })

  // Errors other than 403 / 404: the menu would stay empty without notification
  it('notifies the other errors when the audit cannot be loaded', async () => {
    const notify = mockNotify()
    await mountEdit({ audit: apiError(500, 'Internal error') })
    expect(notify).toHaveBeenCalled()
    expect(lastNotification(notify)).toMatchObject({ message: 'Internal error', color: 'negative' })
  })

  it('notifies a network error when the audit cannot be loaded (no response)', async () => {
    const notify = mockNotify()
    await mountEdit({ audit: new Error('Network Error') })
    expect(lastNotification(notify)).toMatchObject({ message: 'Network Error', color: 'negative' })
  })

  // Creator null when its user was deleted
  it('opens an audit whose creator was deleted', async () => {
    await mountEdit({ user: 'admin', audit: auditData({ creator: null }) })
    expect(vm().loading).toBe(false)
    expect(vm().frontEndAuditState).toBe(S.EDIT)
    expect(vm().commentsStore.canResolve({ author: { _id: 'u-other' } })).toBe(true) // Editor of the audit
  })

  it('opens an audit whose creator was deleted for review', async () => {
    await mountEdit({ user: 'reviewer', audit: auditData({ creator: null, state: 'REVIEW' }) })
    expect(vm().frontEndAuditState).toBe(S.REVIEW)
  })

  it('does not leave the room when unmounted before the audit was loaded', async () => {
    await mountEdit({ audit: apiError(404, 'Audit not found') })
    socket.emit.mockClear()
    wrapper.unmount()
    wrapper = null
    expect(socket.emit).not.toHaveBeenCalled()
    expect(socket.off).not.toHaveBeenCalled()
  })
})

describe('audit review state', () => {
  // [reviews enabled, audit state, user, approvals of the audit, expected state]
  it.each([
    [true, 'EDIT', 'author', [], S.EDIT],
    [true, 'EDIT', 'collaborator', [], S.EDIT],
    [true, 'EDIT', 'admin', [], S.EDIT],
    [true, 'EDIT', 'reviewer', [], S.EDIT_READONLY],
    [true, 'EDIT', 'other', [], S.EDIT_READONLY],
    [true, 'REVIEW', 'author', [], S.REVIEW_EDITOR],
    [true, 'REVIEW', 'collaborator', [{ _id: 'u-collab' }], S.REVIEW_EDITOR],
    [true, 'REVIEW', 'reviewer', [], S.REVIEW],
    [true, 'REVIEW', 'reviewer', [{ _id: 'u-reviewer' }], S.REVIEW_APPROVED],
    [true, 'REVIEW', 'admin', [], S.REVIEW_ADMIN],
    [true, 'REVIEW', 'admin', [{ _id: 'u-admin' }], S.REVIEW_ADMIN_APPROVED],
    [true, 'REVIEW', 'other', [], S.REVIEW_READONLY],
    [true, 'APPROVED', 'author', [{ _id: 'u-reviewer' }], S.APPROVED_READONLY],
    [true, 'APPROVED', 'reviewer', [{ _id: 'u-admin' }], S.APPROVED],
    [true, 'APPROVED', 'reviewer', [{ _id: 'u-reviewer' }], S.APPROVED_APPROVED],
    [true, 'APPROVED', 'admin', [{ _id: 'u-admin' }], S.APPROVED_APPROVED],
    [true, 'APPROVED', 'other', [{ _id: 'u-reviewer' }], S.APPROVED_READONLY],
    [false, 'REVIEW', 'author', [], S.EDIT],
    [false, 'APPROVED', 'collaborator', [], S.EDIT],
    [false, 'REVIEW', 'reviewer', [], S.EDIT_READONLY],
    [false, 'EDIT', 'other', [], S.EDIT_READONLY]
  ])('reviews %s, audit %s, user %s, approvals %j: state %i', async (reviews, state, user, approvals, expected) => {
    await mountEdit({ user, $settings: settings({ reviews }), audit: auditData({ state, approvals }) })
    expect(vm().frontEndAuditState).toBe(expected)
  })

  it('a reviewer who is also a collaborator is not a reviewer of the audit', async () => {
    await mountEdit({ user: 'reviewer', audit: auditData({ state: 'REVIEW', collaborators: [{ _id: 'u-reviewer' }] }) })
    expect(vm().isUserAReviewer()).toBe(false)
    expect(vm().frontEndAuditState).toBe(S.REVIEW_EDITOR)
  })

  it.each([
    [S.EDIT, ['submitReview']],
    [S.REVIEW_EDITOR, ['cancelReview']],
    [S.REVIEW, ['approve']],
    [S.REVIEW_APPROVED, ['removeApproval']],
    [S.REVIEW_ADMIN, ['cancelReview', 'approve']],
    [S.REVIEW_ADMIN_APPROVED, ['cancelReview', 'removeApproval']],
    [S.REVIEW_READONLY, []],
    [S.APPROVED, []],
    [S.APPROVED_APPROVED, ['removeApproval']],
    [S.APPROVED_READONLY, []],
    [S.EDIT_READONLY, []]
  ])('state %i shows the review buttons %j', async (state, buttons) => {
    await mountEdit()
    vm().frontEndAuditState = state
    await flushPromises()
    const review = ['submitReview', 'cancelReview', 'approve', 'removeApproval']
    expect(review.filter((name) => buttonLabels().includes(t(`btn.topButtonSection.${name}`)))).toEqual(buttons)
  })

  it('shows no review button when the reviews are disabled', async () => {
    await mountEdit({ $settings: settings({ reviews: false }) })
    expect(buttonLabels().filter((label) => Object.values(vm().$tm('btn.topButtonSection')).includes(label))).toEqual([])
  })

  it('submits the audit for review and updates the state', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'updateReadyForReview').mockResolvedValue({})
    await mountEdit()
    const submit = page().findAllComponents(QBtn).find((button) => button.props('label') === t('btn.topButtonSection.submitReview'))
    await submit.trigger('click')
    await flushPromises()
    expect(AuditService.updateReadyForReview).toHaveBeenCalledWith('a1', { state: 'REVIEW' })
    expect(vm().audit.state).toBe('REVIEW')
    expect(vm().frontEndAuditState).toBe(S.REVIEW_EDITOR)
    expect(lastNotification(notify)).toMatchObject({ message: t('msg.auditReviewUpdateOk'), color: 'positive' })
    expect(buttonLabels()).toContain(t('btn.topButtonSection.cancelReview'))
  })

  it('cancels the review (back to edition)', async () => {
    mockNotify()
    vi.spyOn(AuditService, 'updateReadyForReview').mockResolvedValue({})
    await mountEdit({ audit: auditData({ state: 'REVIEW' }) })
    vm().toggleAskReview()
    await flushPromises()
    expect(AuditService.updateReadyForReview).toHaveBeenCalledWith('a1', { state: 'EDIT' })
    expect(vm().frontEndAuditState).toBe(S.EDIT)
  })

  it('keeps the state and notifies the error of the server when the review cannot be asked', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'updateReadyForReview').mockRejectedValue(apiError(403, 'Insufficient privileges'))
    await mountEdit()
    vm().toggleAskReview()
    await flushPromises()
    expect(vm().audit.state).toBe('EDIT')
    expect(vm().frontEndAuditState).toBe(S.EDIT)
    expect(lastNotification(notify)).toMatchObject({ message: 'Insufficient privileges', color: 'negative' })
  })

  it('uses the message of the error when the server gives none', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'updateReadyForReview').mockRejectedValue({ message: 'Request failed with status code 500', response: { data: {} } })
    await mountEdit()
    vm().toggleAskReview()
    await flushPromises()
    expect(lastNotification(notify).message).toBe('Request failed with status code 500')
  })

  it('approves the audit', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'toggleApproval').mockResolvedValue({})
    await mountEdit({ user: 'reviewer', audit: auditData({ state: 'REVIEW' }) })
    const approve = page().findAllComponents(QBtn).find((button) => button.props('label') === t('btn.topButtonSection.approve'))
    await approve.trigger('click')
    await flushPromises()
    expect(AuditService.toggleApproval).toHaveBeenCalledWith('a1', { approved: true }) // Set, not toggled
    expect(lastNotification(notify)).toMatchObject({ message: t('msg.auditApprovalUpdateOk'), color: 'positive' })
  })

  it('removes the approval', async () => {
    mockNotify()
    vi.spyOn(AuditService, 'toggleApproval').mockResolvedValue({})
    await mountEdit({ user: 'reviewer', audit: auditData({ state: 'REVIEW', approvals: [{ _id: 'u-reviewer' }] }) })
    const remove = page().findAllComponents(QBtn).find((button) => button.props('label') === t('btn.topButtonSection.removeApproval'))
    await remove.trigger('click')
    await flushPromises()
    expect(AuditService.toggleApproval).toHaveBeenCalledWith('a1', { approved: false })
  })

  // Second click of a double click: the request answered fast, the opposite button took the place of the clicked one
  it.each([
    ['submitReview', 'updateReadyForReview', 'EDIT', 'author'],
    ['cancelReview', 'updateReadyForReview', 'REVIEW', 'author'],
    ['approve', 'toggleApproval', 'REVIEW', 'reviewer'],
    ['removeApproval', 'toggleApproval', 'REVIEW', 'reviewer']
  ])('ignores the second click of a double click on %s', async (name, method, state, user) => {
    mockNotify()
    vi.spyOn(AuditService, method).mockResolvedValue({})
    const approvals = name === 'removeApproval' ? [{ _id: 'u-reviewer' }] : []
    await mountEdit({ user, audit: auditData({ state, approvals }) })
    const button = page().findAllComponents(QBtn).find((b) => b.props('label') === t(`btn.topButtonSection.${name}`))
    button.vm.$emit('click', new MouseEvent('click', { detail: 2 }))
    await flushPromises()
    expect(AuditService[method]).not.toHaveBeenCalled()
  })

  it('notifies the approval errors', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'toggleApproval').mockRejectedValue(apiError(400, 'Not enough reviewers'))
    await mountEdit({ user: 'reviewer', audit: auditData({ state: 'REVIEW' }) })
    vm().toggleApproval()
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Not enough reviewers', color: 'negative' })
  })

  it('blocks the approval while comments are open (setting) and shows them', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'toggleApproval').mockResolvedValue({})
    const comments = [{ _id: 'c1', target: { kind: 'general', field: 'name' }, resolved: false }]
    await mountEdit({ user: 'reviewer', audit: auditData({ state: 'REVIEW' }), comments, $settings: settings({ blockApprovalWithOpenComments: true }) })
    vm().commentsStore.status = 'resolved'
    vm().commentsStore.targetFilter = { kind: 'general', field: 'name' }
    vm().toggleApproval()
    expect(AuditService.toggleApproval).not.toHaveBeenCalled()
    expect(lastNotification(notify)).toMatchObject({ message: t('comments.approvalBlocked'), color: 'warning' })
    expect(vm().commentsStore).toMatchObject({ panelOpen: true, status: 'open', targetFilter: null })
  })

  it('allows the approval with open comments when the setting is disabled, and the removal of an approval', async () => {
    mockNotify()
    vi.spyOn(AuditService, 'toggleApproval').mockResolvedValue({})
    const comments = [{ _id: 'c1', target: { kind: 'general', field: 'name' }, resolved: false }]
    await mountEdit({ user: 'reviewer', audit: auditData({ state: 'REVIEW' }), comments })
    vm().toggleApproval()
    expect(AuditService.toggleApproval).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    await mountEdit({ user: 'reviewer', audit: auditData({ state: 'REVIEW', approvals: [{ _id: 'u-reviewer' }] }), comments, $settings: settings({ blockApprovalWithOpenComments: true }) })
    vm().toggleApproval() // Removal of the approval: not blocked
    expect(AuditService.toggleApproval).toHaveBeenCalledTimes(2)
  })
})

describe('findings of the menu', () => {
  it('groups the findings by category, without category last named "No Category"', async () => {
    await mountEdit()
    expect(vm().findingList.map((group) => [group.category, group.findings.map((f) => f._id)])).toEqual([['Web', ['f1', 'f2']], ['No Category', ['f3']]])
    expect(page().text()).toContain('No Category')
  })

  it('uses the sort options of the audit, then the default of the vulnerability category, then a default', async () => {
    const audit = auditData({
      findings: [finding('f1', 'A', { category: 'Web' }), finding('f2', 'B', { category: 'Network' }), finding('f3', 'C')],
      sortFindings: [{ category: 'Web', sortValue: 'priority', sortOrder: 'asc', sortAuto: false }]
    })
    await mountEdit({ audit, categories: [{ name: 'Network', sortValue: 'cvssTemporalScore', sortOrder: 'asc', sortAuto: true }] })
    const options = Object.fromEntries(vm().findingList.map((group) => [group.category, group.sortOption]))
    expect(options.Web).toMatchObject({ sortValue: 'priority', sortOrder: 'asc', sortAuto: false })
    expect(options.Network).toMatchObject({ category: 'Network', sortValue: 'cvssTemporalScore', sortOrder: 'asc' })
    expect(options['No Category']).toEqual({ category: 'No Category', sortValue: 'cvssScore', sortOrder: 'desc', sortAuto: true })
    // Missing options added to the audit
    expect(vm().audit.sortFindings.map((option) => option.category)).toEqual(['Web', 'Network', 'No Category'])
  })

  it('saves the sort options of the audit', async () => {
    vi.spyOn(AuditService, 'updateAuditSortFindings').mockResolvedValue({})
    await mountEdit()
    vm().findingList[0].sortOption.sortAuto = false
    vm().updateSortFindings()
    expect(AuditService.updateAuditSortFindings).toHaveBeenCalledWith('a1', { sortFindings: vm().audit.sortFindings })
    expect(vm().audit.sortFindings[0].sortAuto).toBe(false)
  })

  // Category without saved sort option ('No Category', categories created after the audit): the option added to the
  // audit is the one changed in the menu
  it('saves the sort options changed for a category without saved option', async () => {
    vi.spyOn(AuditService, 'updateAuditSortFindings').mockResolvedValue({})
    await mountEdit({ audit: auditData({ sortFindings: [] }) })
    const group = vm().findingList.find((g) => g.category === 'No Category')
    group.sortOption.sortAuto = false // q-toggle of the sort menu
    vm().updateSortFindings()
    const [, { sortFindings }] = AuditService.updateAuditSortFindings.mock.calls[0]
    expect(sortFindings.find((option) => option.category === 'No Category').sortAuto).toBe(false)
  })

  it('offers the CVSS scores, priority, complexity and the allowed custom fields of the category as sort values', async () => {
    const customFields = [
      { label: 'Impact', display: 'finding', displaySub: '', fieldType: 'select' },
      { label: 'Web only', display: 'vulnerability', displaySub: 'Web', fieldType: 'input' },
      { label: 'Network only', display: 'finding', displaySub: 'Network', fieldType: 'date' },
      { label: 'Long text', display: 'finding', displaySub: '', fieldType: 'text' },
      { label: 'Audit field', display: 'general', displaySub: '', fieldType: 'input' }
    ]
    await mountEdit({ customFields })
    expect(vm().getSortOptions('Web').map((option) => option.value)).toEqual(['cvssScore', 'cvssTemporalScore', 'cvssEnvironmentalScore', 'priority', 'remediationComplexity', 'Impact', 'Web only'])
    expect(vm().getSortOptions('No Category').map((option) => option.value)).toContain('Impact')
    expect(vm().getSortOptions('No Category').map((option) => option.value)).not.toContain('Web only')
  })

  it('shows the severity of the findings with the colors of the settings', async () => {
    const cvssColors = { criticalColor: '#212121', highColor: '#fe0000', mediumColor: '#f9a009', lowColor: '#008000', noneColor: '#4a86e8' }
    await mountEdit({ $settings: settings({ report: { cvssColors } }) })
    const chips = page().findAllComponents(QChip).filter((chip) => chip.classes().includes('text-white'))
    expect(chips.map((chip) => chip.text())).toEqual(['C', 'M', 'N'])
    expect(vm().getFindingColor(vm().audit.findings[0])).toBe('#212121')
    expect(vm().getFindingColor(vm().audit.findings[2])).toBe('#4a86e8')
  })

  it('uses the color of no severity when the color of a severity is missing', async () => {
    await mountEdit({ $settings: settings({ report: { cvssColors: { noneColor: '#4a86e8' } } }) })
    expect(vm().getFindingColor(vm().audit.findings[0])).toBe('#4a86e8')
  })

  it.each([
    [CRITICAL, 'black'], [MEDIUM, 'orange'], ['CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N', 'green'],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N', 'red'], ['', 'blue'], ['not a vector', 'blue']
  ])('uses default colors without report settings (%s: %s)', async (cvssv3, color) => {
    await mountEdit()
    expect(vm().getFindingColor({ cvssv3 })).toBe(color)
  })

  it('uses the temporal or environmental severity according to the sort option of the category', async () => {
    await mountEdit()
    const f = { cvssv3: WITH_TEMPORAL, category: 'Web' }
    expect(vm().getFindingCvss(f)).toEqual({ severity: 'Critical', score: '9.8' })
    vm().audit.sortFindings[0].sortValue = 'cvssTemporalScore'
    expect(vm().getFindingCvss(f)).toEqual({ severity: 'High', score: '7.8' })
    vm().audit.sortFindings[0].sortValue = 'cvssEnvironmentalScore'
    expect(vm().getFindingCvss(f)).toEqual({ severity: 'Medium', score: '4.0' })
    expect(vm().getFindingCvss({ ...f, category: 'Other' }).severity).toBe('Critical') // Category without sort option: base
    expect(vm().getFindingCvss({ cvssv3: null })).toEqual({ severity: 'None', score: '' })
  })

  it('shows the title of the findings by default', async () => {
    await mountEdit()
    expect(vm().getFindingLabel(vm().audit.findings[1])).toBe('XSS réfléchie')
  })

  it('builds the label of the findings with the template of the settings', async () => {
    const audit = auditData({ findings: [finding('f1', 'SQL Injection', { category: 'Web', cvssv3: CRITICAL, customFields: [{ customField: { label: 'Owner', fieldType: 'input' }, text: 'Équipe 🔒' }] })] })
    await mountEdit({ audit, $settings: settings({ report: { cvssColors: {}, findingSidebarTemplate: '{identifier}  {severity} - {title} ({custom.owner}) {unknown}' } }) })
    expect(vm().getFindingLabel(vm().audit.findings[0])).toBe('IDX-001 Critical - SQL Injection (Équipe 🔒) {unknown}')
    expect(page().text()).toContain('IDX-001 Critical - SQL Injection')
  })

  it('falls back to the title when the template gives an empty label', async () => {
    await mountEdit({ $settings: settings({ report: { cvssColors: {}, findingSidebarTemplate: '{custom.missing}  ' } }) })
    expect(vm().getFindingLabel(vm().audit.findings[0])).toBe('SQL Injection')
  })

  it('marks the completed findings', async () => {
    await mountEdit()
    const items = page().findAllComponents(QItem).filter((item) => String(item.props('to')).includes('/findings/f'))
    expect(items.map((item) => item.find('.q-icon.text-green').exists())).toEqual([true, false, false])
  })

  it('shows the add and sort buttons and the drag handles only in edition', async () => {
    const audit = auditData({ sortFindings: [{ category: 'Web', sortValue: 'cvssScore', sortOrder: 'desc', sortAuto: false }] })
    await mountEdit({ audit })
    const icons = () => page().findAllComponents(QBtn).map((button) => button.props('icon'))
    expect(icons()).toContain('add')
    expect(icons().filter((icon) => icon === 'sort')).toHaveLength(2)
    expect(page().findAll('.handle')).toHaveLength(2) // Manual sort of the Web findings only
    vm().frontEndAuditState = S.REVIEW_EDITOR
    await flushPromises()
    expect(icons()).not.toContain('add')
    expect(icons()).not.toContain('sort')
    expect(page().findAll('.handle')).toHaveLength(0)
  })

  it('opens the page to add findings', async () => {
    await mountEdit()
    const push = vi.spyOn(router, 'push')
    await page().findAllComponents(QBtn).find((button) => button.props('icon') === 'add').trigger('click')
    expect(push).toHaveBeenCalledWith('/audits/a1/findings/add')
  })

  it('moves a finding of a category (positions in the whole audit)', async () => {
    vi.spyOn(AuditService, 'updateAuditFindingPosition').mockResolvedValue({})
    await mountEdit()
    vm().moveFindingPosition({ oldIndex: 1, newIndex: 0 }, 'Web')
    expect(AuditService.updateAuditFindingPosition).toHaveBeenCalledWith('a1', { oldIndex: 1, newIndex: 0 })
    await flushPromises()
    expect(AuditService.getAudit).toHaveBeenCalledTimes(2) // Audit loaded again
  })

  it('moves a finding without category', async () => {
    vi.spyOn(AuditService, 'updateAuditFindingPosition').mockResolvedValue({})
    const audit = auditData({ findings: [finding('f1', 'A', { category: 'Web' }), finding('f2', 'B'), finding('f3', 'C')] })
    await mountEdit({ audit })
    vm().moveFindingPosition({ oldIndex: 1, newIndex: 0 }, 'No Category')
    expect(AuditService.updateAuditFindingPosition).toHaveBeenCalledWith('a1', { oldIndex: 2, newIndex: 1 })
  })

  it('does nothing for an unknown category', async () => {
    vi.spyOn(AuditService, 'updateAuditFindingPosition').mockResolvedValue({})
    await mountEdit()
    vm().moveFindingPosition({ oldIndex: 1, newIndex: 0 }, 'Unknown')
    expect(AuditService.updateAuditFindingPosition).not.toHaveBeenCalled()
  })

  it('notifies the error of a move and loads the audit again', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'updateAuditFindingPosition').mockRejectedValue(apiError(400, 'Invalid index'))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await mountEdit()
    vm().moveFindingPosition({ oldIndex: 1, newIndex: 0 }, 'Web') // Refused by the server (finding deleted meanwhile...)
    await flushPromises()
    expect(lastNotification(notify)).toMatchObject({ message: 'Invalid index', color: 'negative' })
    expect(AuditService.getAudit).toHaveBeenCalledTimes(2)
  })

  // The findings of a category are not contiguous in the audit when the category is sorted manually (backend
  // createFinding does not regroup them)
  it('moves the dragged finding when the findings of the category are not contiguous', async () => {
    vi.spyOn(AuditService, 'updateAuditFindingPosition').mockResolvedValue({})
    const audit = auditData({
      findings: [finding('f1', 'A', { category: 'Web' }), finding('f2', 'B', { category: 'Network' }), finding('f3', 'C', { category: 'Web' })],
      sortFindings: [{ category: 'Web', sortValue: 'cvssScore', sortOrder: 'desc', sortAuto: false }]
    })
    await mountEdit({ audit })
    vm().moveFindingPosition({ oldIndex: 1, newIndex: 0 }, 'Web') // C dragged above A
    expect(AuditService.updateAuditFindingPosition).toHaveBeenLastCalledWith('a1', { oldIndex: 2, newIndex: 0 })
    vm().moveFindingPosition({ oldIndex: 0, newIndex: 1 }, 'Web') // A dragged below C
    expect(AuditService.updateAuditFindingPosition).toHaveBeenLastCalledWith('a1', { oldIndex: 0, newIndex: 2 })
  })
})

describe('users connected to the audit', () => {
  it('lists the users of the room, the current user first in green', async () => {
    await mountEdit()
    socket.trigger('roomUsers', [{ _id: 'x1', username: 'bob', color: '#123456', menu: 'general' }, { _id: 'x2', username: 'author', menu: 'editFinding', finding: 'f1' }])
    await flushPromises()
    expect(vm().users.map((user) => user.username)).toEqual(['author', 'bob'])
    expect(vm().users[0]).toMatchObject({ me: true, color: '#77C84E' })
    expect(page().text()).toContain(`author (${t('me')})`)
    expect(vm().generalUsers.map((user) => user.username)).toEqual(['bob'])
    expect(vm().filteredFindingUsers('f1').map((user) => user.username)).toEqual(['author'])
    expect(vm().filteredFindingUsers('f2')).toEqual([])
  })

  it('shows the colors of the users on the menu entries they are on', async () => {
    await mountEdit()
    socket.trigger('roomUsers', [
      { _id: 'x1', username: 'bob', color: 'rgb(1, 2, 3)', menu: 'network' },
      { _id: 'x2', username: 'carol', color: 'rgb(4, 5, 6)', menu: 'editSection', section: 's2' }
    ])
    await flushPromises()
    const bars = page().findAll('.multi-colors-bar').map((bar) => bar.attributes('style'))
    expect(bars).toEqual(['background: rgb(1, 2, 3);', 'background: rgb(4, 5, 6);'])
    expect(vm().networkUsers).toHaveLength(1)
    expect(vm().filteredSectionUsers('s2').map((user) => user.username)).toEqual(['carol'])
  })

  it('handles an empty room and unicode usernames', async () => {
    await mountEdit()
    socket.trigger('roomUsers', [])
    expect(vm().users.filter(Boolean)).toEqual([])
    socket.trigger('roomUsers', [{ _id: 'x', username: 'zoé 漢字' }])
    await flushPromises()
    expect(page().text()).toContain('zoé 漢字')
  })

  it('answers the requests of the server and reloads the audit and the comments', async () => {
    await mountEdit()
    socket.trigger('updateUsers')
    expect(socket.emit).toHaveBeenLastCalledWith('updateUsers', { room: 'a1' })
    socket.trigger('updateAudit')
    socket.trigger('updateComments')
    await flushPromises()
    expect(AuditService.getAudit).toHaveBeenCalledTimes(2)
    expect(AuditService.getComments).toHaveBeenCalledTimes(2)
    expect(socket.emit.mock.calls.filter(([event]) => event === 'join')).toHaveLength(1) // Not joined again
  })

  it.each([
    ['/audits/a1/general', { menu: 'general', room: 'a1' }],
    ['/audits/a1/network', { menu: 'network', room: 'a1' }],
    ['/audits/a1/findings/add', { menu: 'addFindings', room: 'a1' }],
    ['/audits/a1/findings/f2', { menu: 'editFinding', finding: 'f2', room: 'a1' }],
    ['/audits/a1/sections/s1', { menu: 'editSection', section: 's1', room: 'a1' }]
  ])('joins the room and the menu %s again after a reconnection', async (path, menu) => {
    await mountEdit({ path })
    socket.emit.mockClear()
    socket.trigger('disconnect')
    expect(socket.emit.mock.calls).toEqual([['join', { username: 'author', room: 'a1' }], ['menu', menu]])
  })

  it('leaves the room and removes its socket listeners when unmounted', async () => {
    await mountEdit()
    const disconnect = socket.handlers.disconnect
    wrapper.unmount()
    wrapper = null
    expect(socket.emit).toHaveBeenLastCalledWith('leave', { username: 'author', room: 'a1' })
    expect(socket.off.mock.calls.map(([event]) => event)).toEqual(['roomUsers', 'updateUsers', 'updateAudit', 'updateComments', 'disconnect'])
    expect(socket.off).toHaveBeenCalledWith('disconnect', disconnect) // Only its own listener
  })
})

describe('review comments in the menu', () => {
  const COMMENTS = [
    { _id: 'c1', target: { kind: 'general', field: 'name' }, resolved: false },
    { _id: 'c2', target: { kind: 'finding', findingId: 'f1', field: 'title' }, resolved: false },
    { _id: 'c3', target: { kind: 'finding', findingId: 'f1', field: 'description' }, resolved: false },
    { _id: 'c4', target: { kind: 'section', sectionId: 's2', field: 'text' }, resolved: false },
    { _id: 'c5', target: { kind: 'network', field: 'scope.LAN' }, resolved: true }
  ]

  it('counts the open comments of each entry of the menu', async () => {
    await mountEdit({ comments: COMMENTS })
    expect(vm().openCommentsCount('general')).toBe(1)
    expect(vm().openCommentsCount('network')).toBe(0)
    expect(vm().openCommentsCount('finding', 'f1')).toBe(2)
    expect(vm().openCommentsCount('finding', 'f2')).toBe(0)
    expect(vm().openCommentsCount('section', 's2')).toBe(1)
    expect(vm().openCommentsCount('finding')).toBe(2)
    const badges = page().findAllComponents(QBadge).map((badge) => badge.text())
    expect(badges).toEqual(['4', '1', '2', '1'])
  })

  it('opens and closes the comments panel', async () => {
    await mountEdit({ comments: COMMENTS })
    const button = page().findAllComponents(QBtn).find((b) => b.props('icon') === 'mdi-comment-text-multiple-outline')
    await button.trigger('click')
    expect(vm().commentsStore.panelOpen).toBe(true)
    expect(page().classes()).toContain('comments-panel-open')
    await button.trigger('click')
    expect(vm().commentsStore.panelOpen).toBe(false)
    button.vm.$emit('click', new MouseEvent('click', { detail: 1 }))
    button.vm.$emit('click', new MouseEvent('click', { detail: 2 })) // Double click: opened once
    expect(vm().commentsStore.panelOpen).toBe(true)
  })

  it('shows no badge without open comment', async () => {
    await mountEdit({ comments: [] })
    expect(page().findAllComponents(QBadge)).toHaveLength(0)
  })

  it('opens the page of a commented element', async () => {
    await mountEdit({ comments: COMMENTS })
    const push = vi.spyOn(router, 'push')
    vm().navigateToComment({ _id: 'c2', target: COMMENTS[1].target, quote: { exact: 'x' } })
    expect(push).toHaveBeenCalledWith('/audits/a1/findings/f1')
    expect(vm().commentsStore.focus).toMatchObject({ kind: 'finding', findingId: 'f1', field: 'title', key: 'finding:f1:title', commentId: 'c2' })
    await flushPromises()
    vm().navigateToComment({ _id: 'c1', target: COMMENTS[0].target })
    expect(push).toHaveBeenLastCalledWith('/audits/a1/general')
    expect(vm().commentsStore.focus.commentId).toBeNull() // Not anchored on a passage
  })

  it('does not navigate when the commented element is on the current page', async () => {
    await mountEdit({ path: '/audits/a1/sections/s2' })
    const push = vi.spyOn(router, 'push')
    vm().navigateToComment({ _id: 'c4', target: COMMENTS[3].target })
    expect(push).not.toHaveBeenCalled()
  })

  // The attempts (up to 6 s) would go on after the audit is left (and after the end of the tests: document undefined)
  it('stops looking for the commented element when the audit is left', async () => {
    vi.useFakeTimers()
    try {
      await mountEdit()
      const page = vm()
      const show = vi.spyOn(page, 'showCommentFocus')
      page.navigateToComment({ _id: 'c1', target: COMMENTS[0].target }) // Element never displayed
      vi.advanceTimersByTime(450)
      const attempts = show.mock.calls.length
      expect(attempts).toBe(3)
      wrapper.unmount()
      wrapper = null
      vi.advanceTimersByTime(7000)
      expect(show).toHaveBeenCalledTimes(attempts)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('scrolls to the commented field once it is displayed', async () => {
    vi.useFakeTimers()
    try {
      await mountEdit()
      const element = document.createElement('div')
      element.setAttribute('data-comment-field', 'general:name')
      element.scrollIntoView = vi.fn()
      vm().navigateToComment({ _id: 'c1', target: COMMENTS[0].target })
      expect(element.scrollIntoView).not.toHaveBeenCalled()
      document.body.appendChild(element) // Page loaded later
      vi.advanceTimersByTime(250)
      expect(element.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
      expect(element.classList.contains('comment-focus')).toBe(true)
      element.remove()
    }
    finally {
      vi.useRealTimers()
    }
  })
})

describe('highlighted texts to replace (warning of the settings)', () => {
  const WARNING = () => settings({ report: { cvssColors: {}, highlightWarning: true, highlightWarningColors: ['#ffff00'] } })
  const ITEMS = [
    { kind: 'finding', id: 'f2', name: 'XSS réfléchie', field: 'description', label: null, texts: [{ text: '[CLIENT NAME]', color: '#ffff00' }, { text: '<b>not html</b>', color: '#ffff00' }] },
    { kind: 'finding', id: 'f2', name: 'XSS réfléchie', field: 'customFields.c1', label: 'Impact métier', texts: [{ text: 'to complete', color: '#ffff00' }] },
    { kind: 'section', id: 's1', name: 'Introduction', field: 'customFields.c2', label: 'Body', texts: [{ text: 'TODO', color: '#ffff00' }] },
    { kind: 'general', id: null, name: 'Pentest Été', field: 'summary', label: null, texts: [{ text: 'summary', color: '#ffff00' }] }
  ]
  const highlights = (items = ITEMS) => vi.spyOn(AuditService, 'getAuditHighlights').mockImplementation(() => ok({ enabled: true, colors: ['#ffff00'], items }))
  const report = () => vi.spyOn(AuditService, 'generateAuditReport').mockResolvedValue({ data: new Blob(['docx']), headers: { 'content-disposition': 'attachment; filename="r.docx"' } })
  const dialog = () => vm().$refs.highlightWarning // components/highlight-warning-dialog.vue
  const markedItems = () => page().findAll('.highlight-marker').map((marker) => marker.element.closest('.q-item').textContent)

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:report')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mockNotify()
  })

  it('marks the findings and sections with highlighted texts in the menu', async () => {
    highlights()
    await mountEdit({ $settings: WARNING() })
    expect(AuditService.getAuditHighlights).toHaveBeenCalledWith('a1')
    expect(markedItems()).toHaveLength(2)
    expect(markedItems()[0]).toContain('XSS réfléchie')
    expect(markedItems()[1]).toContain('Introduction')
  })

  it('neither requests nor marks anything when the warning is disabled, and generates at once', async () => {
    const getHighlights = vi.spyOn(AuditService, 'getAuditHighlights')
    report()
    await mountEdit({ $settings: settings({ report: { cvssColors: {}, highlightWarning: false } }) })
    expect(page().findAll('.highlight-marker')).toHaveLength(0)
    vm().generateReport()
    expect(AuditService.generateAuditReport).toHaveBeenCalledTimes(1) // Not delayed
    expect(getHighlights).not.toHaveBeenCalled()
  })

  it('lists the highlighted texts before the generation: cancelled, then generated anyway', async () => {
    highlights()
    report()
    await mountEdit({ $settings: WARNING() })
    vm().generateReport()
    await flushPromises()
    expect(dialog().show).toBe(true)
    expect(dialog().items).toEqual(ITEMS)
    expect(ITEMS.map((item) => dialog().place(item))).toEqual(['XSS réfléchie · Description', 'XSS réfléchie · Impact métier', 'Introduction · Body', 'General Information'])
    expect(AuditService.generateAuditReport).not.toHaveBeenCalled()
    dialog().close(false)
    await flushPromises()
    expect(AuditService.generateAuditReport).not.toHaveBeenCalled()
    expect(vm().reportPending).toBe(false)
    vm().generateReport()
    await flushPromises()
    dialog().close(true)
    await flushPromises()
    expect(AuditService.generateAuditReport).toHaveBeenCalledTimes(1)
    expect(vm().reportPending).toBe(false)
  })

  it('shows the texts of the dialog as text (no HTML)', async () => {
    highlights()
    await mountEdit({ $settings: WARNING() })
    vm().generateReport()
    await flushPromises()
    const card = document.querySelector('.highlight-dialog')
    expect(card.textContent).toContain('[CLIENT NAME]')
    expect(card.textContent).toContain('<b>not html</b>')
    expect(card.querySelector('b')).toBeNull()
    dialog().close(false)
    await flushPromises()
  })

  it('opens the place of a highlighted text from the dialog, without generating', async () => {
    highlights()
    report()
    await mountEdit({ $settings: WARNING() })
    vm().generateReport()
    await flushPromises()
    dialog().open(ITEMS[0])
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/audits/a1/findings/f2')
    vm().generateReport()
    await flushPromises()
    dialog().open(ITEMS[2])
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/audits/a1/sections/s1')
    expect(AuditService.generateAuditReport).not.toHaveBeenCalled()
  })

  it('generates at once without highlighted texts, and when they cannot be loaded (warning only)', async () => {
    highlights([])
    report()
    await mountEdit({ $settings: WARNING() })
    vm().generateReport()
    await flushPromises()
    expect(dialog().show).toBe(false)
    expect(AuditService.generateAuditReport).toHaveBeenCalledTimes(1)
    AuditService.getAuditHighlights.mockRejectedValue(new Error('Network Error'))
    vm().generateReport()
    await flushPromises()
    expect(AuditService.generateAuditReport).toHaveBeenCalledTimes(2)
  })
})

describe('report and small screens', () => {
  it('downloads the report with the name given by the server', async () => {
    const notify = mockNotify()
    URL.createObjectURL = vi.fn(() => 'blob:report')
    let download
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { download = this.download })
    vi.spyOn(AuditService, 'generateAuditReport').mockResolvedValue({ data: new Blob(['docx']), headers: { 'content-disposition': `attachment; filename="${encodeURIComponent('Rapport Été 🔒.docx')}"` } })
    await mountEdit()
    await page().findAllComponents(QBtn).find((button) => button.find('.fa-download').exists()).trigger('click')
    await flushPromises()
    expect(AuditService.generateAuditReport).toHaveBeenCalledWith('a1')
    expect(download).toBe('Rapport Été 🔒.docx')
    expect(notify.mock.results[0].value).toHaveBeenCalledWith(expect.objectContaining({ icon: 'done', color: 'green' }))
  })

  it('shows the error of the report generation given by the server', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'generateAuditReport').mockRejectedValue({ response: { data: new Blob([JSON.stringify({ datas: 'Template error: {#findings' })]) } })
    await mountEdit()
    vm().generateReport()
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2))
    expect(lastNotification(notify)).toMatchObject({ message: 'Template error: {#findings', type: 'negative' })
    expect(notify.mock.results[0].value).toHaveBeenCalledWith() // Spinner closed
  })

  it('shows a generic error when the server does not answer', async () => {
    const notify = mockNotify()
    vi.spyOn(AuditService, 'generateAuditReport').mockRejectedValue(new Error('Network Error'))
    await mountEdit()
    vm().generateReport()
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2))
    expect(lastNotification(notify).message).toBe('Error generating template')
  })

  it('shows the menu on large screens, with a button to show it again when hidden', async () => {
    await mountEdit()
    expect(vm().sectionsDrawer).toBe(true) // show-if-above (jsdom width: 1024px)
    expect(page().findComponent(QPageSticky).exists()).toBe(false)
    vm().sectionsDrawer = false // Small screen
    await flushPromises()
    const sticky = page().findComponent(QPageSticky)
    expect(sticky.exists()).toBe(true)
    await sticky.findComponent(QBtn).trigger('click')
    expect(vm().sectionsDrawer).toBe(true)
  })

  it('reads the blobs of the errors as text', async () => {
    await mountEdit()
    await expect(vm().BlobReader(new Blob(['{"datas":"é"}']))).resolves.toBe('{"datas":"é"}')
  })
})

describe('double actions', () => {
  it('sends the same review state for two quick clicks (idempotent request)', async () => {
    mockNotify()
    let resolve
    vi.spyOn(AuditService, 'updateReadyForReview').mockImplementation(() => new Promise((r) => { resolve = r }))
    await mountEdit()
    vm().toggleAskReview()
    vm().toggleAskReview()
    expect(AuditService.updateReadyForReview.mock.calls.map(([, data]) => data)).toEqual([{ state: 'REVIEW' }, { state: 'REVIEW' }])
    resolve()
    await flushPromises()
  })
})
