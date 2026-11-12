// Quality checks without AI (no link ever requested): issues of an audit in its panel (count on the button, place
// opened), issue ignored for the audit then restored, errors and warnings listed before the generation of the report,
// duplicated titles of the vulnerability database. Own audit and vulnerabilities (unique names, deleted at the end).
const { test, expect } = require('@playwright/test')
const D = require('./support/data')
const { qInput, loginUI, apiAs, datas, ensureBaseData, ensureAudit, setQaChecks } = require('./support/helpers')

test.describe.configure({ mode: 'serial' })

const RUN = Date.now().toString(36)
const pentester = D.USERS.pentester
const AUDIT_NAME = `E2E QA Audit ${RUN}`
const CRITICAL = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'
const FINDINGS = {
  incomplete: { title: 'E2E QA Incomplete', description: '', references: ['htps://typo.example.com'] },
  complete: { title: 'E2E QA Complete', description: '<p>Text</p>', remediation: '<p>Fix</p>', cvssv3: CRITICAL, status: 0, references: ['https://owasp.org/'] }
}
const VULNS = [`E2E QA Cookie Flag ${RUN}`, `e2e qa cookie-flag ${RUN}`]

let auditId
const ids = {}
let expected // Errors and warnings of the audit given by the API (sections of the audit type included)

const drawer = page => page.locator('.q-drawer--left')
const qaButton = page => page.locator('.qa-button')
const panel = page => page.locator('.qa-panel')
const issue = (page, text) => panel(page).locator('.qa-issue').filter({ hasText: text })

