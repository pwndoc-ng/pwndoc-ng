// components/proposals-list.vue and components/proposal-review.vue (vulnerability proposals made from findings)
// The TipTap editor (html fields) is replaced by a stub.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { QBtnToggle, QToggle, QChip, QCheckbox, QBtn } from 'quasar'

vi.mock('components/editor', () => import('../../helpers/editor-stub'))
vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import ProposalsList from 'components/proposals-list'
import ProposalReview from 'components/proposal-review'
import EditorStub from '../../helpers/editor-stub'
import VulnerabilityService from '@/services/vulnerability'
import UserService from '@/services/user'
import { mockDialog, mockNotify, lastNotification } from '../../helpers/quasar'

const RouterLinkStub = { name: 'RouterLink', props: ['to'], template: '<a :href="to"><slot /></a>' }

const VULNERABILITY = {
  _id: 'v1', category: 'Web', cvssv3: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', priority: 2, remediationComplexity: 1,
  details: [
    { locale: 'en', title: 'SQL Injection', vulnType: 'Web', description: '<p>Old description</p>', references: ['https://owasp.org'], customFields: [{ customField: 'cf1', text: '<p>old impact</p>' }] },
    { locale: 'fr', title: 'Injection SQL', description: '<p>Ancienne</p>' }
  ]
}

function updateDetail(overrides = {}) {
  return {
    proposal: {
      _id: 'p1', kind: 'update', status: 'pending', locale: 'en', title: 'SQL Injection', vulnType: 'Web',
      description: '<p>New description</p>', references: ['https://owasp.org', 'CWE-89'], priority: 4, category: 'Web',
      customFields: [{ customField: { _id: 'cf1', label: 'Impact', fieldType: 'text' }, text: '<p>new impact</p>' },
        { customField: { _id: 'cf2', label: 'Tags', fieldType: 'select-multiple' }, text: ['db'] }],
      creator: { _id: 'author', firstname: 'Ada', lastname: 'Lovelace', username: 'ada' },
      createdAt: '2024-03-01T10:00:00Z',
      source: { audit: 'a1', finding: 'f1' },
      ...overrides
    },
    vulnerability: VULNERABILITY,
    changedFields: ['description', 'references', 'priority', 'customFields.cf1', 'customFields.cf2']
  }
}

function creationDetail() {
  return {
    proposal: {
      _id: 'p2', kind: 'creation', status: 'pending', locale: 'fr', title: 'XSS', vulnType: '', description: '<p>Desc</p>',
      references: [], cvssv3: 'CVSS:3.1/AV:N', priority: 3, remediationComplexity: null,
      creator: { _id: 'author', username: 'ada' }, createdAt: '2024-03-02T10:00:00Z'
    },
    vulnerability: null,
    changedFields: []
  }
}

let wrapper

function setUser(id, roles) {
  UserService.user = { id, username: id, roles }
}

async function openReview(detail) {
  vi.spyOn(VulnerabilityService, 'getProposal').mockResolvedValue({ data: { datas: detail } })
  wrapper = mount(ProposalReview, { attachTo: document.body, global: { stubs: { RouterLink: RouterLinkStub } } })
  await wrapper.vm.open(detail.proposal._id)
  await flushPromises()
  return wrapper
}

const rowFields = () => wrapper.vm.rows.map((row) => row.field)

