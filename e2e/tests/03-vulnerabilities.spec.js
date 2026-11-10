// Vulnerabilities database: creation in 2 languages, edition, search/filters/sort, archives, deletion
const { test, expect } = require('@playwright/test')
const D = require('./support/data')
const {
  qField, qInput, qSelect, expectNotification, dialog, button, editorContent, typeInEditor, cvssBase,
  loginUI, apiAs, datas, ensureBaseData
} = require('./support/helpers')

test.describe.configure({ mode: 'serial' })

// Rows of vulnerabilities (the first row of the table holds the search fields)
const rows = page => page.locator('.q-table tbody tr').filter({ has: page.locator('td') }).filter({ hasNot: page.locator('.q-field') })
const rowOf = (page, title) => rows(page).filter({ hasText: title })

test.beforeAll(async () => {
  await ensureBaseData()
})

test.beforeEach(async ({ page }) => {
  await loginUI(page, D.USERS.admin)
  await page.locator('.q-header').getByText('Vulnerabilities').click()
  await expect(page).toHaveURL(/\/vulnerabilities$/)
  await expect(page.getByRole('button', { name: 'New Vulnerability' })).toBeVisible()
})

async function openCreation (page, category) {
  await page.getByRole('button', { name: 'New Vulnerability' }).click()
  await page.locator('.q-menu').getByText(category, { exact: true }).click()
  const modal = dialog(page)
  await expect(modal.getByText(`Add Vulnerability (${category})`)).toBeVisible()
  return modal
}

