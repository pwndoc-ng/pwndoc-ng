// Helpers shared by the specs: Quasar components, authentication, API seeding
const fs = require('fs')
const path = require('path')
const { test, expect, request: playwrightRequest } = require('@playwright/test')
const D = require('./data')

const BASE_URL = process.env.BASE_URL || 'https://pwndoc-ng-frontend:8443'
const TEMPLATES_DIR = process.env.TEMPLATES_DIR || path.resolve(__dirname, '../../report-templates')
const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures')

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const exactText = text => (text instanceof RegExp) ? text : new RegExp(`^\\s*${escapeRegex(text)}\\s*$`)
const pageOf = scope => (typeof scope.page === 'function') ? scope.page() : scope

// Test of a known bug (see the BUG comment above each call), written for the correct behavior: skipped as "fixme"
// by default. With E2E_RUN_KNOWN_BUGS=1 (./run.sh --known-bugs) it runs as an expected failure (test.fail): reported
// as passed while the bug is there, as failed ("expected to fail, but passed") once the bug is fixed.
const knownBug = process.env.E2E_RUN_KNOWN_BUGS ? test.fail : test.fixme

// ---------------------------------------------------------------------------------------------------------------
// Quasar components
// ---------------------------------------------------------------------------------------------------------------

// Quasar field (q-input, q-select...) located by the text of its label
function qField (scope, label) {
  const page = pageOf(scope)
  return scope.locator('.q-field').filter({ has: page.locator('.q-field__label', { hasText: exactText(label) }) })
}

function qInput (scope, label) {
  return qField(scope, label).locator('input, textarea').first()
}

// Selects an option of a q-select (single or multiple). The menu of a multiple select is closed afterwards.
async function qSelect (scope, label, options, { field } = {}) {
  const page = pageOf(scope)
  const target = field || qField(scope, label)
  const values = Array.isArray(options) ? options : [options]
  await target.locator('.q-field__control').first().click()
  const menu = page.locator('.q-menu').last()
  await expect(menu).toBeVisible()
  for (const value of values) {
    await menu.getByRole('option', { name: exactText(value) }).first().click()
  }
  // Single select: the menu closes by itself. Multiple select: it stays open and is closed with Escape (handled by
  // the menu only; an Escape sent while the menu is closing would close a dialog around the select).
  const closed = await menu.waitFor({ state: 'hidden', timeout: 1000 }).then(() => true, () => false)
  if (!closed) {
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  }
  await menusClosed(page)
}

// Waits until the Quasar menus are removed and the focus is settled: after the choice of an option, a menu (and a
// q-select) gives the focus back to the element that opened it, a few hundred milliseconds later. A click in another
// field and the keys typed just after would lose the focus (keys sent to the select instead of an editor).
async function menusClosed (page) {
  await expect(page.locator('.q-menu')).toHaveCount(0)
  await page.waitForTimeout(400)
}

// Quasar notification (Notify plugin)
function notification (page, text) {
  return page.locator('.q-notification').filter({ hasText: text })
}

async function expectNotification (page, text) {
  await expect(notification(page, text).first()).toBeVisible()
}

// Response of an API request of the page (method and path regexp), to be awaited after the action that sends it
function waitForApi (page, method, pathRegexp, { status } = {}) {
  return page.waitForResponse(r => r.request().method() === method && pathRegexp.test(new URL(r.url()).pathname) &&
    (status === undefined || r.status() === status))
}

// Visible Quasar dialog
function dialog (page) {
  return page.locator('.q-dialog').last()
}

// Button located by its exact visible text
function button (scope, name) {
  return scope.getByRole('button', { name: exactText(name) })
}

// Content (ProseMirror) of a TipTap editor located by the label of its field
function editorContent (scope, label) {
  return qField(scope, label).locator('.ProseMirror').first()
}

// Card of a TipTap editor (toolbar + content) located by the label of its field
function editorCard (scope, label) {
  return qField(scope, label).locator('.editor').first()
}

// Button of the toolbar of an editor, located by its icon (Material ligature, mdi-* or fa class)
function toolbarButton (editor, icon) {
  const page = pageOf(editor)
  const iconLocator = /^(mdi-|fa)/.test(icon)
    ? page.locator(`.q-icon.${icon.split(' ').pop()}`)
    : page.locator('.q-icon', { hasText: exactText(icon) })
  return editor.locator('.editor-toolbar button, .editor-toolbar .q-btn').filter({ has: iconLocator }).first()
}

