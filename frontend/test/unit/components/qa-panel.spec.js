// components/qa-panel.vue: quality checks of an audit (issues by severity, place opened, issues ignored and restored)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import QaPanel from 'components/qa-panel'
import AuditService from '@/services/audit'

const issue = (fingerprint, severity, code, location, params = {}) => ({ fingerprint: fingerprint.repeat(20), check: 'completeness', severity, code, params, location })
const ISSUES = [
  issue('a', 'error', 'findingNoDescription', { kind: 'finding', id: 'f1', name: 'SQLi <b>', field: 'description', label: null }),
  issue('b', 'warning', 'captionFileName', { kind: 'finding', id: 'f1', name: 'SQLi <b>', field: 'poc', label: null }, { caption: 'IMG_1.png' }),
  issue('c', 'warning', 'highlightedText', { kind: 'section', id: 's1', name: 'Synthèse', field: 'text', label: null }, { text: 'TODO', color: '#ffff00' })
]
const IGNORED = [issue('e', 'warning', 'findingNoCvss', { kind: 'finding', id: 'f2', name: 'XSS', field: 'cvss', label: null })]

let wrapper
let router

async function mountPanel({ editable = true, issues = ISSUES, ignored = IGNORED } = {}) {
  router = { push: vi.fn() }
  vi.spyOn(AuditService, 'getAuditQa').mockResolvedValue({ data: { datas: { issues, ignored } } })
  wrapper = mount(QaPanel, { props: { auditId: 'a1', editable }, global: { mocks: { $router: router } } })
  await flushPromises()
  return wrapper
}

afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('quality checks panel', () => {
  it('lists the issues with their message, place and severity, and gives the counts', async () => {
    await mountPanel()
    expect(AuditService.getAuditQa).toHaveBeenCalledWith('a1')
    const items = wrapper.findAll('.qa-issue')
    expect(items.map((item) => item.find('.qa-message').text())).toEqual(['Empty description', 'Caption left as a file name: "IMG_1.png"', 'Highlighted text to replace: "TODO"'])
    expect(items[0].text()).toContain('SQLi <b> · Description')
    expect(items[0].classes()).toContain('qa-issue--error')
    expect(items[2].find('.qa-swatch').attributes('style')).toContain('background: rgb(255, 255, 0)')
    expect(wrapper.find('.qa-summary').text()).toBe('1 errors, 2 warnings')
    expect(wrapper.emitted('update')[0][0]).toEqual({ error: 1, warning: 2, info: 0 })
    expect(wrapper.find('.qa-ignored').text()).toContain('Ignored (1)')
  })

  it('shows that nothing was found', async () => {
    await mountPanel({ issues: [], ignored: [] })
    expect(wrapper.find('.qa-empty').text()).toBe('No issue found')
    expect(wrapper.find('.qa-ignored').exists()).toBe(false)
  })

  it('ignores an issue and restores an ignored one, then checks again', async () => {
    const ignore = vi.spyOn(AuditService, 'setAuditQaIgnored').mockResolvedValue({})
    await mountPanel()
    await wrapper.findAll('.qa-ignore')[1].trigger('click')
    await flushPromises()
    expect(ignore).toHaveBeenCalledWith('a1', 'b'.repeat(20), true)
    expect(AuditService.getAuditQa).toHaveBeenCalledTimes(2)
    wrapper.vm.setIgnored(IGNORED[0], false)
    await flushPromises()
    expect(ignore).toHaveBeenLastCalledWith('a1', 'e'.repeat(20), false)
  })

  it('cannot ignore the issues when the audit cannot be edited', async () => {
    await mountPanel({ editable: false })
    expect(wrapper.findAll('.qa-ignore')).toHaveLength(0)
    expect(wrapper.findAll('.qa-restore')).toHaveLength(0)
  })

  it('opens the place of an issue and closes the panel', async () => {
    await mountPanel()
    await wrapper.findAll('.qa-open')[2].trigger('click')
    expect(router.push).toHaveBeenCalledWith('/audits/a1/sections/s1')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows the error of the checks', async () => {
    router = { push: vi.fn() }
    vi.spyOn(AuditService, 'getAuditQa').mockRejectedValue({ response: { data: { datas: 'Audit not found' } } })
    wrapper = mount(QaPanel, { props: { auditId: 'a1' }, global: { mocks: { $router: router } } })
    await flushPromises()
    expect(wrapper.find('.qa-error').text()).toBe('Audit not found')
  })
})
