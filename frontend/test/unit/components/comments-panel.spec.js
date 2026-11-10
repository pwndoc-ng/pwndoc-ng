// components/comments-panel.vue with the real comments store (services/comments.js), API mocked
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { QBtn, QBtnToggle, QChip } from 'quasar'

vi.mock('@/services/audit', () => ({
  default: { getComments: vi.fn(), createComment: vi.fn(), replyComment: vi.fn(), updateComment: vi.fn(), deleteComment: vi.fn() }
}))
vi.mock('@/services/user', () => ({ default: { user: { id: 'me' }, isAllowed: vi.fn(() => false) } }))

import CommentsPanel from 'components/comments-panel'
import AuditService from '@/services/audit'
import { createCommentsStore } from '@/services/comments'
import { mockDialog, mockNotify } from '../../helpers/quasar'

const audit = {
  state: 'REVIEW',
  name: 'Audit',
  findings: [{ _id: 'f1', title: 'SQL Injection', description: '<p>The login form is vulnerable</p>' }],
  sections: []
}

function comment(id, target, extra = {}) {
  return { _id: id, target, text: `Comment ${id}`, author: { _id: 'other', firstname: 'Bob', lastname: 'Martin' }, resolved: false, replies: [], createdAt: '2024-01-01T10:00:00', ...extra }
}

let wrapper
let store
let navigate

function mountPanel(items, { canEdit = false } = {}) {
  navigate = vi.fn()
  store = createCommentsStore('a1', { getAudit: () => audit, getCustomFields: () => [], canEdit: () => canEdit, navigate })
  store.items = items
  wrapper = mount(CommentsPanel, { global: { provide: { auditComments: store } }, attachTo: document.body })
  return wrapper
}

const buttonByLabel = (label) => wrapper.findAllComponents(QBtn).find((button) => button.props('label') === label)
const buttonByIcon = (icon) => wrapper.findAllComponents(QBtn).find((button) => button.props('icon') === icon)

const COMMENTS = () => [
  comment('c1', { kind: 'finding', findingId: 'f1', field: 'description' }, { quote: { exact: 'login form' }, replies: [{ _id: 'r1', text: 'Fixed', author: { username: 'alice' }, createdAt: '2024-01-02T09:00:00' }] }),
  comment('c2', { kind: 'general', field: 'name' }, { author: { _id: 'me', username: 'me' } }),
  comment('c3', { kind: 'finding', findingId: 'f1', field: 'title' }, { resolved: true, resolvedBy: { firstname: 'Alice' } })
]

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('comments-panel list', () => {
  it('groups the open comments by commented element, in the order of the audit', () => {
    mountPanel(COMMENTS())
    expect(wrapper.vm.groups.map((group) => [group.label, group.comments.map((c) => c._id)])).toEqual([
      ['General Information', ['c2']],
      ['SQL Injection', ['c1']]
    ])
    const cards = wrapper.findAll('.comment-card')
    expect(cards.map((card) => card.find('.comment-text').text())).toEqual(['Comment c2', 'Comment c1'])
    expect(cards[1].text()).toContain('Bob Martin')
    expect(cards[1].text()).toContain('01/01/2024 10:00')
    expect(cards[1].find('.comment-quote').text()).toBe('« login form »')
    expect(cards[1].text()).toContain(wrapper.vm.$t('comments.repliesCount', { count: 1 }))
    expect(cards[0].text()).not.toContain(wrapper.vm.$t('comments.repliesCount', { count: 0 }))
  })

  it('shows the number of open comments', () => {
    mountPanel(COMMENTS())
    expect(wrapper.find('.q-toolbar .q-badge').text()).toBe('2')
  })

  it('shows a message without comments and disables the tour', () => {
    mountPanel([])
    expect(wrapper.text()).toContain(wrapper.vm.$t('comments.none'))
    expect(buttonByIcon('chevron_left').props('disable')).toBe(true)
    expect(buttonByIcon('chevron_right').props('disable')).toBe(true)
    expect(wrapper.vm.position).toBe('0')
  })

  it('filters the comments by status and author', async () => {
    mountPanel(COMMENTS())
    wrapper.findComponent(QBtnToggle).vm.$emit('update:modelValue', 'resolved')
    await flushPromises()
    expect(wrapper.findAll('.comment-card').map((card) => card.find('.comment-text').text())).toEqual(['Comment c3'])
    expect(wrapper.find('.comment-card--resolved').exists()).toBe(true)
    store.status = 'all'
    store.onlyMine = true
    await flushPromises()
    expect(wrapper.findAll('.comment-card')).toHaveLength(1)
    expect(wrapper.find('.comment-text').text()).toBe('Comment c2')
  })

  it('tours the comments with the previous / next buttons and shows the position', async () => {
    mountPanel(COMMENTS())
    expect(wrapper.vm.position).toBe('2')
    await buttonByIcon('chevron_right').trigger('click')
    expect(store.activeId).toBe('c2')
    expect(navigate).toHaveBeenLastCalledWith(expect.objectContaining({ _id: 'c2' }))
    await flushPromises()
    expect(wrapper.vm.position).toBe('1 / 2')
    await buttonByIcon('chevron_right').trigger('click')
    expect(store.activeId).toBe('c1')
    await buttonByIcon('chevron_left').trigger('click')
    expect(store.activeId).toBe('c2')
  })

  it('selects a comment and goes to the commented element when it is clicked', async () => {
    mountPanel(COMMENTS())
    await wrapper.findAll('.comment-card')[1].trigger('click')
    expect(store.activeId).toBe('c1')
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ _id: 'c1' }))
    expect(wrapper.find('.comment-card--active .comment-text').text()).toBe('Comment c1')
  })

  it('marks the comments whose quoted text was modified', async () => {
    const items = COMMENTS()
    items[0].quote.exact = 'password field'
    mountPanel(items)
    expect(wrapper.find('.comment-quote--outdated').exists()).toBe(true)
    expect(wrapper.text()).toContain(wrapper.vm.$t('comments.textChanged'))
  })

  it('displays the texts of the comments as text, not HTML', () => {
    mountPanel([comment('x', { kind: 'general', field: 'name' }, { text: '<img src=x onerror="window.__commentXss = 1">', quote: { exact: '<b>bold</b>' } })])
    expect(wrapper.find('.comment-text').text()).toBe('<img src=x onerror="window.__commentXss = 1">')
    expect(wrapper.find('.comment-card img').exists()).toBe(false)
    expect(wrapper.find('.comment-card b').exists()).toBe(false)
    expect(window.__commentXss).toBeUndefined()
  })
})

