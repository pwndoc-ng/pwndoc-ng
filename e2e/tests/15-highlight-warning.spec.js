// Highlighted texts to replace (setting of the reports, warning only, several colors): finding marked in the menu of the audit, texts
// listed before the generation of the report (audit page and audits list): cancelled, place opened, generated anyway.
// Quality checks disabled during this spec: the check before the generation lists the highlighted texts only.
// Own audit (unique name, deleted at the end), settings restored at the end.
const { test, expect } = require('@playwright/test')
const D = require('./support/data')
const { qInput, loginUI, apiAs, datas, ensureBaseData, ensureAudit, setQaChecks } = require('./support/helpers')

test.describe.configure({ mode: 'serial' })

const RUN = Date.now().toString(36)
const pentester = D.USERS.pentester
const AUDIT_NAME = `E2E Highlight Audit ${RUN}`
const YELLOW = '#ffff00'
const GREEN = '#00ff00'
const RED = '#fe0000'
const mark = (text, color = YELLOW) => `<mark data-color="${color}" style="background-color: ${color}; color: inherit">${text}</mark>`
const FINDINGS = {
  highlighted: { title: 'E2E HL Finding', description: `<p>Contact ${mark('[CLIENT NAME]')} on ${mark('[DATE]', GREEN)}, ${mark('red note', RED)}.</p>`, cvssv3: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' },
  clean: { title: 'E2E HL Clean', description: `<p>Nothing to replace, ${mark('red only', RED)}.</p>` }
}

let auditId
const ids = {}

const drawer = page => page.locator('.q-drawer--left')
const findingItem = (page, title) => drawer(page).locator('.q-item').filter({ hasText: title })
const dialog = page => page.locator('.report-check-dialog')

// Warning enabled for the yellow and green highlights (red ones not reported)
async function setWarning (enabled) {
  const api = await apiAs(D.USERS.admin)
  const colors = enabled ? [YELLOW, GREEN] : [YELLOW]
  const response = await api.put('/api/settings', { data: { report: { public: { highlightWarning: enabled, highlightWarningColors: colors } } } })
  expect(response.ok(), await response.text()).toBeTruthy()
  await api.dispose()
}

test.beforeAll(async () => {
  await ensureBaseData()
  await setWarning(true)
  await setQaChecks(false)
  const api = await apiAs(pentester)
  auditId = await ensureAudit(api, AUDIT_NAME)
  for (const finding of Object.values(FINDINGS)) {
    const response = await api.post(`/api/audits/${auditId}/findings`, { data: finding })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
  const findings = (await datas(await api.get(`/api/audits/${auditId}`))).findings
  for (const [key, finding] of Object.entries(FINDINGS))
    ids[key] = findings.find(f => f.title === finding.title)._id
  await api.dispose()
})

test.afterAll(async () => {
  await setWarning(false)
  await setQaChecks(true)
  const api = await apiAs(pentester)
  await api.delete(`/api/audits/${auditId}`)
  await api.dispose()
})

test.beforeEach(async ({ page }) => {
  await loginUI(page, pentester)
})

test('the finding with highlighted texts is marked in the menu of the audit', async ({ page }) => {
  await page.goto(`/audits/${auditId}/general`)
  await expect(findingItem(page, FINDINGS.highlighted.title).locator('.highlight-marker')).toBeVisible()
  await expect(findingItem(page, FINDINGS.clean.title)).toBeVisible()
  await expect(findingItem(page, FINDINGS.clean.title).locator('.highlight-marker')).toHaveCount(0)
})

test('generation from the audit: texts listed, cancelled, place opened, then generated anyway', async ({ page }) => {
  const generations = []
  page.on('request', request => { if (/\/api\/audits\/[0-9a-f]{24}\/generate$/.test(new URL(request.url()).pathname)) generations.push(request) })
  await page.goto(`/audits/${auditId}/general`)
  const download = () => drawer(page).locator('button').filter({ has: page.locator('.fa-download') }).click()

  // Cancelled: not generated
  await download()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText(`${FINDINGS.highlighted.title} · Description`)
  // Texts of the chosen colors only, each one in its color
  await expect(dialog(page).locator('mark')).toHaveText(['[CLIENT NAME]', '[DATE]'])
  await expect(dialog(page).locator('mark').nth(0)).toHaveCSS('background-color', 'rgb(255, 255, 0)')
  await expect(dialog(page).locator('mark').nth(1)).toHaveCSS('background-color', 'rgb(0, 255, 0)')
  await expect(dialog(page)).not.toContainText(FINDINGS.clean.title)
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog(page)).toHaveCount(0)

  // Place of the text opened from the list
  await download()
  await dialog(page).locator('.report-check-item').filter({ hasText: '[CLIENT NAME]' }).click()
  await expect(page).toHaveURL(new RegExp(`/audits/${auditId}/findings/${ids.highlighted}$`))
  await expect(qInput(page, 'Title *')).toHaveValue(FINDINGS.highlighted.title)
  expect(generations).toHaveLength(0)

  // Generated anyway
  await download()
  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
  await dialog(page).getByRole('button', { name: 'Generate anyway' }).click()
  expect((await downloadPromise).suggestedFilename()).toBe(`${AUDIT_NAME}.docx`)
  expect(generations).toHaveLength(1)
})

test('generation from the audits list: same warning before the report', async ({ page }) => {
  const row = page.getByRole('row').filter({ hasText: AUDIT_NAME })
  await row.locator('button').filter({ has: page.locator('.fa-download') }).click()
  await expect(dialog(page)).toContainText('[CLIENT NAME]')
  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
  await dialog(page).getByRole('button', { name: 'Generate anyway' }).click()
  expect((await downloadPromise).suggestedFilename()).toBe(`${AUDIT_NAME}.docx`)
})
