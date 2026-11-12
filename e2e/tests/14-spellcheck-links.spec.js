// Spell checker and links between findings in the browser:
// - texts checked by LanguageTool through the backend (stub e2e/languagetool-stub: "E2E_TYPO_WORD" reported with the
//   suggestion "E2E_FIXED_WORD"), LanguageTool not reachable through the web server
// - suggestions menu shown on a mistake only, suggestion applied
// - code blocks and inline code not checked
// - word proposed by a pentester, ignored once approved by an administrator (Settings)
// - link to a finding inserted with ":::"
// Own audit (unique name, deleted at the end) and ignored words removed at the start and at the end.
const { test, expect } = require('@playwright/test')
const D = require('./support/data')
const {
  qInput, expectNotification, waitForApi, editorContent, press, type, loginUI, newUserContext, apiAs, datas, ensureBaseData, ensureAudit
} = require('./support/helpers')

test.describe.configure({ mode: 'serial' })

const RUN = Date.now().toString(36)
const pentester = D.USERS.pentester
const TYPO = 'E2E_TYPO_WORD'
const FIXED = 'E2E_FIXED_WORD'
const AUDIT_NAME = `E2E Spellcheck Audit ${RUN}`
const FINDINGS = {
  suggestion: { title: 'E2E Spell Suggestion', description: `<p>Normal words then ${TYPO} here.</p>` },
  code: { title: 'E2E Spell Code', description: `<p>Text ${TYPO} <code>${TYPO}</code></p><pre><code>${TYPO}</code></pre>` },
  ignore: { title: 'E2E Spell Ignore', description: `<p>Word ${TYPO} to ignore.</p>` },
  target: { title: 'E2E Link Target', description: '<p>Target of the link.</p>' },
  source: { title: 'E2E Link Source', description: '<p>See the finding</p>' }
}

let auditId
const ids = {}

const description = page => editorContent(page, 'Description')
const mistakes = page => description(page).locator('span.lt')
const spellMenu = page => page.locator('.bubble-menu .bubble-menu-section-container:visible')
const spellChecked = page => waitForApi(page, 'POST', /^\/api\/spellcheck\/check$/, { status: 200 })

async function openFinding (page, key) {
  await page.goto(`/audits/${auditId}/findings/${ids[key]}`)
  await expect(qInput(page, 'Title *')).toHaveValue(FINDINGS[key].title)
  await expect(description(page)).toHaveAttribute('contenteditable', 'true')
}

// Words ignored by the spell checker created by this spec
async function deleteIgnoredWords () {
  const api = await apiAs(D.USERS.admin)
  const words = await datas(await api.get('/api/spellcheck/words/all'))
  for (const word of words.filter(w => w.word.toLowerCase() === TYPO.toLowerCase()))
    await api.delete(`/api/spellcheck/words/${word._id}`)
  await api.dispose()
}

