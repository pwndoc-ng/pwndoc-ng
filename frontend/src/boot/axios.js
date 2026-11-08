import { boot } from 'quasar/wrappers'
import axios from 'axios'
import User from '@/services/user'
import Router from '../router'

const api = axios.create({
  baseURL: `${window.location.origin}/api`
})

let refreshPending = false
let requestsQueue = [] // Requests received during the refresh of the token: {config, resolve, reject}

// Endpoints answering 401 for a reason other than an expired access token (wrong password, wrong TOTP code...):
// no refresh of the token. URLs of the services are relative ('users/token') or absolute ('/users/token').
const ENDPOINTS_WITHOUT_REFRESH = ['users/token', 'settings/public', 'users/totp', 'users/me']
const isEndpoint = (url, endpoint) => new RegExp(`(^|/)${endpoint}$`).test(String(url || '').split('?')[0])

// Request sent again after the refresh of the token (a second 401 is not refreshed again)
const retry = (config) => api.request({ ...config, _retried: true })

const settleQueue = (error) => {
  const queue = requestsQueue
  requestsQueue = []
  queue.forEach(request => error ? request.reject(error) : request.resolve(retry(request.config)))
}

// Expired access token (401): token refreshed, then the request is sent again. Redirect to login if the refresh fails.
api.interceptors.response.use(
  response => response,
  error => {
    if (!error.response || error.response.status !== 401) {
      return Promise.reject(error)
    }
    const originalRequest = error.config || {}

    // 401 of the refresh itself: session ended
    if (isEndpoint(originalRequest.url, 'users/refreshtoken')) {
      User.clear()
      return Promise.reject(error)
    }
    if (ENDPOINTS_WITHOUT_REFRESH.some(endpoint => isEndpoint(originalRequest.url, endpoint)) || originalRequest._retried) {
      return Promise.reject(error)
    }

    if (refreshPending) {
      return new Promise((resolve, reject) => {
        requestsQueue.push({ config: originalRequest, resolve, reject })
      })
    }
    refreshPending = true
    return api.get('/users/refreshtoken')
      .finally(() => {
        refreshPending = false
      })
      .then(() => {
        const replay = retry(originalRequest)
        settleQueue(null)
        return replay
      }, (refreshError) => {
        settleQueue(refreshError)
        Router.push('/login')
        return Promise.reject(refreshError)
      })
  }
)

export default boot(({ app }) => {
  // Inject axios globally
  app.config.globalProperties.$axios = api
})

export { api }