// Review of an audit: submission by the pentester, comments of the reviewer on a text selection and on an image,
// reply, resolution, approval blocked while comments are open, approval, approved audit read-only
const { test, expect } = require('@playwright/test')
const D = require('./support/data')
const {
  qInput, expectNotification, editorContent, newUserContext, apiAs, datas, ensureMainAudit
} = require('./support/helpers')

test.describe.configure({ mode: 'serial' })

const MANUAL_FINDING = 'E2E Manual Finding'
const drawer = page => page.locator('.q-drawer--left')
const panel = page => page.locator('.comments-panel')

let auditId
let paul // Pentester, creator of the audit
let rita // Reviewer

async function openAudit (page) {
  await page.goto(`/audits/${auditId}/general`)
  await expect(qInput(page, 'Name *')).toHaveValue(D.AUDIT.name)
}

async function openFinding (page, title) {
  await drawer(page).getByRole('link').filter({ hasText: title }).first().click()
  await expect(qInput(page, 'Title *')).toHaveValue(new RegExp(`^${title}`))
}

// Selection of a passage with the mouse (drag from the first to the last character)
async function selectText (page, content, text) {
  const box = await content.evaluate((element, searched) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const index = node.data.indexOf(searched)
      if (index < 0) continue
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + 1)
      const start = range.getBoundingClientRect()
      range.setStart(node, index + searched.length - 1)
      range.setEnd(node, index + searched.length)
      const end = range.getBoundingClientRect()
      return { x1: start.left + 1, y1: start.top + start.height / 2, x2: end.right - 1, y2: end.top + end.height / 2 }
    }
    return null
  }, text)
  expect(box, `text "${text}" in the editor`).toBeTruthy()
  await page.mouse.move(box.x1, box.y1)
  await page.mouse.down()
  await page.mouse.move(box.x2, box.y2, { steps: 6 })
  await page.mouse.up()
}

test.beforeAll(async ({ browser }) => {
  auditId = await ensureMainAudit()
  // Approval blocked while comments are open
  const admin = await apiAs(D.USERS.admin)
  const settings = await datas(await admin.get('/api/settings'))
  settings.reviews.enabled = true
  settings.reviews.public.minReviewers = 1
  settings.reviews.public.mandatoryReview = false
  settings.reviews.public.blockApprovalWithOpenComments = true
  expect((await admin.put('/api/settings', { data: settings })).ok()).toBeTruthy()
  await admin.dispose()
  paul = await newUserContext(browser, D.USERS.pentester)
  rita = await newUserContext(browser, D.USERS.reviewer)
})

test.afterAll(async () => {
  await paul?.context.close()
  await rita?.context.close()
})

