// Complete audit by a pentester: creation, general information, findings (database and manual), rich edition,
// table column resizing (#266), code block, link, images, captions, CVSS, custom fields, persistence after reload
const fs = require('fs')
const path = require('path')
const { test, expect } = require('@playwright/test')
const D = require('./support/data')
const {
  qField, qInput, qSelect, menusClosed, expectNotification, waitForApi, editorContent, editorCard, toolbarButton, clickToolbar, press, type, cvssBase, cvssPick,
  loginUI, apiAs, datas, ensureBaseData, ensureVulnerability, auditIdByName, FIXTURES_DIR
} = require('./support/helpers')

test.describe.configure({ mode: 'serial' })

const pentester = D.USERS.pentester
const MANUAL_FINDING = 'E2E Manual Finding'
const drawer = page => page.locator('.q-drawer--left')

let auditId

test.beforeAll(async () => {
  await ensureBaseData()
  const api = await apiAs(D.USERS.admin)
  await ensureVulnerability(api, D.VULNS.sqli.en, { category: D.CATEGORY.name })
  await ensureVulnerability(api, D.VULNS.xss.en)
  await api.dispose()
})

test.beforeEach(async ({ page }) => {
  await loginUI(page, pentester)
})

async function openCreateAudit (page) {
  await page.getByRole('button', { name: 'New Audit' }).click()
  const modal = page.locator('.q-dialog').filter({ hasText: 'New Audit' })
  await expect(modal).toBeVisible()
  return modal
}

const createButton = modal => modal.getByRole('button', { name: /^(Create|Créer)$/ })

// Finding page of the audit: waits for the editors to be loaded and editable
async function openFinding (page, title) {
  await drawer(page).getByRole('link').filter({ hasText: title }).first().click()
  await expect(page).toHaveURL(/\/findings\/[0-9a-f]{24}$/)
  await expect(qInput(page, 'Title *')).toHaveValue(title)
  await expect(editorContent(page, 'Description')).toHaveAttribute('contenteditable', 'true')
}

async function saveFinding (page) {
  await page.getByRole('button', { name: 'Save (ctrl+s)' }).click()
  await expectNotification(page, 'Finding updated successfully')
}

async function findingByTitle (title) {
  const api = await apiAs(pentester)
  const audit = await datas(await api.get(`/api/audits/${auditId}`))
  const finding = audit.findings.find(f => f.title === title)
  await api.dispose()
  return finding
}

