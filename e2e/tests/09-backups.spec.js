// Backups: creation (full, partial with password), download, upload of a file larger than 10 MB (nginx limit,
// issue #519), restore in merge mode and in replace mode, encrypted backup restore
const fs = require('fs')
const crypto = require('crypto')
const { test, expect } = require('@playwright/test')
const D = require('./support/data')
const { unzip } = require('./support/zip')
const {
  qInput, expectNotification, waitForApi, loginUI, apiAs, datas, ensureBaseData, ensureVulnerability
} = require('./support/helpers')

test.describe.configure({ mode: 'serial' })

const FULL = 'E2E Full Backup'
const PARTIAL = 'E2E Partial Encrypted'
const BACKUP_PASSWORD = 'Backup-Pass-2026'
const AFTER_BACKUP = 'E2E Created After Backup'

const card = page => page.locator('.q-card').filter({ has: page.getByRole('button', { name: 'Create a backup' }) })
const rowOf = (page, name) => card(page).locator('tbody tr').filter({ hasText: name })

test.beforeAll(async () => {
  await ensureBaseData()
  const api = await apiAs(D.USERS.admin)
  await ensureVulnerability(api, D.VULNS.xss.en)
  // Backups of a previous run removed (spec run again on the same instance)
  for (const backup of await datas(await api.get('/api/backups'))) {
    if (backup.name.startsWith('E2E ') || backup.name.startsWith('e2e-')) await api.delete(`/api/backups/${backup.id}`)
  }
  await api.dispose()
})

test.beforeEach(async ({ page }) => {
  await loginUI(page, D.USERS.admin)
  await page.goto('/data/dump')
  await page.getByRole('tab', { name: /Backups/ }).click()
  await expect(card(page)).toBeVisible()
})

// Keeps only the given categories checked in the restore dialog (group checkboxes toggle their categories)
async function keepCategories (dialog, labels) {
  const keep = name => labels.some(label => name.startsWith(label))
  for (let pass = 0; pass < 3; pass++) {
    const boxes = dialog.getByRole('checkbox')
    for (let i = 0; i < await boxes.count(); i++) {
      const box = boxes.nth(i)
      const name = (await box.getAttribute('aria-label')) || (await box.innerText())
      const state = await box.getAttribute('aria-checked')
      if (keep(name) ? state !== 'true' : state !== 'false') await box.click()
    }
  }
}

async function vulnerabilityTitles () {
  const api = await apiAs(D.USERS.admin)
  const titles = (await datas(await api.get('/api/vulnerabilities'))).flatMap(v => v.details.map(d => d.title))
  await api.dispose()
  return titles
}

