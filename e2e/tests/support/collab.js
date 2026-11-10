// Collaboration under degraded network conditions: control of the collaboration websocket (/collab/, Hocuspocus) of a
// browser context, network throttling (CDP), finding seeding and state of the TipTap editors
const { expect } = require('@playwright/test')
const D = require('./data')
const { qInput, editorContent, apiAs, datas, ensureBaseData, ensureAudit, press, type } = require('./helpers')

const NETWORK_AUDIT = 'E2E Network Audit'
// Third user of the collaboration tests (created through the API)
const PENTESTER3 = { username: 'e2e-pentester3', password: 'E2e-Pentest3-2026', firstname: 'Max', lastname: 'Third', role: 'user' }

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------------------------------------------
// Collaboration websocket of a browser context (routeWebSocket): the page side and the server side are connected by
// the test, which can delay the messages (order kept), cut the connections and refuse the new ones.
//   online   messages forwarded, after `latency` ms in each direction (+ `serverDelay` ms from the server)
//   offline  open connections closed, new connections closed at once (network unreachable)
//   hang     new connections accepted by the test but never connected to the server: open, no answer
// Each editor of a page has its own websocket (Hocuspocus provider), on the document of the audit.
// ---------------------------------------------------------------------------------------------------------------
class CollabLink {
  constructor () {
    this.mode = 'online'
    this.latency = 0
    this.serverDelay = 0
    this.links = new Set()
    this.connected = 0 // Connections forwarded to the server
    this.cutAfter = null // Connections opened from now on: cut after this number of messages of the server
    this.cutPlan = [] // Next connections: each one cut after the number of messages of the server taken from this list
  }

  async install (context) {
    await context.routeWebSocket(/\/collab\/?(\?.*)?$/, ws => this.handle(ws))
    return this
  }

  handle (ws) {
    if (this.mode === 'offline') {
      ws.close({ code: 1011, reason: 'offline' }).catch(() => {})
      return
    }
    if (this.mode === 'hang') {
      // Mocked: open for the page, nothing sent to a server
      const link = { ws, server: null, closed: false }
      this.links.add(link)
      ws.onMessage(() => {})
      ws.onClose(() => this.cut(link))
      return
    }
    const server = ws.connectToServer()
    this.connected++
    const link = { ws, server, closed: false, toServer: Promise.resolve(), toPage: Promise.resolve(), received: 0, cutAfter: this.cutPlan.length ? this.cutPlan.shift() : this.cutAfter }
    this.links.add(link)
    // Each message delivered `delay` ms after its reception, in the order of reception
    const forward = (direction, send, message, extra = 0) => {
      const deliverAt = Date.now() + this.latency + extra
      link[direction] = link[direction].then(async () => {
        const wait = deliverAt - Date.now()
        if (wait > 0) await sleep(wait)
        if (!link.closed) await send(message)
      }).catch(() => {})
    }
    ws.onMessage(message => forward('toServer', m => server.send(m), message))
    server.onMessage(message => {
      link.received++
      if (link.cutAfter !== null && link.received > link.cutAfter) {
        this.cut(link)
        return
      }
      forward('toPage', m => ws.send(m), message, this.serverDelay)
    })
    ws.onClose((code, reason) => { this.cut(link); server.close({ code, reason }).catch(() => {}) })
    server.onClose((code, reason) => { this.cut(link); ws.close({ code: 1011, reason: 'server closed' }).catch(() => {}) })
  }

  cut (link) {
    if (link.closed) return
    link.closed = true
    this.links.delete(link)
    link.ws.close({ code: 1011, reason: 'network cut' }).catch(() => {})
    if (link.server) link.server.close().catch(() => {})
  }

  // Network unreachable for the collaboration: connections closed, new ones refused
  offline () {
    this.mode = 'offline'
    this.cutAll()
  }

  // Server not answering: new connections open but never answered
  hang () {
    this.mode = 'hang'
    this.cutAll()
  }

  // Network back. Connections left without answer (hang) are closed: the provider opens new ones.
  online ({ latency, serverDelay, cutAfter = null } = {}) {
    this.mode = 'online'
    if (latency !== undefined) this.latency = latency
    if (serverDelay !== undefined) this.serverDelay = serverDelay
    this.cutAfter = cutAfter
    for (const link of [...this.links]) if (!link.server) this.cut(link)
  }

