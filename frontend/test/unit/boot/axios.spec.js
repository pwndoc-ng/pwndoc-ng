// boot/axios.js: axios instance of the API and handling of the expired access tokens (401 responses)
// The real instance is used with a fake adapter: no network request.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AxiosError } from 'axios'

vi.mock('@/services/user', () => ({ default: { clear: vi.fn() } }))
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

import { api } from 'boot/axios'
import bootAxios from 'boot/axios'
import User from '@/services/user'
import Router from '@/router'

// Responses of the fake backend: {url: [status of the 1st call, status of the 2nd call...]} (200 when not given)
let statuses
let requests

function adapter(config) {
  requests.push(`${config.method.toUpperCase()} ${config.url}`)
  const queue = statuses[config.url] || []
  const status = queue.length ? queue.shift() : 200
  if (status === 'network')
    return Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config))
  const response = { data: { status: status === 200 ? 'success' : 'error', datas: `${status} ${config.url}` }, status, statusText: String(status), headers: {}, config }
  if (status >= 200 && status < 300) return Promise.resolve(response)
  return Promise.reject(new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, null, response))
}

beforeEach(() => {
  statuses = {}
  requests = []
  api.defaults.adapter = adapter
  vi.mocked(User.clear).mockClear()
  vi.mocked(Router.push).mockClear()
})

describe('boot/axios instance', () => {
  it('targets the /api path of the current origin', () => {
    expect(api.defaults.baseURL).toBe(`${window.location.origin}/api`)
  })

  it('exposes the instance as $axios', () => {
    const app = { config: { globalProperties: {} } }
    bootAxios({ app })
    expect(app.config.globalProperties.$axios).toBe(api)
  })

  it('returns the successful responses', async () => {
    const response = await api.get('audits')
    expect(response.data.datas).toBe('200 audits')
    expect(requests).toEqual(['GET audits'])
  })

  it('rejects the network errors without refreshing the token', async () => {
    statuses['audits'] = ['network']
    await expect(api.get('audits')).rejects.toThrow('Network Error')
    expect(requests).toEqual(['GET audits'])
  })

  it('rejects the other errors as is', async () => {
    statuses['audits/a1'] = [404]
    await expect(api.get('audits/a1')).rejects.toMatchObject({ response: { status: 404 } })
    expect(requests).toEqual(['GET audits/a1'])
  })
})

describe('boot/axios expired access token (401)', () => {
  it('refreshes the token and replays the requests received during the refresh', async () => {
    statuses['audits'] = [401]
    statuses['vulnerabilities'] = [401]
    const first = api.get('audits')
    const second = api.get('vulnerabilities')
    const response = await second
    await first
    expect(response.data.datas).toBe('200 vulnerabilities')
    expect(requests).toEqual(['GET audits', 'GET vulnerabilities', 'GET /users/refreshtoken', 'GET vulnerabilities'])
    expect(Router.push).not.toHaveBeenCalled()
  })

  // BUG: src/boot/axios.js:56-69 the request whose 401 starts the token refresh is never replayed: its promise
  // resolves with undefined, so the caller gets no data (TypeError on response.data) or treats it as a success
  it.skip('replays the request which started the refresh', async () => {
    statuses['audits'] = [401]
    const response = await api.get('audits')
    expect(response && response.data.datas).toBe('200 audits')
    expect(requests).toEqual(['GET audits', 'GET /users/refreshtoken', 'GET audits'])
  })

  it('clears the user and goes to the login page when the refresh fails', async () => {
    statuses['audits'] = [401]
    statuses['/users/refreshtoken'] = [401]
    await expect(api.get('audits')).rejects.toMatchObject({ response: { status: 401 } })
    expect(User.clear).toHaveBeenCalledTimes(1)
    expect(Router.push).toHaveBeenCalledWith('/login')
    expect(requests).toEqual(['GET audits', 'GET /users/refreshtoken'])
  })

  // BUG: src/boot/axios.js:63-73 when the refresh fails, the requests queued during the refresh are never settled
  // (requestsQueue is not rejected nor cleared): their callers wait forever (e.g. loading spinners never stop)
  it.skip('settles the requests queued during a failed refresh', async () => {
    statuses['audits'] = [401]
    statuses['vulnerabilities'] = [401]
    statuses['/users/refreshtoken'] = [401]
    const first = api.get('audits').catch((err) => err)
    const second = api.get('vulnerabilities').then(() => 'resolved', () => 'rejected')
    await first
    const result = await Promise.race([second, new Promise((resolve) => setTimeout(() => resolve('pending'), 50))])
    expect(result).not.toBe('pending')
  })

  it.each(['/users/refreshtoken', '/users/token', '/settings/public', '/users/totp', '/users/me'])(
    'does not refresh the token for the 401 of %s (URL with a leading slash)', async (url) => {
      statuses[url] = [401]
      await expect(api.get(url)).rejects.toMatchObject({ response: { status: 401 } })
      expect(requests).toEqual([`GET ${url}`])
      expect(User.clear).toHaveBeenCalledTimes(url === '/users/refreshtoken' ? 1 : 0)
    })

  // BUG: src/boot/axios.js:27-50 the 401 exceptions test url.endsWith('/users/...') but the services call relative
  // URLs without leading slash ('users/token', 'users/me', 'users/totp', 'settings/public', 'users/refreshtoken'):
  // - wrong password on the login page: a token refresh is attempted, it fails, and the login page shows the error of
  //   the refresh ("Invalid refreshToken"...) instead of the login error, and redirects to /login
  // - wrong current password when updating the profile (PUT users/me -> 401): the refresh succeeds and, the request
  //   not being replayed, the promise resolves with undefined: the profile page notifies a successful update
  // - wrong TOTP code (users/totp -> 401): same problem as the profile
  it.skip.each(['users/token', 'users/me', 'users/totp', 'settings/public', 'users/refreshtoken'])(
    'does not refresh the token for the 401 of %s (URLs used by the services)', async (url) => {
      statuses[url] = [401]
      await expect(api.post(url, {})).rejects.toMatchObject({ response: { status: 401, data: { datas: `401 ${url}` } } })
      expect(requests).toEqual([`POST ${url}`])
    })
})