describe('comments-panel thread of the active comment', () => {
  it('shows the replies, the resolution and the actions allowed', async () => {
    mountPanel(COMMENTS(), { canEdit: true })
    store.status = 'all'
    store.activeId = 'c3'
    await flushPromises()
    expect(wrapper.text()).toContain(wrapper.vm.$t('comments.resolvedBy', { name: 'Alice' }))
    expect(buttonByLabel(wrapper.vm.$t('comments.reopen'))).toBeDefined() // editor of the audit
    expect(buttonByIcon('delete_outline')).toBeUndefined() // not the author
    store.activeId = 'c2'
    await flushPromises()
    expect(buttonByIcon('delete_outline')).toBeDefined() // author
    expect(buttonByLabel(wrapper.vm.$t('comments.resolve'))).toBeDefined()
  })

  it('does not let the other users resolve or delete a comment', async () => {
    mountPanel(COMMENTS(), { canEdit: false })
    store.activeId = 'c1'
    await flushPromises()
    expect(wrapper.find('.comment-reply').text()).toContain('Fixed')
    expect(buttonByLabel(wrapper.vm.$t('comments.resolve'))).toBeUndefined()
    expect(buttonByIcon('delete_outline')).toBeUndefined()
  })

  it('replies to the active comment and clears the reply', async () => {
    mountPanel(COMMENTS())
    store.activeId = 'c1'
    await flushPromises()
    const replyButton = () => buttonByLabel(wrapper.vm.$t('comments.reply'))
    expect(replyButton().props('disable')).toBe(true)
    AuditService.replyComment.mockResolvedValue({ data: { datas: COMMENTS() } })
    await wrapper.find('.comment-card--active textarea').setValue('  Done  ')
    expect(replyButton().props('disable')).toBe(false)
    await replyButton().trigger('click')
    await flushPromises()
    expect(AuditService.replyComment).toHaveBeenCalledWith('a1', 'c1', '  Done  ')
    expect(wrapper.vm.replyText).toBe('')
  })

  it('does not send blank replies, and keeps the reply when it fails', async () => {
    mockNotify()
    mountPanel(COMMENTS())
    store.activeId = 'c1'
    await flushPromises()
    wrapper.vm.replyText = '   '
    await wrapper.vm.reply(store.items[0])
    expect(AuditService.replyComment).not.toHaveBeenCalled()
    AuditService.replyComment.mockRejectedValue(new Error('Network Error'))
    wrapper.vm.replyText = 'Retry'
    await wrapper.vm.reply(store.items[0])
    expect(wrapper.vm.replyText).toBe('Retry')
  })

  it('resolves a comment', async () => {
    mountPanel(COMMENTS(), { canEdit: true })
    store.activeId = 'c1'
    await flushPromises()
    AuditService.updateComment.mockResolvedValue({ data: { datas: COMMENTS() } })
    await buttonByLabel(wrapper.vm.$t('comments.resolve')).trigger('click')
    expect(AuditService.updateComment).toHaveBeenCalledWith('a1', 'c1', { resolved: true })
  })

  it('deletes a comment after confirmation', async () => {
    const dialogs = mockDialog()
    mountPanel(COMMENTS())
    store.activeId = 'c2'
    await flushPromises()
    AuditService.deleteComment.mockResolvedValue({ data: { datas: [] } })
    await buttonByIcon('delete_outline').trigger('click')
    expect(dialogs[0].options.message).toBe(wrapper.vm.$t('comments.deleteConfirm'))
    expect(AuditService.deleteComment).not.toHaveBeenCalled()
    await dialogs[0].ok()
    expect(AuditService.deleteComment).toHaveBeenCalledWith('a1', 'c2')
  })

  it('clears the reply when another comment is selected', async () => {
    mountPanel(COMMENTS())
    store.activeId = 'c1'
    await flushPromises()
    wrapper.vm.replyText = 'draft reply'
    store.activeId = 'c2'
    await flushPromises()
    expect(wrapper.vm.replyText).toBe('')
  })
})

