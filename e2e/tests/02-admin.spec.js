// Administration from the user interface: users, custom data, companies/clients, report template, settings.
// The data created here is used by the next specs (see support/data.js).
const path = require('path')
const { test, expect } = require('@playwright/test')
const D = require('./support/data')
const {
  qField, qInput, qSelect, expectNotification, dialog, button, loginUI, apiAs, datas, ensureInitialized, TEMPLATES_DIR
} = require('./support/helpers')

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await ensureInitialized()
})

test.beforeEach(async ({ page }) => {
  await loginUI(page, D.USERS.admin)
})

async function createCollaborator (page, user) {
  await page.getByRole('button', { name: 'Add Collaborator' }).click()
  const modal = dialog(page)
  await expect(modal.getByText('Add Collaborator')).toBeVisible()
  await qInput(modal, 'Username *').fill(user.username)
  await qInput(modal, 'Firstname *').fill(user.firstname)
  await qInput(modal, 'Lastname *').fill(user.lastname)
  if (user.email) await qInput(modal, 'Email').fill(user.email)
  await qSelect(modal, 'Role *', user.role)
  await qInput(modal, 'Password *').fill(user.password)
  await button(modal, 'Create').click()
  await expectNotification(page, 'Collaborator created successfully')
  await expect(modal).toBeHidden()
}

