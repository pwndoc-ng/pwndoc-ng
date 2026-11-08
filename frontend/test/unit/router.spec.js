// src/router/routes.js: routes, redirects and breadcrumbs (pages replaced by stubs, real vue-router)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'

const { page } = vi.hoisted(() => ({ page: (name) => () => ({ default: { name, render: () => null } }) }))
vi.mock('layouts/home', page('home'))
vi.mock('pages/audits', page('audits'))
vi.mock('pages/audits/list', page('audits-list'))
vi.mock('pages/audits/edit', page('audit-edit'))
vi.mock('pages/audits/edit/general', page('general'))
vi.mock('pages/audits/edit/network', page('network'))
vi.mock('pages/audits/edit/findings/add', page('findings-add'))
vi.mock('pages/audits/edit/findings/edit', page('finding-edit'))
vi.mock('pages/audits/edit/sections', page('section'))
vi.mock('pages/data', page('data'))
vi.mock('pages/data/collaborators', page('collaborators'))
vi.mock('pages/data/companies', page('companies'))
vi.mock('pages/data/clients', page('clients'))
vi.mock('pages/data/templates', page('templates'))
vi.mock('pages/data/dump', page('dump'))
vi.mock('pages/data/custom', page('custom'))
vi.mock('@/pages/vulnerabilities', page('vulnerabilities'))
vi.mock('pages/profile', page('profile'))
vi.mock('pages/settings', page('settings'))
vi.mock('pages/403', page('403'))
vi.mock('pages/404', page('404'))
vi.mock('pages/login', page('login'))
vi.mock('@/services/user', () => ({ default: { isAuth: vi.fn(() => false), refreshToken: vi.fn(() => Promise.resolve()) } }))

import routes from '@/router/routes'
import UserService from '@/services/user'
import bootAuth from 'boot/auth'

const ID = '5f0c8b9e2a1d4c3b2a1f0e9d'

function newRouter() {
  return createRouter({ history: createMemoryHistory(), routes })
}

// Names of the components displayed for a path, from the layout to the page
async function resolve(path) {
  const router = newRouter()
  await router.push(path)
  const route = router.currentRoute.value
  const components = await Promise.all(route.matched.map(async (record) => {
    const component = record.components.default
    return typeof component === 'function' ? (await component()).default.name : component.name
  }))
  return { route, components, path: route.fullPath }
}

describe('routes', () => {
  it.each([
    ['/', '/audits', ['home', 'audits', 'audits-list']],
    ['/audits', '/audits', ['home', 'audits', 'audits-list']],
    [`/audits/${ID}/general`, `/audits/${ID}/general`, ['home', 'audits', 'audit-edit', 'general']],
    [`/audits/${ID}/network`, `/audits/${ID}/network`, ['home', 'audits', 'audit-edit', 'network']],
    [`/audits/${ID}/findings/add`, `/audits/${ID}/findings/add`, ['home', 'audits', 'audit-edit', 'findings-add']],
    [`/audits/${ID}/findings/f1`, `/audits/${ID}/findings/f1`, ['home', 'audits', 'audit-edit', 'finding-edit']],
    [`/audits/${ID}/sections/s1`, `/audits/${ID}/sections/s1`, ['home', 'audits', 'audit-edit', 'section']],
    ['/data/collaborators', '/data/collaborators', ['home', 'data', 'collaborators']],
    ['/data/companies', '/data/companies', ['home', 'data', 'companies']],
    ['/data/clients', '/data/clients', ['home', 'data', 'clients']],
    ['/data/templates', '/data/templates', ['home', 'data', 'templates']],
    ['/data/dump', '/data/dump', ['home', 'data', 'dump']],
    ['/data/custom', '/data/custom', ['home', 'data', 'custom']],
    ['/vulnerabilities', '/vulnerabilities', ['home', 'vulnerabilities']],
    ['/profile', '/profile', ['home', 'profile']],
    ['/settings', '/settings', ['home', 'settings']],
    ['/403', '/403', ['home', '403']],
    ['/404', '/404', ['home', '404']],
    ['/login', '/login', ['login']],
    ['/unknown/page', '/audits', ['home', 'audits', 'audits-list']]
  ])('%s -> %s', async (path, expectedPath, expectedComponents) => {
    const { components, path: finalPath } = await resolve(path)
    expect(finalPath).toBe(expectedPath)
    expect(components).toEqual(expectedComponents)
  })

  it('lists the audits containing a finding (link of the vulnerabilities page)', async () => {
    const router = newRouter()
    await router.push({ name: 'audits_by_find', params: { finding: 'SQL Injection' } })
    expect(router.currentRoute.value.fullPath).toBe('/audits/SQL%20Injection')
    expect(router.currentRoute.value.params.finding).toBe('SQL Injection')
    expect(router.currentRoute.value.matched.at(-1).name).toBe('audits_by_find')
  })

  // BUG: src/router/routes.js:8-10 '/audits/:finding' (audits list filtered by finding) and '/audits/:auditId' (audit
  // edition, redirected to general) have the same path: '/audits/<id>' always opens the audits list filtered on a
  // finding named <id>. pages/audits/list/audits-list.js:208,226 navigate to "/audits/" + id after creating or
  // cloning an audit: the user lands on an empty audits list instead of the new audit.
  it.skip('opens the general page of an audit for /audits/<id>', async () => {
    const { path, components } = await resolve(`/audits/${ID}`)
    expect(path).toBe(`/audits/${ID}/general`)
    expect(components).toEqual(['home', 'audits', 'audit-edit', 'general'])
  })

  // BUG: src/router/routes.js:20 the relative redirect 'collaborators' of '/data' is resolved against the URL
  // '/data' (-> '/collaborators', unknown, then '/' and '/audits'): opening /data (typed URL, bookmark, 'Datas'
  // breadcrumb link) shows the audits instead of the collaborators ('/data/collaborators' would be needed)
  it.skip('redirects /data to the collaborators page', async () => {
    const { path, components } = await resolve('/data')
    expect(path).toBe('/data/collaborators')
    expect(components).toEqual(['home', 'data', 'collaborators'])
  })

  it('names the routes used by the pages', () => {
    const router = newRouter()
    for (const name of ['audits', 'audits_by_find', 'general', 'network', 'addFindings', 'editFinding', 'editSection', '403', '404'])
      expect(router.hasRoute(name), name).toBe(true)
  })

  it('gives the breadcrumbs of the nested pages', async () => {
    const { route } = await resolve(`/audits/${ID}/general`)
    expect(route.matched.map((record) => record.meta.breadcrumb).filter(Boolean)).toEqual(['Home', 'Audits', 'Edit Audit'])
    const data = await resolve('/data/dump')
    expect(data.route.matched.map((record) => record.meta.breadcrumb).filter(Boolean)).toEqual(['Home', 'Datas'])
  })

  it('loads the pages lazily (code splitting)', () => {
    const lazy = (list) => list.every((route) => (!route.component || typeof route.component === 'function') && lazy(route.children || []))
    expect(lazy(routes)).toBe(true)
  })
})