test.describe('Review of the audit', () => {
  test('pentester: submission for review, the audit is no longer editable', async () => {
    const page = paul.page
    await openAudit(page)
    await drawer(page).getByRole('button', { name: 'Submit Review' }).click()
    await expectNotification(page, 'Audit review status updated successfully')
    await expect(drawer(page).getByRole('button', { name: 'Cancel Review' })).toBeVisible()
    await expect(drawer(page).getByRole('button', { name: 'Submit Review' })).toHaveCount(0)

    // Read-only for the editors during the review
    await openFinding(page, D.VULNS.sqli.en.title)
    await expect(page.getByRole('button', { name: 'Save (ctrl+s)' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
    await expect(editorContent(page, 'Description')).toHaveAttribute('contenteditable', 'false')
    await expect(qInput(page, 'Title *')).toHaveAttribute('readonly', '')

    // Refused by the backend too
    const api = await apiAs(D.USERS.pentester)
    const response = await api.put(`/api/audits/${auditId}/general`, { data: { name: 'Changed during review' } })
    expect(response.status()).toBe(403)
    await api.dispose()
  })

  test('reviewer: comments on a text selection and on an image, approval blocked while they are open', async () => {
    const page = rita.page
    await openAudit(page)
    await expect(drawer(page).getByRole('button', { name: 'Approve' })).toBeVisible()

    // Comment on a passage of the description
    await openFinding(page, D.VULNS.sqli.en.title)
    const description = editorContent(page, 'Description')
    await expect(description).toContainText('SQL queries')
    await selectText(page, description, 'SQL queries')
    const commentButton = page.locator('.comment-selection-btn')
    await expect(commentButton).toBeVisible()
    await commentButton.click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page)).toContainText('« SQL queries »')
    const draft = panel(page).getByPlaceholder('Your comment (Ctrl+Enter to send)')
    await draft.fill('Name the vulnerable parameter.')
    await draft.press('Control+Enter')
    const card = panel(page).locator('.comment-card').filter({ hasText: 'Name the vulnerable parameter.' })
    await expect(card).toBeVisible()
    await expect(card).toContainText('« SQL queries »')
    await expect(description.locator('.comment-highlight')).toContainText('SQL queries')

    // Comment on an image
    await openFinding(page, MANUAL_FINDING)
    const image = editorContent(page, 'Description').locator('.editor-image').first()
    await image.hover()
    await image.locator('.editor-image__comment-add').click()
    await expect(panel(page)).toContainText('New comment')
    await panel(page).getByPlaceholder('Your comment (Ctrl+Enter to send)').fill('Crop the screenshot.')
    await panel(page).getByRole('button', { name: 'Comment', exact: true }).click()
    await expect(panel(page).locator('.comment-card').filter({ hasText: 'Crop the screenshot.' })).toContainText('proof.png')
    await expect(image.locator('.q-badge')).toHaveText('1')

    // Counters in the menu
    await expect(drawer(page).getByRole('link').filter({ hasText: D.VULNS.sqli.en.title }).locator('.q-badge')).toHaveText('1')
    await expect(drawer(page).getByRole('link').filter({ hasText: MANUAL_FINDING }).locator('.q-badge')).toHaveText('1')

    // Approval refused while comments are open
    await drawer(page).getByRole('button', { name: 'Approve' }).click()
    await expectNotification(page, 'Some comments are still open')
    const api = await apiAs(D.USERS.reviewer)
    expect((await datas(await api.get(`/api/audits/${auditId}`))).state).toBe('REVIEW')
    await api.dispose()
  })

  test('pentester: sees the comments and replies', async () => {
    const page = paul.page
    await openAudit(page)
    await drawer(page).locator('button').filter({ has: page.locator('.mdi-comment-text-multiple-outline') }).click()
    await expect(panel(page).locator('.comment-card')).toHaveCount(2)
    const card = panel(page).locator('.comment-card').filter({ hasText: 'Name the vulnerable parameter.' })
    await card.click()
    // Selecting the comment shows its passage
    await expect(page).toHaveURL(/\/findings\/[0-9a-f]{24}$/)
    const reply = card.getByPlaceholder('Reply (Ctrl+Enter to send)')
    await reply.fill('The parameter is "id".')
    await reply.press('Control+Enter')
    await expect(card).toContainText('The parameter is "id".')
    await expect(card).toContainText(`${D.USERS.pentester.firstname} ${D.USERS.pentester.lastname}`)
  })

  test('reviewer: resolution of the comments, then approval', async () => {
    const page = rita.page
    await openAudit(page)
    await drawer(page).locator('button').filter({ has: page.locator('.mdi-comment-text-multiple-outline') }).click()
    const cards = panel(page).locator('.comment-card')
    await expect(cards).toHaveCount(2)
    await expect(cards.filter({ hasText: 'Name the vulnerable parameter.' })).toContainText('Replies: 1')
    for (const text of ['Name the vulnerable parameter.', 'Crop the screenshot.']) {
      const card = cards.filter({ hasText: text })
      await card.click()
      await card.getByRole('button', { name: 'Resolve' }).click()
      await expect(cards.filter({ hasText: text })).toHaveCount(0) // Open comments listed only
    }
    await panel(page).getByRole('button', { name: 'Resolved', exact: true }).click()
    await expect(cards).toHaveCount(2)
    await cards.first().click()
    await expect(cards.first()).toContainText(`Resolved by ${D.USERS.reviewer.firstname} ${D.USERS.reviewer.lastname}`)

    await drawer(page).getByRole('button', { name: 'Approve' }).click()
    await expectNotification(page, 'Audit approval updated successfully')
    await expect(drawer(page).getByRole('button', { name: 'Remove Approval' })).toBeVisible()

    const api = await apiAs(D.USERS.reviewer)
    const audit = await datas(await api.get(`/api/audits/${auditId}`))
    expect(audit.state).toBe('APPROVED')
    expect(audit.approvals.map(a => a.username || a._id)).toHaveLength(1)
    await api.dispose()
  })

  test('approved audit: read-only for the pentester', async () => {
    const page = paul.page
    await page.reload()
    await openAudit(page)
    await expect(page.getByRole('button', { name: 'Save (ctrl+s)' })).toHaveCount(0)
    await expect(qInput(page, 'Name *')).toHaveAttribute('readonly', '')
    await expect(drawer(page).getByRole('button', { name: /Submit Review|Cancel Review|Approve/ })).toHaveCount(0)
    await expect(drawer(page).locator('.q-item').filter({ hasText: 'Findings (' }).getByRole('button')).toHaveCount(0)
    await openFinding(page, MANUAL_FINDING)
    await expect(editorContent(page, 'Description')).toHaveAttribute('contenteditable', 'false')
    await expect(page.getByRole('button', { name: 'Save (ctrl+s)' })).toHaveCount(0)

    // State in the audits list
    await page.locator('.q-header').getByText('Audits').click()
    const row = page.getByRole('row').filter({ hasText: D.AUDIT.name })
    await expect(row).toBeVisible()
    const api = await apiAs(D.USERS.pentester)
    expect((await api.put(`/api/audits/${auditId}/general`, { data: { name: 'Changed after approval' } })).status()).toBe(403)
    await api.dispose()
  })
})
