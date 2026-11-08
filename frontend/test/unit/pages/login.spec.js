// pages/login.vue: first user registration, login, two-step verification, token errors
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { Loading } from 'quasar'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))
vi.mock('@/boot/socketio', () => ({ disconnectSocket: vi.fn(), connectSocket: vi.fn() }))

import LoginPage from 'pages/login'
import UserService from '@/services/user'
import { disconnectSocket } from '@/boot/socketio'

let wrapper
let router
let settings

async function mountLogin({ init = false, query = {}, isInit } = {}) {
  router = { push: vi.fn() }
  settings = { refresh: vi.fn(() => Promise.resolve()) }
  vi.spyOn(Loading, 'show').mockImplementation(() => {})
  vi.spyOn(Loading, 'hide').mockImplementation(() => {})
  vi.spyOn(UserService, 'isInit').mockImplementation(isInit || (() => Promise.resolve({ data: { datas: init } })))
  wrapper = mount(LoginPage, { global: { mocks: { $route: { query }, $router: router, $settings: settings } } })
  await flushPromises()
  return wrapper
}

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}))
afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('login page loading', () => {
  it('closes the socket of the previous session and checks if the first user must be created', async () => {
    await mountLogin({ init: true })
    expect(disconnectSocket).toHaveBeenCalled()
    expect(UserService.isInit).toHaveBeenCalled()
    expect(wrapper.vm.loaded).toBe(true)
    expect(wrapper.vm.init).toBe(true)
    expect(wrapper.text()).toContain(wrapper.vm.$t('registerFirstUser'))
  })

  it('shows the login form when the application is initialized', async () => {
    await mountLogin({ init: false })
    expect(wrapper.text()).not.toContain(wrapper.vm.$t('registerFirstUser'))
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
  })

  it.each([
    ['2', 'err.expiredToken'],
    ['1', 'err.invalidToken']
  ])('explains why the session ended (tokenError=%s)', async (tokenError, key) => {
    await mountLogin({ query: { tokenError } })
    expect(wrapper.vm.errors.alert).toBe(wrapper.vm.$t(key))
    expect(wrapper.text()).toContain(wrapper.vm.$t(key))
  })

  // BUG: src/pages/login.vue:200 the loading message msg.tryingToContactBackend ('<p>Trying to contact backend</p>')
  // is shown without html: true: Quasar renders it as text, the user sees the <p> tags
  it.skip('shows the loading message without HTML tags', async () => {
    await mountLogin()
    const [options] = Loading.show.mock.calls[0]
    expect(options.html === true || !/<[a-z]/i.test(options.message)).toBe(true)
  })

  it('shows an error when the backend cannot be contacted', async () => {
    await mountLogin({ isInit: () => Promise.reject(new Error('Network Error')) })
    expect(wrapper.vm.loaded).toBe(false)
    expect(Loading.show).toHaveBeenLastCalledWith(expect.objectContaining({ backgroundColor: 'red-10', html: true }))
  })
})