test.describe('Audit by a pentester', () => {
  test('creation of an audit', async ({ page }) => {
    const modal = await openCreateAudit(page)
    await qInput(modal, 'Name').fill(D.AUDIT.name)
    await qSelect(modal, 'Language', 'English')
    await qSelect(modal, 'Audit type', D.AUDIT_TYPE.name)
    await createButton(modal).click()
    await expect(page).toHaveURL(/\/audits\/[0-9a-f]{24}\/general$/)
    auditId = page.url().match(/audits\/([0-9a-f]{24})/)[1]
    await expect(page.getByText(`${D.AUDIT.name} (${D.AUDIT_TYPE.name})`)).toBeVisible()

    // Sections of the audit type in the menu
    await expect(drawer(page).getByText('General Information')).toBeVisible()
    await expect(drawer(page).getByText('Findings (0)')).toBeVisible()
    await expect(drawer(page).getByText(D.SECTION.name)).toBeVisible()

    // Listed in the audits of the pentester
    await page.locator('.q-header').getByText('Audits').click()
    await expect(page.getByRole('row').filter({ hasText: D.AUDIT.name })).toBeVisible()
  })

  test('new audit dialog: buttons translated in the display language', async ({ page }) => {
    const modal = await openCreateAudit(page)
    await expect(modal.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Create', exact: true })).toBeVisible()
  })

  test('new audit dialog: required fields', async ({ page }) => {
    const modal = await openCreateAudit(page)
    await createButton(modal).click()
    await expect(modal.getByText('Name required')).toBeVisible()
    await expect(modal.getByText('Language required')).toBeVisible()
    await expect(modal.getByText('Assessment required')).toBeVisible()
    await expect(page).toHaveURL(/\/audits$/)
  })

  test('new audit dialog: creation after a first refused attempt', async ({ page }) => {
    const modal = await openCreateAudit(page)
    await qSelect(modal, 'Language', 'English')
    await qSelect(modal, 'Audit type', D.AUDIT_TYPE.name)
    await createButton(modal).click()
    await expect(modal.getByText('Name required')).toBeVisible()
    await qInput(modal, 'Name').fill('E2E Retry Audit')
    await createButton(modal).click()
    await expect(page).toHaveURL(/\/audits\/[0-9a-f]{24}\/general$/)
  })

  test('general information: company, client, reviewers, collaborators, dates, scope, custom field', async ({ page }) => {
    auditId = auditId || await auditIdByName(pentester, D.AUDIT.name)
    await page.goto(`/audits/${auditId}/general`)
    await expect(qInput(page, 'Name *')).toHaveValue(D.AUDIT.name)

    await qSelect(page, 'Company', D.COMPANY.name)
    await qSelect(page, 'Client', D.CLIENT.email)
    await qSelect(page, 'Reviewers', `${D.USERS.reviewer.firstname} ${D.USERS.reviewer.lastname}`)
    await qSelect(page, 'Collaborators', `${D.USERS.pentester2.firstname} ${D.USERS.pentester2.lastname}`)
    await qInput(page, 'Start Date').fill('2026-11-02')
    await qInput(page, 'End Date').fill('2026-11-06')
    await qInput(page, 'Reporting Date').fill('2026-11-09')
    await qInput(page, 'Scope (One per line)').fill('app.e2e-corp.test\n10.10.0.0/24')
    await qInput(page, D.CUSTOM_FIELDS.general.label).fill('CTR-2026-042')
    await page.getByRole('button', { name: 'Save (ctrl+s)' }).click()
    await expectNotification(page, 'Audit updated successfully')

    // Kept after a reload
    await page.reload()
    await expect(qInput(page, 'Name *')).toHaveValue(D.AUDIT.name)
    await expect(qField(page, 'Company')).toContainText(D.COMPANY.name)
    await expect(qField(page, 'Client')).toContainText(D.CLIENT.email)
    await expect(qField(page, 'Reviewers')).toContainText(`${D.USERS.reviewer.firstname} ${D.USERS.reviewer.lastname}`)
    await expect(qField(page, 'Collaborators')).toContainText(`${D.USERS.pentester2.firstname} ${D.USERS.pentester2.lastname}`)
    await expect(qInput(page, 'Start Date')).toHaveValue('2026-11-02')
    await expect(qInput(page, 'Reporting Date')).toHaveValue('2026-11-09')
    await expect(qInput(page, 'Scope (One per line)')).toHaveValue('app.e2e-corp.test\n10.10.0.0/24')
    await expect(qInput(page, D.CUSTOM_FIELDS.general.label)).toHaveValue('CTR-2026-042')

    const api = await apiAs(pentester)
    const general = await datas(await api.get(`/api/audits/${auditId}/general`))
    expect(general.company.name).toBe(D.COMPANY.name)
    expect(general.client.email).toBe(D.CLIENT.email)
    expect(general.reviewers.map(r => r.username)).toEqual([D.USERS.reviewer.username])
    expect(general.collaborators.map(c => c.username)).toEqual([D.USERS.pentester2.username])
    expect(general.scope.map(s => s.name || s)).toEqual(['app.e2e-corp.test', '10.10.0.0/24'])
    await api.dispose()
  })

  test('findings: added from the vulnerabilities database and manually', async ({ page }) => {
    auditId = auditId || await auditIdByName(pentester, D.AUDIT.name)
    await page.goto(`/audits/${auditId}/general`)
    await drawer(page).locator('.q-item').filter({ hasText: 'Findings (0)' }).getByRole('button').click()
    await expect(page).toHaveURL(/\/findings\/add$/)

    // Vulnerabilities of the audit language, archived ones excluded
    const table = page.locator('.q-table')
    await expect(table.getByText(D.VULNS.sqli.en.title)).toBeVisible()
    await expect(table.getByText(D.VULNS.xss.en.title)).toBeVisible()
    await expect(table.getByText(D.VULNS.csrf.en.title)).toHaveCount(0)

    // Search then add
    await table.locator('tbody tr').first().locator('.q-field').first().locator('input').fill('injection')
    const sqliRow = table.locator('tbody tr').filter({ hasText: D.VULNS.sqli.en.title })
    await expect(table.getByText(D.VULNS.xss.en.title)).toHaveCount(0)
    const created = () => waitForApi(page, 'POST', /\/api\/audits\/[0-9a-f]+\/findings$/, { status: 200 })
    let response = created()
    await sqliRow.locator('button').filter({ has: page.locator('.fa-plus-circle') }).click()
    await response
    await expectNotification(page, 'Finding created successfully')
    await table.locator('tbody tr').first().locator('.q-field').first().locator('input').fill('')
    response = created()
    await table.locator('tbody tr').filter({ hasText: D.VULNS.xss.en.title }).locator('button').filter({ has: page.locator('.fa-plus-circle') }).click()
    await response
    await expect(drawer(page).getByText('Findings (2)')).toBeVisible()

    // Manual finding
    await qInput(page.locator('.q-table__top'), 'Title').fill(MANUAL_FINDING)
    await page.locator('.q-table__top').getByRole('button', { name: 'Create' }).click()
    response = created()
    await page.locator('.q-menu').getByText('No Category', { exact: true }).click()
    await response
    await expect(qInput(page.locator('.q-table__top'), 'Title')).toHaveValue('')

    // Menu: findings grouped by category
    await expect(drawer(page).getByText('Findings (3)')).toBeVisible()
    for (const title of [D.VULNS.sqli.en.title, D.VULNS.xss.en.title, MANUAL_FINDING]) {
      await expect(drawer(page).getByRole('link').filter({ hasText: title })).toBeVisible()
    }
    await expect(drawer(page).getByText(D.CATEGORY.name)).toBeVisible()

    // Finding from the database: content copied
    await openFinding(page, D.VULNS.sqli.en.title)
    await expect(editorContent(page, 'Description')).toContainText(D.VULNS.sqli.en.description)
    await expect(qInput(page, D.CUSTOM_FIELDS.finding.label)).toBeVisible()
  })

  test('add findings page: the footer counts the listed vulnerabilities', async ({ page }) => {
    auditId = auditId || await auditIdByName(pentester, D.AUDIT.name)
    await page.goto(`/audits/${auditId}/findings/add`)
    const table = page.locator('.q-table')
    await expect(table.getByText(D.VULNS.sqli.en.title)).toBeVisible()
    await expect(page.locator('.q-table__bottom')).toContainText('2 / 2 Vulnerabilities')
    await table.locator('tbody tr').first().locator('.q-field').first().locator('input').fill('injection')
    await expect(page.locator('.q-table__bottom')).toContainText('1 / 2 Vulnerabilities')
  })

  test('rich edition: headings, marks, lists, table with column resizing, code block, link, images, caption', async ({ page }) => {
    auditId = auditId || await auditIdByName(pentester, D.AUDIT.name)
    await page.goto(`/audits/${auditId}/general`)
    await openFinding(page, MANUAL_FINDING)

    const card = editorCard(page, 'Description')
    const content = editorContent(page, 'Description')
    await content.click()
    await press(page, 'Control+a')
    await press(page, 'Delete')
    const observation = editorContent(page, 'Observation')
    await observation.click()
    await press(page, 'Control+a')
    await press(page, 'Delete')
    await content.click()

    // Heading 2 with the format menu, then caret put back in the heading
    await card.locator('.editor-toolbar .q-btn-dropdown').first().click()
    await page.locator('.q-menu').getByText('H2', { exact: true }).click()
    await content.locator('h2').click()
    await menusClosed(page)
    await expect(content).toBeFocused()
    await type(page, 'E2E Heading')
    await press(page, 'Enter')
    await expect(content.locator('h2')).toHaveText('E2E Heading')

    // Bold and italic (toolbar), then keyboard shortcuts
    await clickToolbar(card, 'format_bold')
    await type(page, 'bold text')
    await clickToolbar(card, 'format_bold')
    await type(page, ' and ')
    await clickToolbar(card, 'format_italic')
    await type(page, 'italic text')
    await clickToolbar(card, 'format_italic')
    await press(page, 'Enter')
    await expect(content.locator('strong')).toHaveText('bold text')
    await expect(content.locator('em')).toHaveText('italic text')

    // Lists
    await clickToolbar(card, 'format_list_bulleted')
    await type(page, 'first bullet')
    await press(page, 'Enter')
    await type(page, 'second bullet')
    await press(page, 'Enter')
    await press(page, 'Enter') // Leaves the list
    await clickToolbar(card, 'format_list_numbered')
    await type(page, 'first step')
    await press(page, 'Enter')
    await press(page, 'Enter')
    await expect(content.locator('ul > li')).toHaveCount(2)
    await expect(content.locator('ol > li')).toHaveCount(1)

    // Code block
    await clickToolbar(card, 'mdi-console')
    await type(page, "SELECT * FROM users WHERE id = '1' OR '1'='1';")
    await expect(content.locator('pre code')).toContainText('SELECT * FROM users')
    // Leave the code block: triple Enter
    await press(page, 'Enter')
    await press(page, 'Enter')
    await press(page, 'Enter')

    // Link on a selected word (URL asked with a prompt)
    await type(page, 'See the advisory')
    for (let i = 0; i < 'advisory'.length; i++) await press(page, 'Shift+ArrowLeft')
    page.once('dialog', dialog => dialog.accept('https://advisory.e2e.test/sqli'))
    await clickToolbar(card, 'mdi-link')
    await expect(content.locator('a[href="https://advisory.e2e.test/sqli"]')).toHaveText('advisory')
    // Selection collapsed at the end of the line before going on
    await press(page, 'ArrowRight')
    await press(page, 'End')
    await press(page, 'Enter')
    await type(page, 'Evidence:')
    await press(page, 'Enter')

    // Image uploaded with the toolbar button, at the end of the text
    const imageUploaded = waitForApi(page, 'POST', /\/api\/images\/?$/, { status: 201 })
    await card.locator('.editor-toolbar input[type=file]').setInputFiles(path.join(FIXTURES_DIR, 'proof.png'))
    await imageUploaded
    await expect(content.locator('.editor-image img')).toHaveCount(1)

    // Caption after the image: cursor moved after the image (selected after its insertion), then caption chosen in
    // the captions menu and its text typed
    await press(page, 'ArrowRight')
    await card.locator('.editor-toolbar .q-btn-dropdown').filter({ has: page.locator('.q-icon', { hasText: 'subtitles' }) }).click()
    await page.locator('.q-menu').getByText('Figure', { exact: true }).click()
    await menusClosed(page)
    const caption = content.locator('.editor-caption__input')
    await expect(caption).toBeVisible()
    await caption.fill('E2E proof of the injection')
    await expect(content.locator('.editor-caption__label')).toContainText('Figure')
    await expect(content.locator('.editor-image img')).toHaveCount(1)

    // Table 3x3 with a header row, inserted after "Evidence:"
    await content.locator('p', { hasText: 'Evidence:' }).click()
    await press(page, 'End')
    await press(page, 'Enter')
    await clickToolbar(card, 'mdi-table')
    const table = content.locator('table')
    await expect(table).toBeVisible()
    await expect(table.locator('th')).toHaveCount(3)
    await expect(table.locator('td')).toHaveCount(6)
    await type(page, 'Host')
    await press(page, 'Tab')
    await type(page, 'Port')
    await press(page, 'Tab')
    await type(page, 'Service')
    await press(page, 'Tab')
    await type(page, '10.10.0.5')
    await expect(table.locator('th')).toHaveText(['Host', 'Port', 'Service'])
    await expect(table.locator('td').first()).toHaveText('10.10.0.5')

    // Column resizing with the mouse: drag of the handle on the right border of the first column (#266)
    const firstHeader = table.locator('th').first()
    const before = await firstHeader.boundingBox()
    await page.mouse.move(before.x + before.width - 2, before.y + before.height / 2)
    await expect(content.locator('.column-resize-handle').first()).toBeVisible()
    await page.mouse.down()
    await page.mouse.move(before.x + before.width + 60, before.y + before.height / 2, { steps: 8 })
    await page.mouse.move(before.x + before.width + 120, before.y + before.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => (await firstHeader.boundingBox()).width).toBeGreaterThan(before.width + 80)
    await expect(firstHeader).toHaveAttribute('colwidth', /^\d+$/)
    const resizedWidth = Number(await firstHeader.getAttribute('colwidth'))
    await expect(table.locator('td').first()).toHaveText('10.10.0.5')
    // Order of the blocks: text, table, image, caption
    expect(await content.evaluate(el => [...el.children].map(c => c.tagName.toLowerCase() + (c.className ? '.' + c.className.split(' ')[0] : '')).slice(-4)))
      .toEqual(['p', 'div.tableWrapper', 'div.editor-image-page', 'div.editor-caption'])

    // Image pasted from the clipboard (observation field)
    await observation.click()
    await type(page, 'Pasted screenshot:')
    await press(page, 'Enter')
    const pngBase64 = fs.readFileSync(path.join(FIXTURES_DIR, 'pasted.png')).toString('base64')
    const uploaded = waitForApi(page, 'POST', /\/api\/images\/?$/, { status: 201 })
    await observation.evaluate((element, base64) => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }))
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    }, pngBase64)
    await uploaded
    await expect(observation.locator('.editor-image img')).toHaveCount(1)

    await saveFinding(page)

    // Saved HTML
    const finding = await findingByTitle(MANUAL_FINDING)
    const html = finding.description
    expect(html).toContain('<h2>E2E Heading</h2>')
    expect(html).toContain('<strong>bold text</strong>')
    expect(html).toContain('<em>italic text</em>')
    expect(html).toMatch(/<ul>.*first bullet.*second bullet.*<\/ul>/s)
    expect(html).toMatch(/<ol>.*first step.*<\/ol>/s)
    expect(html).toContain('<pre><code')
    expect(html).toContain('SELECT * FROM users')
    expect(html).toContain('href="https://advisory.e2e.test/sqli"')
    expect(html).toMatch(new RegExp(`<th[^>]*colwidth="${resizedWidth}"`))
    expect(html).toMatch(/<\/table><img [^>]*src="[0-9a-f]{24}"[^>]*alt="proof.png"[^>]*><legend[^>]*label="Figure"[^>]*alt="E2E proof of the injection"/)
    expect((html.match(/<img /g) || []).length).toBe(1)
    expect(finding.observation).toContain('Pasted screenshot:')
    expect(finding.observation).toMatch(/<img [^>]*src="[0-9a-f]{24}"[^>]*alt="pasted.png"/)

    // Reload: everything is displayed again, including the column width
    await page.reload()
    await expect(editorContent(page, 'Description')).toHaveAttribute('contenteditable', 'true')
    const reloaded = editorContent(page, 'Description')
    await expect(reloaded.locator('h2')).toHaveText('E2E Heading')
    await expect(reloaded.locator('strong')).toHaveText('bold text')
    await expect(reloaded.locator('em')).toHaveText('italic text')
    await expect(reloaded.locator('ul > li')).toHaveCount(2)
    await expect(reloaded.locator('pre code')).toContainText('SELECT * FROM users')
    await expect(reloaded.locator('a[href="https://advisory.e2e.test/sqli"]')).toHaveText('advisory')
    await expect(reloaded.locator('th').first()).toHaveAttribute('colwidth', String(resizedWidth))
    await expect(reloaded.locator('table td').first()).toHaveText('10.10.0.5')
    await expect(reloaded.locator('.editor-image img')).toHaveCount(1)
    await expect(editorContent(page, 'Observation').locator('.editor-image img')).toHaveCount(1)
    await expect(reloaded.locator('.editor-caption__input')).toHaveValue('E2E proof of the injection')
  })

  test('format menu: closed after choosing a heading, the typed text goes in the heading', async ({ page }) => {
    auditId = auditId || await auditIdByName(pentester, D.AUDIT.name)
    await page.goto(`/audits/${auditId}/general`)
    await openFinding(page, D.VULNS.sqli.en.title)
    const card = editorCard(page, 'Observation')
    const content = editorContent(page, 'Observation')
    await content.click()
    await press(page, 'Control+End')
    await press(page, 'Enter')
    await card.locator('.editor-toolbar .q-btn-dropdown').first().click()
    await page.locator('.q-menu').getByText('H3', { exact: true }).click()
    await expect(page.locator('.q-menu')).toBeHidden()
    await page.waitForTimeout(500)
    await type(page, 'Heading typed after the choice')
    await expect(content.locator('h3')).toHaveText('Heading typed after the choice')
  })

  test('captions menu: the editor keeps the focus after inserting a caption', async ({ page }) => {
    auditId = auditId || await auditIdByName(pentester, D.AUDIT.name)
    await page.goto(`/audits/${auditId}/general`)
    await openFinding(page, D.VULNS.sqli.en.title)
    const card = editorCard(page, 'Observation')
    const content = editorContent(page, 'Observation')
    await content.click()
    await press(page, 'Control+End')
    await card.locator('.editor-toolbar .q-btn-dropdown').filter({ has: page.locator('.q-icon', { hasText: 'subtitles' }) }).click()
    await page.locator('.q-menu').getByText('Figure', { exact: true }).click()
    await expect(page.locator('.q-menu')).toBeHidden()
    await page.waitForTimeout(600)
    await expect.poll(() => page.evaluate(() => !!document.activeElement.closest('.editor__content'))).toBe(true)
  })

  test('caption inserted right after an image upload keeps the image', async ({ page }) => {
    auditId = auditId || await auditIdByName(pentester, D.AUDIT.name)
    const api = await apiAs(pentester)
    const created = await api.post(`/api/audits/${auditId}/findings`, { data: { title: 'E2E Caption Bug' } })
    expect(created.ok()).toBeTruthy()
    try {
      await page.goto(`/audits/${auditId}/general`)
      await openFinding(page, 'E2E Caption Bug')
      const card = editorCard(page, 'Description')
      const content = editorContent(page, 'Description')
      await content.click()
      await type(page, 'Screenshot:')
      await press(page, 'Enter')
      await card.locator('.editor-toolbar input[type=file]').setInputFiles(path.join(FIXTURES_DIR, 'proof.png'))
      await expect(content.locator('.editor-image img')).toHaveCount(1)
      await card.locator('.editor-toolbar .q-btn-dropdown').filter({ has: page.locator('.q-icon', { hasText: 'subtitles' }) }).click()
      await page.locator('.q-menu').getByText('Figure', { exact: true }).click()
      await expect(content.locator('.editor-caption')).toHaveCount(1)
      await expect(content.locator('.editor-image img')).toHaveCount(1)
    } finally {
      const audit = await datas(await api.get(`/api/audits/${auditId}`))
      const finding = audit.findings.find(f => f.title === 'E2E Caption Bug')
      if (finding) await api.delete(`/api/audits/${auditId}/findings/${finding._id}`)
      await api.dispose()
    }
  })

  test('the resized column keeps its width after a second resize and undo/redo', async ({ page }) => {
    auditId = auditId || await auditIdByName(pentester, D.AUDIT.name)
    await page.goto(`/audits/${auditId}/general`)
    await openFinding(page, MANUAL_FINDING)
    const content = editorContent(page, 'Description')
    const card = editorCard(page, 'Description')
    const header = content.locator('th').first()
    const saved = Number(await header.getAttribute('colwidth'))

    // The table loaded from the database (editor made editable after loading) can be resized again
    const box = await header.boundingBox()
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2)
    await expect(content.locator('.column-resize-handle').first()).toBeVisible()
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 40, box.y + box.height / 2, { steps: 10 })
    await page.mouse.up()
    await expect.poll(async () => Number(await header.getAttribute('colwidth'))).toBeLessThan(saved - 20)

    // Undo restores the previous width, redo the new one
    await clickToolbar(card, 'undo')
    await expect.poll(async () => Number(await header.getAttribute('colwidth'))).toBe(saved)
    await clickToolbar(card, 'redo')
    await expect.poll(async () => Number(await header.getAttribute('colwidth'))).toBeLessThan(saved - 20)
    await clickToolbar(card, 'undo')
    await expect.poll(async () => Number(await header.getAttribute('colwidth'))).toBe(saved)
  })

  test('details: CVSS, remediation, affected assets, proofs and custom field', async ({ page }) => {
    auditId = auditId || await auditIdByName(pentester, D.AUDIT.name)
    await page.goto(`/audits/${auditId}/general`)
    await openFinding(page, MANUAL_FINDING)

    // Custom field of the findings (definition tab)
    await qInput(page, D.CUSTOM_FIELDS.finding.label).fill('Admin back office')
    await qSelect(page, 'Type', 'Web Application')

    // Proofs
    await page.getByRole('tab', { name: 'Proofs' }).click()
    const proofs = page.locator('.q-tab-panel').filter({ has: page.locator('.ProseMirror') }).locator('.ProseMirror').first()
    await expect(proofs).toHaveAttribute('contenteditable', 'true')
    await proofs.click()
    await type(page, 'Proof: the payload returns every account.')

    // Details: CVSS and course of actions
    await page.getByRole('tab', { name: 'Details' }).click()
    const calculator = page.locator('.cvsscalculator').first()
    await cvssBase(calculator, { A: 'None' })
    await expect(calculator.locator('.baseMetricScore').first()).toHaveText('9.1')
    await expect(calculator.locator('.baseSeverity').first()).toContainText('Critical')
    await cvssPick(calculator, 'Attack Complexity', 'High')
    await expect(calculator.locator('.baseMetricScore').first()).toHaveText('7.4')
    await qSelect(page, 'Remediation Difficulty', 'Complex')
    await qSelect(page, 'Priority', 'Urgent')
    const scope = page.locator('.q-card').filter({ hasText: 'Affected Assets' }).locator('.ProseMirror').first()
    await scope.click()
    await type(page, 'app.e2e-corp.test')
    const remediation = editorContent(page, 'Remediation')
    await remediation.click()
    await type(page, 'Use parameterized queries.')

    // Completed
    const completed = page.getByRole('switch', { name: 'Completed' })
    if (await completed.getAttribute('aria-checked') !== 'true') await completed.click()
    await expect(completed).toHaveAttribute('aria-checked', 'true')
    await saveFinding(page)

    const finding = await findingByTitle(MANUAL_FINDING)
    expect(finding.cvssv3).toBe('CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N')
    expect(finding.remediationComplexity).toBe(3)
    expect(finding.priority).toBe(4)
    expect(finding.vulnType).toBe('Web Application')
    expect(finding.poc).toContain('Proof: the payload returns every account.')
    expect(finding.scope).toContain('app.e2e-corp.test')
    expect(finding.remediation).toContain('Use parameterized queries.')
    expect(finding.status).toBe(0)
    expect(finding.customFields.some(f => f.text === 'Admin back office')).toBeTruthy()

    // Reload
    await page.reload()
    await expect(qInput(page, D.CUSTOM_FIELDS.finding.label)).toHaveValue('Admin back office')
    await page.getByRole('tab', { name: 'Details' }).click()
    await expect(page.locator('.cvsscalculator .baseMetricScore').first()).toHaveText('7.4')
    await expect(qField(page, 'Priority')).toContainText('Urgent')
    await expect(editorContent(page, 'Remediation')).toContainText('Use parameterized queries.')
    // Severity shown in the menu
    await expect(drawer(page).getByRole('link').filter({ hasText: MANUAL_FINDING }).locator('.q-chip')).toHaveText('H')
  })

  test('unsaved changes: leaving the finding or the general information asks for a confirmation', async ({ page }) => {
    auditId = auditId || await auditIdByName(pentester, D.AUDIT.name)
    await page.goto(`/audits/${auditId}/general`)
    await openFinding(page, D.VULNS.xss.en.title)
    const observation = editorContent(page, 'Observation')
    await observation.click()
    await press(page, 'Control+End')
    await type(page, ' Also on the login page.')
    await drawer(page).getByText('General Information').click()
    let confirm = page.locator('.q-dialog').filter({ hasText: 'There are unsaved changes' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(page).toHaveURL(/\/findings\/[0-9a-f]{24}$/)
    await saveFinding(page)
    await drawer(page).getByText('General Information').click()
    await expect(page).toHaveURL(/\/general$/)
    expect((await findingByTitle(D.VULNS.xss.en.title)).observation).toContain('Also on the login page.')

    // General information
    await qInput(page, 'Name *').fill(`${D.AUDIT.name} (renamed)`)
    await drawer(page).getByRole('link').filter({ hasText: D.VULNS.sqli.en.title }).click()
    confirm = page.locator('.q-dialog').filter({ hasText: 'There are unsaved changes' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await qInput(page, 'Name *').fill(D.AUDIT.name)
    await drawer(page).getByRole('link').filter({ hasText: D.VULNS.sqli.en.title }).click()
    await expect(page).toHaveURL(/\/findings\/[0-9a-f]{24}$/)
  })

  test('unsaved changes: a title change also asks for a confirmation', async ({ page }) => {
    auditId = auditId || await auditIdByName(pentester, D.AUDIT.name)
    await page.goto(`/audits/${auditId}/general`)
    await openFinding(page, D.VULNS.xss.en.title)
    await qInput(page, 'Title *').fill(`${D.VULNS.xss.en.title} (changed)`)
    await drawer(page).getByText('General Information').click()
    await expect(page.locator('.q-dialog').filter({ hasText: 'There are unsaved changes' })).toBeVisible()
  })
})
