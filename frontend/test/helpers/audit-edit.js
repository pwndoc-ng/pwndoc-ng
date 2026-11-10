// Helpers of the tests of the audit edit pages (pages/audits/edit/*)
import fs from 'node:fs'
import path from 'node:path'
import { vi } from 'vitest'
import _ from 'lodash'

import { FRONTEND_DIR } from './source'

// Globals of the application: lodash (set by its AMD build under webpack) and the CVSS calculator of FIRST
// (public/js/cvsscalc31.js loaded by index.html)
export function installAppGlobals() {
  globalThis._ = _
  if (!globalThis.CVSS31) {
    const code = fs.readFileSync(path.join(FRONTEND_DIR, 'public/js/cvsscalc31.js'), 'utf8')
    globalThis.CVSS31 = new Function(`${code}\nreturn CVSS31`)()
  }
}

// Fake socket.io client (this.$socket): handlers registered with on() can be triggered by the tests
export function fakeSocket() {
  const handlers = {}
  const socket = {
    handlers,
    emit: vi.fn(),
    on: vi.fn((event, handler) => { handlers[event] = handler; return socket }),
    off: vi.fn((event) => { delete handlers[event]; return socket }),
    trigger: (event, ...args) => handlers[event] && handlers[event](...args)
  }
  return socket
}

// Public settings (this.$settings)
export function settings({ reviews = true, minReviewers = 1, blockApprovalWithOpenComments = false, report } = {}) {
  const result = { reviews: { enabled: reviews, public: { minReviewers, blockApprovalWithOpenComments } } }
  if (report) result.report = { public: report }
  return result
}

// this.$route of a page of the audit (breadcrumb reads route.matched)
export function route(name, params = {}) {
  return { name, params: { auditId: 'a1', ...params }, matched: [], path: `/audits/${params.auditId || 'a1'}/${name}`, fullPath: '' }
}

// Ctrl+S (Cmd+S on Mac) in the page
export function pressSave({ meta = false, ctrl = !meta } = {}) {
  const event = new KeyboardEvent('keydown', { ctrlKey: ctrl, metaKey: meta, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'keyCode', { value: 83 })
  document.dispatchEvent(event)
  return event
}

// Axios like error of the API
export const apiError = (status, datas) => ({ response: { status, data: { datas } } })

// Resolved API answer
export const ok = (datas) => Promise.resolve({ data: { datas } })

// Answer of the API controlled by the test: d.resolve(datas) / d.reject(error), in any order
export function deferred() {
  const d = {}
  d.promise = new Promise((resolve, reject) => {
    d.resolve = (datas) => resolve({ data: { datas } })
    d.reject = reject
  })
  return d
}

// Each call of the method returns a new pending answer (calls[i].args: arguments of the call, calls[i].sent: copy of
// the arguments at the time of the call, as serialized in the request)
export function controlled(service, method) {
  const calls = []
  vi.spyOn(service, method).mockImplementation((...args) => {
    const d = deferred()
    d.args = args
    d.sent = JSON.parse(JSON.stringify(args))
    calls.push(d)
    return d.promise
  })
  return calls
}