beforeEach(() => setUser('reviewer', ['vulnerabilities:update']))
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('proposal-review comparison', () => {
  it('loads the proposal and shows the changed fields, all selected', async () => {
    await openReview(updateDetail())
    expect(VulnerabilityService.getProposal).toHaveBeenCalledWith('p1')
    expect(wrapper.vm.visible).toBe(true)
    expect(rowFields()).toEqual(['description', 'references', 'priority', 'customFields.cf1', 'customFields.cf2'])
    expect(wrapper.vm.selected).toEqual(rowFields())
    expect(wrapper.vm.allSelected).toBe(true)
  })

  it('compares with the detail of the proposal language and the fields of the vulnerability', async () => {
    await openReview(updateDetail())
    const rows = Object.fromEntries(wrapper.vm.rows.map((row) => [row.field, row]))
    expect(rows.description).toMatchObject({ label: 'Description', html: true, current: '<p>Old description</p>', proposed: '<p>New description</p>' })
    expect(rows.references).toMatchObject({ html: false, current: 'https://owasp.org', proposed: 'https://owasp.org\nCWE-89' })
    expect(rows.priority).toMatchObject({ label: 'Priority', current: 'Medium', proposed: 'Urgent' })
    expect(rows['customFields.cf1']).toMatchObject({ label: 'Impact', html: true, current: '<p>old impact</p>', proposed: '<p>new impact</p>' })
    expect(rows['customFields.cf2']).toMatchObject({ label: 'Tags', html: false, current: '', proposed: 'db' })
  })

  it('shows the html fields in read only editors with the differences', async () => {
    await openReview(updateDetail())
    const editors = wrapper.findAllComponents(EditorStub)
    expect(editors).toHaveLength(2)
    expect(editors[0].props()).toMatchObject({ modelValue: '<p>New description</p>', diff: '<p>Old description</p>', editable: false, collab: false })
    expect(document.body.querySelector('.proposal-value--proposed').textContent).toBe('https://owasp.org\nCWE-89')
  })

  it('shows the proposed values of a creation, without the empty fields', async () => {
    await openReview(creationDetail())
    expect(rowFields()).toEqual(['title', 'description', 'cvssv3', 'priority'])
    expect(wrapper.vm.rows.every((row) => row.current === '')).toBe(true)
    expect(wrapper.vm.rows.find((row) => row.field === 'cvssv3').label).toBe('CVSS')
    expect(wrapper.vm.selectable).toBe(false) // A creation is accepted as a whole
    expect(document.body.textContent).toContain('Creation')
  })

  it('also shows the accepted fields of a reviewed proposal', async () => {
    const detail = updateDetail({ status: 'partial', acceptedFields: ['title', 'description'], reviewer: { username: 'bob' }, reviewedAt: '2024-03-03T10:00:00Z', reviewComment: 'Title kept' })
    detail.changedFields = ['description']
    await openReview(detail)
    expect(rowFields()).toEqual(['title', 'description'])
    expect(wrapper.vm.isAccepted('title')).toBe(true)
    expect(wrapper.vm.pending).toBe(false)
    expect(wrapper.vm.selectable).toBe(false)
    expect(document.body.textContent).toContain('Title kept')
    expect(wrapper.findAllComponents(QBtn).map((button) => button.props('label'))).not.toContain('Refuse')
  })

  it('formats the values', async () => {
    await openReview(updateDetail())
    const { display } = wrapper.vm
    expect(display({}, null)).toBe('')
    expect(display({}, [])).toBe('')
    expect(display({ values: { 1: 'low' } }, 1)).toBe('Low')
    expect(display({ values: { 1: 'low' } }, 7)).toBe('7')
    expect(display({}, ['a', 'b'])).toBe('a\nb')
    expect(display({}, { a: 1 })).toBe('{"a":1}')
    expect(display({ html: true }, '<p>x</p>')).toBe('<p>x</p>')
    expect(display({}, 0)).toBe('0')
  })

  it('handles a proposal whose vulnerability has been deleted', async () => {
    const detail = updateDetail()
    detail.vulnerability = null
    await openReview(detail)
    expect(wrapper.vm.selectable).toBe(false)
    expect(document.body.textContent).toContain(wrapper.vm.$t('proposals.vulnerabilityDeleted'))
  })

  it('notifies the error when the proposal cannot be loaded', async () => {
    const notify = mockNotify()
    vi.spyOn(VulnerabilityService, 'getProposal').mockRejectedValue({ message: 'Request failed', response: { data: { datas: 'Proposal not found' } } })
    wrapper = mount(ProposalReview, { global: { stubs: { RouterLink: RouterLinkStub } } })
    await wrapper.vm.open('nope')
    expect(wrapper.vm.visible).toBe(false)
    expect(lastNotification(notify)).toMatchObject({ message: 'Proposal not found', color: 'negative' })
  })
})

