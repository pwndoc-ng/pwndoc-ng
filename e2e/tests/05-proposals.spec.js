// Proposals to the vulnerabilities database: update and creation proposed by a pentester from findings, review by an
// admin (partial acceptance, refusal with a reason), status shown on the findings
const { test, expect } = require('@playwright/test')
const D = require('./support/data')
const {
  qInput, expectNotification, editorContent, press, type, loginUI, apiAs, datas, ensureBaseData, ensureVulnerability,
  auditIdByName, newUserContext, waitForApi
} = require('./support/helpers')

test.describe.configure({ mode: 'serial' })

const pentester = D.USERS.pentester
const MANUAL_FINDING = 'E2E Manual Finding'
const PROPOSED_REMEDIATION = 'Also review the stored procedures.'
const drawer = page => page.locator('.q-drawer--left')

let auditId

test.beforeAll(async () => {
  await ensureBaseData()
  const api = await apiAs(pentester)
  auditId = (await datas(await api.get('/api/audits'))).find(a => a.name === D.AUDIT.name)?._id
  if (!auditId) {
    // Spec run alone: audit with a finding from the database and a manual finding
    const admin = await apiAs(D.USERS.admin)
    const vuln = await ensureVulnerability(admin, D.VULNS.sqli.en, { category: D.CATEGORY.name })
    await admin.dispose()
    const response = await api.post('/api/audits', { data: { name: D.AUDIT.name, language: 'en', auditType: D.AUDIT_TYPE.name } })
    auditId = (await datas(response)).audit._id
    const detail = vuln.details.find(d => d.locale === 'en')
    await api.post(`/api/audits/${auditId}/findings`, { data: { title: detail.title, description: detail.description, remediation: detail.remediation, cvssv3: vuln.cvssv3, category: vuln.category, vulnType: detail.vulnType } })
    await api.post(`/api/audits/${auditId}/findings`, { data: { title: MANUAL_FINDING, description: '<p>Manual</p>' } })
  }
  // Pending proposals of a previous run withdrawn (spec run again on the same instance)
  for (const proposal of await datas(await api.get('/api/vulnerability-proposals?status=pending'))) {
    await api.delete(`/api/vulnerability-proposals/${proposal._id}`)
  }
  await api.dispose()
})

async function openFinding (page, title) {
  await page.goto(`/audits/${auditId}/general`)
  await drawer(page).getByRole('link').filter({ hasText: title }).first().click()
  await expect(qInput(page, 'Title *')).toHaveValue(title)
  await expect(editorContent(page, 'Description')).toHaveAttribute('contenteditable', 'true')
}

const proposeButton = page => page.getByRole('button', { name: 'Propose Creation / Update in Vulnerability Database' })

