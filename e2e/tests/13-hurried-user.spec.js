// Hurried user: clicks chained at a human pace (80 to 150 ms) without waiting for the loading, double clicks on the
// creation and action buttons, browser history, reload just after a change, typing before the end of the loading,
// slowed collaboration websocket or API. After each scenario the real state is checked through the API (content of
// the findings, number of created elements) and the pages must not raise JavaScript errors.
// Own audits ("E2E Hurried ..."), created through the API: runs alone on an empty instance and after the specs 01-12.
const fs = require('fs')
const { test: base, expect } = require('@playwright/test')
const D = require('./support/data')
const {
  qField, qInput, qSelect, expectNotification, notification, dialog, button, editorContent, editorCard, press, type,
  newUserContext, apiAs, datas, ensureBaseData, ensureVulnerability, setQaChecks
} = require('./support/helpers')
const {
  RUN, pause, textOf, watchErrors, checkErrors, hurriedClick, clicksAt, doubleClick, slowCollab, slowApi,
  countRequests, login, createAudit, getAudit, getGeneral
} = require('./support/hurried')

// JavaScript errors of the page of each test checked at the end of the test
const test = base.extend({
  errors: [async ({ page }, use, testInfo) => {
    const watcher = watchErrors(page)
    await use(watcher)
    checkErrors(watcher, testInfo)
  }, { auto: true }]
})

const pentester = D.USERS.pentester
// Unique names of the data created by a test (with RUN: removed at the end, see afterAll; --repeat-each supported)
let created = 0
const uid = () => `${RUN}-${++created}`
const drawer = page => page.locator('.q-drawer--left')
const findingLink = (page, title) => drawer(page).getByRole('link').filter({ hasText: title }).first()
const saveButton = page => page.getByRole('button', { name: 'Save (ctrl+s)' })
const unsavedDialog = page => page.locator('.q-dialog').filter({ hasText: 'There are unsaved changes' })

// Findings with distinct contents (no title included in another one)
const FINDINGS = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map(name => ({
  title: `Hurried ${name}`,
  description: `<p>Description of ${name}: only for ${name.toLowerCase()}.</p>`,
  observation: `<p>Observation of ${name}.</p>`
}))
const initialContents = (count = FINDINGS.length) => Object.fromEntries(FINDINGS.slice(0, count).map(f => [f.title, { description: f.description, observation: f.observation }]))

// Vulnerabilities of the database created by this spec (removed at the end)
const VULN_A = { title: `E2E Hurried Vuln A ${RUN}`, description: 'Alpha vulnerability description.', remediation: 'Alpha remediation.' }
const VULN_B = { title: `E2E Hurried Vuln B ${RUN}`, description: 'Bravo vulnerability description.', remediation: 'Bravo remediation.' }

// No confirmation of unsaved changes when nothing was typed (see "switching between the findings without any change")
async function expectNoFalseUnsaved (page) {
  await expect(unsavedDialog(page), 'confirmation of unsaved changes shown without any change').toHaveCount(0)
}

// Finding page loaded: title of the finding and editors editable
async function findingReady (page, title) {
  await expect(async () => {
    await expectNoFalseUnsaved(page)
    await expect(qInput(page, 'Title *')).toHaveValue(title, { timeout: 1000 })
  }).toPass({ timeout: 30_000 })
  await expect(page).toHaveURL(/\/findings\/[0-9a-f]{24}$/)
  await expect(editorContent(page, 'Description')).toHaveAttribute('contenteditable', 'true', { timeout: 30_000 })
  await expect(editorContent(page, 'Observation')).toHaveAttribute('contenteditable', 'true', { timeout: 30_000 })
}

// Click on a link of the audit menu at a hurried pace
async function openFast (page, locator) {
  await expectNoFalseUnsaved(page)
  await hurriedClick(page, locator)
}

const openFindingFast = (page, title) => openFast(page, findingLink(page, title))

// Each finding opened from the menu shows its own stored description and observation, once
async function expectFindingsShown (page, auditId) {
  const audit = await getAudit(auditId)
  for (const finding of audit.findings) {
    await openFindingFast(page, finding.title)
    await findingReady(page, finding.title)
    await expect(editorContent(page, 'Description')).toHaveText(textOf(finding.description))
    await expect(editorContent(page, 'Observation')).toHaveText(textOf(finding.observation))
  }
}

// Stored findings compared with the expected contents (title -> {description, observation}), none added or lost
async function expectStoredFindings (auditId, expected) {
  const audit = await getAudit(auditId)
  expect(audit.findings.map(f => f.title).sort()).toEqual(Object.keys(expected).sort())
  for (const finding of audit.findings) {
    expect(textOf(finding.description), `description of ${finding.title}`).toBe(textOf(expected[finding.title].description))
    expect(textOf(finding.observation), `observation of ${finding.title}`).toBe(textOf(expected[finding.title].observation))
  }
  return audit
}