test.beforeAll(async () => {
  await ensureBaseData()
  await deleteIgnoredWords()
  const api = await apiAs(pentester)
  auditId = await ensureAudit(api, AUDIT_NAME)
  for (const finding of Object.values(FINDINGS)) {
    const response = await api.post(`/api/audits/${auditId}/findings`, { data: finding })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
  const findings = (await datas(await api.get(`/api/audits/${auditId}`))).findings
  for (const [key, finding] of Object.entries(FINDINGS))
    ids[key] = findings.find(f => f.title === finding.title)._id
  await api.dispose()
})

test.afterAll(async () => {
  await deleteIgnoredWords()
  const api = await apiAs(pentester)
  await api.delete(`/api/audits/${auditId}`)
  await api.dispose()
})

test.beforeEach(async ({ page }) => {
  await loginUI(page, pentester)
})

test.describe('Spell checker', () => {
  test('mistakes checked through the backend and underlined, LanguageTool not reachable through the web server', async ({ page }) => {
    const checked = spellChecked(page)
    await openFinding(page, 'suggestion')
    expect((await checked).request().postDataJSON()).toEqual({ text: `Normal words then ${TYPO} here.`, language: 'auto' })
    await expect(mistakes(page)).toHaveText([TYPO])
    // Former address of LanguageTool (proxied by nginx before): no answer of LanguageTool
    const response = await page.request.post('/v2/check', { form: { text: TYPO, language: 'auto' } })
    expect(await response.text()).not.toContain('"matches"')
  })

  test('suggestions menu: not shown for a selected text without mistake, shown on a mistake, suggestion applied', async ({ page }) => {
    await openFinding(page, 'suggestion')
    await expect(mistakes(page)).toHaveText([TYPO])
    // "Normal" selected: formatting menu only
    await description(page).getByText('Normal words').click()
    await press(page, 'Home')
    for (let i = 0; i < 'Normal'.length; i++) await press(page, 'Shift+ArrowRight')
    await expect(page.locator('.editor-bubble-menu:visible')).toHaveCount(1)
    await expect(spellMenu(page)).toHaveCount(0)
    // Click on the mistake: its message and suggestion
    await mistakes(page).first().click()
    await expect(spellMenu(page)).toHaveCount(1)
    await expect(spellMenu(page)).toContainText('Possible spelling mistake found.')
    await spellMenu(page).locator('.suggestion', { hasText: FIXED }).click()
    await expect(description(page)).toContainText(`Normal words then ${FIXED} here.`)
    await expect(mistakes(page)).toHaveCount(0)
    await expect(spellMenu(page)).toHaveCount(0)
  })

  test('code blocks and inline code are not checked, the whitespace replacing them is not underlined', async ({ page }) => {
    const checked = spellChecked(page)
    await openFinding(page, 'code')
    const response = await checked
    const text = response.request().postDataJSON().text
    expect(text.split(TYPO)).toHaveLength(2) // Sent once: the text of the paragraph, the code replaced by spaces
    expect(text.startsWith(`Text ${TYPO} `)).toBe(true)
    expect(text.trim()).toBe(`Text ${TYPO}`)
    // LanguageTool reports the spaces replacing the code (repeated whitespace): not shown
    expect((await datas(response)).matches.map(m => m.rule.id)).toContain('WHITESPACE_RULE')
    await expect(mistakes(page)).toHaveText([TYPO])
    await expect(description(page).locator('code span.lt, pre span.lt')).toHaveCount(0)
  })

  test('word to ignore: proposed by a pentester, ignored for all once approved by an administrator', async ({ page, browser }) => {
    await openFinding(page, 'ignore')
    await expect(mistakes(page)).toHaveText([TYPO])
    await mistakes(page).first().click()
    const ignore = spellMenu(page).locator('.suggestion--ignore')
    await expect(ignore).toContainText(`Ignore "${TYPO}"`)
    const proposed = waitForApi(page, 'POST', /^\/api\/spellcheck\/words$/, { status: 201 })
    await ignore.click()
    expect(await datas(await proposed)).toMatchObject({ word: TYPO, status: 'pending' })
    await expectNotification(page, `"${TYPO}" proposed: it will be ignored once approved by an administrator`)
    await expect(spellMenu(page)).toHaveCount(0)

    // Pending: still reported
    let checked = spellChecked(page)
    await page.reload()
    await checked
    await expect(mistakes(page)).toHaveText([TYPO])

    // Approved by an administrator in the settings
    const { context, page: adminPage } = await newUserContext(browser, D.USERS.admin)
    await adminPage.goto('/settings?tab=quality')
    const row = adminPage.locator('.spellcheck-word').filter({ hasText: TYPO })
    await expect(row).toContainText('Pending')
    await expect(row).toContainText('Proposed by Paul Pentester')
    const approved = waitForApi(adminPage, 'PUT', /^\/api\/spellcheck\/words\/[0-9a-f]{24}$/, { status: 200 })
    await row.locator('.spellcheck-approve').click()
    await approved
    await expect(row).toContainText('Approved')
    await context.close()

    // No longer reported to the pentester
    checked = spellChecked(page)
    await page.reload()
    await checked
    await expect(description(page)).toContainText(`Word ${TYPO} to ignore.`)
    await page.waitForTimeout(1000) // Decorations of the answer
    await expect(mistakes(page)).toHaveCount(0)
  })
})

test.describe('Links between findings', () => {
  test('":::" opens the findings of the audit, the chosen finding is linked, the link is saved', async ({ page }) => {
    await openFinding(page, 'source')
    await description(page).getByText('See the finding').click()
    await press(page, 'End')
    await type(page, ' :::')
    const menu = page.locator('.tiptap-trigger-menu')
    await expect(menu).toBeVisible()
    await menu.locator('.menu-option', { hasText: FINDINGS.target.title }).click()
    await expect(menu).toHaveCount(0)
    await expect(description(page).locator(`a[href="#${ids.target}"]`)).toHaveText(FINDINGS.target.title)
    await expect(description(page)).not.toContainText(':')
    await page.getByRole('button', { name: 'Save (ctrl+s)' }).click()
    await expectNotification(page, 'Finding updated successfully')
    const api = await apiAs(pentester)
    const finding = (await datas(await api.get(`/api/audits/${auditId}`))).findings.find(f => f._id === ids.source)
    expect(finding.description).toContain(`href="#${ids.target}"`)
    await api.dispose()
  })

  test('"::" followed by other characters stays in the text (IPv6 address)', async ({ page }) => {
    await openFinding(page, 'target')
    await description(page).getByText('Target of the link.').click()
    await press(page, 'End')
    await type(page, ' fe80::1')
    await expect(page.locator('.tiptap-trigger-menu')).toHaveCount(0)
    await expect(description(page)).toContainText('Target of the link. fe80::1')
  })
})
