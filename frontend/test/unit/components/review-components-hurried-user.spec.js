// Hurried user on the review components: comments panel (and its store), proposals list and review, backups manager.
// API responses delayed and resolved by the test, in any order (double clicks, quick changes of filters, refreshes
// crossing each other, components unmounted while a request is pending).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { QBtn, QBtnToggle } from 'quasar'

vi.mock('components/editor', () => import('../../helpers/editor-stub'))
vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))
vi.mock('@/services/audit', () => ({
  default: { getComments: vi.fn(), createComment: vi.fn(), replyComment: vi.fn(), updateComment: vi.fn(), deleteComment: vi.fn() }
}))

import CommentsPanel from 'components/comments-panel'
import ProposalsList from 'components/proposals-list'
import ProposalReview from 'components/proposal-review'
import BackupsManager from 'components/backups-manager'
import AuditService from '@/services/audit'
import VulnerabilityService from '@/services/vulnerability'
import BackupService from '@/services/backup'
import UserService from '@/services/user'
import { createCommentsStore } from '@/services/comments'
import { mockNotify } from '../../helpers/quasar'

// Promise resolved or rejected by the test
function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// Successive calls of a mocked service answered by the test: calls[i].resolve(...)
function delayedCalls(mock) {
  const calls = []
  mock.mockImplementation(() => {
    const call = deferred()
    calls.push(call)
    return call.promise
  })
  return calls
}

const RouterLinkStub = { name: 'RouterLink', props: ['to'], template: '<a :href="to"><slot /></a>' }

let wrapper
const buttonByLabel = (label) => wrapper.findAllComponents(QBtn).find((button) => button.props('label') === label)