test.describe('Backups', () => {
  test('creation of a full backup and of a partial encrypted backup', async ({ page }) => {
    // Full
    await card(page).getByRole('button', { name: 'Create a backup' }).click()
    let dialog = page.locator('.q-dialog').filter({ hasText: 'Create a backup' })
    await qInput(dialog, 'Name').fill(FULL)
    await expect(dialog.getByRole('radio', { name: 'All the data' })).toHaveAttribute('aria-checked', 'true')
    await dialog.getByRole('button', { name: 'Create the backup' }).click()
    await expectNotification(page, 'Backup created')
    await expect(rowOf(page, FULL)).toContainText('All the data')

    // Partial (vulnerabilities, images added as a dependency), encrypted
    await card(page).getByRole('button', { name: 'Create a backup' }).click()
    dialog = page.locator('.q-dialog').filter({ hasText: 'Create a backup' })
    await qInput(dialog, 'Name').fill(PARTIAL)
    await dialog.getByRole('radio', { name: 'Partial' }).click()
    await dialog.getByRole('checkbox', { name: 'Vulnerabilities and proposals' }).click()
    await expect(dialog.getByRole('checkbox', { name: 'Images' })).toHaveAttribute('aria-checked', 'true')
    await qInput(dialog, 'Encryption password (optional)').fill(BACKUP_PASSWORD)
    await qInput(dialog, 'Confirm the password').fill('Another-Pass-2026')
    await expect(dialog.getByText('Passwords do not match')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Create the backup' })).toBeDisabled()
    await qInput(dialog, 'Confirm the password').fill(BACKUP_PASSWORD)
    await dialog.getByRole('button', { name: 'Create the backup' }).click()
    await expectNotification(page, 'Backup created')
    const partial = rowOf(page, PARTIAL)
    await expect(partial).toContainText('Partial')
    await expect(partial.locator('.mdi-lock')).toBeVisible()
  })

  test('download: zip archive with the manifest and the data, encrypted archive not readable', async ({ page }) => {
    let downloadPromise = page.waitForEvent('download')
    await rowOf(page, FULL).locator('button').filter({ has: page.locator('.mdi-download') }).click()
    let download = await downloadPromise
    const archive = fs.readFileSync(await download.path())
    const zip = unzip(archive)
    const manifest = JSON.parse(zip.read('manifest.json').toString('utf8'))
    expect(manifest.format).toBe('pwndoc-ng-backup')
    expect(manifest.name).toBe(FULL)
    expect(zip.names.some(name => /^data\/Audit\.json$/.test(name))).toBeTruthy()
    expect(zip.read('data/Vulnerability.json').toString('utf8')).toContain(D.VULNS.xss.en.title)
    expect(zip.names.some(name => name.startsWith('templates/'))).toBeTruthy()

    downloadPromise = page.waitForEvent('download')
    await rowOf(page, PARTIAL).locator('button').filter({ has: page.locator('.mdi-download') }).click()
    download = await downloadPromise
    const encrypted = fs.readFileSync(await download.path())
    expect(encrypted.subarray(0, 2).toString('latin1')).not.toBe('PK')
    expect(encrypted.toString('latin1')).not.toContain(D.VULNS.xss.en.title)
  })

  test('upload of a backup larger than 10 MB (#519): accepted by nginx and the backend', async ({ page }, testInfo) => {
    // Valid backup of more than 10 MB: backup of the images with large images (random data, not compressible;
    // 3 images of 5.3 MB, a MongoDB document is limited to 16 MB)
    const api = await apiAs(D.USERS.admin)
    const images = []
    for (let i = 0; i < 3; i++) {
      const value = 'data:image/png;base64,' + crypto.randomBytes(4 * 1024 * 1024).toString('base64')
      const response = await api.post('/api/images', { data: { value, name: `e2e-large-${i}.png` } })
      expect(response.status(), await response.text()).toBe(201)
      images.push(await datas(response))
    }
    let file
    try {
      const created = await datas(await api.post('/api/backups', { data: { name: 'E2E Large Backup', categories: ['images'] }, timeout: 120_000 }))
      const response = await api.get(`/api/backups/${created.id}/download`, { timeout: 120_000 })
      const buffer = await response.body()
      expect(buffer.length).toBeGreaterThan(10 * 1024 * 1024)
      file = testInfo.outputPath('e2e-large-backup.zip')
      fs.writeFileSync(file, buffer)
      await api.delete(`/api/backups/${created.id}`)
    } finally {
      for (const image of images) await api.delete(`/api/images/${image._id}`)
      await api.dispose()
    }

    const uploaded = waitForApi(page, 'POST', /\/api\/backups\/upload$/)
    await card(page).locator('input[type=file]').setInputFiles(file)
    const response = await uploaded
    expect(response.status(), 'not rejected by nginx (413 Request Entity Too Large)').toBe(201)
    await expectNotification(page, 'e2e-large-backup.zip added to the backups')
    // Name of the backup kept from its manifest
    const row = rowOf(page, 'E2E Large Backup')
    await expect(row).toContainText('Uploaded')
    await expect(row).toContainText('Partial')
    fs.unlinkSync(file)
  })

  test('restore in merge mode: data of the backup put back, newer data kept', async ({ page }) => {
    // Changes after the backup: new vulnerability, deleted vulnerability
    const api = await apiAs(D.USERS.admin)
    await ensureVulnerability(api, { title: AFTER_BACKUP, description: 'After', remediation: 'After' })
    const xss = (await datas(await api.get('/api/vulnerabilities'))).find(v => v.details.some(d => d.title === D.VULNS.xss.en.title))
    expect((await api.delete(`/api/vulnerabilities/${xss._id}`)).ok()).toBeTruthy()
    await api.dispose()
    expect(await vulnerabilityTitles()).not.toContain(D.VULNS.xss.en.title)

    await rowOf(page, FULL).locator('button').filter({ has: page.locator('.mdi-backup-restore') }).click()
    const dialog = page.locator('.q-dialog').filter({ hasText: `Restore ${FULL}` })
    await expect(dialog.getByRole('radio', { name: 'Merge with the current data' })).toHaveAttribute('aria-checked', 'true')
    await keepCategories(dialog, ['Vulnerabilities and proposals'])
    await expect(dialog.getByRole('checkbox', { name: /^Vulnerabilities and proposals/ })).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByRole('checkbox', { name: /^Audits/ })).toHaveAttribute('aria-checked', 'false')
    await dialog.getByRole('button', { name: 'Restore', exact: true }).click()
    await expectNotification(page, /documents and \d+ report templates restored/)

    const titles = await vulnerabilityTitles()
    expect(titles).toContain(D.VULNS.xss.en.title) // Put back
    expect(titles).toContain(AFTER_BACKUP) // Kept (merge)
  })

  test('restore in replace mode: current data of the category replaced, after a confirmation', async ({ page }) => {
    await rowOf(page, FULL).locator('button').filter({ has: page.locator('.mdi-backup-restore') }).click()
    const dialog = page.locator('.q-dialog').filter({ hasText: `Restore ${FULL}` })
    await dialog.getByRole('radio', { name: 'Replace the current data' }).click()
    await expect(dialog.getByText('The current data of the selected categories is lost')).toBeVisible()
    await keepCategories(dialog, ['Vulnerabilities and proposals'])
    await dialog.getByRole('button', { name: 'Restore', exact: true }).click()
    const confirm = page.locator('.q-dialog').filter({ hasText: 'Replace the current data?' })
    await expect(confirm).toContainText('Vulnerabilities and proposals')
    await confirm.getByRole('button', { name: 'Restore' }).click()
    await expectNotification(page, /documents and \d+ report templates restored/)

    const titles = await vulnerabilityTitles()
    expect(titles).toContain(D.VULNS.xss.en.title)
    expect(titles).not.toContain(AFTER_BACKUP) // Not in the backup: removed
    // Other data untouched
    const api = await apiAs(D.USERS.admin)
    expect((await datas(await api.get('/api/audits'))).length).toBeGreaterThan(0)
    await api.dispose()
  })

  test('restore of the encrypted backup: password required and checked', async ({ page }) => {
    await rowOf(page, PARTIAL).locator('button').filter({ has: page.locator('.mdi-backup-restore') }).click()
    const dialog = page.locator('.q-dialog').filter({ hasText: `Restore ${PARTIAL}` })
    const restore = dialog.getByRole('button', { name: 'Restore', exact: true })
    await expect(restore).toBeDisabled()
    await qInput(dialog, 'Password of the backup').fill('Wrong-Pass-2026')
    await restore.click()
    await expectNotification(page, /password|decrypt/i)
    await qInput(dialog, 'Password of the backup').fill(BACKUP_PASSWORD)
    await restore.click()
    await expectNotification(page, /documents and \d+ report templates restored/)
    expect(await vulnerabilityTitles()).toContain(D.VULNS.xss.en.title)
  })

  test('deletion of a backup', async ({ page }) => {
    await rowOf(page, 'E2E Large Backup').locator('button').filter({ has: page.locator('.q-icon', { hasText: /^delete$/ }) }).click()
    const confirm = page.locator('.q-dialog').filter({ hasText: 'Delete the backup?' })
    await confirm.getByRole('button', { name: /OK|Delete|Confirm/ }).click()
    await expectNotification(page, 'Backup deleted')
    await expect(rowOf(page, 'E2E Large Backup')).toHaveCount(0)
  })
})
