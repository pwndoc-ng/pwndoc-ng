// services/comments.js: review comments store of an audit (targets, filters, labels, permissions, API calls)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Notify } from 'quasar'

vi.mock('@/services/audit', () => ({
  default: {
    getComments: vi.fn(),
    createComment: vi.fn(),
    replyComment: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn()
  }
}))
vi.mock('@/services/user', () => ({
  default: { user: { id: 'me' }, isAllowed: vi.fn(() => false) }
}))

import AuditService from '@/services/audit'
import UserService from '@/services/user'
import { targetKey, createCommentsStore, FINDING_FIELD_TABS } from '@/services/comments'

const audit = {
  state: 'EDIT',
  name: 'Audit',
  scope: ['srv-01'],
  findings: [
    { _id: 'f1', title: 'SQL Injection', description: '<p>The <b>login</b> form is   vulnerable.</p>', customFields: [{ customField: { _id: 'cf1' }, text: '<p>custom text</p>' }] },
    { _id: 'f2', title: 'XSS', poc: `<p>Proof</p><img src="5f0c8b9e2a1d4c3b2a1f0e9d" alt="capture">` }
  ],
  sections: [{ _id: 's1', name: 'Introduction', text: '<p>Intro</p>', customFields: [{ customField: 'cf2', text: 'section custom' }] }]
}
const customFields = [{ _id: 'cf1', label: 'Impact' }, { _id: 'cf2', label: 'Context' }]

let comments
function comment(id, target, extra = {}) {
  return { _id: id, target, text: `text ${id}`, author: { _id: 'other' }, resolved: false, replies: [], createdAt: '2024-01-01T10:00:00Z', ...extra }
}

function newStore(options = {}) {
  return createCommentsStore('a1', {
    getAudit: () => audit,
    getCustomFields: () => customFields,
    canEdit: () => false,
    navigate: vi.fn(),
    ...options
  })
}

beforeEach(() => {
  vi.mocked(UserService.isAllowed).mockReturnValue(false)
  comments = [
    comment('c1', { kind: 'finding', findingId: 'f2', field: 'title' }, { createdAt: '2024-01-02T00:00:00Z' }),
    comment('c2', { kind: 'general', field: 'name' }, { author: { _id: 'me' } }),
    comment('c3', { kind: 'section', sectionId: 's1', field: 'text' }, { resolved: true }),
    comment('c4', { kind: 'finding', findingId: 'f1', field: 'description' }),
    comment('c5', { kind: 'network', field: 'scope.srv-01' }),
    comment('c6', { kind: 'finding', findingId: 'f2', field: 'title' }, { createdAt: '2024-01-01T00:00:00Z' }),
    comment('c7', { kind: 'finding', findingId: 'deleted', field: 'title' })
  ]
})

describe('targetKey', () => {
  it('builds a unique key per commented field', () => {
    expect(targetKey({ kind: 'general', field: 'name' })).toBe('general:name')
    expect(targetKey({ kind: 'network', field: 'scope.srv-01' })).toBe('network:scope.srv-01')
    expect(targetKey({ kind: 'finding', findingId: 'f1', sectionId: 'ignored', field: 'description' })).toBe('finding:f1:description')
    expect(targetKey({ kind: 'section', sectionId: 's1', findingId: 'ignored', field: 'customFields.cf2' })).toBe('section:s1:customFields.cf2')
    expect(targetKey(null)).toBe('')
    expect(targetKey(undefined)).toBe('')
  })

  it('lists the finding fields displayed in the proofs and details tabs', () => {
    expect(FINDING_FIELD_TABS).toEqual({ proofs: ['poc'], details: ['scope', 'cvssv3', 'remediationComplexity', 'priority', 'remediation'] })
  })
})