test.beforeAll(async () => {
  await ensureBaseData()
  await setQaChecks(true)
  const api = await apiAs(pentester)
  auditId = await ensureAudit(api, AUDIT_NAME)
  for (const finding of Object.values(FINDINGS)) {
    const response = await api.post(`/api/audits/${auditId}/findings`, { data: finding })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
  const findings = (await datas(await api.get(`/api/audits/${auditId}`))).findings
  for (const [key, finding] of Object.entries(FINDINGS))
    ids[key] = findings.find(f => f.title === finding.title)._id
  // The complete finding is done (created in redaction)
  await api.put(`/api/audits/${auditId}/findings/${ids.complete}`, { data: { status: 0 } })
  const issues = (await datas(await api.get(`/api/audits/${auditId}/qa`))).issues
  expected = { error: issues.filter(i => i.severity === 'error').length, warning: issues.filter(i => i.severity === 'warning').length }
  expect(issues.filter(i => i.location.id === ids.incomplete).map(i => i.code)).toEqual(['findingNoDescription', 'findingNoRemediation', 'findingNoCvss', 'findingRedacting', 'referenceInvalid'])
  expect(issues.filter(i => i.location.id === ids.complete)).toEqual([])
  await api.dispose()
})

test.afterAll(async () => {
  const api = await apiAs(pentester)
  await api.delete(`/api/audits/${auditId}`)
  await api.dispose()
  const admin = await apiAs(D.USERS.admin)
  const vulnerabilities = await datas(await admin.get('/api/vulnerabilities'))
  for (const vulnerability of vulnerabilities.filter(v => v.details.some(d => VULNS.includes(d.title))))
    await admin.delete(`/api/vulnerabilities/${vulnerability._id}`)
  await admin.dispose()
})

test('issues of the audit: count on the button, listed in the panel, place opened', async ({ page }) => {
  await loginUI(page, pentester)
  await page.goto(`/audits/${auditId}/general`)
  // Errors and warnings: empty description; no remediation, no CVSS, in redaction, invalid reference link (and the
  // sections of the audit type left empty)
  await expect(qaButton(page).locator('.q-badge')).toHaveText(String(expected.error + expected.warning))
  await qaButton(page).click()
  await expect(panel(page)).toBeVisible()
  await expect(panel(page).locator('.qa-summary')).toHaveText(`${expected.error} errors, ${expected.warning} warnings`)
  await expect(issue(page, 'Empty description')).toContainText(`${FINDINGS.incomplete.title} · Description`)
  await expect(issue(page, 'Invalid link: "htps://typo.example.com"')).toContainText(`${FINDINGS.incomplete.title} · References`)
  await expect(panel(page)).not.toContainText(FINDINGS.complete.title)
  await issue(page, 'Empty description').locator('.qa-open').click()
  await expect(page).toHaveURL(new RegExp(`/audits/${auditId}/findings/${ids.incomplete}$`))
  await expect(qInput(page, 'Title *')).toHaveValue(FINDINGS.incomplete.title)
  await expect(panel(page)).toHaveCount(0)
})

test('issue ignored for the audit, then restored', async ({ page }) => {
  await loginUI(page, pentester)
  await page.goto(`/audits/${auditId}/general`)
  await qaButton(page).click()
  const invalidLink = 'Invalid link: "htps://typo.example.com"'
  await issue(page, invalidLink).locator('.qa-ignore').click()
  await expect(issue(page, invalidLink)).toHaveCount(0)
  await expect(panel(page).locator('.qa-summary')).toHaveText(`${expected.error} errors, ${expected.warning - 1} warnings`)
  await expect(qaButton(page).locator('.q-badge')).toHaveText(String(expected.error + expected.warning - 1))

  // Ignored for the other users of the audit too (stored), until restored
  await page.reload()
  await expect(qaButton(page).locator('.q-badge')).toHaveText(String(expected.error + expected.warning - 1))
  await qaButton(page).click()
  await panel(page).locator('.qa-ignored').click()
  await expect(panel(page).locator('.qa-ignored-issue')).toContainText(invalidLink)
  await panel(page).locator('.qa-ignored-issue').filter({ hasText: invalidLink }).locator('.qa-restore').click()
  await expect(issue(page, invalidLink)).toBeVisible()
  await expect(qaButton(page).locator('.q-badge')).toHaveText(String(expected.error + expected.warning))
})

test('errors and warnings listed before the generation: cancelled, then generated anyway', async ({ page }) => {
  const generations = []
  page.on('request', request => { if (/\/api\/audits\/[0-9a-f]{24}\/generate$/.test(new URL(request.url()).pathname)) generations.push(request) })
  await loginUI(page, pentester)
  await page.goto(`/audits/${auditId}/general`)
  const download = () => drawer(page).locator('button').filter({ has: page.locator('.fa-download') }).click()
  const check = page.locator('.report-check-dialog')

  await download()
  await expect(check.locator('.report-check-summary')).toContainText(`${expected.error} errors and ${expected.warning} warnings`)
  await expect(check.locator('.report-check-item')).toHaveCount(expected.error + expected.warning)
  await check.getByRole('button', { name: 'Cancel' }).click()
  await expect(check).toHaveCount(0)
  expect(generations).toHaveLength(0)

  await download()
  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
  await check.getByRole('button', { name: 'Generate anyway' }).click()
  expect((await downloadPromise).suggestedFilename()).toBe(`${AUDIT_NAME}.docx`)
  expect(generations).toHaveLength(1)
})

test('vulnerability database: duplicated titles listed, vulnerability opened', async ({ page }) => {
  const admin = await apiAs(D.USERS.admin)
  const response = await admin.post('/api/vulnerabilities', { data: VULNS.map(title => ({ cvssv3: '', details: [{ locale: 'en', title }] })) })
  expect(response.ok(), await response.text()).toBeTruthy()
  await admin.dispose()

  await loginUI(page, D.USERS.admin)
  await page.goto('/vulnerabilities')
  await page.locator('.vulnerabilities-qa-button').click()
  const dialog = page.locator('.vulnerabilities-qa')
  const duplicate = dialog.locator('.qa-issue').filter({ hasText: `Same title as "${VULNS[1]}"` })
  await expect(duplicate).toContainText(`${VULNS[0]} (en)`)
  await duplicate.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.q-dialog').getByText('Edit Vulnerability')).toBeVisible()
})
