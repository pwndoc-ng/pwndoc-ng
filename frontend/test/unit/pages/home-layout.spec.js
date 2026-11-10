// layouts/home.vue, complements of layouts.spec.js: user menu (profile, dark mode label), proposals badge errors
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { QItem, QBadge, QBtnDropdown, QLayout, QIcon, Dark } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import HomeLayout from 'layouts/home'
import UserService from '@/services/user'
import VulnerabilityService from '@/services/vulnerability'

let wrapper

async function mountHome({ roles = ['audits:read'], username = 'jdoe', count = () => Promise.resolve({ data: { datas: { pending: 4 } } }) } = {}) {
  UserService.user = { username, roles }
  vi.spyOn(VulnerabilityService, 'getProposalsCount').mockImplementation(count)
  const page = { template: '<div class="page" />' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/audits', '/vulnerabilities', '/settings', '/profile', '/data/collaborators'].map((path) => ({ path, component: page }))
  })
  router.push('/audits')
  await router.isReady()
  wrapper = mount(HomeLayout, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return router
}

// Items of the user menu (rendered in a menu once the dropdown is opened)
async function openUserMenu() {
  wrapper.findComponent(QBtnDropdown).vm.show()
  await flushPromises()
  return wrapper.findAllComponents(QItem).filter((item) => item.props('clickable'))
}

afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
  Dark.set(false)
  localStorage.removeItem('darkmodeEnabled')
})

describe('home layout user menu', () => {
  it('shows the username with unicode characters', async () => {
    await mountHome({ username: 'zoë.王' })
    expect(wrapper.findComponent(QBtnDropdown).props('label')).toBe('zoë.王')
  })

  it('offers the dark mode, the profile and the logout', async () => {
    await mountHome()
    const items = await openUserMenu()
    expect(items.map((item) => item.text())).toEqual(['Dark-Mode', wrapper.vm.$t('profile'), wrapper.vm.$t('logout')])
    expect(items[0].findComponent(QIcon).props('name')).toBe('fa fa-moon')
  })

  it('opens the profile page', async () => {
    const router = await mountHome()
    const items = await openUserMenu()
    await items[1].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/profile')
  })

  it('logs out from the menu', async () => {
    await mountHome()
    const destroy = vi.spyOn(UserService, 'destroyToken').mockImplementation(() => {})
    const items = await openUserMenu()
    await items[2].trigger('click')
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('switches to the dark mode and back from the menu (label, icon and background)', async () => {
    await mountHome()
    expect(wrapper.findComponent(QLayout).classes()).toContain('home-background')
    let items = await openUserMenu()
    await items[0].trigger('click')
    await flushPromises()
    expect(Dark.isActive).toBe(true)
    expect(localStorage.getItem('darkmodeEnabled')).toBe('y')
    expect(wrapper.findComponent(QLayout).classes()).not.toContain('home-background')
    items = await openUserMenu()
    expect(items[0].text()).toBe('Light-Mode')
    expect(items[0].findComponent(QIcon).props('name')).toBe('fa fa-sun')
    await items[0].trigger('click')
    expect(Dark.isActive).toBe(false)
    expect(localStorage.getItem('darkmodeEnabled')).toBeNull()
  })
})

describe('home layout proposals badge', () => {
  it('requests the count for the administrators (all permissions)', async () => {
    await mountHome({ roles: '*' })
    expect(VulnerabilityService.getProposalsCount).toHaveBeenCalledTimes(1)
    expect(wrapper.findComponent(QBadge).text()).toBe('4')
  })

  it('shows no badge when the count request fails', async () => {
    await mountHome({ roles: ['vulnerabilities:update'], count: () => Promise.reject({ response: { status: 500 } }) })
    expect(wrapper.findComponent(QBadge).exists()).toBe(false)
    expect(wrapper.find('.page').exists()).toBe(true)
  })

  it('keeps the last count when a refresh fails', async () => {
    const router = await mountHome({ roles: ['vulnerabilities:update'] })
    VulnerabilityService.getProposalsCount.mockRejectedValue(new Error('Network Error'))
    await router.push('/vulnerabilities')
    await flushPromises()
    expect(VulnerabilityService.getProposalsCount).toHaveBeenCalledTimes(2)
    expect(wrapper.findComponent(QBadge).text()).toBe('4')
  })

  it('refreshes the count once per navigation', async () => {
    const router = await mountHome({ roles: ['vulnerabilities:update'] })
    await router.push('/settings')
    await router.push('/profile')
    await flushPromises()
    expect(VulnerabilityService.getProposalsCount).toHaveBeenCalledTimes(3)
  })

  it('marks the active page in green', async () => {
    const router = await mountHome()
    const item = (path) => wrapper.findAllComponents(QItem).find((i) => i.props('to') === path)
    expect(item('/audits').classes()).toContain('text-green')
    await router.push('/settings')
    await flushPromises()
    expect(item('/settings').classes()).toContain('text-green')
    expect(item('/audits').classes()).not.toContain('text-green')
  })
})