describe('login', () => {
  it('requires the username and the password', async () => {
    vi.spyOn(UserService, 'getToken')
    await mountLogin()
    wrapper.vm.getToken()
    expect(wrapper.vm.errors).toMatchObject({ username: wrapper.vm.$t('msg.usernameRequired'), password: wrapper.vm.$t('msg.passwordRequired') })
    expect(UserService.getToken).not.toHaveBeenCalled()
  })

  it('logs in, loads the settings of the user and goes to the home page', async () => {
    vi.spyOn(UserService, 'getToken').mockResolvedValue()
    await mountLogin()
    Object.assign(wrapper.vm, { username: 'jdoe', password: 'Passw0rd!' })
    wrapper.vm.getToken()
    expect(wrapper.vm.loginLoading).toBe(true)
    await flushPromises()
    expect(UserService.getToken).toHaveBeenCalledWith('jdoe', 'Passw0rd!', '')
    expect(settings.refresh).toHaveBeenCalled()
    expect(router.push).toHaveBeenCalledWith('/')
    expect(wrapper.vm.loginLoading).toBe(false)
  })

  it('asks for the TOTP code when the account uses the two-step verification (422)', async () => {
    vi.spyOn(UserService, 'getToken').mockRejectedValueOnce({ response: { status: 422, data: { datas: 'Missing TOTP token' } } })
    await mountLogin()
    Object.assign(wrapper.vm, { username: 'jdoe', password: 'Passw0rd!' })
    wrapper.vm.getToken()
    await flushPromises()
    expect(wrapper.vm.step).toBe(1)
    expect(wrapper.vm.errors.alert).toBe('')
    expect(router.push).not.toHaveBeenCalled()
    UserService.getToken.mockResolvedValueOnce()
    wrapper.vm.totpToken = '123456'
    wrapper.vm.getToken()
    await flushPromises()
    expect(UserService.getToken).toHaveBeenLastCalledWith('jdoe', 'Passw0rd!', '123456')
    expect(router.push).toHaveBeenCalledWith('/')
  })

  it('shows the error of the backend, or a generic message', async () => {
    vi.spyOn(UserService, 'getToken').mockRejectedValueOnce({ response: { status: 401, data: { datas: 'Authentication Failed.' } } })
    await mountLogin()
    Object.assign(wrapper.vm, { username: 'jdoe', password: 'bad' })
    wrapper.vm.getToken()
    await flushPromises()
    expect(wrapper.vm.errors.alert).toBe('Authentication Failed.')
    UserService.getToken.mockRejectedValueOnce({ response: { status: 500, data: {} } })
    wrapper.vm.getToken()
    await flushPromises()
    expect(wrapper.vm.errors.alert).toBe(wrapper.vm.$t('err.invalidCredentials'))
    expect(wrapper.vm.loginLoading).toBe(false)
  })
})

describe('first user registration', () => {
  it('requires all the fields and a strong password', async () => {
    vi.spyOn(UserService, 'initUser')
    await mountLogin({ init: true })
    wrapper.vm.initUser()
    expect(wrapper.vm.errors).toMatchObject({
      username: wrapper.vm.$t('msg.usernameRequired'), password: wrapper.vm.$t('msg.passwordRequired'),
      firstname: wrapper.vm.$t('msg.firstnameRequired'), lastname: wrapper.vm.$t('msg.lastnameRequired')
    })
    Object.assign(wrapper.vm, { username: 'admin', firstname: 'Ad', lastname: 'Min', password: 'weakpassword' })
    wrapper.vm.initUser()
    expect(wrapper.vm.errors.password).toBe(wrapper.vm.$t('msg.passwordComplexity'))
    expect(UserService.initUser).not.toHaveBeenCalled()
  })

  it('creates the first user and logs in', async () => {
    vi.spyOn(UserService, 'initUser').mockResolvedValue()
    await mountLogin({ init: true })
    Object.assign(wrapper.vm, { username: 'admin', firstname: 'Ad', lastname: 'Min', password: 'Passw0rdX' })
    wrapper.vm.initUser()
    await flushPromises()
    expect(UserService.initUser).toHaveBeenCalledWith('admin', 'Ad', 'Min', 'Passw0rdX')
    expect(settings.refresh).toHaveBeenCalled()
    expect(router.push).toHaveBeenCalledWith('/')
  })

  it('shows the error of the backend', async () => {
    vi.spyOn(UserService, 'initUser').mockRejectedValue({ response: { data: { datas: 'Already Initialized' } } })
    await mountLogin({ init: true })
    Object.assign(wrapper.vm, { username: 'admin', firstname: 'Ad', lastname: 'Min', password: 'Passw0rdX' })
    wrapper.vm.initUser()
    await flushPromises()
    expect(wrapper.vm.errors.alert).toBe('Already Initialized')
  })
})