describe('comments-panel new comment', () => {
  it('shows the commented field and the quoted passage of the draft', async () => {
    mountPanel([])
    store.startComment({ kind: 'finding', findingId: 'f1', field: 'description' }, { exact: 'login form' })
    await flushPromises()
    expect(wrapper.text()).toContain('SQL Injection › Description')
    expect(wrapper.find('.bg-orange-1 .comment-quote').text()).toBe('« login form »')
  })

  it('shows the commented image of the draft', async () => {
    mountPanel([])
    store.startComment({ kind: 'finding', findingId: 'f1', field: 'poc' }, null, { src: 'abc', alt: '' })
    await flushPromises()
    expect(wrapper.find('.bg-orange-1 .comment-quote').text()).toContain(wrapper.vm.$t('comments.image'))
  })

  it('creates the comment with the button or ctrl+enter, not when blank', async () => {
    mountPanel([])
    const target = { kind: 'general', field: 'name' }
    store.openTarget(target)
    await flushPromises()
    const add = () => buttonByLabel(wrapper.vm.$t('comments.add'))
    expect(add().props('disable')).toBe(true)
    await wrapper.vm.createComment()
    expect(AuditService.createComment).not.toHaveBeenCalled()
    AuditService.createComment.mockResolvedValue({ data: { datas: [comment('new', target)] } })
    const textarea = wrapper.find('.bg-orange-1 textarea')
    expect(textarea.attributes('placeholder')).toBe(wrapper.vm.$t('comments.placeholder'))
    await textarea.setValue('Wrong name')
    await textarea.trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(AuditService.createComment).toHaveBeenCalledWith('a1', { target, text: 'Wrong name' })
    expect(store.draft).toBeNull()
    expect(wrapper.vm.draftText).toBe('')
    expect(store.activeId).toBe('new')
  })

  it('keeps the text when the creation fails', async () => {
    mockNotify()
    mountPanel([])
    store.openTarget({ kind: 'general', field: 'name' })
    wrapper.vm.draftText = 'Important'
    AuditService.createComment.mockRejectedValue(new Error('Network Error'))
    await wrapper.vm.createComment()
    expect(wrapper.vm.draftText).toBe('Important')
    expect(store.draft).not.toBeNull()
  })

  it('cancels the draft and clears its text', async () => {
    mountPanel([])
    store.openTarget({ kind: 'general', field: 'name' })
    await flushPromises()
    wrapper.vm.draftText = 'abandoned'
    await buttonByLabel(wrapper.vm.$t('btn.cancel')).trigger('click')
    await flushPromises()
    expect(store.draft).toBeNull()
    expect(wrapper.vm.draftText).toBe('')
  })

  it('removes the field filter (chip) and the draft of this field', async () => {
    mountPanel(COMMENTS())
    store.openTarget({ kind: 'finding', findingId: 'f1', field: 'description' })
    await flushPromises()
    expect(wrapper.findAll('.comment-card')).toHaveLength(1)
    const chip = wrapper.findAllComponents(QChip).find((c) => c.props('removable'))
    expect(chip.text()).toContain('Description')
    chip.vm.$emit('remove')
    await flushPromises()
    expect(store.targetFilter).toBeNull()
    expect(store.draft).toBeNull()
  })

  it('closes the panel', async () => {
    mountPanel([])
    store.panelOpen = true
    await buttonByIcon('close').trigger('click')
    expect(store.panelOpen).toBe(false)
  })
})