// Waits for the next animation frames of the page (TipTap focus command: focus and selection restored in a frame)
async function nextFrames (page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

// Click on a toolbar button of an editor, then wait for the focus to be back in the content (TipTap focuses it
// asynchronously, with the selection: keys typed before would be lost or applied to the previous selection)
async function clickToolbar (editor, icon) {
  await toolbarButton(editor, icon).click()
  await expect(editor.locator('.ProseMirror').first()).toBeFocused()
  await nextFrames(pageOf(editor))
}

// Keyboard input at a human pace in the editors: ProseMirror reads the selection changes made by the browser
// (navigation keys: arrows, End, Home) on the asynchronous selectionchange event. Keys sent a few milliseconds
// later would apply to the previous selection (e.g. End then Enter replacing the selected text).
async function press (page, key) {
  await page.keyboard.press(key)
  await page.waitForTimeout(60)
}

async function type (page, text) {
  await page.keyboard.type(text, { delay: 15 })
}

async function typeInEditor (content, text) {
  await content.click()
  await type(pageOf(content), text)
}

// CVSS calculator: value of a base metric (buttons of the q-btn-toggle following the metric title)
async function cvssPick (calculator, metric, value) {
  const group = calculator.locator('.text-weight-bold', { hasText: exactText(metric) })
    .locator('xpath=following-sibling::*[contains(concat(" ", normalize-space(@class), " "), " q-btn-toggle ")][1]')
  await group.getByRole('button', { name: exactText(value) }).click()
}

async function cvssBase (calculator, { AV = 'Network', AC = 'Low', PR = 'None', UI = 'None', S = 'Unchanged', C = 'High', I = 'High', A = 'High' } = {}) {
  await cvssPick(calculator, 'Attack Vector', AV)
  await cvssPick(calculator, 'Attack Complexity', AC)
  await cvssPick(calculator, 'Privileges Required', PR)
  await cvssPick(calculator, 'User Interaction', UI)
  await cvssPick(calculator, 'Scope', S)
  await cvssPick(calculator, 'Confidentiality Impact', C)
  await cvssPick(calculator, 'Integrity Impact', I)
  await cvssPick(calculator, 'Availability Impact', A)
}

// ---------------------------------------------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------------------------------------------

async function loginUI (page, user) {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible()
  await page.getByLabel('Username').fill(user.username)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page).toHaveURL(/\/audits$/)
}

// Browser context of a user, authenticated through the API (token cookies of the context)
async function newUserContext (browser, user, contextOptions = {}) {
  const context = await browser.newContext(contextOptions)
  const response = await context.request.post('/api/users/token', { data: { username: user.username, password: user.password } })
  expect(response.ok(), `login of ${user.username}: ${response.status()} ${await response.text()}`).toBeTruthy()
  const page = await context.newPage()
  return { context, page }
}

// API client authenticated as a user (independent of the browser contexts)
async function apiAs (user) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true })
  const response = await api.post('/api/users/token', { data: { username: user.username, password: user.password } })
  expect(response.ok(), `API login of ${user.username}: ${response.status()} ${await response.text()}`).toBeTruthy()
  return api
}

// Report generated with a download button: the check before the generation (errors and warnings of the quality checks,
// highlighted texts) is confirmed with "Generate anyway" when it is shown. Returns the download
async function downloadReport (page, clickDownload) {
  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
  await clickDownload()
  const check = page.locator('.report-check-dialog')
  const checkShown = check.waitFor({ state: 'visible', timeout: 120_000 }).then(() => 'check', () => null)
  if (await Promise.race([downloadPromise.then(() => 'download'), checkShown]) === 'check')
    await check.getByRole('button', { name: 'Generate anyway' }).click()
  return downloadPromise
}

// Quality checks of the settings: all enabled (default) or all disabled
async function setQaChecks (enabled) {
  const api = await apiAs(D.USERS.admin)
  const checks = Object.fromEntries(['completeness', 'comments', 'internalLinks', 'images', 'references', 'duplicates'].map(check => [check, enabled]))
  const response = await api.put('/api/settings', { data: { qa: { public: { checks } } } })
  expect(response.ok(), await response.text()).toBeTruthy()
  await api.dispose()
}

async function datas (response) {
  const body = await response.json()
  return body.datas
}

// ---------------------------------------------------------------------------------------------------------------
// Seeding through the API: lets each spec run alone on a fresh instance. Every function does nothing when
// the data already exists (created by the previous specs from the user interface).
// ---------------------------------------------------------------------------------------------------------------

