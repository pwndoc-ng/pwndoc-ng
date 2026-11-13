// components/qa-panel.vue: quality checks of an audit (issues by severity, place opened, issues ignored and restored)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import { qaFocus } from '@/services/qa'
import QaPanel from 'components/qa-panel'
import AuditService from '@/services/audit'
import AiService from '@/services/ai'
import UserService from '@/services/user'

const issue = (fingerprint, severity, code, location, params = {}) => ({ fingerprint: fingerprint.repeat(20), check: 'completeness', severity, code, params, location })
const ISSUES = [
  issue('a', 'error', 'findingNoDescription', { kind: 'finding', id: 'f1', name: 'SQLi <b>', field: 'description', label: null }),
  issue('b', 'warning', 'captionFileName', { kind: 'finding', id: 'f1', name: 'SQLi <b>', field: 'poc', label: null }, { caption: 'IMG_1.png' }),
  issue('c', 'warning', 'highlightedText', { kind: 'section', id: 's1', name: 'Synthèse', field: 'text', label: null }, { text: 'TODO', color: '#ffff00' })
]
const IGNORED = [issue('e', 'warning', 'findingNoCvss', { kind: 'finding', id: 'f2', name: 'XSS', field: 'cvss', label: null })]

let wrapper
let router

async function mountPanel({ editable = true, issues = ISSUES, ignored = IGNORED, ai = null, $settings = {} } = {}) {
  router = { push: vi.fn() }
  vi.spyOn(AuditService, 'getAuditQa').mockResolvedValue({ data: { datas: { issues, ignored, ai } } })
  wrapper = mount(QaPanel, { props: { auditId: 'a1', editable }, global: { mocks: { $router: router, $settings } } })
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
    // Field and passage shown by the audit page
    expect(qaFocus.request).toEqual({ auditId: 'a1', issue: wrapper.vm.issues[2] })
    qaFocus.request = null
  })

  it('offers the quality check by the AI when it is enabled and allowed, with the date of the last check', async () => {
    UserService.user = { username: 'ann', roles: '*' }
    await mountPanel()
    expect(wrapper.find('.qa-ai').exists()).toBe(false)
    wrapper.unmount()
    const at = '2026-11-12T10:00:00.000Z'
    await mountPanel({ $settings: { ai: { enabled: true } }, ai: { at } })
    expect(wrapper.find('.qa-ai-date').text()).toBe(`Last check by the AI: ${new Date(at).toLocaleString()}`)
    const check = vi.spyOn(AiService, 'checkAudit').mockResolvedValue({ data: { datas: { at, issues: [] } } })
    const loads = AuditService.getAuditQa.mock.calls.length
    await wrapper.find('.qa-ai-run').trigger('click')
    await flushPromises()
    expect(check).toHaveBeenCalledWith('a1')
    expect(AuditService.getAuditQa.mock.calls.length).toBe(loads + 1) // Issues of the AI listed with the others
  })

  it('shows the issues of the AI with their message, and when the AI was never run', async () => {
    UserService.user = { username: 'ann', roles: '*' }
    const aiIssue = { fingerprint: 'f'.repeat(20), check: 'ai', severity: 'warning', code: 'ai', params: { message: 'CVSS too high for the impact' }, location: { kind: 'finding', id: 'f1', name: 'SQLi', field: 'cvss', label: null } }
    await mountPanel({ issues: [aiIssue], $settings: { ai: { enabled: true } } })
    expect(wrapper.find('.qa-message').text()).toBe('CVSS too high for the impact')
    expect(wrapper.find('.qa-issue').text()).toContain('SQLi · CVSS')
    expect(wrapper.find('.qa-ai-date').text()).toBe('Never checked by the AI')
  })

  it('distinguishes the issues of the AI and filters them by source, with the number of each', async () => {
    UserService.user = { username: 'ann', roles: '*' }
    const aiIssue = (fingerprint, severity, message) => ({ fingerprint: fingerprint.repeat(20), check: 'ai', severity, code: 'ai', params: { message }, location: { kind: 'finding', id: 'f1', name: 'SQLi', field: 'description', label: null } })
    const issues = [...ISSUES, aiIssue('g', 'warning', 'Guideline 2 not respected'), aiIssue('h', 'info', 'Unclear wording')]
    await mountPanel({ issues, ignored: [...IGNORED, aiIssue('i', 'warning', 'Ignored')], $settings: { ai: { enabled: true } } })
    const buttons = () => wrapper.findAll('.qa-source-filter button')
    expect(buttons().map((button) => button.text().trim())).toEqual(['All (5)', 'Standard rules (3)', 'AI (2)'])
    expect(wrapper.findAll('.qa-issue')).toHaveLength(5)
    expect(wrapper.findAll('.qa-issue--ai').map((item) => item.find('.qa-ai-badge').text())).toEqual(['AI', 'AI'])
    expect(wrapper.findAll('.qa-issue--rules')).toHaveLength(3)
    expect(wrapper.find('.qa-issue--rules .qa-ai-badge').exists()).toBe(false)
    expect(wrapper.find('.qa-ignored').text()).toContain('Ignored (2)')
    // AI only: issues, severities and ignored issues of the AI
    await buttons()[2].trigger('click')
    expect(wrapper.findAll('.qa-issue .qa-message').map((message) => message.text())).toEqual(['Guideline 2 not respected', 'Unclear wording'])
    expect(wrapper.find('.qa-summary').text()).toBe('0 errors, 1 warnings')
    expect(wrapper.find('.qa-ignored').text()).toContain('Ignored (1)')
    // Standard rules only
    await buttons()[1].trigger('click')
    expect(wrapper.findAll('.qa-issue')).toHaveLength(3)
    expect(wrapper.find('.qa-issue--ai').exists()).toBe(false)
    expect(wrapper.find('.qa-summary').text()).toBe('1 errors, 2 warnings')
    expect(wrapper.find('.qa-ignored').text()).toContain('Ignored (1)')
    // Number of the audit menu: all the issues
    expect(wrapper.emitted('update')[0][0]).toEqual({ error: 1, warning: 3, info: 1 })
  })

  it('shows that there is no issue of the source chosen, and no filter without AI', async () => {
    UserService.user = { username: 'ann', roles: '*' }
    await mountPanel({ $settings: { ai: { enabled: true } } })
    await wrapper.findAll('.qa-source-filter button')[2].trigger('click')
    expect(wrapper.find('.qa-empty-source').text()).toBe('No issue of this kind')
    expect(wrapper.findAll('.qa-issue')).toHaveLength(0)
    wrapper.unmount()
    await mountPanel() // AI disabled and no issue of the AI: all the issues are of the standard rules
    expect(wrapper.find('.qa-sources').exists()).toBe(false)
    expect(wrapper.findAll('.qa-issue')).toHaveLength(3)
  })

  it('shows the error of the quality check by the AI', async () => {
    UserService.user = { username: 'ann', roles: '*' }
    await mountPanel({ $settings: { ai: { enabled: true } } })
    vi.spyOn(AiService, 'checkAudit').mockRejectedValue({ response: { data: { datas: 'The AI server did not answer in time' } } })
    await wrapper.find('.qa-ai-run').trigger('click')
    await flushPromises()
    expect(wrapper.find('.qa-error').text()).toBe('The AI server did not answer in time')
  })

  it('shows the error of the checks', async () => {
    router = { push: vi.fn() }
    vi.spyOn(AuditService, 'getAuditQa').mockRejectedValue({ response: { data: { datas: 'Audit not found' } } })
    wrapper = mount(QaPanel, { props: { auditId: 'a1' }, global: { mocks: { $router: router, $settings: {} } } })
    await flushPromises()
    expect(wrapper.find('.qa-error').text()).toBe('Audit not found')
  })
})
