// Collaborative edition: two users (two browser contexts) on the same finding of the audit
const { test, expect } = require('@playwright/test')
const D = require('./support/data')
const {
  qInput, expectNotification, editorContent, editorCard, toolbarButton, press, type, newUserContext, apiAs, datas,
  ensureMainAudit
} = require('./support/helpers')

test.describe.configure({ mode: 'serial' })

const FINDING = D.VULNS.xss.en.title
const drawer = page => page.locator('.q-drawer--left')

let auditId
let paul // Creator of the audit
let lea // Collaborator

async function openFinding (page) {
  await page.goto(`/audits/${auditId}/general`)
  await drawer(page).getByRole('link').filter({ hasText: FINDING }).first().click()
  await expect(qInput(page, 'Title *')).toHaveValue(new RegExp(`^${FINDING}`))
  await expect(editorContent(page, 'Description')).toHaveAttribute('contenteditable', 'true')
}

// Text at the end of the description, typed at a human pace
async function appendText (page, text) {
  const content = editorContent(page, 'Description')
  await content.click()
  await press(page, 'Control+End')
  await press(page, 'Enter')
  await type(page, text)
}

test.beforeAll(async ({ browser }) => {
  auditId = await ensureMainAudit()
  paul = await newUserContext(browser, D.USERS.pentester)
  lea = await newUserContext(browser, D.USERS.pentester2)
  await openFinding(paul.page)
  await openFinding(lea.page)
})

test.afterAll(async () => {
  await paul?.context.close()
  await lea?.context.close()
})

test.describe('Collaborative edition', () => {
  test('both users are shown as connected to the audit', async () => {
    const usersList = page => drawer(page).locator('.q-list').filter({ hasText: 'Users Connected' }).last()
    await expect(usersList(paul.page)).toContainText(`${D.USERS.pentester.username} (me)`)
    await expect(usersList(paul.page)).toContainText(D.USERS.pentester2.username)
    await expect(usersList(lea.page)).toContainText(`${D.USERS.pentester2.username} (me)`)
    await expect(usersList(lea.page)).toContainText(D.USERS.pentester.username)
  })

  test('the text typed by one user appears for the other one, with the caret of its author', async () => {
    await appendText(paul.page, 'Paul writes the first line.')
    await expect(editorContent(lea.page, 'Description')).toContainText('Paul writes the first line.')
    // Caret of the other user with his name
    await expect(editorContent(lea.page, 'Description').locator('.collaboration-carets__label')).toContainText(D.USERS.pentester.username)

    await appendText(lea.page, 'Lea answers on a second line.')
    await expect(editorContent(paul.page, 'Description')).toContainText('Lea answers on a second line.')
    await expect(editorContent(paul.page, 'Description')).toContainText('Paul writes the first line.')
  })

  test('simultaneous typing in two fields and in the same field: no loss', async () => {
    // Different fields at the same time
    await Promise.all([
      (async () => {
        const observation = editorContent(paul.page, 'Observation')
        await observation.click()
        await press(paul.page, 'Control+End')
        await press(paul.page, 'Enter')
        await type(paul.page, 'Observation by Paul, typed while Lea writes.')
      })(),
      appendText(lea.page, 'Description by Lea, typed while Paul writes.')
    ])
    for (const { page } of [paul, lea]) {
      await expect(editorContent(page, 'Observation')).toContainText('Observation by Paul, typed while Lea writes.')
      await expect(editorContent(page, 'Description')).toContainText('Description by Lea, typed while Paul writes.')
    }

    // Same field at the same time, at two different places
    await editorContent(paul.page, 'Description').locator('p', { hasText: 'Paul writes the first line.' }).click()
    await press(paul.page, 'End')
    await editorContent(lea.page, 'Description').locator('p', { hasText: 'Lea answers on a second line.' }).click()
    await press(lea.page, 'End')
    await Promise.all([type(paul.page, ' [Paul again]'), type(lea.page, ' [Lea again]')])
    for (const { page } of [paul, lea]) {
      const description = editorContent(page, 'Description')
      await expect(description.locator('p', { hasText: 'Paul writes the first line. [Paul again]' })).toHaveCount(1)
      await expect(description.locator('p', { hasText: 'Lea answers on a second line. [Lea again]' })).toHaveCount(1)
    }
    // Same document on both sides (HTML of the editors, without the carets)
    const html = page => editorContent(page, 'Description').evaluate(element => element.editor.getHTML())
    await expect.poll(async () => html(lea.page)).toBe(await html(paul.page))
  })

  test('undo and redo only apply to the changes of the user, on both sides', async () => {
    const card = editorCard(paul.page, 'Description')
    await appendText(paul.page, 'UNDO-ME')
    await expect(editorContent(lea.page, 'Description')).toContainText('UNDO-ME')

    await toolbarButton(card, 'undo').click()
    await expect(editorContent(paul.page, 'Description')).not.toContainText('UNDO-ME')
    await expect(editorContent(lea.page, 'Description')).not.toContainText('UNDO-ME')
    // Changes of Lea kept
    await expect(editorContent(paul.page, 'Description')).toContainText('[Lea again]')

    await toolbarButton(card, 'redo').click()
    await expect(editorContent(paul.page, 'Description')).toContainText('UNDO-ME')
    await expect(editorContent(lea.page, 'Description')).toContainText('UNDO-ME')

    // Keyboard shortcuts
    await editorContent(paul.page, 'Description').click()
    await press(paul.page, 'Control+z')
    await expect(editorContent(lea.page, 'Description')).not.toContainText('UNDO-ME')
    await press(paul.page, 'Control+Shift+z')
    await expect(editorContent(lea.page, 'Description')).toContainText('UNDO-ME')
  })

  test('saved by one user: everything is stored and shown after a reload of the other one', async () => {
    await paul.page.getByRole('button', { name: 'Save (ctrl+s)' }).click()
    await expectNotification(paul.page, 'Finding updated successfully')

    const api = await apiAs(D.USERS.pentester2)
    const audit = await datas(await api.get(`/api/audits/${auditId}`))
    const finding = audit.findings.find(f => f.title.startsWith(FINDING))
    await api.dispose()
    for (const text of ['Paul writes the first line. [Paul again]', 'Lea answers on a second line. [Lea again]', 'Description by Lea, typed while Paul writes.', 'UNDO-ME']) {
      expect(finding.description).toContain(text)
    }
    expect(finding.observation).toContain('Observation by Paul, typed while Lea writes.')

    await lea.page.reload()
    await expect(editorContent(lea.page, 'Description')).toHaveAttribute('contenteditable', 'true')
    await expect(editorContent(lea.page, 'Description')).toContainText('Paul writes the first line. [Paul again]')
    await expect(editorContent(lea.page, 'Description')).toContainText('UNDO-ME')
    await expect(editorContent(lea.page, 'Observation')).toContainText('Observation by Paul, typed while Lea writes.')
  })
})
