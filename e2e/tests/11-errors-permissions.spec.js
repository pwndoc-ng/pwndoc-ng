// Errors and permissions: backend unavailable, connection lost and recovered, pages and actions of a user without
// the admin role, audit of another user
const { test, expect } = require('@playwright/test')
const D = require('./support/data')
const { loginUI, apiAs, datas, ensureMainAudit, ensureAudit, newUserContext } = require('./support/helpers')

const BACKEND_ERROR = 'Something went wrong contacting backend'

// Backend stopped behind nginx: every API request answers 502 Bad Gateway, the socket cannot connect
async function stopBackend (page) {
  await page.route('**/api/**', route => route.fulfill({ status: 502, contentType: 'text/html', body: '<html><body>502 Bad Gateway</body></html>' }))
  await page.route('**/socket.io/**', route => route.fulfill({ status: 502, contentType: 'text/html', body: '502 Bad Gateway' }))
}

test.describe('Backend unavailable', () => {
  test('at load: message on the login page, application usable once the backend is back', async ({ page }) => {
    await stopBackend(page)
    await page.goto('/audits')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText(BACKEND_ERROR)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Login' })).toHaveCount(0)

    await page.unrouteAll()
    await page.reload()
    await expect(page.getByText(BACKEND_ERROR)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible()
    await loginUI(page, D.USERS.pentester)
  })

  test('connection lost while working: message shown, hidden once reconnected', async ({ page }) => {
    // Audit page: the socket is connected (list of the connected users)
    const auditId = await ensureMainAudit()
    await loginUI(page, D.USERS.pentester)
    await page.goto(`/audits/${auditId}/general`)
    await expect(page.locator('.q-drawer--left').getByText(`${D.USERS.pentester.username} (me)`)).toBeVisible()
    // Backend down: new connections refused, the current socket connection is closed
    let backendDown = true
    await page.route('**/socket.io/**', route => backendDown ? route.fulfill({ status: 502, body: '502 Bad Gateway' }) : route.continue())
    await page.routeWebSocket(/\/socket\.io\//, ws => { if (backendDown) ws.close(); else ws.connectToServer() })
    await page.evaluate(() => document.querySelector('#q-app').__vue_app__.config.globalProperties.$socket.io.engine.close())
    // Shown after the delay of the message (5 s)
    await expect(page.getByText(BACKEND_ERROR)).toBeVisible({ timeout: 30_000 })

    // Backend back: automatic reconnection, message hidden
    backendDown = false
    await expect(page.getByText(BACKEND_ERROR)).toBeHidden({ timeout: 30_000 })
    await expect(page.locator('.q-drawer--left').getByText(`${D.USERS.pentester.username} (me)`)).toBeVisible()
    await page.locator('.q-header').getByText('Vulnerabilities').click()
    await expect(page).toHaveURL(/\/vulnerabilities$/)
  })
})

test.describe('Permissions of a user without the admin role', () => {
  test.beforeAll(async () => {
    await ensureMainAudit()
  })

  test.beforeEach(async ({ page }) => {
    await loginUI(page, D.USERS.pentester2)
  })

  test('data pages: lists readable, administration actions hidden', async ({ page }) => {
    await page.goto('/data/collaborators')
    await expect(page.getByRole('row').filter({ hasText: D.USERS.admin.username })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add Collaborator' })).toHaveCount(0)
    await expect(page.locator('.q-table .fa-edit')).toHaveCount(0)

    await page.goto('/data/templates')
    await expect(page.getByRole('row').filter({ hasText: D.TEMPLATE.name })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create Template' })).toHaveCount(0)
    await expect(page.locator('.q-table .fa-trash')).toHaveCount(0)

    await page.goto('/data/custom')
    await page.getByRole('tab', { name: 'Languages' }).click()
    const languages = page.locator('.q-card--bordered').filter({ hasText: 'List of Languages' })
    await expect(languages).toBeVisible()
    await expect(page.getByRole('button', { name: '+' })).toHaveCount(0)
    await expect(languages.locator('.fa-edit')).toHaveCount(0)
    await page.getByRole('tab', { name: 'Custom Fields' }).click()
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0)

    await page.goto('/data/dump')
    await expect(page.getByRole('tab', { name: /Backups/ })).toHaveCount(0)
  })

  test('settings: display language only, administration settings hidden', async ({ page }) => {
    await page.locator('.q-header').getByText('Settings').click()
    await expect(page.getByText('General Settings')).toBeVisible()
    await expect(page.getByText('Display Language')).toBeVisible()
    await expect(page.getByText('Dangerous Settings')).toHaveCount(0)
    await expect(page.locator('.text-h6', { hasText: /^Reviews$/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0)
  })

  test('vulnerabilities: no creation, no merge, no edition', async ({ page }) => {
    await page.locator('.q-header').getByText('Vulnerabilities').click()
    await expect(page.locator('.q-table tbody tr').filter({ hasText: 'E2E' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'New Vulnerability' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Merge Vulnerabilities' })).toHaveCount(0)
    await expect(page.locator('.q-table .fa-edit')).toHaveCount(0)
    await expect(page.locator('.q-table .fa-trash')).toHaveCount(0)
  })

  test('audit of another user: not listed, not readable', async ({ page }) => {
    const admin = await apiAs(D.USERS.admin)
    const privateAudit = await ensureAudit(admin, 'E2E Admin Private Audit')
    await admin.dispose()

    await expect(page.getByRole('row').filter({ hasText: D.AUDIT.name })).toBeVisible() // Collaborator of this one
    await expect(page.getByRole('row').filter({ hasText: 'E2E Admin Private Audit' })).toHaveCount(0)
    const api = await apiAs(D.USERS.pentester2)
    expect([403, 404]).toContain((await api.get(`/api/audits/${privateAudit}`)).status())
    expect([403, 404]).toContain((await api.get(`/api/audits/${privateAudit}/general`)).status())
    await api.dispose()
    await page.goto(`/audits/${privateAudit}/general`)
    await expect(page.getByText('E2E Admin Private Audit')).toHaveCount(0)
  })

  test('audit of another user: redirected to the 403/404 page with the reason', async ({ page }) => {
    const admin = await apiAs(D.USERS.admin)
    const privateAudit = await ensureAudit(admin, 'E2E Admin Private Audit')
    await admin.dispose()
    await page.goto(`/audits/${privateAudit}/general`)
    // Page of the error with its reason in the path, e.g. /404/Audit%20not%20found%20or%20Insufficient%20Privileges
    await expect(page).toHaveURL(/\/(403|404)(\/[^/]+)?$/)
    await expect(page.getByText(/\((403|404)\)/)).toBeVisible()
    await expect(page.getByText('Audit not found or Insufficient Privileges')).toBeVisible()
    await expect(page.getByText('There are unsaved changes')).toHaveCount(0)
  })

  test('API: administration requests refused', async () => {
    const api = await apiAs(D.USERS.pentester2)
    expect((await api.put('/api/settings', { data: {} })).status()).toBe(403)
    expect((await api.post('/api/users', { data: [{ username: 'e2e-hacker', password: 'Hacker-2026', firstname: 'H', lastname: 'H' }] })).status()).toBe(403)
    expect((await api.get('/api/backups')).status()).toBe(403)
    expect((await api.post('/api/data/languages', { data: { language: 'Hack', locale: 'hk' } })).status()).toBe(403)
    expect((await api.post('/api/vulnerabilities', { data: [{ details: [{ locale: 'en', title: 'E2E Hack' }] }] })).status()).toBe(403)
    const users = await datas(await api.get('/api/users'))
    expect(users.some(u => u.username === 'e2e-hacker')).toBe(false)
    await api.dispose()
  })

  test('the collaborator can edit the shared audit but not delete it from the list of another creator', async ({ browser }) => {
    const { context, page } = await newUserContext(browser, D.USERS.pentester2)
    await page.goto('/audits')
    const row = page.getByRole('row').filter({ hasText: D.AUDIT.name })
    await expect(row).toBeVisible()
    const api = await apiAs(D.USERS.pentester2)
    const audit = (await datas(await api.get('/api/audits'))).find(a => a.name === D.AUDIT.name)
    // Deletion reserved to the creator
    expect((await api.delete(`/api/audits/${audit._id}`)).status()).not.toBe(200)
    expect((await datas(await api.get('/api/audits'))).some(a => a.name === D.AUDIT.name)).toBe(true)
    await api.dispose()
    await context.close()
  })
})
