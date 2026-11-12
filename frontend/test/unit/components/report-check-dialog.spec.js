// components/report-check-dialog.vue: errors and warnings of the quality checks (highlighted texts to replace included)
// listed before the generation of a report, generated anyway or cancelled (API service mocked)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import ReportCheckDialog from 'components/report-check-dialog'
import AuditService from '@/services/audit'

const issue = (fingerprint, severity, code, location, params = {}) => ({ fingerprint: fingerprint.repeat(20), check: 'completeness', severity, code, params, location })
const ISSUES = [
  issue('a', 'error', 'internalLinkBroken', { kind: 'finding', id: 'f1', name: 'XSS réfléchie', field: 'poc', label: null }, { text: '<img src=x onerror=alert(1)>' }),
  issue('b', 'warning', 'highlightedText', { kind: 'section', id: 's1', name: 'Synthèse 🔒', field: 'customFields.c1', label: 'Corps' }, { text: '[CLIENT]', color: '#00ff00' }),
  issue('c', 'warning', 'commentsOpen', { kind: 'network', id: null, name: 'Audit', field: null, label: null }, { count: 1 }),
  issue('d', 'info', 'similarTitle', { kind: 'finding', id: 'f2', name: 'Other', field: null, label: null }, { other: 'x' })
]
const ENABLED = { qa: { public: { checks: { completeness: true } } } }

let wrapper
let router

function mountDialog($settings = ENABLED) {
  router = { push: vi.fn() }
  wrapper = mount(ReportCheckDialog, { attachTo: document.body, global: { mocks: { $settings, $router: router } } })
  return wrapper.vm
}
const answer = (issues) => vi.spyOn(AuditService, 'getAuditQa').mockResolvedValue({ data: { datas: { issues, ignored: [] } } })

afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('report check dialog', () => {
  it('confirms at once without request when the checks and the highlight warning are disabled', async () => {
    const get = vi.spyOn(AuditService, 'getAuditQa')
    const vm = mountDialog({ qa: { public: { checks: { completeness: false, images: false } } }, report: { public: { highlightWarning: false } } })
    expect(await vm.confirm('a1')).toBe(true)
    expect(get).not.toHaveBeenCalled()
    expect(vm.show).toBe(false)
  })

  it('checks when only the highlight warning is enabled', async () => {
    answer([ISSUES[1]])
    const vm = mountDialog({ report: { public: { highlightWarning: true } } })
    vm.confirm('a1')
    await flushPromises()
    expect(vm.show).toBe(true)
    vm.close(false)
  })

  it('confirms at once without error nor warning, and when the checks cannot be run (warning only)', async () => {
    answer([ISSUES[3]])
    const vm = mountDialog()
    expect(await vm.confirm('a1')).toBe(true)
    AuditService.getAuditQa.mockRejectedValue(new Error('Network Error'))
    expect(await vm.confirm('a1')).toBe(true)
    expect(vm.show).toBe(false)
  })

  it('lists the errors and warnings, as text, the highlighted texts in their color, and answers the choice of the user', async () => {
    answer(ISSUES)
    const vm = mountDialog()
    const cancelled = vm.confirm('a1')
    await flushPromises()
    expect(vm.show).toBe(true)
    expect(vm.counts).toEqual({ error: 1, warning: 2, info: 0 })
    expect(vm.issues.map((item) => vm.place(item))).toEqual(['XSS réfléchie · Proofs', 'Synthèse 🔒 · Corps', 'Network Scan'])
    const card = document.querySelector('.report-check-dialog')
    expect(card.querySelector('.report-check-summary').textContent).toContain('1 errors and 2 warnings')
    expect(card.textContent).toContain('Link to a deleted finding: "<img src=x onerror=alert(1)>"')
    expect(card.querySelector('img')).toBeNull()
    expect(card.querySelector('mark').textContent).toBe('[CLIENT]')
    expect(card.querySelector('mark').style.background).toBe('rgb(0, 255, 0)')
    document.querySelector('.report-check-cancel').click()
    expect(await cancelled).toBe(false)
    const generated = vm.confirm('a1')
    await flushPromises()
    document.querySelector('.report-check-generate').click()
    expect(await generated).toBe(true)
  })

  it('opens the place of an issue clicked in the list, without generating', async () => {
    answer(ISSUES)
    const vm = mountDialog()
    let result = vm.confirm('a1')
    await flushPromises()
    vm.open(ISSUES[1])
    expect(await result).toBe(false)
    expect(router.push).toHaveBeenCalledWith('/audits/a1/sections/s1')
    result = vm.confirm('a1')
    await flushPromises()
    vm.open(ISSUES[2])
    expect(await result).toBe(false)
    expect(router.push).toHaveBeenLastCalledWith('/audits/a1/network')
  })

  it('cancels a previous dialog not answered when asked again', async () => {
    answer(ISSUES)
    const vm = mountDialog()
    const first = vm.confirm('a1')
    await flushPromises()
    const second = vm.confirm('a2')
    await flushPromises()
    expect(await first).toBe(false)
    vm.close(true)
    expect(await second).toBe(true)
  })
})