async function ensureInitialized () {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true })
  const init = await datas(await api.get('/api/users/init'))
  if (init) {
    const { username, password, firstname, lastname } = D.USERS.admin
    const response = await api.post('/api/users/init', { data: { username, password, firstname, lastname } })
    expect(response.ok()).toBeTruthy()
  }
  await api.dispose()
}

async function ensureUsers (api, keys = ['reviewer', 'pentester', 'pentester2']) {
  const existing = (await datas(await api.get('/api/users'))).map(u => u.username)
  const missing = keys.map(k => D.USERS[k]).filter(u => !existing.includes(u.username))
  if (missing.length) {
    const response = await api.post('/api/users', { data: missing })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
}

async function ensureLanguages (api) {
  const existing = (await datas(await api.get('/api/data/languages'))).map(l => l.locale)
  for (const language of D.LANGUAGES.filter(l => !existing.includes(l.locale))) {
    expect((await api.post('/api/data/languages', { data: language })).ok()).toBeTruthy()
  }
}

async function ensureTemplate (api) {
  let template = (await datas(await api.get('/api/templates'))).find(t => t.name === D.TEMPLATE.name)
  if (!template) {
    const file = fs.readFileSync(path.join(TEMPLATES_DIR, D.TEMPLATE.file)).toString('base64')
    const response = await api.post('/api/templates', { data: { name: D.TEMPLATE.name, ext: 'docx', file } })
    expect(response.ok(), await response.text()).toBeTruthy()
    template = await datas(response)
  }
  return template
}

async function ensureSection (api) {
  const existing = await datas(await api.get('/api/data/sections'))
  if (!existing.some(s => s.field === D.SECTION.field)) {
    expect((await api.post('/api/data/sections', { data: D.SECTION })).ok()).toBeTruthy()
  }
}

async function ensureAuditType (api) {
  const template = await ensureTemplate(api)
  const existing = await datas(await api.get('/api/data/audit-types'))
  if (!existing.some(t => t.name === D.AUDIT_TYPE.name)) {
    const data = {
      name: D.AUDIT_TYPE.name,
      templates: D.LANGUAGES.map(l => ({ locale: l.locale, template: template._id })),
      sections: [D.SECTION.field]
    }
    const response = await api.post('/api/data/audit-types', { data })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
}

async function ensureVulnTypes (api) {
  const existing = await datas(await api.get('/api/data/vulnerability-types'))
  for (const type of D.VULN_TYPES.filter(t => !existing.some(e => e.name === t.name && e.locale === t.locale))) {
    expect((await api.post('/api/data/vulnerability-types', { data: type })).ok()).toBeTruthy()
  }
}

async function ensureCategory (api) {
  const existing = await datas(await api.get('/api/data/vulnerability-categories'))
  if (!existing.some(c => c.name === D.CATEGORY.name)) {
    expect((await api.post('/api/data/vulnerability-categories', { data: D.CATEGORY })).ok()).toBeTruthy()
  }
}

async function ensureCustomFields (api) {
  const existing = await datas(await api.get('/api/data/custom-fields'))
  for (const field of Object.values(D.CUSTOM_FIELDS)) {
    if (!existing.some(f => f.label === field.label && f.display === field.display)) {
      expect((await api.post('/api/data/custom-fields', { data: field })).ok()).toBeTruthy()
    }
  }
}

async function ensureCompanyAndClient (api) {
  const companies = await datas(await api.get('/api/companies'))
  if (!companies.some(c => c.name === D.COMPANY.name)) {
    const response = await api.post('/api/companies', { data: [D.COMPANY] })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
  const clients = await datas(await api.get('/api/clients'))
  if (!clients.some(c => c.email === D.CLIENT.email)) {
    const response = await api.post('/api/clients', { data: [{ ...D.CLIENT, company: { name: D.COMPANY.name } }] })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
}

async function ensureReviewSettings (api) {
  const settings = await datas(await api.get('/api/settings'))
  if (!settings.reviews.enabled) {
    settings.reviews.enabled = true
    settings.reviews.public.minReviewers = 1
    expect((await api.put('/api/settings', { data: settings })).ok()).toBeTruthy()
  }
}

// Everything the audit specs need
async function ensureBaseData () {
  await ensureInitialized()
  const api = await apiAs(D.USERS.admin)
  await ensureUsers(api)
  await ensureLanguages(api)
  await ensureSection(api)
  await ensureAuditType(api)
  await ensureVulnTypes(api)
  await ensureCategory(api)
  await ensureCustomFields(api)
  await ensureCompanyAndClient(api)
  await ensureReviewSettings(api)
  await api.dispose()
}

// Vulnerability of the database (English), created by the admin if missing
async function ensureVulnerability (api, vuln, extra = {}) {
  const all = await datas(await api.get('/api/vulnerabilities'))
  const found = all.find(v => v.details.some(d => d.title === vuln.title))
  if (found) return found
  const data = [{
    cvssv3: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N',
    priority: 3,
    remediationComplexity: 2,
    details: [{ locale: 'en', title: vuln.title, vulnType: 'Web Application', description: `<p>${vuln.description}</p>`, observation: '', remediation: `<p>${vuln.remediation}</p>`, references: [] }],
    ...extra
  }]
  const response = await api.post('/api/vulnerabilities', { data })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await datas(await api.get('/api/vulnerabilities'))).find(v => v.details.some(d => d.title === vuln.title))
}

// Audit of the pentester (created through the API when a spec runs alone)
async function ensureAudit (api, name, { language = 'en' } = {}) {
  const audits = await datas(await api.get('/api/audits'))
  const found = audits.find(a => a.name === name)
  if (found) return found._id
  const response = await api.post('/api/audits', { data: { name, language, auditType: D.AUDIT_TYPE.name, type: 'default' } })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await datas(response)).audit._id
}

async function auditByName (api, name) {
  const audits = await datas(await api.get('/api/audits'))
  return audits.find(a => a.name === name)
}

// Audit of the pentester with its collaborator and its reviewer (set from the UI by 04-audit, through the API when
// a spec runs alone). Returns the audit identifier.
async function ensureMainAudit () {
  await ensureBaseData()
  const admin = await apiAs(D.USERS.admin)
  await ensureVulnerability(admin, D.VULNS.sqli.en, { category: D.CATEGORY.name })
  await admin.dispose()
  const api = await apiAs(D.USERS.pentester)
  const auditId = await ensureAudit(api, D.AUDIT.name)
  const audit = await datas(await api.get(`/api/audits/${auditId}`))
  if (audit.findings.length === 0) {
    await api.post(`/api/audits/${auditId}/findings`, { data: { title: D.VULNS.sqli.en.title, description: `<p>${D.VULNS.sqli.en.description}</p>`, cvssv3: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', category: D.CATEGORY.name } })
    await api.post(`/api/audits/${auditId}/findings`, { data: { title: D.VULNS.xss.en.title, description: `<p>${D.VULNS.xss.en.description}</p>` } })
    await api.post(`/api/audits/${auditId}/findings`, { data: { title: 'E2E Manual Finding', description: '<p>Manual finding</p>' } })
  }
  const general = await datas(await api.get(`/api/audits/${auditId}/general`))
  const users = await datas(await api.get('/api/users'))
  const id = key => users.find(u => u.username === D.USERS[key].username)._id
  const update = {}
  if (!general.collaborators.some(c => c.username === D.USERS.pentester2.username)) update.collaborators = [{ _id: id('pentester2') }]
  if (!general.reviewers.some(r => r.username === D.USERS.reviewer.username)) update.reviewers = [{ _id: id('reviewer') }]
  if (Object.keys(update).length) {
    const response = await api.put(`/api/audits/${auditId}/general`, { data: update })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
  await api.dispose()
  return auditId
}

// Identifier of an audit readable by the user
async function auditIdByName (user, name) {
  const api = await apiAs(user)
  const audit = await auditByName(api, name)
  await api.dispose()
  expect(audit, `audit ${name}`).toBeTruthy()
  return audit._id
}

module.exports = {
  BASE_URL, TEMPLATES_DIR, FIXTURES_DIR,
  escapeRegex, exactText, knownBug,
  qField, qInput, qSelect, menusClosed, notification, expectNotification, waitForApi, dialog, button,
  editorContent, editorCard, toolbarButton, clickToolbar, nextFrames, press, type, typeInEditor, cvssPick, cvssBase,
  loginUI, newUserContext, apiAs, datas, downloadReport, setQaChecks,
  ensureInitialized, ensureUsers, ensureLanguages, ensureTemplate, ensureSection, ensureAuditType, ensureVulnTypes,
  ensureCategory, ensureCustomFields, ensureCompanyAndClient, ensureReviewSettings, ensureBaseData,
  ensureVulnerability, ensureAudit, ensureMainAudit, auditByName, auditIdByName
}