describe('createCommentsStore queries', () => {
  it('loads the comments of the audit', async () => {
    AuditService.getComments.mockResolvedValueOnce({ data: { datas: comments } })
    const store = newStore()
    expect(store.loaded).toBe(false)
    await store.load()
    expect(AuditService.getComments).toHaveBeenCalledWith('a1')
    expect(store.items).toHaveLength(7)
    expect(store.loaded).toBe(true)
  })

  it('stays not loaded when the request fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    AuditService.getComments.mockRejectedValueOnce(new Error('Network Error'))
    const store = newStore()
    await store.load()
    expect(store.loaded).toBe(false)
    expect(store.items).toEqual([])
  })

  it('finds and counts the comments of a field', () => {
    const store = newStore()
    store.items = comments
    expect(store.forTarget({ kind: 'finding', findingId: 'f2', field: 'title' }).map((c) => c._id)).toEqual(['c1', 'c6'])
    expect(store.openCount()).toBe(6)
    expect(store.openCountForTarget({ kind: 'section', sectionId: 's1', field: 'text' })).toBe(0)
    expect(store.openCountForTarget({ kind: 'general', field: 'name' })).toBe(1)
  })

  it('orders the comments by location in the audit then by date', () => {
    const store = newStore()
    store.items = comments
    store.status = 'all'
    expect(store.filtered().map((c) => c._id)).toEqual(['c2', 'c5', 'c4', 'c6', 'c1', 'c7', 'c3'])
  })

  it('filters by status, author and target', () => {
    const store = newStore()
    store.items = comments
    expect(store.filtered().map((c) => c._id)).not.toContain('c3') // open by default
    store.status = 'resolved'
    expect(store.filtered().map((c) => c._id)).toEqual(['c3'])
    store.status = 'all'
    store.onlyMine = true
    expect(store.filtered().map((c) => c._id)).toEqual(['c2'])
    store.onlyMine = false
    store.targetFilter = { kind: 'finding', findingId: 'f2', field: 'title' }
    expect(store.filtered().map((c) => c._id)).toEqual(['c6', 'c1'])
  })

  it('handles an audit whose findings and sections are not loaded yet', () => {
    const store = newStore({ getAudit: () => ({ findings: {}, sections: undefined }) })
    store.items = comments
    store.status = 'all'
    expect(store.filtered()).toHaveLength(7)
    expect(store.locationLabel({ kind: 'finding', findingId: 'f1' })).toBe('Deleted element')
    expect(newStore({ getAudit: () => null }).locationLabel({ kind: 'section', sectionId: 's1' })).toBe('Deleted element')
  })
})

