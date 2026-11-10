// layouts/home.vue (navigation bar) and pages/data/index.vue (data menu)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { QItem, QBadge, QBtnDropdown, QLayout, Dark } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import HomeLayout from 'layouts/home'
import DataLayout from 'pages/data'
import UserService from '@/services/user'
import VulnerabilityService from '@/services/vulnerability'

let wrapper

async function newRouter(path) {
  const page = { template: '<div class="page" />' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/audits', '/vulnerabilities', '/settings', '/profile', '/data/collaborators', '/data/companies', '/data/clients', '/data/templates', '/data/custom', '/data/dump']
      .map((p) => ({ path: p, component: page }))
  })
  router.push(path)
  await router.isReady()
  return router
}

afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
  Dark.set(false)
  localStorage.removeItem('darkmodeEnabled')
})

describe('home layout', () => {
  async function mountHome(roles, pending = 4) {
    UserService.user = { username: 'jdoe', roles }
    vi.spyOn(VulnerabilityService, 'getProposalsCount').mockResolvedValue({ data: { datas: { pending } } })
    const router = await newRouter('/audits')
    wrapper = mount(HomeLayout, { global: { plugins: [router] } })
    await flushPromises()
    return router
  }

  it('links to the main pages', async () => {
    await mountHome(['audits:read'])
    expect(wrapper.findAllComponents(QItem).map((item) => item.props('to')).filter(Boolean)).toEqual(['/audits', '/vulnerabilities', '/data/collaborators', '/settings'])
    expect(wrapper.findComponent(QBtnDropdown).props('label')).toBe('jdoe')
    expect(wrapper.find('.page').exists()).toBe(true)
  })

  it('shows the number of proposals to review to the reviewers, refreshed on navigation and changes', async () => {
    const router = await mountHome(['vulnerabilities:update'])
    expect(wrapper.findComponent(QBadge).text()).toBe('4')
    VulnerabilityService.getProposalsCount.mockResolvedValue({ data: { datas: { pending: 2 } } })
    await router.push('/vulnerabilities')
    await flushPromises()
    expect(wrapper.findComponent(QBadge).text()).toBe('2')
    VulnerabilityService.getProposalsCount.mockResolvedValue({ data: { datas: { pending: 0 } } })
    window.dispatchEvent(new Event('proposals-changed'))
    await flushPromises()
    expect(wrapper.findComponent(QBadge).exists()).toBe(false)
  })

  it('does not request the proposals count for the other users', async () => {
    await mountHome(['vulnerabilities:read'])
    expect(VulnerabilityService.getProposalsCount).not.toHaveBeenCalled()
    expect(wrapper.findComponent(QBadge).exists()).toBe(false)
  })

  it('stops listening to the proposals changes when unmounted', async () => {
    await mountHome(['vulnerabilities:update'])
    wrapper.unmount()
    wrapper = null
    VulnerabilityService.getProposalsCount.mockClear()
    window.dispatchEvent(new Event('proposals-changed'))
    expect(VulnerabilityService.getProposalsCount).not.toHaveBeenCalled()
  })

  it('logs out and toggles the dark mode from the user menu', async () => {
    await mountHome(['audits:read'])
    const destroy = vi.spyOn(UserService, 'destroyToken').mockImplementation(() => {})
    wrapper.vm.logout()
    expect(destroy).toHaveBeenCalled()
    wrapper.vm.toggleDarkMode()
    expect(Dark.isActive).toBe(true)
    expect(localStorage.getItem('darkmodeEnabled')).toBe('y')
    wrapper.vm.toggleDarkMode()
    expect(Dark.isActive).toBe(false)
  })
})

describe('data layout', () => {
  it('links to the data pages and displays the selected one', async () => {
    UserService.user = { username: 'admin', roles: '*' }
    const router = await newRouter('/data/dump')
    // The drawer of the page needs a QLayout (given by layouts/home in the application)
    wrapper = mount({ components: { DataLayout, QLayout }, template: '<q-layout><data-layout /></q-layout>' }, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.findAllComponents(QItem).map((item) => item.props('to')).filter(Boolean))
      .toEqual(['/data/collaborators', '/data/companies', '/data/clients', '/data/templates', '/data/custom', '/data/dump'])
    expect(wrapper.find('.page').exists()).toBe(true)
  })
})