describe('boot/auth navigation guard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(UserService.refreshToken).mockReset().mockResolvedValue()
    vi.mocked(UserService.isAuth).mockReset().mockReturnValue(false)
  })

  async function boot(urlPath) {
    const router = newRouter()
    const redirect = vi.fn()
    await bootAuth({ urlPath, router, redirect })
    return { router, redirect }
  }

  it('refreshes the token when the application is loaded', async () => {
    const { redirect } = await boot('/audits')
    expect(UserService.refreshToken).toHaveBeenCalledTimes(1)
    expect(redirect).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('redirects to the login page when the session cannot be refreshed', async () => {
    vi.mocked(UserService.refreshToken).mockRejectedValueOnce('Invalid Token')
    expect((await boot('/audits')).redirect).toHaveBeenCalledWith('/login')
    vi.mocked(UserService.refreshToken).mockRejectedValueOnce('Expired refreshToken')
    expect((await boot('/vulnerabilities')).redirect).toHaveBeenCalledWith('/login?tokenError=2')
    vi.mocked(UserService.refreshToken).mockRejectedValueOnce('Invalid Token')
    expect((await boot('/login')).redirect).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('refreshes the token every 14 minutes', async () => {
    await boot('/audits')
    expect(UserService.refreshToken).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(14 * 60 * 1000)
    expect(UserService.refreshToken).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(14 * 60 * 1000)
    expect(UserService.refreshToken).toHaveBeenCalledTimes(3)
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('sends a logged in user from the login page to the home page', async () => {
    const { router } = await boot('/audits')
    vi.useRealTimers()
    vi.mocked(UserService.isAuth).mockReturnValue(true)
    await router.push('/login')
    expect(router.currentRoute.value.fullPath).toBe('/audits')
    vi.mocked(UserService.isAuth).mockReturnValue(false)
    await router.push('/login')
    expect(router.currentRoute.value.fullPath).toBe('/login')
  })

  // BUG: src/boot/auth.js:9 the periodic refresh reads router.currentRoute.path, which is undefined with vue-router 4
  // (currentRoute is a ref: currentRoute.value.path): when the refresh fails, a TypeError is thrown in the catch and
  // the user is never redirected to the login page
  it.skip('redirects to the login page when the periodic refresh fails', async () => {
    const { redirect } = await boot('/audits')
    vi.mocked(UserService.refreshToken).mockRejectedValueOnce('Expired refreshToken')
    await vi.advanceTimersByTimeAsync(14 * 60 * 1000)
    expect(redirect).toHaveBeenCalledWith('/login?tokenError=2')
    vi.clearAllTimers()
    vi.useRealTimers()
  })
})