beforeEach(() => {
  vi.clearAllMocks()
  UserService.user = { id: 'me', username: 'me', roles: '*' }
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('comments: double clicks and crossing refreshes', () => {
  const TARGET = { kind: 'general', field: 'name' }
  const audit = { state: 'REVIEW', name: 'Audit', findings: [], sections: [] }
  const comment = (id, extra = {}) => ({ _id: id, target: TARGET, text: `Comment ${id}`, author: { _id: 'other', username: 'bob' }, resolved: false, replies: [], createdAt: '2024-01-01T10:00:00', ...extra })
  let store

  function mountPanel(items = []) {
    store = createCommentsStore('a1', { getAudit: () => audit, getCustomFields: () => [], canEdit: () => true, navigate: vi.fn() })
    store.items = items
    wrapper = mount(CommentsPanel, { global: { provide: { auditComments: store } }, attachTo: document.body })
    return wrapper
  }

  it('keeps the text and the draft until the creation is answered', async () => {
    const calls = delayedCalls(AuditService.createComment)
    mountPanel()
    store.openTarget(TARGET)
    await flushPromises()
    await wrapper.find('.bg-orange-1 textarea').setValue('Nom à corriger')
    await buttonByLabel(wrapper.vm.$t('comments.add')).trigger('click')
    expect(store.draft).not.toBeNull()
    calls[0].resolve({ data: { datas: [comment('new', { text: 'Nom à corriger' })] } })
    await flushPromises()
    expect(store.draft).toBeNull()
    expect(wrapper.vm.draftText).toBe('')
    expect(store.activeId).toBe('new')
  })

  // The text is cleared only after the answer: a second click while the creation is pending would create it twice
  it('creates the comment once on a double click', async () => {
    mockNotify()
    const calls = delayedCalls(AuditService.createComment)
    mountPanel()
    store.openTarget(TARGET)
    await flushPromises()
    await wrapper.find('.bg-orange-1 textarea').setValue('Nom à corriger')
    const add = buttonByLabel(wrapper.vm.$t('comments.add'))
    await add.trigger('click')
    await add.trigger('click')
    wrapper.vm.createComment() // Ctrl+Enter
    expect(AuditService.createComment).toHaveBeenCalledTimes(1)
    calls[0].reject({ response: { status: 500, data: { datas: 'Internal error' } } })
    await flushPromises()
    await add.trigger('click') // Sent again once answered (failure: draft kept)
    expect(AuditService.createComment).toHaveBeenCalledTimes(2)
  })

  // Same for the replies
  it('sends a reply once on a double click', async () => {
    delayedCalls(AuditService.replyComment)
    mountPanel([comment('c1')])
    store.activeId = 'c1'
    await flushPromises()
    wrapper.vm.replyText = 'Corrigé'
    await flushPromises()
    const reply = buttonByLabel(wrapper.vm.$t('comments.reply'))
    await reply.trigger('click')
    await reply.trigger('click')
    expect(AuditService.replyComment).toHaveBeenCalledTimes(1)
  })

  it('resolving twice quickly sends the same state (consistent result)', async () => {
    const calls = delayedCalls(AuditService.updateComment)
    mountPanel([comment('c1')])
    store.setResolved(store.items[0], true)
    store.setResolved(store.items[0], true)
    expect(AuditService.updateComment.mock.calls.map((call) => call[2])).toEqual([{ resolved: true }, { resolved: true }])
    calls[1].resolve({ data: { datas: [comment('c1', { resolved: true })] } })
    calls[0].resolve({ data: { datas: [comment('c1', { resolved: true })] } })
    await flushPromises()
    expect(store.items[0].resolved).toBe(true)
  })

  it('ignores the second click of a double click on "Resolve" (the button became "Reopen")', async () => {
    const calls = delayedCalls(AuditService.updateComment)
    mountPanel([comment('c1')])
    store.status = 'all'
    store.activeId = 'c1'
    await flushPromises()
    buttonByLabel(wrapper.vm.$t('comments.resolve')).vm.$emit('click', new MouseEvent('click', { detail: 1 }))
    calls[0].resolve({ data: { datas: [comment('c1', { resolved: true })] } })
    await flushPromises()
    buttonByLabel(wrapper.vm.$t('comments.reopen')).vm.$emit('click', new MouseEvent('click', { detail: 2 }))
    expect(AuditService.updateComment).toHaveBeenCalledTimes(1)
    expect(store.items[0].resolved).toBe(true)
  })

  it('shows the error of a failed creation once and keeps the draft', async () => {
    const notify = mockNotify()
    const calls = delayedCalls(AuditService.createComment)
    mountPanel()
    store.openTarget(TARGET)
    wrapper.vm.draftText = 'Texte'
    const created = wrapper.vm.createComment()
    calls[0].reject({ response: { status: 500, data: { datas: 'Internal error' } } })
    await created
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toMatchObject({ message: 'Internal error', color: 'negative' })
    expect(wrapper.vm.draftText).toBe('Texte')
  })

  it('panel closed (page left) while the creation is pending: the answer updates the store without error', async () => {
    const calls = delayedCalls(AuditService.createComment)
    mountPanel()
    store.openTarget(TARGET)
    wrapper.vm.draftText = 'Texte'
    const created = wrapper.vm.createComment()
    wrapper.unmount()
    wrapper = null
    calls[0].resolve({ data: { datas: [comment('new')] } })
    await created
    expect(store.items.map((c) => c._id)).toEqual(['new'])
    expect(store.draft).toBeNull()
  })

  it('refreshes answered in order: the last list is shown', async () => {
    const calls = delayedCalls(AuditService.getComments)
    mountPanel()
    store.load()
    store.load()
    calls[0].resolve({ data: { datas: [comment('c1')] } })
    await flushPromises()
    calls[1].resolve({ data: { datas: [comment('c1'), comment('c2')] } })
    await flushPromises()
    expect(store.items.map((c) => c._id)).toEqual(['c1', 'c2'])
  })

  // Two refreshes crossing each other (socket 'updateComments' sent to the room after each change): the answer of the
  // older request is ignored, a comment just created or resolved must not disappear or come back open
  it('refreshes answered in the wrong order: the last requested list is kept', async () => {
    const calls = delayedCalls(AuditService.getComments)
    mountPanel()
    store.load() // Refresh for the comment of another user
    store.load() // Refresh after my comment
    calls[1].resolve({ data: { datas: [comment('c1'), comment('mine', { author: { _id: 'me' } })] } })
    await flushPromises()
    calls[0].resolve({ data: { datas: [comment('c1')] } })
    await flushPromises()
    expect(store.items.map((c) => c._id)).toEqual(['c1', 'mine'])
  })
})

describe('proposals: quick filters, double clicks and crossing answers', () => {
  const row = (id, status) => ({ _id: id, kind: 'update', title: `Proposal ${id}`, locale: 'en', creator: { username: 'ada' }, createdAt: '2024-03-01T10:00:00', status })

  async function mountList() {
    wrapper = mount(ProposalsList, { attachTo: document.body, global: { stubs: { RouterLink: RouterLinkStub } } })
    await flushPromises()
  }

  it('status changed twice quickly, answers in order: rows of the last status', async () => {
    const calls = delayedCalls(vi.spyOn(VulnerabilityService, 'getProposals'))
    await mountList()
    const toggle = wrapper.findComponent(QBtnToggle)
    toggle.vm.$emit('update:modelValue', 'accepted')
    toggle.vm.$emit('update:modelValue', 'rejected')
    calls[0].resolve({ data: { datas: [row('p1', 'pending')] } })
    calls[1].resolve({ data: { datas: [row('p2', 'accepted')] } })
    calls[2].resolve({ data: { datas: [row('p3', 'rejected')] } })
    await flushPromises()
    expect(wrapper.vm.rows.map((r) => r._id)).toEqual(['p3'])
    expect(wrapper.vm.loading).toBe(false)
  })

  // Status changed quickly: a slower answer of the previous status must not replace the rows of the selected one
  it('status changed quickly, answers in the wrong order: rows of the selected status', async () => {
    const calls = delayedCalls(vi.spyOn(VulnerabilityService, 'getProposals'))
    await mountList()
    wrapper.findComponent(QBtnToggle).vm.$emit('update:modelValue', 'rejected')
    calls[1].resolve({ data: { datas: [row('p3', 'rejected')] } })
    await flushPromises()
    expect(wrapper.vm.loading).toBe(false)
    calls[0].resolve({ data: { datas: [row('p1', 'pending')] } })
    await flushPromises()
    expect(wrapper.vm.status).toBe('rejected')
    expect(wrapper.vm.rows.map((r) => r._id)).toEqual(['p3'])
  })

  it('status changed quickly: loading until the answer of the selected status', async () => {
    const calls = delayedCalls(vi.spyOn(VulnerabilityService, 'getProposals'))
    await mountList()
    wrapper.findComponent(QBtnToggle).vm.$emit('update:modelValue', 'rejected')
    calls[0].resolve({ data: { datas: [row('p1', 'pending')] } })
    await flushPromises()
    expect(wrapper.vm.loading).toBe(true)
    expect(wrapper.vm.rows).toEqual([])
  })

  it('list left while loading: the late answer causes no error', async () => {
    const calls = delayedCalls(vi.spyOn(VulnerabilityService, 'getProposals'))
    await mountList()
    wrapper.unmount()
    wrapper = null
    calls[0].resolve({ data: { datas: [row('p1', 'pending')] } })
    await flushPromises() // An error would fail the test (unhandled rejection)
    expect(VulnerabilityService.getProposals).toHaveBeenCalledTimes(1)
  })

  const detail = (id) => ({
    proposal: { _id: id, kind: 'creation', status: 'pending', locale: 'en', title: `Proposal ${id}`, description: '', references: [], creator: { _id: 'author', username: 'ada' }, createdAt: '2024-03-02T10:00:00Z' },
    vulnerability: null,
    changedFields: []
  })

  async function mountReview() {
    wrapper = mount(ProposalReview, { attachTo: document.body, global: { stubs: { RouterLink: RouterLinkStub } } })
    await flushPromises()
  }

  it('two proposals opened quickly, answers in order: the last one is shown', async () => {
    const calls = delayedCalls(vi.spyOn(VulnerabilityService, 'getProposal'))
    await mountReview()
    wrapper.vm.open('p1')
    wrapper.vm.open('p2')
    calls[0].resolve({ data: { datas: detail('p1') } })
    calls[1].resolve({ data: { datas: detail('p2') } })
    await flushPromises()
    expect(wrapper.vm.proposal._id).toBe('p2')
  })

  // Two rows clicked quickly with a slower first answer: the first proposal would be shown, then accepted or rejected
  // instead of the one chosen
  it('two proposals opened quickly, answers in the wrong order: the last opened one is shown', async () => {
    const calls = delayedCalls(vi.spyOn(VulnerabilityService, 'getProposal'))
    await mountReview()
    wrapper.vm.open('p1')
    wrapper.vm.open('p2')
    calls[1].resolve({ data: { datas: detail('p2') } })
    await flushPromises()
    calls[0].resolve({ data: { datas: detail('p1') } })
    await flushPromises()
    expect(wrapper.vm.proposal._id).toBe('p2')
  })

  it('accepted proposal: dialog closed and change emitted once the answer is received', async () => {
    mockNotify()
    vi.spyOn(VulnerabilityService, 'getProposal').mockResolvedValue({ data: { datas: detail('p1') } })
    const calls = delayedCalls(vi.spyOn(VulnerabilityService, 'acceptProposal'))
    await mountReview()
    await wrapper.vm.open('p1')
    await flushPromises()
    await buttonByLabel(wrapper.vm.$t('proposals.acceptCreation')).trigger('click')
    expect(wrapper.vm.visible).toBe(true)
    calls[0].resolve({ data: { datas: { status: 'accepted' } } })
    await flushPromises()
    expect(wrapper.vm.visible).toBe(false)
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  // A second acceptation sent while the first one is pending would be refused (proposal no longer pending): error
  // shown after the success
  it('accepts a proposal once on a double click', async () => {
    mockNotify()
    vi.spyOn(VulnerabilityService, 'getProposal').mockResolvedValue({ data: { datas: detail('p1') } })
    delayedCalls(vi.spyOn(VulnerabilityService, 'acceptProposal'))
    await mountReview()
    await wrapper.vm.open('p1')
    await flushPromises()
    const accept = buttonByLabel(wrapper.vm.$t('proposals.acceptCreation'))
    await accept.trigger('click')
    await accept.trigger('click')
    wrapper.vm.accept()
    expect(VulnerabilityService.acceptProposal).toHaveBeenCalledTimes(1)
  })

  it('accepts again after a refused acceptation', async () => {
    const notify = mockNotify()
    vi.spyOn(VulnerabilityService, 'getProposal').mockResolvedValue({ data: { datas: detail('p1') } })
    const calls = delayedCalls(vi.spyOn(VulnerabilityService, 'acceptProposal'))
    await mountReview()
    await wrapper.vm.open('p1')
    await flushPromises()
    wrapper.vm.accept()
    calls[0].reject({ response: { status: 500, data: { datas: 'Internal error' } } })
    await flushPromises()
    expect(notify.mock.calls.at(-1)[0]).toMatchObject({ message: 'Internal error', color: 'negative' })
    expect(wrapper.vm.visible).toBe(true)
    wrapper.vm.accept()
    expect(VulnerabilityService.acceptProposal).toHaveBeenCalledTimes(2)
  })
})

describe('backups: double clicks', () => {
  beforeEach(() => vi.spyOn(BackupService, 'getBackups').mockResolvedValue({ data: { datas: [] } }))

  it('creates a backup once on a double click (button loading while running)', async () => {
    mockNotify()
    const calls = delayedCalls(vi.spyOn(BackupService, 'createBackup'))
    wrapper = mount(BackupsManager, { attachTo: document.body })
    await flushPromises()
    wrapper.vm.openCreate()
    await flushPromises()
    const confirm = () => wrapper.findAllComponents(QBtn).find((button) => button.props('label') === wrapper.vm.$t('backup.createBtn'))
    await confirm().trigger('click')
    await flushPromises()
    expect(confirm().props('loading')).toBe(true) // Clicks ignored by q-btn while loading
    await confirm().trigger('click')
    expect(BackupService.createBackup).toHaveBeenCalledTimes(1)
    calls[0].resolve({})
    await flushPromises()
    expect(wrapper.vm.create.show).toBe(false)
    expect(wrapper.vm.create.running).toBe(false)
  })

  it('closing the page while a backup is created: the answer causes no error', async () => {
    mockNotify()
    const calls = delayedCalls(vi.spyOn(BackupService, 'createBackup'))
    wrapper = mount(BackupsManager, { attachTo: document.body })
    await flushPromises()
    wrapper.vm.openCreate()
    const created = wrapper.vm.createBackup()
    wrapper.unmount()
    wrapper = null
    calls[0].resolve({})
    await expect(created).resolves.toBeUndefined()
  })
})
