// Small components: textarea-array, breadcrumb, audit-state-icon, language-selector, comment-button
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { QInput, QBtn, QBadge, QBreadcrumbsEl, QSelect, QTooltip } from 'quasar'

import TextareaArray from 'components/textarea-array'
import Breadcrumb from 'components/breadcrumb'
import AuditStateIcon from 'components/audit-state-icon'
import LanguageSelector from 'components/language-selector'
import CommentButton from 'components/comment-button'
import { i18n } from '@/boot/i18n'

const settings = (enabled = true, minReviewers = 2) => ({ reviews: { enabled, public: { minReviewers } } })

let wrapper
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('textarea-array', () => {
  // Parent keeping the value of v-model
  function mountWithModel(initial, props = {}) {
    const model = { value: initial }
    wrapper = mount(TextareaArray, {
      props: {
        modelValue: initial,
        label: 'References',
        ...props,
        'onUpdate:modelValue': (value) => {
          model.value = value
          wrapper.setProps({ modelValue: value })
        }
      }
    })
    return model
  }

  const textarea = () => wrapper.find('textarea')

  it('shows one line per item', async () => {
    mountWithModel(['https://owasp.org', 'CWE-79'])
    await flushPromises() // Text set when mounted
    expect(textarea().element.value).toBe('https://owasp.org\nCWE-79')
    expect(wrapper.text()).toContain('References')
  })

  it('shows an empty text without value', () => {
    mountWithModel(undefined)
    expect(textarea().element.value).toBe('')
  })

  it('emits one item per line, empty lines included by default', async () => {
    const model = mountWithModel([])
    await textarea().setValue('a\n\nb')
    expect(model.value).toEqual(['a', '', 'b'])
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([['a', '', 'b']])
  })

  it('removes the empty lines with no-empty-line', async () => {
    const model = mountWithModel([], { noEmptyLine: true })
    await textarea().setValue('a\n\nb\n')
    expect(model.value).toEqual(['a', 'b'])
  })

  it('lets the user type a new line with no-empty-line', async () => {
    mountWithModel(['srv-01'], { noEmptyLine: true })
    await textarea().setValue('srv-01\n')
    await flushPromises()
    expect(textarea().element.value).toBe('srv-01\n')
  })

  it('updates the text when the value is changed by the parent', async () => {
    mountWithModel(['a'])
    await wrapper.setProps({ modelValue: ['x', 'y'] })
    expect(textarea().element.value).toBe('x\ny')
    await wrapper.setProps({ modelValue: null })
    expect(textarea().element.value).toBe('')
  })

  it('is read only when asked', () => {
    mountWithModel(['a'], { readonly: true })
    expect(wrapper.findComponent(QInput).props('readonly')).toBe(true)
    expect(textarea().attributes('readonly')).toBeDefined()
  })
})

describe('audit-state-icon', () => {
  function mountIcon(props, minReviewers = 2) {
    wrapper = mount(AuditStateIcon, { props, global: { mocks: { $settings: settings(true, minReviewers) } } })
    return wrapper
  }

  it('shows the approvals of an approved audit', () => {
    mountIcon({ state: 'APPROVED', approvals: [{ _id: 'u1', firstname: 'Ada', lastname: 'L' }, { _id: 'u2', firstname: 'Bob', lastname: 'M' }] })
    expect(wrapper.text()).toContain('2/2')
    expect(wrapper.text()).toContain('Approved')
    expect(wrapper.find('.q-chip').classes()).toContain('bg-green-2')
  })

  it('shows the progress of an audit in review', () => {
    mountIcon({ state: 'REVIEW', approvals: [{ _id: 'u1' }] }, 3)
    expect(wrapper.text()).toContain('1/3')
    expect(wrapper.text()).toContain('Reviewing')
    expect(wrapper.find('.q-chip').classes()).toContain('bg-amber-2')
  })

  it('shows nothing in edit state', () => {
    mountIcon({ state: 'EDIT', approvals: [] })
    expect(wrapper.find('.q-chip').exists()).toBe(false)
  })

  it('counts -1 approvals when they are not given', () => {
    mountIcon({ state: 'REVIEW' })
    expect(wrapper.vm.getApprovalCount()).toBe(-1)
  })

  it('uses the given size', () => {
    mountIcon({ state: 'REVIEW', approvals: [], size: '20px' })
    expect(wrapper.find('.q-chip').attributes('style')).toContain('font-size: 20px')
  })
})

describe('breadcrumb', () => {
  async function mountBreadcrumb(path, props = {}, reviews = true) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<router-view />' }, meta: { breadcrumb: 'Home' }, children: [
        { path: 'audits', component: { template: '<div />' }, meta: { breadcrumb: 'Audits' } },
        { path: 'data', component: { template: '<router-view />' }, meta: { breadcrumb: 'Datas' }, children: [
          { path: 'dump', component: { template: '<div />' } }
        ] }
      ] }]
    })
    router.push(path)
    await router.isReady()
    wrapper = mount(Breadcrumb, { props, global: { plugins: [router], mocks: { $settings: settings(reviews) } } })
    return router
  }

  it('shows the last breadcrumb as title and links to the parent pages', async () => {
    await mountBreadcrumb('/data/dump')
    expect(wrapper.find('.breadcrumb-title').text()).toBe('Datas')
    expect(wrapper.findAllComponents(QBreadcrumbsEl).map((el) => [el.props('label'), el.props('to')])).toEqual([['Home', '/'], ['Datas', '/data']])
  })

  it('shows the title, the review state and the buttons slot of the audit pages', async () => {
    const router = await mountBreadcrumb('/audits', { buttons: '', title: 'Audit ACME', state: 'REVIEW', approvals: [] })
    expect(wrapper.text()).toContain('Audit ACME')
    expect(wrapper.findComponent(AuditStateIcon).exists()).toBe(true)
    expect(wrapper.findAllComponents(QBreadcrumbsEl)).toHaveLength(0)
    const push = vi.spyOn(router, 'push')
    await wrapper.findComponent(QBtn).trigger('click')
    expect(push).toHaveBeenCalledWith('/audits')
  })

  it('hides the review state when the reviews are disabled or the audit is edited', async () => {
    await mountBreadcrumb('/audits', { buttons: '', title: 'Audit', state: 'REVIEW' }, false)
    expect(wrapper.findComponent(AuditStateIcon).exists()).toBe(false)
    wrapper.unmount()
    await mountBreadcrumb('/audits', { buttons: '', title: 'Audit', state: 'EDIT' })
    expect(wrapper.findComponent(AuditStateIcon).exists()).toBe(false)
    expect(wrapper.text()).toContain('Audit')
  })
})