test.describe('Administration', () => {
  test('users: creation with roles, password policy, deactivation', async ({ page, browser }) => {
    await page.locator('.q-header').getByText('Data').click()
    await expect(page).toHaveURL(/\/data\/collaborators$/)
    const table = page.locator('.q-table')
    await expect(table.getByText(D.USERS.admin.username)).toBeVisible()

    // Password policy checked before the creation
    await page.getByRole('button', { name: 'Add Collaborator' }).click()
    const modal = dialog(page)
    await qInput(modal, 'Username *').fill('e2e-weak')
    await qInput(modal, 'Firstname *').fill('Weak')
    await qInput(modal, 'Lastname *').fill('Password')
    await qSelect(modal, 'Role *', 'user')
    await qInput(modal, 'Password *').fill('weak')
    await button(modal, 'Create').click()
    await expect(modal.getByText('Password must be at least 8 characters')).toBeVisible()
    await button(modal, 'Cancel').click()
    await expect(modal).toBeHidden()

    for (const key of ['reviewer', 'pentester', 'pentester2', 'disabled']) {
      await createCollaborator(page, D.USERS[key])
      await expect(table.getByRole('row').filter({ hasText: D.USERS[key].username })).toBeVisible()
    }

    // Duplicate username refused
    await page.getByRole('button', { name: 'Add Collaborator' }).click()
    await qInput(modal, 'Username *').fill(D.USERS.pentester.username)
    await qInput(modal, 'Firstname *').fill('Dup')
    await qInput(modal, 'Lastname *').fill('Licate')
    await qSelect(modal, 'Role *', 'user')
    await qInput(modal, 'Password *').fill('Duplicate-2026')
    await button(modal, 'Create').click()
    await expectNotification(page, /already exists/i)
    await button(modal, 'Cancel').click()

    // Search by username
    const usernameSearch = table.locator('thead, tbody').getByLabel('Search').first()
    await usernameSearch.fill('pentester2')
    await expect(table.getByRole('row').filter({ hasText: D.USERS.pentester2.username })).toBeVisible()
    await expect(table.getByRole('row').filter({ hasText: D.USERS.reviewer.username })).toHaveCount(0)
    await usernameSearch.fill('')

    // Deactivation of an account
    const row = table.getByRole('row').filter({ hasText: D.USERS.disabled.username })
    await row.locator('button').filter({ has: page.locator('.fa-edit') }).click()
    await expect(modal.getByText('Edit Collaborator')).toBeVisible()
    await modal.getByRole('switch', { name: 'Account enabled' }).click()
    await expect(modal.getByText('Account disabled')).toBeVisible()
    await button(modal, 'Update').click()
    await expectNotification(page, 'Collaborator updated successfully')
    await expect(table.getByRole('row').filter({ hasText: D.USERS.disabled.username })).toHaveCount(0)

    // Disabled accounts listed with the toggle of the table
    await page.getByRole('switch', { name: 'Enabled accounts' }).click()
    await expect(table.getByRole('row').filter({ hasText: D.USERS.disabled.username })).toBeVisible()

    // The disabled user cannot log in
    const other = await browser.newContext()
    const otherPage = await other.newPage()
    await otherPage.goto('/login')
    await otherPage.getByLabel('Username').fill(D.USERS.disabled.username)
    await otherPage.getByLabel('Password').fill(D.USERS.disabled.password)
    await otherPage.getByRole('button', { name: 'Login' }).click()
    await expect(otherPage.locator('.q-banner')).toContainText('Account disabled')
    await other.close()

    // Users with the admin role can review audits
    const api = await apiAs(D.USERS.admin)
    const reviewers = (await datas(await api.get('/api/users/reviewers'))).map(u => u.username)
    expect(reviewers).toEqual(expect.arrayContaining([D.USERS.admin.username, D.USERS.reviewer.username]))
    expect(reviewers).not.toContain(D.USERS.pentester.username)
    await api.dispose()
  })

  test('custom data: languages', async ({ page }) => {
    await page.goto('/data/custom')
    await page.getByRole('tab', { name: 'Languages' }).click()
    // Required fields
    await button(page, '+').click()
    await expect(page.getByText('Language is required')).toBeVisible()

    for (const language of D.LANGUAGES) {
      await qInput(page, 'Language').fill(language.language)
      await qInput(page, 'Locale').fill(language.locale)
      await button(page, '+').click()
      await expectNotification(page, 'Language created successfully')
    }
    const list = page.locator('.q-card').filter({ hasText: 'List of Languages' })
    for (const language of D.LANGUAGES) {
      await expect(list.locator(`input[value="${language.locale}"]`)).toHaveCount(1)
    }

    // Invalid characters refused by the backend
    await qInput(page, 'Language').fill('Bad<Language>')
    await qInput(page, 'Locale').fill('xx')
    await button(page, '+').click()
    await expectNotification(page, /must match/)
  })

  test('report template: upload of the default template', async ({ page }) => {
    await page.goto('/data/templates')
    await page.getByRole('button', { name: 'Create Template' }).click()
    const modal = dialog(page)
    // Required fields
    await button(modal, 'Create').click()
    await expect(modal.getByText('Name required')).toBeVisible()
    await expect(modal.getByText('File required')).toBeVisible()

    await qInput(modal, 'Name *').fill(D.TEMPLATE.name)
    await modal.locator('input[type=file]').setInputFiles(path.join(TEMPLATES_DIR, D.TEMPLATE.file))
    await expect(modal.getByText(D.TEMPLATE.file)).toBeVisible()
    await button(modal, 'Create').click()
    await expectNotification(page, 'Template created successfully')
    const row = page.getByRole('row').filter({ hasText: D.TEMPLATE.name })
    await expect(row).toBeVisible()
    await expect(row).toContainText('docx')

    // Download of the uploaded template: same file
    const downloadPromise = page.waitForEvent('download')
    await row.locator('button').filter({ has: page.locator('.fa-download') }).click()
    const download = await downloadPromise
    const fs = require('fs')
    const downloaded = fs.readFileSync(await download.path())
    expect(downloaded.equals(fs.readFileSync(path.join(TEMPLATES_DIR, D.TEMPLATE.file)))).toBeTruthy()
  })

  test('custom data: sections, audit types, vulnerability types and categories', async ({ page }) => {
    await page.goto('/data/custom')

    // Custom section
    await page.getByRole('tab', { name: 'Custom Sections' }).click()
    await qInput(page, 'Name').fill(D.SECTION.name)
    await qInput(page, 'Field (For Template)').fill(D.SECTION.field)
    await qInput(page, 'Icon (Material/Font Awesome)').fill(D.SECTION.icon)
    await button(page, '+').click()
    await expectNotification(page, 'Section created successfully')
    await expect(page.locator('.q-card').filter({ hasText: 'List of Sections' }).locator(`input[value="${D.SECTION.field}"]`)).toHaveCount(1)

    // Audit type: one template per language, custom section
    await page.getByRole('tab', { name: 'Audit Types' }).click()
    await button(page, 'Create').click()
    await expect(page.getByText('Name is required')).toBeVisible()
    await qInput(page, 'Name *').fill(D.AUDIT_TYPE.name)
    for (const language of D.LANGUAGES) {
      await qSelect(page, `${language.language} Template *`, D.TEMPLATE.name)
    }
    await qSelect(page, 'Add Sections', D.SECTION.name)
    await button(page, 'Create').click()
    await expectNotification(page, 'Audit type created successfully')
    const auditTypes = page.locator('.q-card').filter({ hasText: 'List of Audit Types' })
    await expect(auditTypes.getByText(D.AUDIT_TYPE.name)).toBeVisible()

    // Vulnerability types: one per language
    await page.getByRole('tab', { name: 'Vulnerability Types' }).click()
    for (const type of D.VULN_TYPES) {
      const language = D.LANGUAGES.find(l => l.locale === type.locale).language
      await qSelect(page, 'Language', language)
      await qInput(page, 'Name').fill(type.name)
      await qInput(page, 'Name').press('Enter')
      await expectNotification(page, 'Vulnerability type created successfully')
      await expect(page.locator('.q-list').getByText(type.name, { exact: true })).toBeVisible()
    }
    // Types are listed per language
    await qSelect(page, 'Language', 'English')
    await expect(page.locator('.q-list').getByText('Web Application', { exact: true })).toBeVisible()
    await expect(page.locator('.q-list').getByText('Application Web', { exact: true })).toHaveCount(0)

    // Category
    await page.getByRole('tab', { name: 'Vulnerability Categories' }).click()
    await qInput(page, 'Name').fill(D.CATEGORY.name)
    await qSelect(page, 'Sort By', 'CVSS Score')
    await qSelect(page, 'Sort Order', 'Descending')
    await button(page, 'Create').click()
    await expectNotification(page, 'Vulnerability category created successfully')
    await expect(page.locator('.q-card').filter({ hasText: 'List of Categories' }).locator(`input[value="${D.CATEGORY.name}"]`)).toHaveCount(1)
  })

  test('custom data: custom fields for the audits and the vulnerabilities', async ({ page }) => {
    await page.goto('/data/custom')
    await page.getByRole('tab', { name: 'Custom Fields' }).click()

    // Audit general tab
    await qSelect(page, 'Select View', 'Audit General')
    await qSelect(page, 'Select Component', 'Input')
    await qInput(page, 'Label').fill(D.CUSTOM_FIELDS.general.label)
    await button(page, 'Add').click()
    await expectNotification(page, 'Custom Field created successfully')

    // Findings and vulnerabilities
    await qSelect(page, 'Select View', 'Vulnerability')
    await qSelect(page, 'Select Component', 'Input')
    await qInput(page, 'Label').fill(D.CUSTOM_FIELDS.finding.label)
    await button(page, 'Add').click()
    await expectNotification(page, 'Custom Field created successfully')
    // Preview of the fields of the view
    await expect(page.locator('.q-field__label').getByText(D.CUSTOM_FIELDS.finding.label, { exact: true })).toBeVisible()

    const api = await apiAs(D.USERS.admin)
    const fields = await datas(await api.get('/api/data/custom-fields'))
    expect(fields.map(f => `${f.display}:${f.label}`)).toEqual(expect.arrayContaining([
      `general:${D.CUSTOM_FIELDS.general.label}`, `vulnerability:${D.CUSTOM_FIELDS.finding.label}`
    ]))
    await api.dispose()
  })

  test('companies and clients', async ({ page }) => {
    await page.goto('/data/companies')
    await page.getByRole('button', { name: 'Add Company' }).click()
    let modal = dialog(page)
    await qInput(modal, 'Name *').fill(D.COMPANY.name)
    await qInput(modal, 'Short name').fill(D.COMPANY.shortName)
    await button(modal, 'Create').click()
    await expectNotification(page, 'Company created successfully')
    await expect(page.getByRole('row').filter({ hasText: D.COMPANY.name })).toBeVisible()

    await page.goto('/data/clients')
    await page.getByRole('button', { name: 'Add Client' }).click()
    modal = dialog(page)
    await qSelect(modal, 'Company', D.COMPANY.name)
    await qInput(modal, 'Firstname *').fill(D.CLIENT.firstname)
    await qInput(modal, 'Lastname *').fill(D.CLIENT.lastname)
    await qInput(modal, 'Email *').fill(D.CLIENT.email)
    await button(modal, 'Create').click()
    await expectNotification(page, 'Client created successfully')
    const row = page.getByRole('row').filter({ hasText: D.CLIENT.email })
    await expect(row).toBeVisible()
    await expect(row).toContainText(D.COMPANY.name)
  })

  test('settings: reviews enabled with one approval', async ({ page }) => {
    await page.locator('.q-header').getByText('Settings').click()
    await expect(page).toHaveURL(/\/settings$/)
    // One section at a time (tabs), the section kept in the address
    await expect(page.getByText('General Settings')).toBeVisible()
    await page.locator('.settings-tabs .settings-tab--reviews').click()
    await expect(page).toHaveURL(/\/settings\?tab=reviews$/)
    await expect(page.getByText('General Settings')).toBeHidden()
    const reviews = page.locator('.q-card').filter({ has: page.locator('.text-h6', { hasText: /^Reviews$/ }) })
    const enable = reviews.getByRole('switch').first()
    await expect(enable).toHaveAttribute('aria-checked', 'false')
    await enable.click()
    await expect(enable).toHaveAttribute('aria-checked', 'true')
    const minReviewers = reviews.locator('.q-field').filter({ hasText: 'Minimal number of reviewers' }).locator('input')
    await expect(minReviewers).toBeEnabled()
    await minReviewers.fill('1')
    await button(page, 'Save settings').click()
    await expectNotification(page, 'Settings updated successfully')

    // Kept after a reload, on the same section
    await page.reload()
    await expect(reviews.getByRole('switch').first()).toBeVisible()
    await expect(reviews.getByRole('switch').first()).toHaveAttribute('aria-checked', 'true')
    await expect(minReviewers).toHaveValue('1')
    const api = await apiAs(D.USERS.admin)
    const settings = await datas(await api.get('/api/settings'))
    expect(settings.reviews.enabled).toBe(true)
    expect(settings.reviews.public.minReviewers).toBe(1)
    await api.dispose()
  })
})
