// Generation and download of the report (.docx built from the uploaded template)
const fs = require('fs')
const { test, expect } = require('@playwright/test')
const D = require('./support/data')
const { unzip } = require('./support/zip')
const { qInput, loginUI, apiAs, datas, ensureMainAudit, ensureAudit, notification } = require('./support/helpers')

test.describe.configure({ mode: 'serial' })

let auditId

test.beforeAll(async () => {
  auditId = await ensureMainAudit()
})

test.beforeEach(async ({ page }) => {
  await loginUI(page, D.USERS.pentester)
})

// Text of the document (runs of word/document.xml joined, XML tags removed)
function documentText (docx) {
  const xml = docx.read('word/document.xml').toString('utf8')
  return xml.replace(/<w:tab\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
}

test.describe('Report', () => {
  test('generated from the audit menu: valid .docx with the findings, the table, the image and its caption', async ({ page }) => {
    await page.goto(`/audits/${auditId}/general`)
    await expect(qInput(page, 'Name *')).toHaveValue(D.AUDIT.name)
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
    await page.locator('.q-drawer--left').locator('button').filter({ has: page.locator('.fa-download') }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe(`${D.AUDIT.name}.docx`)
    await expect(notification(page, 'Report successfully generated')).toBeVisible()

    const file = fs.readFileSync(await download.path())
    expect(file.length).toBeGreaterThan(10_000)
    expect(file.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004') // ZIP archive
    const docx = unzip(file)
    expect(docx.names).toEqual(expect.arrayContaining(['[Content_Types].xml', 'word/document.xml']))

    const text = documentText(docx)
    for (const title of [D.VULNS.sqli.en.title, 'E2E Manual Finding']) {
      expect(text).toContain(title)
    }
    // The default template only lists the findings with a CVSS severity (loop filtered on cvss.baseSeverity)
    expect(text).not.toContain(D.VULNS.xss.en.title)
    // Content of the manual finding: heading, table, code block, caption
    expect(text).toContain('E2E Heading')
    expect(text).toContain('10.10.0.5')
    expect(text).toContain('SELECT * FROM users')
    expect(text).toContain('E2E proof of the injection')
    // Images of the findings embedded
    expect(docx.names.filter(name => /^word\/media\/.+\.(png|jpe?g)$/i.test(name)).length).toBeGreaterThanOrEqual(1)
    // Data of the general information
    expect(text).toContain(D.COMPANY.name)
  })

  test('generated from the audits list', async ({ page }) => {
    const row = page.getByRole('row').filter({ hasText: D.AUDIT.name })
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
    await row.locator('button').filter({ has: page.locator('.fa-download') }).click()
    const download = await downloadPromise
    const docx = unzip(fs.readFileSync(await download.path()))
    expect(documentText(docx)).toContain(D.VULNS.sqli.en.title)
  })

  test('mandatory review: a report of an audit not approved is refused', async ({ page }) => {
    const admin = await apiAs(D.USERS.admin)
    const settings = await datas(await admin.get('/api/settings'))
    settings.reviews.enabled = true
    settings.reviews.public.mandatoryReview = true
    expect((await admin.put('/api/settings', { data: settings })).ok()).toBeTruthy()
    try {
      const api = await apiAs(D.USERS.pentester)
      const draftId = await ensureAudit(api, 'E2E Draft Audit')
      await api.dispose()
      await page.goto(`/audits/${draftId}/general`)
      await expect(qInput(page, 'Name *')).toHaveValue('E2E Draft Audit')
      await page.locator('.q-drawer--left').locator('button').filter({ has: page.locator('.fa-download') }).click()
      await expect(notification(page, 'Audit was not approved therefore cannot be exported.')).toBeVisible()

      // The approved audit can still be exported
      const response = await page.request.get(`/api/audits/${auditId}/generate`)
      const audit = await datas(await (await apiAs(D.USERS.pentester)).get(`/api/audits/${auditId}`))
      expect(response.status()).toBe(audit.state === 'APPROVED' ? 200 : 403)
    } finally {
      settings.reviews.public.mandatoryReview = false
      expect((await admin.put('/api/settings', { data: settings })).ok()).toBeTruthy()
      await admin.dispose()
    }
  })
})