// Text added at the end of an editor
async function appendTo (page, label, text) {
  await editorContent(page, label).click()
  await press(page, 'Control+End')
  await type(page, text)
}

async function openAudit (page, auditId, name) {
  await page.goto(`/audits/${auditId}/general`)
  await expect(qInput(page, 'Name *')).toHaveValue(name)
}

// Page of the current URL really shown
async function expectPageShown (page, { auditId, name }) {
  const path = new URL(page.url()).pathname
  if (/^\/audits\/?$/.test(path)) await expect(page.getByRole('button', { name: 'New Audit' })).toBeVisible()
  else if (/^\/vulnerabilities$/.test(path)) await expect(page.locator('.q-table')).toBeVisible()
  else if (/^\/data\//.test(path)) await expect(drawer(page).getByText('Collaborators')).toBeVisible()
  else if (path === `/audits/${auditId}/general`) await expect(qInput(page, 'Name *')).toHaveValue(name)
  else if (path.startsWith(`/audits/${auditId}/`)) await expect(drawer(page).getByText('General Information')).toBeVisible()
  else throw new Error(`unexpected page ${path}`)
}

test.beforeAll(async () => {
  await ensureBaseData()
  const admin = await apiAs(D.USERS.admin)
  await ensureVulnerability(admin, D.VULNS.sqli.en, { category: D.CATEGORY.name })
  await ensureVulnerability(admin, VULN_A)
  await ensureVulnerability(admin, VULN_B)
  await admin.dispose()
})

// Data of this run removed: vulnerabilities and audits (the audits list of the instance stays readable)
test.afterAll(async () => {
  const admin = await apiAs(D.USERS.admin)
  for (const vuln of await datas(await admin.get('/api/vulnerabilities'))) {
    if (vuln.details.some(d => [VULN_A.title, VULN_B.title].includes(d.title))) await admin.delete(`/api/vulnerabilities/${vuln._id}`)
  }
  for (const audit of await datas(await admin.get('/api/audits'))) {
    if (audit.name.startsWith('E2E Hurried ') && audit.name.includes(RUN)) await admin.delete(`/api/audits/${audit._id}`)
  }
  await admin.dispose()
})

test.describe('Hurried user: findings of the audit', () => {
  test('fast switching between the findings of the menu, then immediate typing: no content mixed or lost', async ({ page }) => {
    const name = `E2E Hurried Switch ${uid()}`
    const { auditId } = await createAudit(name, FINDINGS)
    await login(page, pentester)
    await openAudit(page, auditId, name)

    // Rounds through the findings, without waiting for the editors
    for (const index of [0, 1, 2, 3, 2, 0, 3, 1, 0, 2, 1, 3, 2]) await openFindingFast(page, FINDINGS[index].title)

    // Typing as soon as the last one is editable, then saved
    await findingReady(page, FINDINGS[2].title)
    await appendTo(page, 'Description', ' Typed in charlie.')
    await saveButton(page).click()
    await expectNotification(page, 'Finding updated successfully')

    // Fast switching again after the change
    for (const index of [0, 3, 2, 1, 2, 0]) await openFindingFast(page, FINDINGS[index].title)
    await findingReady(page, FINDINGS[0].title)

    const expected = initialContents()
    expected[FINDINGS[2].title].description = '<p>Description of Charlie: only for charlie. Typed in charlie.</p>'
    await expectStoredFindings(auditId, expected)
    await expectFindingsShown(page, auditId)
  })

  test('fast switching with a slow collaboration websocket (A -> B -> A): no duplicated or mixed content', async ({ page }) => {
    const name = `E2E Hurried Slow Collab ${uid()}`
    const { auditId } = await createAudit(name, FINDINGS)
    await slowCollab(page, 700)
    await login(page, pentester)
    await openAudit(page, auditId, name)

    // Same finding opened again while the editors of its previous opening are still waiting for the websocket
    for (const index of [0, 1, 0, 2, 0, 1, 3, 1]) await openFindingFast(page, FINDINGS[index].title)
    await findingReady(page, FINDINGS[1].title)
    await expect(editorContent(page, 'Description')).toHaveText(textOf(FINDINGS[1].description))
    await appendTo(page, 'Observation', ' Typed in bravo.')
    await expect(editorContent(page, 'Observation')).toHaveText('Observation of Bravo. Typed in bravo.')
    await page.keyboard.press('Control+s')
    await expectNotification(page, 'Finding updated successfully')

    // Late initializations of the editors left behind
    await page.waitForTimeout(5000)
    await expect(editorContent(page, 'Description')).toHaveText(textOf(FINDINGS[1].description))
    await expect(editorContent(page, 'Observation')).toHaveText('Observation of Bravo. Typed in bravo.')
    const expected = initialContents()
    expected[FINDINGS[1].title].observation = '<p>Observation of Bravo. Typed in bravo.</p>'
    await expectStoredFindings(auditId, expected)
    await expectFindingsShown(page, auditId)
  })

  test('fast switching between the findings: no JavaScript error', async ({ page }) => {
    const errors = watchErrors(page)
    const name = `E2E Hurried Errors ${uid()}`
    const { auditId } = await createAudit(name, FINDINGS)
    await login(page, pentester)
    await openAudit(page, auditId, name)
    for (const index of [0, 1, 2, 3, 0, 1, 2, 3]) await openFindingFast(page, FINDINGS[index].title)
    await findingReady(page, FINDINGS[3].title)
    await page.waitForTimeout(3000)
    expect(errors.pageErrors).toEqual([])
  })

  test('switching between the findings without any change: never asked to confirm unsaved changes', async ({ page }) => {
    const name = `E2E Hurried False Unsaved ${uid()}`
    const { auditId } = await createAudit(name, FINDINGS)
    await login(page, pentester)
    await openAudit(page, auditId, name)
    // A user reading quickly: each finding shown about half a second (stops at the first confirmation)
    for (let i = 0; i < 60; i++) {
      await findingLink(page, FINDINGS[i % 3].title).click()
      await page.waitForTimeout(600)
      await expect(unsavedDialog(page), `confirmation shown when leaving the finding (switch ${i})`).toHaveCount(0)
    }
  })

  // Finding opened by its URL, click in the description as soon as it is shown and typing at once (about 60 ms per
  // key), slow collaboration websocket: the editors are loaded about 2 s later
  async function typeBeforeLoaded (page) {
    const name = `E2E Hurried Early Typing ${uid()}`
    const { auditId, findings } = await createAudit(name, FINDINGS.slice(0, 2))
    await slowCollab(page, 400)
    await login(page, pentester)
    await page.goto(`/audits/${auditId}/findings/${findings[0]._id}`)
    const description = editorContent(page, 'Description')
    await description.click()
    await page.keyboard.type('EARLY', { delay: 60 })
    await expect(description).toHaveAttribute('contenteditable', 'true', { timeout: 30_000 })
    await expect(qInput(page, 'Title *')).toHaveValue(FINDINGS[0].title)
    return { auditId, description }
  }

  test('typing as soon as the page opens, before the editors are loaded: text only in the clicked field, saved', async ({ page }) => {
    const { auditId, description } = await typeBeforeLoaded(page)
    // Nothing typed elsewhere
    await expect(editorContent(page, 'Observation')).toHaveText(textOf(FINDINGS[0].observation))
    await expect(qInput(page, 'Title *')).toHaveValue(FINDINGS[0].title)
    // Keys typed before the editor was loaded: written at the end of the content once loaded (see below)
    await appendTo(page, 'Description', ' LATE')
    await page.keyboard.press('Control+s')
    await expectNotification(page, 'Finding updated successfully')

    const audit = await getAudit(auditId)
    const stored = audit.findings.find(f => f.title === FINDINGS[0].title)
    expect(textOf(stored.description)).toMatch(/^(EARLY)?Description of Alpha: only for alpha\.(EARLY)? LATE$/)
    expect(textOf(stored.observation)).toBe(textOf(FINDINGS[0].observation))
    const other = audit.findings.find(f => f.title === FINDINGS[1].title)
    expect(textOf(other.description)).toBe(textOf(FINDINGS[1].description))
    expect(textOf(other.observation)).toBe(textOf(FINDINGS[1].observation))
  })

  // The editors show a loading state until their content is loaded: the keys typed meanwhile are not lost, they are
  // written at the end of the content once loaded (a change of the user, saved with the finding)
  test('typing as soon as the page opens, before the editors are loaded: loading shown, typed keys not lost', async ({ page }) => {
    const name = `E2E Hurried Loading ${uid()}`
    const { auditId, findings } = await createAudit(name, FINDINGS.slice(0, 1))
    await slowCollab(page, 1000)
    await login(page, pentester)
    await page.goto(`/audits/${auditId}/findings/${findings[0]._id}`)
    const card = editorCard(page, 'Description')
    const description = editorContent(page, 'Description')
    await expect(card).toHaveAttribute('aria-busy', 'true')
    await expect(card.locator('.editor-loading')).toBeVisible()
    await description.click()
    await page.keyboard.type('EARLY', { delay: 60 })

    await expect(card).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
    await expect(card.locator('.editor-loading')).toHaveCount(0)
    await expect(description).toHaveAttribute('contenteditable', 'true')
    const original = textOf(FINDINGS[0].description)
    await expect(description).toHaveText(`${original}EARLY`)
    await appendTo(page, 'Description', ' LATE')
    await expect(description).toHaveText(`${original}EARLY LATE`)
    await page.keyboard.press('Control+s')
    await expectNotification(page, 'Finding updated successfully')
    const stored = (await getAudit(auditId)).findings.find(f => f.title === FINDINGS[0].title)
    expect(textOf(stored.description)).toBe(`${original}EARLY LATE`)
  })

  test('save then leave at once, Ctrl+S and Save clicked several times: content right, no error', async ({ page }) => {
    const name = `E2E Hurried Save ${uid()}`
    const { auditId } = await createAudit(name, FINDINGS.slice(0, 3))
    await login(page, pentester)
    await openAudit(page, auditId, name)
    await findingLink(page, FINDINGS[0].title).click()
    await findingReady(page, FINDINGS[0].title)

    // Ctrl+S pressed three times, Save clicked three times
    // (identical notifications are grouped by Quasar: the answers of the requests are counted)
    const answers = []
    page.on('response', r => { if (r.request().method() === 'PUT' && /\/findings\/[0-9a-f]+$/.test(r.url())) answers.push(r.status()) })
    await appendTo(page, 'Description', ' First change.')
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+s'); await pause(page) }
    await appendTo(page, 'Observation', ' Second change.')
    await clicksAt(page, saveButton(page), 3, 120)
    await expect.poll(() => answers.length).toBe(6)
    expect(answers).toEqual([200, 200, 200, 200, 200, 200])
    await expectNotification(page, 'Finding updated successfully')
    await expect(page.locator('.q-notification.bg-negative')).toHaveCount(0)

    // Change saved, then another finding opened at once
    await appendTo(page, 'Description', ' Third change.')
    await page.keyboard.press('Control+s')
    await pause(page)
    await hurriedClick(page, findingLink(page, FINDINGS[1].title))
    if (await unsavedDialog(page).count()) {
      test.info().annotations.push({ type: 'observation', description: 'saved then left within 150 ms: confirmation of unsaved changes shown while the save request is pending' })
      await unsavedDialog(page).getByRole('button', { name: 'Confirm' }).click()
    }
    await findingReady(page, FINDINGS[1].title)

    const expected = initialContents(3)
    expected[FINDINGS[0].title] = {
      description: '<p>Description of Alpha: only for alpha. First change. Third change.</p>',
      observation: '<p>Observation of Alpha. Second change.</p>'
    }
    await expectStoredFindings(auditId, expected)
  })

  test('reload just after a change, then just after a save: shown content is the stored one, saved change kept', async ({ page }) => {
    const name = `E2E Hurried Reload ${uid()}`
    const { auditId } = await createAudit(name, FINDINGS.slice(0, 2))
    await login(page, pentester)
    await openAudit(page, auditId, name)
    await findingLink(page, FINDINGS[1].title).click()
    await findingReady(page, FINDINGS[1].title)

    // Change not saved, reload at once: only Save stores, the stored content is shown again (nothing half applied)
    await appendTo(page, 'Description', ' Not saved.')
    await page.reload()
    await findingReady(page, FINDINGS[1].title)
    await expect(editorContent(page, 'Description')).toHaveText(textOf(FINDINGS[1].description))
    await expectStoredFindings(auditId, initialContents(2))

    // Change saved, reload at once
    await appendTo(page, 'Description', ' Saved before reload.')
    await page.keyboard.press('Control+s')
    await pause(page, 50, 80)
    await page.reload()
    await findingReady(page, FINDINGS[1].title)
    await expect(editorContent(page, 'Description')).toHaveText('Description of Bravo: only for bravo. Saved before reload.')
    const expected = initialContents(2)
    expected[FINDINGS[1].title].description = '<p>Description of Bravo: only for bravo. Saved before reload.</p>'
    await expectStoredFindings(auditId, expected)

    // General information: name changed, saved, reloaded at once
    await drawer(page).getByText('General Information').click()
    await expect(qInput(page, 'Name *')).toHaveValue(name)
    await qInput(page, 'Name *').fill(`${name} renamed`)
    await page.keyboard.press('Control+s')
    await pause(page, 50, 80)
    await page.reload()
    await expect(qInput(page, 'Name *')).toHaveValue(`${name} renamed`)
    expect((await getGeneral(auditId)).name).toBe(`${name} renamed`)
  })

  test('Ctrl+S right after opening a finding on a slow network: finding not emptied', async ({ page }) => {
    const name = `E2E Hurried Early Save ${uid()}`
    const { auditId } = await createAudit(name, FINDINGS.slice(0, 2))
    await login(page, pentester)
    await openAudit(page, auditId, name)
    await slowApi(page, 'GET', /\/api\/audits\/[0-9a-f]+\/findings\/[0-9a-f]+$/, 1500)
    await hurriedClick(page, findingLink(page, FINDINGS[1].title))
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(3000)
    await expectStoredFindings(auditId, initialContents(2))
  })
})

test.describe('Hurried user: navigation', () => {
  test('back and forth between the sections of the audit and the pages, browser history: right page shown, nothing changed', async ({ page }) => {
    const name = `E2E Hurried Navigation ${uid()}`
    const { auditId } = await createAudit(name, FINDINGS.slice(0, 2))
    await login(page, pentester)
    await openAudit(page, auditId, name)
    const general = () => drawer(page).getByText('General Information')
    const network = () => drawer(page).getByText('Network Scan')
    const section = () => drawer(page).getByText(D.SECTION.name)
    const header = text => page.locator('.q-header').getByText(text, { exact: true })

    // Sections of the audit
    for (const target of [network, general, () => findingLink(page, FINDINGS[0].title), section, general, network,
      () => findingLink(page, FINDINGS[1].title), section, () => findingLink(page, FINDINGS[0].title), general]) {
      await openFast(page, target())
    }
    await expect(page).toHaveURL(/\/general$/)
    await expect(qInput(page, 'Name *')).toHaveValue(name)

    // Pages of the header
    for (const text of ['Vulnerabilities', 'Data', 'Audits', 'Vulnerabilities', 'Audits', 'Data']) await hurriedClick(page, header(text))
    await expect(page).toHaveURL(/\/data\/collaborators$/)

    // History of the browser: back and forward chained
    for (let i = 0; i < 6; i++) { await page.goBack({ waitUntil: 'commit' }); await pause(page) }
    for (let i = 0; i < 3; i++) { await page.goForward({ waitUntil: 'commit' }); await pause(page) }
    await page.waitForTimeout(1500)
    if (await unsavedDialog(page).count()) {
      test.info().annotations.push({ type: 'observation', description: 'confirmation of unsaved changes shown during the history navigation' })
      await unsavedDialog(page).getByRole('button', { name: 'Confirm' }).click()
      await page.waitForTimeout(1000)
    }
    await expectPageShown(page, { auditId, name })

    // Nothing changed by the navigation
    expect((await getGeneral(auditId)).name).toBe(name)
    await expectStoredFindings(auditId, initialContents(2))
  })

  test('General Information opened twice: one Ctrl+S saves once', async ({ page }) => {
    const name = `E2E Hurried Ctrl S ${uid()}`
    const { auditId } = await createAudit(name, FINDINGS.slice(0, 1))
    await login(page, pentester)
    await openAudit(page, auditId, name)
    await hurriedClick(page, drawer(page).getByText('Network Scan'))
    await hurriedClick(page, drawer(page).getByText('General Information'))
    await expect(qInput(page, 'Name *')).toHaveValue(name)
    await qInput(page, 'Name *').fill(`${name} saved once`)
    const puts = countRequests(page, 'PUT', /\/api\/audits\/[0-9a-f]+\/general$/)
    await page.keyboard.press('Control+s')
    await expectNotification(page, 'Audit updated successfully')
    await page.waitForTimeout(1500)
    expect(puts.map(body => body && body.name)).toEqual([`${name} saved once`])
  })

  test('Ctrl+S in a second audit does not save the first audit visited before', async ({ page }) => {
    const firstName = `E2E Hurried First ${uid()}`
    const secondName = `E2E Hurried Second ${uid()}`
    const first = await createAudit(firstName, [])
    const second = await createAudit(secondName, [])
    await login(page, pentester)
    await openAudit(page, first.auditId, firstName)
    // Second audit opened from the audits list (no reload of the application)
    await hurriedClick(page, page.locator('.q-header').getByText('Audits', { exact: true }))
    await hurriedClick(page, page.getByRole('row').filter({ hasText: secondName }).locator('a').filter({ has: page.locator('.fa-edit') }))
    await expect(qInput(page, 'Name *')).toHaveValue(secondName)
    // Meanwhile, the first audit is renamed by its creator from another window
    const api = await apiAs(pentester)
    expect((await api.put(`/api/audits/${first.auditId}/general`, { data: { name: `${firstName} renamed` } })).ok()).toBeTruthy()
    await api.dispose()
    await qInput(page, 'Name *').fill(`${secondName} saved`)
    await page.keyboard.press('Control+s')
    await expectNotification(page, 'Audit updated successfully')
    await page.waitForTimeout(1500)
    expect((await getGeneral(second.auditId)).name).toBe(`${secondName} saved`)
    expect((await getGeneral(first.auditId)).name).toBe(`${firstName} renamed`)
  })

  // The form of the general information is read-only until the audit is loaded (a choice made before would be
  // replaced by the loaded audit): nothing can be chosen then silently discarded. Once loaded, the language chosen in
  // a hurry is kept and saved.
  test('language of the audit: read-only until the general information is loaded, then the choice is kept and saved', async ({ page }) => {
    const name = `E2E Hurried Language ${uid()}`
    const { auditId } = await createAudit(name, [])
    await login(page, pentester)
    await slowApi(page, 'GET', /\/api\/audits\/[0-9a-f]+\/general$/, 2500)
    await page.goto(`/audits/${auditId}/general`)
    const language = qField(page, 'Language')
    await expect(language).toHaveClass(/q-field--readonly/)
    await language.locator('.q-field__control').first().click()
    await page.waitForTimeout(300)
    await expect(page.locator('.q-menu')).toHaveCount(0) // No menu opened before the loading
    await expect(saveButton(page)).toBeDisabled()

    await expect(qInput(page, 'Name *')).toHaveValue(name, { timeout: 10_000 })
    await expect(language).not.toHaveClass(/q-field--readonly/)
    await expect(language).toContainText('English')
    await qSelect(page, 'Language', 'Francais')
    await saveButton(page).click()
    await expectNotification(page, 'Audit updated successfully')
    expect((await getGeneral(auditId)).language).toBe('fr')
    await page.reload()
    await expect(qField(page, 'Language')).toContainText('Francais')
  })
})

test.describe('Hurried user: double clicks on the creation and action buttons', () => {
  test('New Audit double clicked: the creation dialog stays open', async ({ page }) => {
    await login(page, pentester)
    await page.goto('/audits')
    const newAudit = page.getByRole('button', { name: 'New Audit' })
    await expect(newAudit).toBeVisible()
    await doubleClick(page, newAudit)
    await page.waitForTimeout(800)
    await expect(page.locator('.q-dialog').filter({ hasText: 'New Audit' })).toBeVisible()
  })

  test('Create of the New Audit dialog double clicked: one audit created and opened', async ({ page }) => {
    const name = `E2E Hurried New ${uid()}`
    await login(page, pentester)
    await page.goto('/audits')
    await page.getByRole('button', { name: 'New Audit' }).click()
    const modal = page.locator('.q-dialog').filter({ hasText: 'New Audit' })
    await expect(modal).toBeVisible()
    await qInput(modal, 'Name').fill(name)
    await qSelect(modal, 'Language', 'English')
    await qSelect(modal, 'Audit type', D.AUDIT_TYPE.name)
    await doubleClick(page, modal.getByRole('button', { name: /^(Create|Créer)$/ }))
    await expect(page).toHaveURL(/\/audits\/[0-9a-f]{24}\/general$/)
    await expect(qInput(page, 'Name *')).toHaveValue(name)
    await page.waitForTimeout(1000)
    const api = await apiAs(pentester)
    const audits = (await datas(await api.get('/api/audits'))).filter(a => a.name === name)
    await api.dispose()
    expect(audits).toHaveLength(1)
    expect(page.url()).toContain(audits[0]._id)
  })

  test('finding added from the database with a double click on "+": added once', async ({ page }) => {
    const name = `E2E Hurried Add ${uid()}`
    const { auditId } = await createAudit(name, [])
    await login(page, pentester)
    await page.goto(`/audits/${auditId}/findings/add`)
    const add = page.locator('.q-table tbody tr').filter({ hasText: VULN_A.title }).locator('button').filter({ has: page.locator('.fa-plus-circle') })
    await expect(add).toBeVisible()
    await doubleClick(page, add)
    await expect(drawer(page).getByText(/Findings \([1-9]\)/)).toBeVisible()
    await page.waitForTimeout(2000)
    expect((await getAudit(auditId)).findings.map(f => f.title)).toEqual([VULN_A.title])
  })

  test('manual finding: Enter pressed twice in the title creates it once', async ({ page }) => {
    const name = `E2E Hurried Manual ${uid()}`
    const { auditId } = await createAudit(name, [])
    await login(page, pentester)
    await page.goto(`/audits/${auditId}/findings/add`)
    await expect(page.locator('.q-table')).toBeVisible()
    const title = qInput(page.locator('.q-table__top'), 'Title')
    await title.fill('Hurried manual finding')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(100)
    await page.keyboard.press('Enter')
    await expect(title).toHaveValue('')
    await page.waitForTimeout(2000)
    expect((await getAudit(auditId)).findings.map(f => f.title)).toEqual(['Hurried manual finding'])
  })

  test('manual finding: category chosen in the Create menu with a double click, list still loading: created once', async ({ page }) => {
    const name = `E2E Hurried Category ${uid()}`
    const { auditId } = await createAudit(name, [])
    await login(page, pentester)
    await slowApi(page, 'GET', /\/api\/vulnerabilities\/en$/, 2000)
    await page.goto(`/audits/${auditId}/findings/add`)
    const top = page.locator('.q-table__top')
    await qInput(top, 'Title').fill('Hurried categorized finding')
    await top.getByRole('button', { name: 'Create' }).click()
    await doubleClick(page, page.locator('.q-menu').getByText(D.CATEGORY.name, { exact: true }))
    await expect(qInput(top, 'Title')).toHaveValue('')
    await page.waitForTimeout(2000)
    const findings = (await getAudit(auditId)).findings
    expect(findings.map(f => [f.title, f.category])).toEqual([['Hurried categorized finding', D.CATEGORY.name]])
  })

  test('Submit Review double clicked: the audit is in review', async ({ page }) => {
    const name = `E2E Hurried Submit ${uid()}`
    const { auditId } = await createAudit(name, FINDINGS.slice(0, 1))
    await login(page, pentester)
    await openAudit(page, auditId, name)
    await doubleClick(page, drawer(page).getByRole('button', { name: 'Submit Review' }))
    await page.waitForTimeout(2000)
    const state = (await getAudit(auditId)).state
    const shown = await drawer(page).getByRole('button', { name: 'Cancel Review' }).count() ? 'REVIEW' : 'EDIT'
    expect(shown, 'state shown in the menu').toBe(state)
    expect(state).toBe('REVIEW')
  })

  test('Approve double clicked by the reviewer: approved once', async ({ browser }) => {
    const name = `E2E Hurried Approve ${uid()}`
    const { auditId } = await createAudit(name, FINDINGS.slice(0, 1))
    const api = await apiAs(pentester)
    expect((await api.put(`/api/audits/${auditId}/updateReadyForReview`, { data: { state: 'REVIEW' } })).ok()).toBeTruthy()
    await api.dispose()
    const rita = await newUserContext(browser, D.USERS.reviewer)
    try {
      await openAudit(rita.page, auditId, name)
      await doubleClick(rita.page, drawer(rita.page).getByRole('button', { name: 'Approve' }))
      await rita.page.waitForTimeout(2000)
      const audit = await getAudit(auditId, D.USERS.reviewer)
      const shown = await drawer(rita.page).getByRole('button', { name: 'Remove Approval' }).count() ? 'approved' : 'not approved'
      expect(shown, 'approval shown in the menu').toBe(audit.approvals.length ? 'approved' : 'not approved')
      expect(audit.approvals.map(a => a.username)).toEqual([D.USERS.reviewer.username])
      expect(audit.state).toBe('APPROVED')
    } finally {
      await rita.context.close()
    }
  })

  // Report of an audit generated from the audit menu with clicks at a hurried pace (quality checks disabled: no check
  // before the generation). Returns the downloads.
  async function generateReports (page, name, clicks) {
    const { auditId } = await createAudit(name, FINDINGS.slice(0, 2))
    await setQaChecks(false)
    const admin = await apiAs(D.USERS.admin)
    const settings = await datas(await admin.get('/api/settings'))
    const mandatory = settings.reviews.public.mandatoryReview
    if (mandatory) {
      settings.reviews.public.mandatoryReview = false
      expect((await admin.put('/api/settings', { data: settings })).ok()).toBeTruthy()
    }
    try {
      await login(page, pentester)
      await openAudit(page, auditId, name)
      const downloads = []
      page.on('download', download => downloads.push(download))
      await clicksAt(page, drawer(page).locator('button').filter({ has: page.locator('.fa-download') }), clicks, 120)
      await expect.poll(() => downloads.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(1)
      await page.waitForTimeout(3000)
      await expect(notification(page, 'Generating the Report')).toHaveCount(0, { timeout: 60_000 })
      return downloads
    } finally {
      await setQaChecks(true)
      if (mandatory) {
        settings.reviews.public.mandatoryReview = true
        await admin.put('/api/settings', { data: settings })
      }
      await admin.dispose()
    }
  }

  test('report double clicked: one report generated', async ({ page }) => {
    const downloads = await generateReports(page, `E2E Hurried Report Twice ${uid()}`, 2)
    expect(downloads).toHaveLength(1)
  })

  test('report generation clicked three times: valid reports, no generation left pending', async ({ page }) => {
    const name = `E2E Hurried Report ${uid()}`
    const downloads = await generateReports(page, name, 3)
    for (const download of downloads) {
      expect(download.suggestedFilename()).toBe(`${name}.docx`)
      const file = fs.readFileSync(await download.path())
      expect(file.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004')
    }
    await expect(page.locator('.q-notification.bg-negative')).toHaveCount(0)
  })

  test('user created with a double click on Create (admin): one account, no error shown (account disabled afterwards)', async ({ page }) => {
    const username = `e2e-hurried-${uid()}`
    await login(page, D.USERS.admin)
    await page.goto('/data/collaborators')
    await page.getByRole('button', { name: 'Add Collaborator' }).click()
    const modal = dialog(page)
    await qInput(modal, 'Username *').fill(username)
    await qInput(modal, 'Firstname *').fill('Hurried')
    await qInput(modal, 'Lastname *').fill('User')
    await qSelect(modal, 'Role *', 'user')
    await qInput(modal, 'Password *').fill('E2e-Hurried-2026')
    await doubleClick(page, button(modal, 'Create'))
    await expectNotification(page, 'Collaborator created successfully')
    await expect(modal).toBeHidden()
    await page.waitForTimeout(1500)
    const api = await apiAs(D.USERS.admin)
    const users = (await datas(await api.get('/api/users'))).filter(u => u.username === username)
    try {
      expect(users).toHaveLength(1)
      await expect(page.locator('.q-notification.bg-negative')).toHaveCount(0)
      await expect(page.locator('.q-table').getByRole('row').filter({ hasText: username })).toHaveCount(1)
    } finally {
      // Accounts cannot be deleted (route disabled in the backend): the account created is disabled
      for (const user of users) await api.put(`/api/users/${user._id}`, { data: { enabled: false } })
      await api.dispose()
    }
  })

  test('backup created with a double click (admin): one backup', async ({ page }) => {
    const name = `E2E Hurried Backup ${uid()}`
    await login(page, D.USERS.admin)
    await page.goto('/data/dump')
    await page.getByRole('tab', { name: /Backups/ }).click()
    await page.getByRole('button', { name: 'Create a backup' }).click()
    const modal = page.locator('.q-dialog').filter({ hasText: 'Create a backup' })
    await qInput(modal, 'Name').fill(name)
    await doubleClick(page, modal.getByRole('button', { name: 'Create the backup' }))
    await expectNotification(page, 'Backup created')
    await page.waitForTimeout(2000)
    const api = await apiAs(D.USERS.admin)
    const backups = (await datas(await api.get('/api/backups'))).filter(b => b.name === name)
    try {
      expect(backups).toHaveLength(1)
      await expect(page.locator('.q-notification.bg-negative')).toHaveCount(0)
    } finally {
      for (const backup of backups) await api.delete(`/api/backups/${backup.id}`)
      await api.dispose()
    }
  })
})

test.describe('Hurried user: dialogs opened and closed quickly', () => {
  test('vulnerability edition opened and closed quickly: the last one opened shows its own content, nothing changed', async ({ page }) => {
    await login(page, D.USERS.admin)
    await page.goto('/vulnerabilities')
    const editButton = title => page.locator('.q-table tbody tr').filter({ hasText: title }).locator('button').filter({ has: page.locator('.fa-edit') })
    const modal = page.locator('.q-dialog').filter({ hasText: 'Edit Vulnerability' })
    const close = () => modal.getByRole('button').filter({ has: page.locator('.q-icon', { hasText: /^close$/ }) }).first()
    await expect(editButton(VULN_A.title)).toBeVisible()
    for (const title of [VULN_A.title, VULN_B.title, VULN_A.title, VULN_B.title]) {
      await hurriedClick(page, editButton(title))
      await page.keyboard.press('Escape')
      await pause(page)
      if (await modal.isVisible()) await hurriedClick(page, close())
      await expect(modal).toBeHidden()
    }
    await hurriedClick(page, editButton(VULN_B.title))
    await expect(qInput(modal, 'Title *')).toHaveValue(VULN_B.title)
    await expect(editorContent(modal, 'Description')).toHaveText(VULN_B.description, { timeout: 30_000 })
    await page.waitForTimeout(3000)
    await expect(editorContent(modal, 'Description')).toHaveText(VULN_B.description)
    await hurriedClick(page, close())
    await expect(modal).toBeHidden()
    await hurriedClick(page, editButton(VULN_A.title))
    await expect(qInput(modal, 'Title *')).toHaveValue(VULN_A.title)
    await expect(editorContent(modal, 'Description')).toHaveText(VULN_A.description, { timeout: 30_000 })
    await hurriedClick(page, close())

    const api = await apiAs(D.USERS.admin)
    const all = await datas(await api.get('/api/vulnerabilities'))
    await api.dispose()
    for (const vuln of [VULN_A, VULN_B]) {
      const detail = all.flatMap(v => v.details).find(d => d.title === vuln.title)
      expect(textOf(detail.description)).toBe(vuln.description)
    }
  })

  test('New Audit dialog and Create menu of the findings opened and closed with Escape while loading', async ({ page }) => {
    const name = `E2E Hurried Escape ${uid()}`
    const { auditId } = await createAudit(name, [])
    await login(page, pentester)
    await page.goto('/audits')
    const newAudit = page.getByRole('button', { name: 'New Audit' })
    const modal = page.locator('.q-dialog').filter({ hasText: 'New Audit' })
    for (let i = 0; i < 3; i++) {
      await hurriedClick(page, newAudit)
      await page.keyboard.press('Escape')
      await pause(page)
    }
    await expect(modal).toBeHidden()

    await slowApi(page, 'GET', /\/api\/vulnerabilities\/en$/, 1500)
    await page.goto(`/audits/${auditId}/findings/add`)
    const top = page.locator('.q-table__top')
    for (let i = 0; i < 3; i++) {
      await hurriedClick(page, top.getByRole('button', { name: 'Create' }))
      await page.keyboard.press('Escape')
      await pause(page)
    }
    await expect(page.locator('.q-menu')).toHaveCount(0)
    await expect(page.locator('.q-table').getByText(VULN_A.title)).toBeVisible()
    await page.waitForTimeout(1000)
    expect((await getAudit(auditId)).findings).toHaveLength(0)
    const api = await apiAs(pentester)
    expect((await datas(await api.get('/api/audits'))).filter(a => a.name === name)).toHaveLength(1)
    await api.dispose()
  })
})