  cutAll () {
    for (const link of [...this.links]) this.cut(link)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Network throttling of a page (Chrome DevTools protocol): delays the HTTP requests and the opening of the websockets,
// but almost not the messages of an open websocket (measured: about 200 ms for 1500 ms of latency): see CollabLink
// ---------------------------------------------------------------------------------------------------------------
const SLOW_3G = { latency: 1500, downloadThroughput: Math.round(400 * 1024 / 8), uploadThroughput: Math.round(400 * 1024 / 8) }

async function throttle (page, conditions = SLOW_3G) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...conditions })
  return cdp
}

async function unthrottle (cdp) {
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
}

// ---------------------------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------------------------

async function ensurePentester3 (admin) {
  const users = await datas(await admin.get('/api/users'))
  if (!users.some(u => u.username === PENTESTER3.username)) {
    const response = await admin.post('/api/users', { data: [PENTESTER3] })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
}

// Audit of the network tests (own audit: the main audit is approved, read-only, after 07-review), with pentester2 and
// pentester3 as collaborators. Returns its identifier.
async function ensureNetworkAudit () {
  await ensureBaseData()
  const admin = await apiAs(D.USERS.admin)
  await ensurePentester3(admin)
  await admin.dispose()
  const api = await apiAs(D.USERS.pentester)
  const auditId = await ensureAudit(api, NETWORK_AUDIT)
  const general = await datas(await api.get(`/api/audits/${auditId}/general`))
  const users = await datas(await api.get('/api/users'))
  const wanted = [D.USERS.pentester2.username, PENTESTER3.username]
  if (!wanted.every(name => general.collaborators.some(c => c.username === name))) {
    const collaborators = wanted.map(name => ({ _id: users.find(u => u.username === name)._id }))
    const response = await api.put(`/api/audits/${auditId}/general`, { data: { collaborators } })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
  await api.dispose()
  return auditId
}

let findingCounter = 0
// Finding with a saved content, created through the API with short recognizable paragraphs (one line each: End goes to
// the end of the paragraph). Returns { id, title, key, description, observation } as stored in the database.
async function createFinding (auditId, label) {
  const key = `${label}-${Date.now().toString(36)}${findingCounter++}`
  const title = `E2E Net ${key}`
  const data = {
    title,
    description: `<p>Saved ${key}: first paragraph.</p><p>Second saved paragraph, never to be lost.</p>`,
    observation: `<p>Saved observation ${key}.</p>`
  }
  const api = await apiAs(D.USERS.pentester)
  const response = await api.post(`/api/audits/${auditId}/findings`, { data })
  expect(response.ok(), await response.text()).toBeTruthy()
  const audit = await datas(await api.get(`/api/audits/${auditId}`))
  await api.dispose()
  const finding = audit.findings.find(f => f.title === title)
  expect(finding, `finding ${title}`).toBeTruthy()
  expect(finding.description).toContain('never to be lost')
  return { id: finding._id, title, key, description: finding.description, observation: finding.observation }
}

// Finding as stored in the database (API)
async function storedFinding (auditId, findingId, user = D.USERS.pentester) {
  const api = await apiAs(user)
  const response = await api.get(`/api/audits/${auditId}/findings/${findingId}`)
  expect(response.ok(), await response.text()).toBeTruthy()
  const finding = await datas(response)
  await api.dispose()
  return finding
}

// Saved content of the finding unchanged in the database: not emptied, not partial, not duplicated
async function expectStoredIntact (auditId, finding) {
  const stored = await storedFinding(auditId, finding.id)
  expect(stored.title, 'stored title').toBe(finding.title)
  expect(stored.description, 'stored description').toBe(finding.description)
  expect(stored.observation, 'stored observation').toBe(finding.observation)
}

// Bodies of the save requests (PUT) of a finding sent by a page
function recordSaves (page, findingId) {
  const saves = []
  page.on('request', request => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname.endsWith(`/findings/${findingId}`)) saves.push(request.postDataJSON())
  })
  return saves
}

// Answer of the save request sent by the page, if it sends one within the delay (null otherwise)
function saveAnswer (page, findingId, timeout = 5000) {
  return page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith(`/findings/${findingId}`), { timeout })
    .catch(() => null)
}

// ---------------------------------------------------------------------------------------------------------------
// Pages and editors
// ---------------------------------------------------------------------------------------------------------------