describe('createCommentsStore labels', () => {
  const store = newStore()

  it('names the location of a comment', () => {
    expect(store.locationLabel({ kind: 'general' })).toBe('General Information')
    expect(store.locationLabel({ kind: 'network' })).toBe('Network Scan')
    expect(store.locationLabel({ kind: 'finding', findingId: 'f2' })).toBe('XSS')
    expect(store.locationLabel({ kind: 'section', sectionId: 's1' })).toBe('Introduction')
    expect(store.locationLabel({ kind: 'finding', findingId: 'nope' })).toBe('Deleted element')
  })

  it('names the commented fields with translated labels', () => {
    expect(store.fieldLabel({ kind: 'general', field: 'name' })).toBe('Name')
    expect(store.fieldLabel({ kind: 'general', field: 'auditType' })).toBe('Audit type')
    expect(store.fieldLabel({ kind: 'general', field: 'date_start' })).toBe('Start Date')
    expect(store.fieldLabel({ kind: 'finding', field: 'cvssv3' })).toBe('CVSS')
    expect(store.fieldLabel({ kind: 'finding', field: 'poc' })).toBe('Proofs')
    expect(store.fieldLabel({ kind: 'finding', field: 'status' })).toBe('Status')
    expect(store.fieldLabel({ kind: 'section', field: 'text' })).toBe('Description')
    expect(store.fieldLabel({ kind: 'network', field: 'scope.srv-01' })).toBe('srv-01')
    expect(store.fieldLabel({ kind: 'finding', field: 'customFields.cf1' })).toBe('Impact')
    expect(store.fieldLabel({ kind: 'finding', field: 'customFields.removed' })).toBe('Deleted element')
    expect(store.fieldLabel({ kind: 'finding', field: 'unknownField' })).toBe('unknownField')
    expect(store.fieldLabel({ kind: 'finding' })).toBe('')
  })

  it('has a translation for every field label of the general, finding and section pages', () => {
    const fields = {
      general: ['name', 'auditType', 'language', 'template', 'company', 'client', 'reviewers', 'collaborators', 'date_start', 'date_end', 'date', 'scope'],
      finding: ['status', 'title', 'vulnType', 'description', 'observation', 'references', 'poc', 'scope', 'cvssv3', 'remediationComplexity', 'priority', 'remediation'],
      section: ['text']
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const [kind, names] of Object.entries(fields)) {
      for (const field of names) {
        const label = store.fieldLabel({ kind, field })
        expect(label, `${kind}.${field}`).not.toBe(field)
        expect(label, `${kind}.${field}`).not.toMatch(/^[a-z]+\.[a-zA-Z]+$/) // raw i18n key
      }
    }
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('createCommentsStore outdated comments', () => {
  const store = newStore()

  it('reads the content of the commented field', () => {
    expect(store.fieldContent({ kind: 'general', field: 'name' })).toBe('Audit')
    expect(store.fieldContent({ kind: 'finding', findingId: 'f1', field: 'description' })).toContain('login')
    expect(store.fieldContent({ kind: 'finding', findingId: 'f1', field: 'customFields.cf1' })).toBe('<p>custom text</p>')
    expect(store.fieldContent({ kind: 'section', sectionId: 's1', field: 'customFields.cf2' })).toBe('section custom')
    expect(store.fieldContent({ kind: 'section', sectionId: 's1', field: 'customFields.nope' })).toBeNull()
    expect(store.fieldContent({ kind: 'finding', findingId: 'nope', field: 'title' })).toBeNull()
    expect(store.fieldContent({ kind: 'network', field: 'scope.srv-01' })).toBeNull()
  })

  it('detects a quoted passage which is no longer in the field (text compared without HTML and extra spaces)', () => {
    const target = { kind: 'finding', findingId: 'f1', field: 'description' }
    expect(store.isOutdated({ target, quote: { exact: 'The login form is vulnerable' } })).toBe(false)
    expect(store.isOutdated({ target, quote: { exact: 'login\n form' } })).toBe(false)
    expect(store.isOutdated({ target, quote: { exact: 'password form' } })).toBe(true)
    expect(store.isOutdated({ target })).toBe(false)
    expect(store.isOutdated({ target, quote: { exact: '' } })).toBe(false)
    expect(store.isOutdated({ target: { kind: 'finding', findingId: 'gone', field: 'description' }, quote: { exact: 'x' } })).toBe(false)
  })

  it('detects a commented image which is no longer in the field', () => {
    const target = { kind: 'finding', findingId: 'f2', field: 'poc' }
    expect(store.isOutdated({ target, image: { src: '5f0c8b9e2a1d4c3b2a1f0e9d' } })).toBe(false)
    expect(store.isOutdated({ target, image: { src: '000000000000000000000000' } })).toBe(true)
    expect(store.isOutdated({ target, image: { src: 'hash:abc' } })).toBe(false) // base64 images: hash, not checked
  })
})

describe('createCommentsStore permissions and review state', () => {
  it('is in review when the audit is not in EDIT state', () => {
    let state = 'EDIT'
    const store = newStore({ getAudit: () => ({ state }) })
    expect(store.inReview()).toBe(false)
    state = 'REVIEW'
    expect(store.inReview()).toBe(true)
    state = 'APPROVED'
    expect(store.inReview()).toBe(true)
    expect(newStore({ getAudit: () => null }).inReview()).toBe(false)
    expect(newStore({ getAudit: () => ({}) }).inReview()).toBe(false)
  })

  it('lets the author or an editor of the audit resolve a comment', () => {
    let editor = false
    const store = newStore({ canEdit: () => editor })
    expect(store.canResolve({ author: { _id: 'me' } })).toBe(true)
    expect(store.canResolve({ author: { _id: 'other' } })).toBe(false)
    expect(store.canResolve({ author: null })).toBe(false)
    editor = true
    expect(store.canResolve({ author: { _id: 'other' } })).toBe(true)
  })

  it('lets the author or a user with audits:update-all delete a comment', () => {
    const store = newStore({ canEdit: () => true })
    expect(store.canDelete({ author: { _id: 'me' } })).toBe(true)
    expect(store.canDelete({ author: { _id: 'other' } })).toBe(false) // editors cannot delete the comments of others
    vi.mocked(UserService.isAllowed).mockImplementation((permission) => permission === 'audits:update-all')
    expect(store.canDelete({ author: { _id: 'other' } })).toBe(true)
  })
})

describe('createCommentsStore panel actions', () => {
  it('opens the comments of a field with a draft on this field', () => {
    const store = newStore()
    const target = { kind: 'general', field: 'name' }
    store.activeId = 'c1'
    store.openTarget(target)
    expect(store).toMatchObject({ targetFilter: target, status: 'all', draft: { target, quote: null }, activeId: null, panelOpen: true })
  })

  it('starts a comment on a passage or an image', () => {
    const store = newStore()
    const target = { kind: 'finding', findingId: 'f1', field: 'description' }
    store.targetFilter = { kind: 'general', field: 'name' }
    store.startComment(target, { exact: 'login', prefix: 'The ', suffix: ' form' })
    expect(store).toMatchObject({ targetFilter: null, draft: { target, quote: { exact: 'login' }, image: null }, panelOpen: true })
    store.startComment(target, null, { src: 'abc', alt: 'capture' })
    expect(store.draft.image).toEqual({ src: 'abc', alt: 'capture' })
  })

  it('shows a comment, switching the status filter when it is hidden', () => {
    const store = newStore()
    store.items = comments
    store.show('c3') // resolved, filter on open comments
    expect(store).toMatchObject({ activeId: 'c3', status: 'all', panelOpen: true })
    store.status = 'open'
    store.show('c4')
    expect(store.status).toBe('open')
    store.show('unknown')
    expect(store.activeId).toBe('c4')
  })

  it('selects a comment and navigates to the commented element', () => {
    const navigate = vi.fn()
    const store = newStore({ navigate })
    store.select(comments[0])
    expect(store.activeId).toBe('c1')
    expect(navigate).toHaveBeenCalledWith(comments[0])
  })

  it('tours the filtered comments in both directions, looping at the ends', () => {
    const navigate = vi.fn()
    const store = newStore({ navigate })
    store.items = comments // open comments in order: c2 c5 c4 c6 c1 c7
    store.move(1)
    expect(store.activeId).toBe('c2')
    store.move(-1)
    expect(store.activeId).toBe('c7')
    store.move(1)
    expect(store.activeId).toBe('c2')
    store.move(1)
    expect(store.activeId).toBe('c5')
    store.activeId = null
    store.move(-1)
    expect(store.activeId).toBe('c7')
    expect(navigate).toHaveBeenCalledTimes(5)
    store.items = []
    store.move(1)
    expect(navigate).toHaveBeenCalledTimes(5)
  })
})

describe('createCommentsStore API calls', () => {
  it('creates a comment from the draft and expands it', async () => {
    const store = newStore()
    store.items = comments.slice(0, 2)
    const target = { kind: 'finding', findingId: 'f1', field: 'description' }
    store.startComment(target, { exact: 'login' })
    AuditService.createComment.mockResolvedValueOnce({ data: { datas: [...comments.slice(0, 2), comment('new', target)] } })
    await expect(store.create('Please fix')).resolves.toBe(true)
    expect(AuditService.createComment).toHaveBeenCalledWith('a1', { target, text: 'Please fix', quote: { exact: 'login' } })
    expect(store.items).toHaveLength(3)
    expect(store.draft).toBeNull()
    expect(store.activeId).toBe('new')
  })

  it('sends the image of an image comment, without empty quote', async () => {
    const store = newStore()
    const target = { kind: 'finding', findingId: 'f2', field: 'poc' }
    store.startComment(target, null, { src: 'abc', alt: '' })
    AuditService.createComment.mockResolvedValueOnce({ data: { datas: [] } })
    await store.create('Blurry')
    expect(AuditService.createComment).toHaveBeenCalledWith('a1', { target, text: 'Blurry', image: { src: 'abc', alt: '' } })
  })

  it('keeps the draft and notifies the error when the creation fails', async () => {
    const notify = vi.spyOn(Notify, 'create').mockImplementation(() => {})
    const store = newStore()
    store.openTarget({ kind: 'general', field: 'name' })
    AuditService.createComment.mockRejectedValueOnce({ message: 'Request failed', response: { data: { datas: 'Audit not found' } } })
    await expect(store.create('x')).resolves.toBe(false)
    expect(store.draft).not.toBeNull()
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ message: 'Audit not found', color: 'negative' }))
    AuditService.createComment.mockRejectedValueOnce(new Error('Network Error'))
    await store.create('x')
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'Network Error' }))
  })

  it('replies, resolves and deletes, replacing the comments by the ones returned', async () => {
    const store = newStore()
    store.items = comments
    const updated = { data: { datas: [comments[0]] } }
    AuditService.replyComment.mockResolvedValueOnce(updated)
    await expect(store.reply(comments[0], 'Done')).resolves.toBe(true)
    expect(AuditService.replyComment).toHaveBeenCalledWith('a1', 'c1', 'Done')
    AuditService.updateComment.mockResolvedValueOnce(updated)
    await store.setResolved(comments[0], true)
    expect(AuditService.updateComment).toHaveBeenCalledWith('a1', 'c1', { resolved: true })
    AuditService.deleteComment.mockResolvedValueOnce({ data: { datas: [] } })
    await store.remove(comments[0])
    expect(AuditService.deleteComment).toHaveBeenCalledWith('a1', 'c1')
    expect(store.items).toEqual([])
  })
})