describe('language-selector', () => {
  afterEach(() => {
    i18n.global.locale.value = 'en-US'
    localStorage.setItem('system_language', 'en-US')
  })

  it('offers the 5 languages of the translations', () => {
    wrapper = mount(LanguageSelector)
    expect(wrapper.findComponent(QSelect).props('options').map((option) => option.value)).toEqual(['en-US', 'fr-FR', 'zh-CN', 'de-DE', 'pt-BR'])
  })

  it('selects the saved language', () => {
    localStorage.setItem('system_language', 'de-DE')
    wrapper = mount(LanguageSelector)
    expect(wrapper.vm.lang).toBe('de-DE')
  })

  it('saves English by default', () => {
    localStorage.removeItem('system_language')
    wrapper = mount(LanguageSelector)
    expect(wrapper.vm.lang).toBe('en-US')
    expect(localStorage.getItem('system_language')).toBe('en-US')
  })

  it('switches the language of the interface and saves it', async () => {
    wrapper = mount(LanguageSelector)
    wrapper.findComponent(QSelect).vm.$emit('update:modelValue', 'fr-FR')
    await flushPromises()
    expect(i18n.global.locale.value).toBe('fr-FR')
    expect(localStorage.getItem('system_language')).toBe('fr-FR')
    expect(wrapper.findComponent(QSelect).props('label')).toBe('Langue')
  })
})

describe('comment-button', () => {
  const target = { kind: 'finding', findingId: 'f1', field: 'description' }

  function mountButton(store, props = { target }) {
    wrapper = mount(CommentButton, { props, global: { provide: store === undefined ? {} : { auditComments: store } } })
    return wrapper
  }

  function fakeStore(comments) {
    return reactive({
      comments,
      forTarget: vi.fn(function (t) { return this.comments.filter((c) => c.key === `${t.kind}:${t.findingId}:${t.field}`) }),
      openCountForTarget: vi.fn(function (t) { return this.forTarget(t).filter((c) => !c.resolved).length }),
      openTarget: vi.fn()
    })
  }

  it('is not displayed outside the audit pages (no comments store) or without target', () => {
    mountButton(undefined)
    expect(wrapper.find('.comment-button').exists()).toBe(false)
    wrapper.unmount()
    mountButton(fakeStore([]), { target: null })
    expect(wrapper.find('.comment-button').exists()).toBe(false)
  })

  it('shows a grey icon without comments', () => {
    mountButton(fakeStore([]))
    const button = wrapper.findComponent(QBtn)
    expect(button.props('icon')).toBe('mdi-comment-outline')
    expect(button.props('color')).toBe('grey-6')
    expect(wrapper.findComponent(QBadge).exists()).toBe(false)
    expect(button.attributes('data-comment-field')).toBe('finding:f1:description')
  })

  it('shows the number of open comments of the field', async () => {
    const store = fakeStore([
      { key: 'finding:f1:description' },
      { key: 'finding:f1:description', resolved: true },
      { key: 'finding:f1:description' },
      { key: 'finding:f2:description' }
    ])
    mountButton(store)
    const button = wrapper.findComponent(QBtn)
    expect(button.props('icon')).toBe('mdi-comment-text-multiple-outline')
    expect(button.props('color')).toBe('orange-8')
    expect(wrapper.findComponent(QBadge).text()).toBe('2')
    store.comments = store.comments.map((comment) => ({ ...comment, resolved: true }))
    await flushPromises()
    expect(wrapper.findComponent(QBadge).exists()).toBe(false)
    expect(wrapper.findComponent(QBtn).props('icon')).toBe('mdi-comment-text-multiple-outline') // resolved comments
    expect(wrapper.findComponent(QBtn).props('color')).toBe('grey-6')
  })

  it('opens the comments of the field without triggering the click of the parent', async () => {
    const store = fakeStore([])
    const parentClick = vi.fn()
    wrapper = mount({
      components: { CommentButton },
      template: '<div @click="parentClick"><comment-button :target="target" /></div>',
      setup: () => ({ target, parentClick })
    }, { global: { provide: { auditComments: store } } })
    await wrapper.findComponent(QBtn).trigger('click')
    expect(store.openTarget).toHaveBeenCalledWith(target)
    expect(parentClick).not.toHaveBeenCalled()
  })

  it('has a translated tooltip', () => {
    mountButton(fakeStore([]))
    expect(wrapper.findComponent(QTooltip).exists()).toBe(true)
    expect(i18n.global.te('comments.commentField', 'en-US')).toBe(true)
  })
})
