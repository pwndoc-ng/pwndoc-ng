// Small screens (issue #283): below the drawer breakpoint, the side menus of the audit and of the Data pages are hidden
// and a floating button at the bottom left opens them. Above it, the menus are shown without the button.
const { test, expect } = require('@playwright/test')
const D = require('./support/data')
const { loginUI, ensureMainAudit } = require('./support/helpers')

let auditId

test.beforeAll(async () => {
  auditId = await ensureMainAudit()
})

const drawer = page => page.locator('aside.q-drawer--left')
const menuButton = page => page.locator('.q-page-sticky').getByRole('button').filter({ has: page.locator('.q-icon', { hasText: /^menu$/ }) })

// Floating button at the bottom left of the window
async function expectBottomLeft (page, locator) {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  expect(box.x).toBeLessThan(100)
  expect(box.y + box.height).toBeGreaterThan(viewport.height - 100)
}

const pages = [
  { name: 'audit', path: () => `/audits/${auditId}/general`, item: 'General Information' },
  { name: 'Data', path: () => '/data/collaborators', item: 'Handle Custom Data' }
]

for (const target of pages) {
  test.describe(`Side menu of the ${target.name} page`, () => {
    test('window of 900 px: menu hidden, opened with the floating button', async ({ page }) => {
      await page.setViewportSize({ width: 900, height: 800 })
      await loginUI(page, D.USERS.pentester)
      await page.goto(target.path())
      await expect(menuButton(page)).toBeVisible()
      await expectBottomLeft(page, menuButton(page))
      await expect(drawer(page)).not.toBeInViewport()

      await menuButton(page).click()
      await expect(drawer(page)).toBeInViewport()
      await expect(drawer(page).getByText(target.item)).toBeVisible()
      // Button hidden while the menu is open
      await expect(menuButton(page)).toHaveCount(0)

      // Closed by a click outside the menu (overlay): the button comes back
      await page.mouse.click(860, 400)
      await expect(drawer(page)).not.toBeInViewport()
      await expect(menuButton(page)).toBeVisible()
    })

    test('window of 1440 px: menu shown, no floating button', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await loginUI(page, D.USERS.pentester)
      await page.goto(target.path())
      await expect(drawer(page)).toBeInViewport()
      await expect(drawer(page).getByText(target.item)).toBeVisible()
      await expect(menuButton(page)).toHaveCount(0)
    })

    test('window resized from 1440 px to 900 px and back', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await loginUI(page, D.USERS.pentester)
      await page.goto(target.path())
      await expect(drawer(page)).toBeInViewport()
      await page.setViewportSize({ width: 900, height: 800 })
      await expect(drawer(page)).not.toBeInViewport()
      await expect(menuButton(page)).toBeVisible()
      await page.setViewportSize({ width: 1440, height: 900 })
      await expect(drawer(page)).toBeInViewport()
      await expect(menuButton(page)).toHaveCount(0)
    })
  })
}