const findingUrl = (auditId, findingId) => `/audits/${auditId}/findings/${findingId}`
const drawerLink = (page, title) => page.locator('.q-drawer--left').getByRole('link').filter({ hasText: title }).first()
const unsavedDialog = page => page.locator('.q-dialog').filter({ hasText: 'There are unsaved changes' })
const saveButton = page => page.getByRole('button', { name: 'Save (ctrl+s)' })

// Browser context of a user, with the control of its collaboration websocket (link) installed before any page
async function collabUser (browser, user, { latency = 0 } = {}) {
  const context = await browser.newContext()
  const response = await context.request.post('/api/users/token', { data: { username: user.username, password: user.password } })
  expect(response.ok(), `login of ${user.username}: ${response.status()}`).toBeTruthy()
  const link = new CollabLink()
  link.latency = latency
  await link.install(context)
  const page = await context.newPage()
  return { user, context, page, link }
}

// Finding page opened, editors loaded and editable. `html`: content expected in the Description editor.
async function openFinding (page, auditId, finding, { timeout = 30_000, html } = {}) {
  await page.goto(findingUrl(auditId, finding.id))
  await expect(qInput(page, 'Title *')).toHaveValue(finding.title, { timeout })
  await expect(editorContent(page, 'Description')).toHaveAttribute('contenteditable', 'true', { timeout })
  if (html !== undefined) await expect.poll(() => editorHTML(page), { timeout: 10_000 }).toBe(html)
}

// Other finding opened from the menu of the audit (URL changed, finding not necessarily loaded). No "There are unsaved
// changes" dialog without any change.
async function goToFinding (page, auditId, finding) {
  await drawerLink(page, finding.title).click()
  const url = new RegExp(`${findingUrl(auditId, finding.id)}$`)
  await expect(async () => {
    await expect(unsavedDialog(page), 'confirmation of unsaved changes shown without any change').toHaveCount(0)
    await expect(page).toHaveURL(url, { timeout: 1000 })
  }).toPass({ timeout: 20_000 })
}

// HTML of an editor (TipTap document, without the carets of the other users)
function editorHTML (page, label = 'Description') {
  return editorContent(page, label).evaluate(element => element.editor.getHTML())
}

// Collaboration state of an editor: websocket status of its Hocuspocus provider, synced, editable
function collabState (page, label = 'Description') {
  return editorContent(page, label).evaluate(element => {
    const editor = element.editor
    const caret = editor.extensionManager.extensions.find(e => e.name === 'collaborationCaret')
    const provider = caret && caret.options.provider
    const socket = provider && provider.configuration.websocketProvider
    return { status: socket ? socket.status : null, synced: provider ? provider.isSynced : null, editable: editor.isEditable, html: editor.getHTML() }
  })
}

// Socket.io connection of the page (users of the audit, notifications)
function socketConnected (page) {
  return page.evaluate(() => document.querySelector('#q-app').__vue_app__.config.globalProperties.$socket.connected)
}

// Same document in the editors of all the pages (polled while the changes are exchanged). Returns its HTML.
async function expectConverged (pages, { label = 'Description', timeout = 60_000 } = {}) {
  let htmls = []
  await expect.poll(async () => {
    htmls = await Promise.all(pages.map(page => editorHTML(page, label)))
    return htmls.every(html => html === htmls[0])
  }, { timeout, intervals: [250, 500, 1000], message: 'same document in every editor' }).toBe(true)
  return htmls[0]
}

// Texts of the paragraphs of an HTML document
function paragraphs (html) {
  return [...html.matchAll(/<p>(.*?)<\/p>/g)].map(match => match[1])
}

// Text typed at the end of a paragraph of the description (located by its text), at a human pace
async function typeAtEndOf (page, paragraphText, text, { label = 'Description' } = {}) {
  await editorContent(page, label).locator('p', { hasText: paragraphText }).first().click()
  await press(page, 'End')
  await type(page, text)
}

module.exports = {
  NETWORK_AUDIT, PENTESTER3, SLOW_3G, sleep,
  CollabLink, throttle, unthrottle,
  ensurePentester3, ensureNetworkAudit, createFinding, storedFinding, expectStoredIntact, recordSaves, saveAnswer,
  findingUrl, drawerLink, unsavedDialog, saveButton, collabUser, openFinding, goToFinding,
  editorHTML, collabState, socketConnected, expectConverged, paragraphs, typeAtEndOf
}
