// Hurried user: clicks chained at a human pace, double clicks, slowed network, JavaScript errors of the pages
const { expect } = require('@playwright/test')
const D = require('./data')
const { apiAs, datas } = require('./helpers')

// Pace of a hurried user: clicks chained every 80 to 150 ms, a double click is about 100 ms between the two clicks
const PACE = { min: 80, max: 150, double: 100 }
const pause = (page, min = PACE.min, max = PACE.max) => page.waitForTimeout(min + Math.round(Math.random() * (max - min)))

// Run identifier: names of the data created by this spec are unique (spec run several times on the same instance)
const RUN = Date.now().toString(36).slice(-5)

// Text of an HTML value (as shown by an editor: one line per paragraph is not needed, the text is compared)
const textOf = html => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()

// ---------------------------------------------------------------------------------------------------------------
// JavaScript errors of a page: unhandled errors (pageerror) fail the test. Console errors are split: network errors
// (requests aborted by a fast navigation, refused requests) are expected and only noted, the other ones (TypeError
// logged by Vue in production...) are checked like the unhandled errors.
// ---------------------------------------------------------------------------------------------------------------
const NETWORK_ERROR = /Failed to load resource|net::ERR_|status of [45]\d\d|AxiosError|Request (failed|aborted)|Network Error|WebSocket|ECONNABORTED|canceled|Wait websocket/i

function watchErrors (page, label = 'page') {
  const watcher = { label, pageErrors: [], consoleErrors: [], networkErrors: [], failedRequests: [], stacks: {} }
  page.on('pageerror', error => {
    const message = `${error.name}: ${error.message}`
    watcher.pageErrors.push(message)
    watcher.stacks[message] = watcher.stacks[message] || error.stack
  })
  page.on('console', message => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (NETWORK_ERROR.test(text)) watcher.networkErrors.push(text)
    else watcher.consoleErrors.push(text)
  })
  page.on('requestfailed', request => {
    watcher.failedRequests.push(`${request.method()} ${new URL(request.url()).pathname} ${request.failure() ? request.failure().errorText : ''}`)
  })
  return watcher
}

// Network errors noted in the report (annotations), JavaScript errors checked (except the ones matching `ignore`, a
// list of regexps, only noted).
function checkErrors (watcher, testInfo, { ignore = [] } = {}) {
  const noted = [...new Set([...watcher.networkErrors, ...watcher.failedRequests])]
  if (noted.length) {
    testInfo.annotations.push({ type: `expected network errors (${watcher.label})`, description: noted.slice(0, 15).join(' | ') })
  }
  for (const [message, stack] of Object.entries(watcher.stacks)) {
    const count = watcher.pageErrors.filter(m => m === message).length
    testInfo.annotations.push({ type: `JavaScript error x${count} (${watcher.label})`, description: (stack || message).split('\n').slice(0, 6).join(' <- ') })
  }
  const known = message => ignore.some(regexp => regexp.test(message))
  expect([...new Set(watcher.pageErrors)].filter(m => !known(m)), `unhandled JavaScript errors (${watcher.label})`).toEqual([])
  expect(watcher.consoleErrors.filter(m => !known(m)), `JavaScript errors logged in the console (${watcher.label})`).toEqual([])
}

// ---------------------------------------------------------------------------------------------------------------
// Clicks at a human pace
// ---------------------------------------------------------------------------------------------------------------

// Click then a short pause, without waiting for the loading of what the click opens
async function hurriedClick (page, locator) {
  await locator.click({ delay: 20 })
  await pause(page)
}

// Clicks at the same place of the screen (the element may disappear after the first one, like for a real user)
async function clicksAt (page, locator, count, interval = PACE.double) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  expect(box, 'element to click').toBeTruthy()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  for (let i = 0; i < count; i++) {
    if (i) await page.waitForTimeout(interval - 30)
    // One press per click (mouse.click with clickCount 2 would press twice). Second click of a pair: detail 2, the
    // browser also sends a dblclick event, like for a real double click
    const clickCount = i % 2 === 1 ? 2 : 1
    await page.mouse.down({ clickCount })
    await page.waitForTimeout(30)
    await page.mouse.up({ clickCount })
  }
}

const doubleClick = (page, locator) => clicksAt(page, locator, 2)

// ---------------------------------------------------------------------------------------------------------------
// Slowed network
// ---------------------------------------------------------------------------------------------------------------

// Websocket of the collaborative editors (/collab) slowed down: each message delayed in both directions (order kept)
async function slowCollab (page, delay) {
  await page.routeWebSocket(/\/collab\/?$/, ws => {
    const server = ws.connectToServer()
    const later = send => setTimeout(() => { try { send() } catch (e) { /* closed meanwhile */ } }, delay)
    ws.onMessage(message => later(() => server.send(message)))
    server.onMessage(message => later(() => ws.send(message)))
  })
}

// API requests matching the method and the path delayed (slow server or network)
async function slowApi (page, method, pathRegexp, delay) {
  await page.route(url => pathRegexp.test(url.pathname), async route => {
    if (route.request().method() !== method) return route.fallback()
    await new Promise(resolve => setTimeout(resolve, delay))
    await route.fallback()
  })
}

// Requests sent by the page (method and path), counted from now on
function countRequests (page, method, pathRegexp) {
  const sent = []
  page.on('request', request => {
    if (request.method() === method && pathRegexp.test(new URL(request.url()).pathname)) sent.push(safeJson(request))
  })
  return sent
}

function safeJson (request) {
  try { return request.postDataJSON() } catch (e) { return null }
}

// ---------------------------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------------------------

// Session of a user in the browser context of the page (token cookies), faster than the login form
async function login (page, user) {
  const response = await page.request.post('/api/users/token', { data: { username: user.username, password: user.password } })
  expect(response.ok(), `login of ${user.username}`).toBeTruthy()
}

// Audit of the pentester with findings (title, description, observation), its reviewer set. Returns its identifier
// and its findings as stored.
async function createAudit (name, findings = [], { reviewer = true } = {}) {
  const api = await apiAs(D.USERS.pentester)
  const response = await api.post('/api/audits', { data: { name, language: 'en', auditType: D.AUDIT_TYPE.name, type: 'default' } })
  expect(response.ok(), await response.text()).toBeTruthy()
  const auditId = (await datas(response)).audit._id
  for (const finding of findings) {
    const created = await api.post(`/api/audits/${auditId}/findings`, { data: finding })
    expect(created.ok(), await created.text()).toBeTruthy()
  }
  if (reviewer) {
    const users = await datas(await api.get('/api/users'))
    const reviewerId = users.find(u => u.username === D.USERS.reviewer.username)._id
    expect((await api.put(`/api/audits/${auditId}/general`, { data: { reviewers: [{ _id: reviewerId }] } })).ok()).toBeTruthy()
  }
  const audit = await datas(await api.get(`/api/audits/${auditId}`))
  await api.dispose()
  return { auditId, findings: audit.findings }
}

async function getAudit (auditId, user = D.USERS.pentester) {
  const api = await apiAs(user)
  const audit = await datas(await api.get(`/api/audits/${auditId}`))
  await api.dispose()
  return audit
}

async function getGeneral (auditId, user = D.USERS.pentester) {
  const api = await apiAs(user)
  const general = await datas(await api.get(`/api/audits/${auditId}/general`))
  await api.dispose()
  return general
}

module.exports = {
  PACE, RUN, pause, textOf,
  watchErrors, checkErrors,
  hurriedClick, clicksAt, doubleClick,
  slowCollab, slowApi, countRequests,
  login, createAudit, getAudit, getGeneral
}