describe('proposal-review decisions', () => {
  it('accepts the selected fields of an update', async () => {
    const notify = mockNotify()
    const event = vi.fn()
    window.addEventListener('proposals-changed', event)
    vi.spyOn(VulnerabilityService, 'acceptProposal').mockResolvedValue({ data: { datas: { status: 'partial' } } })
    await openReview(updateDetail())
    const boxes = wrapper.findAllComponents(QCheckbox)
    expect(boxes).toHaveLength(5)
    await boxes[1].trigger('click') // references not accepted
    expect(wrapper.vm.selected).toEqual(['description', 'priority', 'customFields.cf1', 'customFields.cf2'])
    const accept = wrapper.findAllComponents(QBtn).find((button) => /^Accept/.test(button.props('label')))
    expect(accept.props('label')).toContain('4')
    await accept.trigger('click')
    await flushPromises()
    expect(VulnerabilityService.acceptProposal).toHaveBeenCalledWith('p1', ['description', 'priority', 'customFields.cf1', 'customFields.cf2'])
    expect(lastNotification(notify)).toMatchObject({ color: 'positive', message: wrapper.vm.$t('proposals.partiallyAcceptedOk') })
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(event).toHaveBeenCalled()
    expect(wrapper.vm.visible).toBe(false)
    window.removeEventListener('proposals-changed', event)
  })

  it('accepts a creation as a whole', async () => {
    const notify = mockNotify()
    vi.spyOn(VulnerabilityService, 'acceptProposal').mockResolvedValue({ data: { datas: { status: 'accepted' } } })
    await openReview(creationDetail())
    await wrapper.vm.accept()
    expect(VulnerabilityService.acceptProposal).toHaveBeenCalledWith('p2', [])
    expect(lastNotification(notify).message).toBe(wrapper.vm.$t('proposals.acceptedOk'))
  })

  it('selects or unselects all the fields', async () => {
    await openReview(updateDetail())
    wrapper.vm.toggleAll()
    expect(wrapper.vm.selected).toEqual([])
    wrapper.vm.toggleAll()
    expect(wrapper.vm.selected).toHaveLength(5)
  })

  it('disables the acceptance of an update without selected field', async () => {
    await openReview(updateDetail())
    wrapper.vm.selected = []
    await flushPromises()
    const accept = wrapper.findAllComponents(QBtn).find((button) => /^Accept/.test(button.props('label')))
    expect(accept.props('disable')).toBe(true)
  })

  it('refuses with a mandatory reason', async () => {
    const dialogs = mockDialog()
    mockNotify()
    vi.spyOn(VulnerabilityService, 'rejectProposal').mockResolvedValue({ data: { datas: {} } })
    await openReview(updateDetail())
    wrapper.vm.reject()
    const { prompt } = dialogs[0].options
    expect(prompt.isValid('   ')).toBe(false)
    expect(prompt.isValid('Duplicate')).toBe(true)
    await dialogs[0].ok('Duplicate of another vulnerability')
    expect(VulnerabilityService.rejectProposal).toHaveBeenCalledWith('p1', 'Duplicate of another vulnerability')
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('lets the author withdraw a pending proposal', async () => {
    setUser('author', ['vulnerabilities:read'])
    const dialogs = mockDialog()
    mockNotify()
    vi.spyOn(VulnerabilityService, 'withdrawProposal').mockResolvedValue({})
    await openReview(updateDetail())
    expect(wrapper.vm.isReviewer).toBe(false)
    expect(wrapper.vm.isAuthor).toBe(true)
    expect(wrapper.findAllComponents(QCheckbox)).toHaveLength(0)
    const labels = wrapper.findAllComponents(QBtn).map((button) => button.props('label'))
    expect(labels).toContain(wrapper.vm.$t('proposals.withdraw'))
    expect(labels).not.toContain(wrapper.vm.$t('proposals.reject'))
    wrapper.vm.withdraw()
    await dialogs[0].ok()
    expect(VulnerabilityService.withdrawProposal).toHaveBeenCalledWith('p1')
  })

  it('shows no action to the other users', async () => {
    setUser('someone', ['vulnerabilities:read'])
    await openReview(updateDetail())
    expect(wrapper.vm.isAuthor).toBe(false)
    const labels = wrapper.findAllComponents(QBtn).map((button) => button.props('label'))
    expect(labels).not.toContain(wrapper.vm.$t('proposals.withdraw'))
    expect(labels).not.toContain(wrapper.vm.$t('proposals.reject'))
  })

  it('notifies the errors of the decisions and keeps the dialog open', async () => {
    const notify = mockNotify()
    vi.spyOn(VulnerabilityService, 'acceptProposal').mockRejectedValue({ message: 'Request failed', response: { data: { datas: 'Vulnerability title already exists' } } })
    await openReview(updateDetail())
    await wrapper.vm.accept()
    expect(lastNotification(notify)).toMatchObject({ message: 'Vulnerability title already exists', color: 'negative' })
    expect(wrapper.vm.visible).toBe(true)
    expect(wrapper.emitted('changed')).toBeUndefined()
  })

  it('links to the finding of the proposal', async () => {
    await openReview(updateDetail())
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/audits/a1/findings/f1')
  })
})

describe('proposals-list', () => {
  const ROWS = [
    { _id: 'p1', kind: 'update', title: 'SQL Injection', locale: 'en', creator: { firstname: 'Ada', lastname: 'Lovelace' }, createdAt: '2024-03-01T10:00:00', status: 'pending' },
    { _id: 'p2', kind: 'creation', title: 'XSS', locale: 'fr', creator: { username: 'bob' }, createdAt: '2024-03-02T11:30:00', status: 'rejected', reviewer: { username: 'carol' }, reviewComment: 'Duplicate' }
  ]

  async function mountList(props = {}) {
    vi.spyOn(VulnerabilityService, 'getProposals').mockResolvedValue({ data: { datas: ROWS } })
    wrapper = mount(ProposalsList, { props, attachTo: document.body, global: { stubs: { RouterLink: RouterLinkStub } } })
    await flushPromises()
    return wrapper
  }

  it('loads the pending proposals and displays them', async () => {
    await mountList()
    expect(VulnerabilityService.getProposals).toHaveBeenCalledWith({ status: 'pending' })
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('Creation') // Sorted by date, most recent first
    expect(rows[0].text()).toContain('XSS')
    expect(rows[0].text()).toContain('bob')
    expect(rows[0].text()).toContain('Refused')
    expect(rows[0].text()).toContain('carol')
    expect(rows[0].text()).toContain('02/03/2024 11:30')
    expect(rows[1].text()).toContain('Ada Lovelace')
    expect(rows[1].text()).toContain('Pending')
  })

  it('reloads with the selected status', async () => {
    await mountList()
    const toggle = wrapper.findComponent(QBtnToggle)
    expect(toggle.props('options').map((option) => option.value)).toEqual(['pending', 'accepted', 'partial', 'rejected', 'all'])
    toggle.vm.$emit('update:modelValue', 'all')
    await flushPromises()
    expect(VulnerabilityService.getProposals).toHaveBeenLastCalledWith({ status: 'all' })
  })

  it('lets the reviewers show only their proposals', async () => {
    await mountList()
    const mine = wrapper.findComponent(QToggle)
    expect(mine.exists()).toBe(true)
    mine.vm.$emit('update:modelValue', true)
    await flushPromises()
    expect(VulnerabilityService.getProposals).toHaveBeenLastCalledWith({ status: 'pending', mine: 'true' })
  })

  it('does not show the "mine" filter to the authors (they only see their proposals)', async () => {
    setUser('author', ['vulnerabilities:read'])
    await mountList()
    expect(wrapper.findComponent(QToggle).exists()).toBe(false)
  })

  it('filters the proposals of a vulnerability', async () => {
    await mountList({ vulnerabilityFilter: { id: 'v1', title: 'SQL Injection' } })
    expect(VulnerabilityService.getProposals).toHaveBeenCalledWith({ status: 'pending', vulnerability: 'v1' })
    const chip = wrapper.findAllComponents(QChip).find((c) => c.text().includes('SQL Injection') && c.props('removable'))
    chip.vm.$emit('remove')
    expect(wrapper.emitted('clear-vulnerability')).toHaveLength(1)
    await wrapper.setProps({ vulnerabilityFilter: null })
    await flushPromises()
    expect(VulnerabilityService.getProposals).toHaveBeenLastCalledWith({ status: 'pending' })
  })

  it('opens the review of a proposal when a row is clicked', async () => {
    await mountList()
    vi.spyOn(VulnerabilityService, 'getProposal').mockResolvedValue({ data: { datas: updateDetail() } })
    await wrapper.findAll('tbody tr')[1].trigger('click')
    await flushPromises()
    expect(VulnerabilityService.getProposal).toHaveBeenCalledWith('p1')
  })

  it('reloads and notifies the parent when a proposal is reviewed', async () => {
    await mountList()
    wrapper.findComponent(ProposalReview).vm.$emit('changed')
    await flushPromises()
    expect(VulnerabilityService.getProposals).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('stops loading when the request fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(VulnerabilityService, 'getProposals').mockRejectedValue(new Error('Network Error'))
    wrapper = mount(ProposalsList, { global: { stubs: { RouterLink: RouterLinkStub } } })
    await flushPromises()
    expect(wrapper.vm.loading).toBe(false)
    expect(wrapper.vm.rows).toEqual([])
  })
})
