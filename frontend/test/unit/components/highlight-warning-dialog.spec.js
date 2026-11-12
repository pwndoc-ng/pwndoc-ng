// components/highlight-warning-dialog.vue: texts highlighted in the warning color (generic texts to replace) listed before
// the generation of a report, generated anyway or cancelled (API service mocked)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import HighlightWarningDialog from 'components/highlight-warning-dialog'
import AuditService, { highlightWarningEnabled } from '@/services/audit'

const ITEMS = [
  { kind: 'finding', id: 'f1', name: 'XSS réfléchie', field: 'poc', label: null, texts: [{ text: '[CLIENT]', color: '#00ff00' }, { text: '<img src=x onerror=alert(1)>', color: '#ffff00' }] },
  { kind: 'finding', id: 'f1', name: 'XSS réfléchie', field: 'scope', label: null, texts: [{ text: 'host', color: '#ffff00' }] },
  { kind: 'section', id: 's1', name: 'Synthèse 🔒', field: 'customFields.c1', label: 'Corps', texts: [{ text: 'TODO', color: '#ffff00' }] },
  { kind: 'section', id: 's2', name: 'Legacy', field: 'text', label: null, texts: [{ text: 'old', color: '#ffff00' }] },
  { kind: 'general', id: null, name: 'Audit', field: 'customFields.g1', label: 'Contexte', texts: [{ text: 'x', color: '#ffff00' }] }
]
const ENABLED = { report: { public: { highlightWarning: true } } }

let wrapper
let router

function mountDialog($settings = ENABLED) {
  router = { push: vi.fn() }
  wrapper = mount(HighlightWarningDialog, { attachTo: document.body, global: { mocks: { $settings, $router: router } } })
  return wrapper.vm
}
const answer = (items) => vi.spyOn(AuditService, 'getAuditHighlights').mockResolvedValue({ data: { datas: { enabled: true, colors: ['#ffff00', '#00ff00'], items } } })

afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('highlight warning dialog', () => {
  it('is enabled by the setting of the reports only', () => {
    expect(highlightWarningEnabled(ENABLED)).toBe(true)
    expect(highlightWarningEnabled({ report: { enabled: false, public: { highlightWarning: true } } })).toBe(false)
    expect(highlightWarningEnabled({ report: { public: { highlightWarning: false } } })).toBe(false)
    expect(highlightWarningEnabled({ reviews: {} })).toBe(false)
    expect(highlightWarningEnabled(undefined)).toBe(false)
  })

  it('confirms at once without request when the warning is disabled', async () => {
    const get = vi.spyOn(AuditService, 'getAuditHighlights')
    const vm = mountDialog({ report: { public: { highlightWarning: false } } })
    expect(await vm.confirm('a1')).toBe(true)
    expect(get).not.toHaveBeenCalled()
    expect(vm.show).toBe(false)
  })

  it('confirms at once without highlighted texts, and when they cannot be loaded (warning only)', async () => {
    answer([])
    const vm = mountDialog()
    expect(await vm.confirm('a1')).toBe(true)
    AuditService.getAuditHighlights.mockRejectedValue(new Error('Network Error'))
    expect(await vm.confirm('a1')).toBe(true)
    expect(vm.show).toBe(false)
  })

  it('lists the places and texts, as text, in their color, and answers the choice of the user', async () => {
    answer(ITEMS)
    const vm = mountDialog()
    const cancelled = vm.confirm('a1')
    await flushPromises()
    expect(vm.show).toBe(true)
    expect(ITEMS.map((item) => vm.place(item))).toEqual(['XSS réfléchie · Proofs', 'XSS réfléchie · Affected Assets', 'Synthèse 🔒 · Corps', 'Legacy', 'General Information · Contexte'])
    const dialog = document.querySelector('.highlight-dialog')
    expect(dialog.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(dialog.querySelector('img')).toBeNull()
    expect([...dialog.querySelectorAll('mark')].slice(0, 2).map((mark) => mark.style.background)).toEqual(['rgb(0, 255, 0)', 'rgb(255, 255, 0)'])
    document.querySelector('.highlight-cancel').click()
    expect(await cancelled).toBe(false)
    const generated = vm.confirm('a1')
    await flushPromises()
    document.querySelector('.highlight-generate').click()
    expect(await generated).toBe(true)
  })

  it('opens the place of a text clicked in the list, without generating', async () => {
    answer(ITEMS)
    const vm = mountDialog()
    let result = vm.confirm('a1')
    await flushPromises()
    vm.open(ITEMS[2])
    expect(await result).toBe(false)
    expect(router.push).toHaveBeenCalledWith('/audits/a1/sections/s1')
    result = vm.confirm('a1')
    await flushPromises()
    vm.open(ITEMS[4])
    expect(await result).toBe(false)
    expect(router.push).toHaveBeenLastCalledWith('/audits/a1/general')
  })

  it('cancels a previous dialog not answered when asked again', async () => {
    answer(ITEMS)
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