test.describe('Vulnerabilities database', () => {
  test('creation of a vulnerability in two languages, with CVSS, category and custom field', async ({ page }) => {
    const vuln = D.VULNS.sqli
    const modal = await openCreation(page, D.CATEGORY.name)

    // Title required
    await button(modal, 'Create').click()
    await expect(modal.getByText('Title required')).toBeVisible()

    // English
    await qInput(modal, 'Title *').fill(vuln.en.title)
    await qSelect(modal, 'Type', 'Web Application')
    await typeInEditor(editorContent(modal, 'Description'), vuln.en.description)
    await typeInEditor(editorContent(modal, 'Remediation'), vuln.en.remediation)
    const calculator = modal.locator('.cvsscalculator').first()
    await cvssBase(calculator)
    await expect(calculator.locator('.baseMetricScore').first()).toHaveText('9.8')
    await expect(calculator.locator('.baseSeverity').first()).toContainText('Critical')
    await qSelect(modal, 'Remediation Complexity', 'Medium')
    await qSelect(modal, 'Remediation Priority', 'High')
    await qInput(modal, 'References (One per line)').fill('https://owasp.org/www-community/attacks/SQL_Injection\nCWE-89')
    await qInput(modal, D.CUSTOM_FIELDS.finding.label).fill('Login form')

    // French: other details, same CVSS
    await qSelect(modal, 'Language', 'Francais')
    await expect(qInput(modal, 'Title *')).toHaveValue('')
    await qInput(modal, 'Title *').fill(vuln.fr.title)
    await qSelect(modal, 'Type', 'Application Web')
    await typeInEditor(editorContent(modal, 'Description'), vuln.fr.description)
    await typeInEditor(editorContent(modal, 'Remediation'), vuln.fr.remediation)
    await expect(calculator.locator('.baseMetricScore').first()).toHaveText('9.8')

    // Back to English: the English details are kept
    await qSelect(modal, 'Language', 'English')
    await expect(qInput(modal, 'Title *')).toHaveValue(vuln.en.title)
    await expect(editorContent(modal, 'Description')).toContainText(vuln.en.description)

    await button(modal, 'Create').click()
    await expectNotification(page, 'Vulnerability created successfully')
    await expect(modal).toBeHidden()
    await expect(rowOf(page, vuln.en.title)).toBeVisible()
    await expect(rowOf(page, vuln.en.title)).toContainText(D.CATEGORY.name)
    await expect(rowOf(page, vuln.en.title)).toContainText('Web Application')

    // Saved data
    const api = await apiAs(D.USERS.admin)
    const saved = (await datas(await api.get('/api/vulnerabilities'))).find(v => v.details.some(d => d.title === vuln.en.title))
    expect(saved.category).toBe(D.CATEGORY.name)
    expect(saved.cvssv3).toBe('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')
    expect(saved.priority).toBe(3)
    expect(saved.remediationComplexity).toBe(2)
    const en = saved.details.find(d => d.locale === 'en')
    const fr = saved.details.find(d => d.locale === 'fr')
    expect(en.vulnType).toBe('Web Application')
    expect(en.description).toContain(vuln.en.description)
    expect(en.remediation).toContain(vuln.en.remediation)
    expect(en.references).toEqual(['https://owasp.org/www-community/attacks/SQL_Injection', 'CWE-89'])
    expect(en.customFields.find(f => f.text === 'Login form')).toBeTruthy()
    expect(fr.title).toBe(vuln.fr.title)
    expect(fr.vulnType).toBe('Application Web')
    expect(fr.description).toContain(vuln.fr.description)
    await api.dispose()
  })

  test('creation of other vulnerabilities without category', async ({ page }) => {
    for (const key of ['xss', 'csrf']) {
      const vuln = D.VULNS[key].en
      const modal = await openCreation(page, 'No Category')
      await qInput(modal, 'Title *').fill(vuln.title)
      await typeInEditor(editorContent(modal, 'Description'), vuln.description)
      await typeInEditor(editorContent(modal, 'Remediation'), vuln.remediation)
      await button(modal, 'Create').click()
      await expectNotification(page, 'Vulnerability created successfully')
      await expect(modal).toBeHidden()
      await expect(rowOf(page, vuln.title)).toContainText('No Category')
    }
    // Same title: refused
    const modal = await openCreation(page, 'No Category')
    await qInput(modal, 'Title *').fill(D.VULNS.xss.en.title)
    await button(modal, 'Create').click()
    await expectNotification(page, /already exists/i)
    await button(modal, 'Cancel').click()
  })

  test('edition: title, details and category change', async ({ page }) => {
    const vuln = D.VULNS.xss.en
    await rowOf(page, vuln.title).locator('button').filter({ has: page.locator('.fa-edit') }).click()
    const modal = dialog(page)
    await expect(modal.getByText('Edit Vulnerability (No Category)')).toBeVisible()
    await expect(qInput(modal, 'Title *')).toHaveValue(vuln.title)
    await expect(editorContent(modal, 'Description')).toContainText(vuln.description)

    await typeInEditor(editorContent(modal, 'Observation'), 'Observed on the search page.')
    await qSelect(modal, 'Type', 'Web Application')
    await qSelect(modal, 'Remediation Priority', 'Medium')

    // Category change: confirmation
    await modal.getByRole('button', { name: 'Change Category' }).click()
    await page.locator('.q-menu').getByText(D.CATEGORY.name, { exact: true }).click()
    const confirm = page.locator('.q-dialog').filter({ hasText: 'Confirm Category change' })
    await expect(confirm).toBeVisible()
    await button(confirm, 'Confirm').click()
    await expect(modal.getByText(`Edit Vulnerability (${D.CATEGORY.name})`)).toBeVisible()

    await button(modal, 'Update').click()
    await expectNotification(page, 'Vulnerability updated successfully')
    await expect(rowOf(page, vuln.title)).toContainText(D.CATEGORY.name)

    // Opened again: changes kept
    await rowOf(page, vuln.title).locator('button').filter({ has: page.locator('.fa-edit') }).click()
    await expect(editorContent(modal, 'Observation')).toContainText('Observed on the search page.')
    await expect(qField(modal, 'Remediation Priority')).toContainText('Medium')
    await button(modal, 'Cancel').click()
  })

  test('search, filters, sort and display language', async ({ page }) => {
    const titles = [D.VULNS.xss.en.title, D.VULNS.csrf.en.title, D.VULNS.sqli.en.title]
    await expect(rows(page)).toHaveCount(3)
    const searchRow = page.locator('.q-table tbody tr').first()

    // Title search (case insensitive)
    const titleSearch = searchRow.locator('.q-field').nth(0).locator('input')
    await titleSearch.fill('injection')
    await expect(rows(page)).toHaveCount(1)
    await expect(rowOf(page, D.VULNS.sqli.en.title)).toBeVisible()
    await titleSearch.fill('')
    await expect(rows(page)).toHaveCount(3)

    // Category filter
    await qSelect(searchRow, 'Search', 'No Category', { field: searchRow.locator('.q-field').nth(1) })
    await expect(rowOf(page, D.VULNS.csrf.en.title)).toBeVisible()
    await expect(rowOf(page, D.VULNS.sqli.en.title)).toHaveCount(0)
    await searchRow.locator('.q-field').nth(1).locator('.q-field__append .q-icon').filter({ hasText: 'cancel' }).click()
    await expect(rows(page)).toHaveCount(3)

    // Sorted by title (default, ascending), then descending
    const header = page.locator('.q-table thead th').filter({ hasText: 'Title' })
    const titleCells = page.locator('.q-table tbody tr td:first-child')
    await expect(titleCells.filter({ hasText: /^\s*E2E/ })).toHaveText(titles.slice().sort())
    await header.click()
    await expect(titleCells.filter({ hasText: /^\s*E2E/ })).toHaveText(titles.slice().sort().reverse())
    // Sort by category: "E2E Category" before "No Category"
    await page.locator('.q-table thead th').filter({ hasText: 'Category' }).click()
    await expect(titleCells.filter({ hasText: /^\s*E2E/ }).last()).toHaveText(D.VULNS.csrf.en.title)

    // Display language: French titles only
    await qSelect(page.locator('.q-table__top'), 'Language', 'Francais')
    await expect(rowOf(page, D.VULNS.sqli.fr.title)).toBeVisible()
    await expect(rowOf(page, D.VULNS.xss.en.title)).toHaveCount(0)
    await expect(rowOf(page, D.VULNS.sqli.fr.title)).toContainText('Application Web')
  })

  test('archives: an archived vulnerability leaves the list and can be restored', async ({ page }) => {
    const title = D.VULNS.csrf.en.title
    await rowOf(page, title).locator('button').filter({ has: page.locator('.mdi-archive-arrow-down-outline') }).click()
    await expectNotification(page, `${title} archived`)
    await expect(rowOf(page, title)).toHaveCount(0)

    await page.getByRole('tab', { name: /Archives/ }).click()
    await expect(page.getByText('Archived vulnerabilities are no longer proposed')).toBeVisible()
    await expect(rowOf(page, title)).toBeVisible()

    // Restore then archive again (kept archived for the audit specs)
    await rowOf(page, title).locator('button').filter({ has: page.locator('.mdi-archive-arrow-up-outline') }).click()
    await expectNotification(page, `${title} restored from archives`)
    await expect(rowOf(page, title)).toHaveCount(0)
    await page.getByRole('tab', { name: 'Vulnerabilities' }).click()
    await expect(rowOf(page, title)).toBeVisible()
    await rowOf(page, title).locator('button').filter({ has: page.locator('.mdi-archive-arrow-down-outline') }).click()
    await expectNotification(page, `${title} archived`)

    const api = await apiAs(D.USERS.admin)
    const saved = (await datas(await api.get('/api/vulnerabilities'))).find(v => v.details.some(d => d.title === title))
    expect(saved.archived).toBe(true)
    await api.dispose()
  })

  test('deletion with confirmation', async ({ page }) => {
    const modal = await openCreation(page, 'No Category')
    await qInput(modal, 'Title *').fill('E2E Vulnerability To Delete')
    await button(modal, 'Create').click()
    await expectNotification(page, 'Vulnerability created successfully')

    const row = rowOf(page, 'E2E Vulnerability To Delete')
    await row.locator('button').filter({ has: page.locator('.fa-trash') }).click()
    const confirm = page.locator('.q-dialog').filter({ hasText: 'Confirm Suppression' })
    await expect(confirm.getByText('Vulnerability will be permanently deleted')).toBeVisible()
    // Cancel keeps it
    await button(confirm, 'Cancel').click()
    await expect(row).toBeVisible()
    await row.locator('button').filter({ has: page.locator('.fa-trash') }).click()
    await button(page.locator('.q-dialog').filter({ hasText: 'Confirm Suppression' }), 'Confirm').click()
    await expectNotification(page, 'Vulnerability deleted successfully')
    await expect(row).toHaveCount(0)
  })
})
