// pages/403.vue and pages/404.vue: error message given by the route, back to the home page
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { QBtn } from 'quasar'

// Routes of the application imported alone: their guard service (which imports the router itself) is not needed
vi.mock('@/services/user', () => ({ default: {} }))

import Page403 from 'pages/403'
import Page404 from 'pages/404'
import routes from '@/router/routes'

let wrapper
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe.each([
  ['403', Page403],
  ['404', Page404]
])('error page %s', (code, Page) => {
  function mountPage(params = {}) {
    const router = { push: vi.fn() }
    wrapper = mount(Page, { global: { mocks: { $route: { params }, $router: router } } })
    return router
  }

  it('shows the error message of the route and the status code', () => {
    mountPage({ error: 'Insufficient privileges' })
    expect(wrapper.find('.text-faded').text()).toBe(`Insufficient privileges (${code})`)
  })

  it('shows only the status code without message', () => {
    mountPage()
    expect(wrapper.find('.text-faded').text()).toBe(`(${code})`)
  })

  it('shows the message as text (no HTML interpretation), unicode included', () => {
    mountPage({ error: '<img src=x onerror=alert(1)> Audit « été » introuvable 🔍' })
    expect(wrapper.find('img[src="x"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)> Audit « été » introuvable 🔍')
  })

  it('goes back to the home page', async () => {
    const router = mountPage({ error: 'x' })
    const button = wrapper.findComponent(QBtn)
    expect(button.text()).toBe(wrapper.vm.$t('goBack'))
    await button.trigger('click')
    expect(router.push).toHaveBeenCalledWith('/')
  })
})

describe('error pages opened by name (vue-router 4)', () => {
  // Path of the route of the application (src/router/routes.js), the layout of the application not being loaded
  const appPath = (name) => `/${routes[0].children.find((route) => route.name === name).path}`

  async function openByName(name, Page, path = `/${name}`) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }, { path, name, component: Page }]
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {}) // "Discarded invalid param(s)" warning of vue-router
    wrapper = mount({ template: '<router-view />' }, { global: { plugins: [router] } })
    await router.push({ name, params: { error: 'Audit not found' } })
    await flushPromises()
    return router
  }

  it('shows the page of the status code', async () => {
    const router = await openByName('404', Page404)
    expect(router.currentRoute.value.fullPath).toBe('/404')
    expect(wrapper.text()).toContain('(404)')
  })

  // The audit page gives the reason as a route param ({name: '403', params: {error}}): the routes of the application
  // declare it, otherwise vue-router 4 discards it
  it.each([
    ['403', Page403],
    ['404', Page404]
  ])('shows the message given when opening the page %s by name', async (name, Page) => {
    await openByName(name, Page, appPath(name))
    expect(wrapper.text()).toContain('Audit not found')
  })
})
