// services/user.js: authentication tokens (JWT decoded from the API responses) and permissions
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import { api, resetApi } from '../../helpers/api-mock'
import Router from '@/router'
import UserService from '@/services/user'

// Unsigned JWT with the given payload (the frontend only decodes it, the signature is checked by the backend)
function jwt(payload) {
  const encode = (object) => Buffer.from(JSON.stringify(object)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`
}

const PAYLOAD = { id: 'u1', username: 'jdoe', role: 'user', firstname: 'John', lastname: 'Doé', roles: ['audits:read', 'audits:create'], exp: 9999999999 }

describe('UserService tokens', () => {
  beforeEach(() => {
    resetApi()
    UserService.clear()
    vi.mocked(Router.push).mockClear()
  })

  it('logs in: sends the credentials and decodes the token of the response', async () => {
    api.post.mockResolvedValueOnce({ data: { datas: { token: jwt(PAYLOAD) } } })
    await UserService.getToken('jdoe', 'Passw0rd!', '123456')
    expect(api.post).toHaveBeenCalledWith('users/token', { username: 'jdoe', password: 'Passw0rd!', totpToken: '123456' })
    expect(UserService.user).toMatchObject({ id: 'u1', username: 'jdoe', lastname: 'Doé', roles: ['audits:read', 'audits:create'] })
    expect(UserService.isAuth()).toBe(true)
  })

  it('rejects the login with the error of the request (user stays logged out)', async () => {
    const error = { response: { status: 401, data: { datas: 'Invalid credentials' } } }
    api.post.mockRejectedValueOnce(error)
    await expect(UserService.getToken('jdoe', 'bad')).rejects.toBe(error)
    expect(UserService.isAuth()).toBe(false)
  })

  it('refreshes the token (cookie sent by the browser) and updates the user', async () => {
    api.get.mockResolvedValueOnce({ data: { datas: { token: jwt({ ...PAYLOAD, roles: '*' }) } } })
    await UserService.refreshToken()
    expect(api.get).toHaveBeenCalledWith('users/refreshtoken')
    expect(UserService.user.roles).toBe('*')
  })

  it('rejects the refresh with the message of the backend or "Invalid Token"', async () => {
    api.get.mockRejectedValueOnce({ response: { status: 401, data: { datas: 'Expired refreshToken' } } })
    await expect(UserService.refreshToken()).rejects.toBe('Expired refreshToken')
    api.get.mockRejectedValueOnce(new Error('Network Error'))
    await expect(UserService.refreshToken()).rejects.toBe('Invalid Token')
  })

  it('initializes the first user and logs it in', async () => {
    api.post.mockResolvedValueOnce({ data: { datas: { token: jwt({ ...PAYLOAD, role: 'admin' }) } } })
    await UserService.initUser('admin', 'Ad', 'Min', 'Passw0rd!')
    expect(api.post).toHaveBeenCalledWith('users/init', { username: 'admin', password: 'Passw0rd!', firstname: 'Ad', lastname: 'Min' })
    expect(UserService.user.role).toBe('admin')
  })

  it('logs out: deletes the refresh token, clears the user and goes to the login page', async () => {
    UserService.user = { ...PAYLOAD }
    api.delete.mockResolvedValueOnce({})
    UserService.destroyToken()
    await vi.waitFor(() => expect(Router.push).toHaveBeenCalledWith('/login'))
    expect(api.delete).toHaveBeenCalledWith('users/refreshtoken')
    expect(UserService.isAuth()).toBe(false)
  })

  it('stays logged in when the logout request fails', async () => {
    UserService.user = { ...PAYLOAD }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    api.delete.mockRejectedValueOnce(new Error('Network Error'))
    UserService.destroyToken()
    await vi.waitFor(() => expect(log).toHaveBeenCalled())
    expect(UserService.isAuth()).toBe(true)
    expect(Router.push).not.toHaveBeenCalled()
  })

  it('clears the user', () => {
    UserService.user = { ...PAYLOAD }
    UserService.clear()
    expect(UserService.user).toEqual({ username: '', role: '', firstname: '', lastname: '', roles: '' })
    expect(UserService.isAuth()).toBe(false)
  })
})

describe('UserService.isAllowed', () => {
  it('allows the permissions of the roles of the user', () => {
    UserService.user = { username: 'u', roles: ['audits:read', 'backups:read'] }
    expect(UserService.isAllowed('audits:read')).toBe(true)
    expect(UserService.isAllowed('backups:read')).toBe(true)
    expect(UserService.isAllowed('backups:restore')).toBe(false)
    expect(UserService.isAllowed('audits:read-all')).toBe(false)
  })

  it('allows everything to the admin role (*)', () => {
    UserService.user = { username: 'admin', roles: '*' }
    for (const permission of ['backups:restore', 'audits:update-all', 'vulnerabilities:delete'])
      expect(UserService.isAllowed(permission)).toBe(true)
  })

  it('allows nothing when logged out', () => {
    UserService.clear()
    expect(UserService.isAllowed('audits:read')).toBeFalsy()
    UserService.user = { username: 'u' }
    expect(UserService.isAllowed('audits:read')).toBeFalsy()
  })
})
