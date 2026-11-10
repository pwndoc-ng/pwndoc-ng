// First initialization, login/logout, session refresh and expiration, display language
const { test, expect } = require('@playwright/test')
const D = require('./support/data')
const { loginUI, apiAs, datas, BASE_URL } = require('./support/helpers')

const admin = D.USERS.admin

test.describe.configure({ mode: 'serial' })

test.describe('Authentication', () => {
  test('first start: the initialization form validates the fields and creates the first admin', async ({ page, request }) => {
    const init = await (await request.get('/api/users/init')).json()
    test.skip(init.datas !== true, 'Instance already initialized (run.sh starts with an empty database)')

    // Any page redirects to the login page, which shows the initialization form
    await page.goto('/audits')
    await expect(page).toHaveURL(/\/login/)
    const register = page.getByRole('button', { name: 'Register First User' })
    await expect(register).toBeVisible()
    await expect(page.getByRole('button', { name: 'Login' })).toHaveCount(0)

    // Required fields
    await register.click()
    await expect(page.getByText('Username required')).toBeVisible()
    await expect(page.getByText('Firstname required')).toBeVisible()
    await expect(page.getByText('Lastname required')).toBeVisible()
    await expect(page.getByText('Password required')).toBeVisible()

    // Password policy
    await page.getByLabel('Username').fill(admin.username)
    await page.getByLabel('Firstname').fill(admin.firstname)
    await page.getByLabel('Lastname').fill(admin.lastname)
    await page.getByLabel('Password').fill('weakpass')
    await register.click()
    await expect(page.getByText('Password must be at least 8 characters')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)

    // Creation: the admin is logged in
    await page.getByLabel('Password').fill(admin.password)
    await register.click()
    await expect(page).toHaveURL(/\/audits$/)
    await expect(page.getByRole('button', { name: admin.username })).toBeVisible()
    // Admin menus
    await expect(page.locator('.q-header').getByText('Settings')).toBeVisible()
    await expect(page.locator('.q-header').getByText('Data')).toBeVisible()
  })

  test('a second initialization is refused and the login form is shown', async ({ page, request }) => {
    const response = await request.post('/api/users/init', { data: { username: 'e2e-intruder', password: 'Intruder-2026', firstname: 'I', lastname: 'I' } })
    expect(response.status()).toBe(403)
    expect((await response.json()).datas).toBe('Already Initialized')

    await page.goto('/login')
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Register First User' })).toHaveCount(0)
  })

  test('login form: required fields and wrong password', async ({ page }) => {
    await page.goto('/login')
    const loginButton = page.getByRole('button', { name: 'Login' })
    await loginButton.click()
    await expect(page.getByText('Username required')).toBeVisible()
    await expect(page.getByText('Password required')).toBeVisible()

    await page.getByLabel('Username').fill(admin.username)
    await page.getByLabel('Password').fill('Wrong-Password-1')
    await loginButton.click()
    await expect(page.locator('.q-banner')).toContainText('Authentication Failed.')
    await expect(page).toHaveURL(/\/login/)

    // Unknown user: same message (no user enumeration)
    await page.getByLabel('Username').fill('e2e-unknown-user')
    await page.getByLabel('Password').fill('Wrong-Password-1')
    await loginButton.click()
    await expect(page.locator('.q-banner')).toContainText('Authentication Failed.')
  })

  test('login, reload keeps the session, logout ends it', async ({ page, context }) => {
    await loginUI(page, admin)
    await page.reload()
    await expect(page).toHaveURL(/\/audits$/)
    await expect(page.getByRole('button', { name: admin.username })).toBeVisible()

    // Logout from the user menu
    await page.getByRole('button', { name: admin.username }).click()
    await page.getByRole('button', { name: 'Logout' }).click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible()
    const cookies = await context.cookies()
    expect(cookies.filter(c => c.name === 'token' && c.value)).toHaveLength(0)
    // The session is revoked server side: a remaining refresh token is refused
    const refresh = await page.request.get('/api/users/refreshtoken')
    expect(refresh.status()).toBe(401)

    // Protected pages are no longer reachable
    await page.goto('/vulnerabilities')
    await expect(page).toHaveURL(/\/login/)
  })

  test('logout deletes the refresh token cookie', async ({ page, context }) => {
    await loginUI(page, admin)
    await page.getByRole('button', { name: admin.username }).click()
    await page.getByRole('button', { name: 'Logout' }).click()
    await expect(page).toHaveURL(/\/login/)
    expect((await context.cookies()).filter(c => c.name === 'refreshToken' && c.value)).toHaveLength(0)
  })

  test('the logged in user cannot see the login page', async ({ page }) => {
    await loginUI(page, admin)
    await page.goto('/login')
    await expect(page).toHaveURL(/\/audits$/)
  })

  test('expired access token: refreshed transparently with the refresh token', async ({ page, context }) => {
    await loginUI(page, admin)
    // Access token lost/expired (15 minutes lifetime): only the refresh token remains
    const cookies = await context.cookies()
    expect(cookies.some(c => c.name === 'token')).toBeTruthy()
    await context.clearCookies({ name: 'token' })

    // Navigation inside the application: the API answers 401, the token is refreshed and the request replayed
    const refresh = page.waitForResponse(r => r.url().includes('/api/users/refreshtoken') && r.request().method() === 'GET')
    const replayed = page.waitForResponse(r => r.url().endsWith('/api/data/languages') && r.status() === 200)
    await page.locator('.q-header').getByText('Vulnerabilities').click()
    expect((await refresh).status()).toBe(200)
    await replayed
    await expect(page).toHaveURL(/\/vulnerabilities$/)
    expect((await context.cookies()).some(c => c.name === 'token')).toBeTruthy()
  })

  test('session ended (refresh token rejected): back to the login page', async ({ page, context }) => {
    await loginUI(page, admin)
    // Refresh token replaced by an invalid one and access token removed
    const refreshCookie = (await context.cookies()).find(c => c.name === 'refreshToken')
    expect(refreshCookie).toBeTruthy()
    await context.clearCookies()
    await context.addCookies([{ ...refreshCookie, value: 'invalid.refresh.token' }])
    await page.reload()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible()

    // A revoked session (logout from another place) is also refused
    await loginUI(page, admin)
    const session = (await context.cookies()).filter(c => c.name === 'refreshToken')
    // Logout through the API with the cookies of the page: the session is removed server side
    const logout = await page.request.delete('/api/users/refreshtoken')
    expect(logout.ok()).toBeTruthy()
    await context.clearCookies()
    await context.addCookies(session) // Old refresh token put back: its session does not exist anymore
    await page.reload()
    await expect(page).toHaveURL(/\/login/)
  })

  test('login page messages for token errors', async ({ page }) => {
    await page.goto('/login?tokenError=2')
    await expect(page.locator('.q-banner')).toContainText('Expired token')
    await page.goto('/login?tokenError=1')
    await expect(page.locator('.q-banner')).toContainText('Invalid token')
  })

  test('display language: French then back to English', async ({ page }) => {
    await loginUI(page, admin)
    await page.goto('/settings')
    await expect(page.getByText('General Settings')).toBeVisible()
    await page.locator('.q-field').filter({ hasText: 'Language' }).first().locator('.q-field__control').click()
    await page.getByRole('option', { name: 'Français' }).click()

    const header = page.locator('.q-header')
    await expect(page.getByText('Réglages Généraux')).toBeVisible()
    await expect(header.getByText('Paramètres')).toBeVisible()
    await expect(header.getByText('Vulnérabilités')).toBeVisible()
    await expect(header.getByText('Données')).toBeVisible()

    // Kept after a reload (browser storage)
    await page.reload()
    await expect(page.getByText('Réglages Généraux')).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('system_language'))).toBe('fr-FR')

    // Back to English
    await page.locator('.q-field').filter({ hasText: 'Langue' }).first().locator('.q-field__control').click()
    await page.getByRole('option', { name: 'English' }).click()
    await expect(page.getByText('General Settings')).toBeVisible()
    await expect(header.getByText('Settings')).toBeVisible()
  })
})

test('API sanity: the admin token gives access to the users list', async () => {
  const api = await apiAs(admin)
  const users = await datas(await api.get('/api/users'))
  expect(users.map(u => u.username)).toContain(admin.username)
  await api.dispose()
  expect(BASE_URL).toMatch(/^https:\/\//)
})