test.describe('Vulnerability proposals', () => {
  test('pentester: update of an existing vulnerability and creation of a new one proposed from findings', async ({ page }) => {
    await loginUI(page, pentester)

    // Update: remediation of the finding added from the database
    await openFinding(page, D.VULNS.sqli.en.title)
    await page.getByRole('tab', { name: 'Details' }).click()
    const remediation = editorContent(page, 'Remediation')
    await expect(remediation).toHaveAttribute('contenteditable', 'true')
    await remediation.click()
    await press(page, 'Control+End')
    await press(page, 'Enter')
    await type(page, PROPOSED_REMEDIATION)
    await page.getByRole('button', { name: 'Save (ctrl+s)' }).click()
    await expectNotification(page, 'Finding updated successfully')
    let response = waitForApi(page, 'POST', /\/api\/vulnerabilities\/finding\/en$/)
    await proposeButton(page).click()
    expect((await response).status()).toBe(200)
    await expectNotification(page, 'Update proposed for existing vulnerability')
    await expect(page.locator('.q-chip').filter({ hasText: 'Pending' })).toBeVisible()

    // Creation: manual finding
    await openFinding(page, MANUAL_FINDING)
    response = waitForApi(page, 'POST', /\/api\/vulnerabilities\/finding\/en$/)
    await proposeButton(page).click()
    expect((await response).status()).toBe(201)
    await expectNotification(page, 'Finding created as new Vulnerability')
    await expect(page.locator('.q-chip').filter({ hasText: 'Pending' })).toBeVisible()

    // The pentester sees the proposals, cannot review them
    await page.locator('.q-header').getByText('Vulnerabilities').click()
    await expect(page.getByRole('button', { name: 'New Vulnerability' })).toHaveCount(0)
    await page.getByRole('tab', { name: /Proposals/ }).click()
    const rows = page.locator('.q-table tbody tr.cursor-pointer') // Proposals table (rows clickable)
    await expect(rows.filter({ hasText: D.VULNS.sqli.en.title })).toContainText('Update')
    await expect(rows.filter({ hasText: MANUAL_FINDING })).toContainText('Creation')
    await rows.filter({ hasText: D.VULNS.sqli.en.title }).click()
    const review = page.locator('.q-dialog').filter({ hasText: 'Proposed by' })
    await expect(review).toBeVisible()
    await expect(review.getByRole('button', { name: /Accept/ })).toHaveCount(0)
    await expect(review.getByRole('button', { name: 'Withdraw my proposal' })).toBeVisible()
  })

  test('admin: pending proposals counter, partial acceptance of the update, refusal of the creation', async ({ browser }) => {
    const { context, page } = await newUserContext(browser, D.USERS.admin)
    await page.goto('/audits')
    // Counter of the proposals to review in the navigation bar
    await expect(page.locator('.q-header').getByRole('link', { name: /Vulnerabilities/ }).locator('.q-badge')).toHaveText('2')

    await page.locator('.q-header').getByText('Vulnerabilities').click()
    await page.getByRole('tab', { name: /Proposals/ }).click()
    const rows = page.locator('.q-table tbody tr.cursor-pointer') // Proposals table (rows clickable)
    await expect(rows.filter({ hasText: 'Pending' })).toHaveCount(2)

    // Update: comparison field by field, only the remediation accepted
    await rows.filter({ hasText: D.VULNS.sqli.en.title }).click()
    const review = page.locator('.q-dialog').filter({ hasText: 'Proposed by' })
    await expect(review).toContainText(`Proposed by ${pentester.firstname} ${pentester.lastname}`)
    await expect(review.getByText('Remediation', { exact: true })).toBeVisible()
    await expect(review.locator('.diffadd').first()).toContainText(PROPOSED_REMEDIATION)
    const checkboxes = review.getByRole('checkbox')
    const count = await checkboxes.count()
    expect(count).toBeGreaterThanOrEqual(1)
    // Unselect all, then select the remediation only
    for (let i = 0; i < count; i++) {
      if (await checkboxes.nth(i).getAttribute('aria-checked') === 'true') await checkboxes.nth(i).click()
    }
    const remediationRow = review.locator('.row.items-center').filter({ has: page.getByText('Remediation', { exact: true }) })
    await remediationRow.getByRole('checkbox').click()
    await review.getByRole('button', { name: 'Accept the selection (1)' }).click()
    await expectNotification(page, count > 1 ? 'Proposal partially accepted' : 'Proposal accepted')

    // Creation refused with a reason
    await rows.filter({ hasText: MANUAL_FINDING }).click()
    await expect(review).toContainText('Creation')
    await review.getByRole('button', { name: 'Refuse' }).click()
    const prompt = page.locator('.q-dialog').filter({ hasText: 'Reason of the refusal' })
    await prompt.locator('textarea').fill('Too specific to this audit')
    await prompt.getByRole('button', { name: 'Refuse' }).click()
    await expectNotification(page, 'Proposal refused')
    await expect(rows.filter({ hasText: 'Pending' })).toHaveCount(0)
    await expect(page.locator('.q-header').getByRole('link', { name: /Vulnerabilities/ }).locator('.q-badge')).toHaveCount(0)

    // Database: remediation updated, refused creation removed
    const api = await apiAs(D.USERS.admin)
    const vulns = await datas(await api.get('/api/vulnerabilities'))
    const sqli = vulns.find(v => v.details.some(d => d.title === D.VULNS.sqli.en.title))
    expect(sqli.details.find(d => d.locale === 'en').remediation).toContain(PROPOSED_REMEDIATION)
    expect(sqli.status).toBe(0)
    expect(vulns.some(v => v.details.some(d => d.title === MANUAL_FINDING))).toBe(false)
    await api.dispose()
    await context.close()
  })

  test('pentester: review result shown on the findings', async ({ page }) => {
    await loginUI(page, pentester)
    await openFinding(page, D.VULNS.sqli.en.title)
    await expect(page.locator('.q-chip').filter({ hasText: /Accepted|Partially accepted/ })).toBeVisible()
    await openFinding(page, MANUAL_FINDING)
    const refused = page.locator('.q-chip').filter({ hasText: 'Refused' })
    await expect(refused).toBeVisible()
    await refused.click()
    const review = page.locator('.q-dialog').filter({ hasText: 'Proposed by' })
    await expect(review).toContainText('Too specific to this audit')
  })
})

test('pentester: archived vulnerabilities are not proposed and the database is read-only', async ({ page }) => {
  await loginUI(page, pentester)
  const id = auditId || await auditIdByName(pentester, D.AUDIT.name)
  await page.goto(`/audits/${id}/findings/add`)
  await expect(page.locator('.q-table').getByText(D.VULNS.sqli.en.title)).toBeVisible()
  await expect(page.locator('.q-table').getByText(D.VULNS.csrf.en.title)).toHaveCount(0)

  await page.goto('/vulnerabilities')
  const row = page.locator('.q-table tbody tr').filter({ hasText: D.VULNS.sqli.en.title })
  await expect(row).toBeVisible()
  await expect(row.locator('.fa-edit')).toHaveCount(0)
  await expect(row.locator('.fa-trash')).toHaveCount(0)
  await row.locator('button').filter({ has: page.locator('.fa-eye') }).click()
  await expect(page.locator('.q-dialog').getByRole('button', { name: 'Update' })).toHaveCount(0)
})
