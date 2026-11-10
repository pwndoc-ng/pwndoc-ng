// Collaborative edition under degraded network conditions, and protection of the saved content while the content of
// the collaboration (websocket /collab/, Hocuspocus) is not loaded.
// - Three users on the same finding: normal network, slow 3G (throttling + 1.5 s latency on the collaboration
//   websocket), network cut while typing. Typing at the same time at different places then at the same place.
// - Collaboration websocket refused, open without answer, slow, cut during the loading, page reloaded during a slow
//   load, navigation between findings, Ctrl+S and Save in these states: nothing overwritten in the database.
// Own audit (E2E Network Audit, created through the API): the main audit is approved (read-only) after 07-review.
// The latency and the cuts of the collaboration websocket are made with routeWebSocket (support/collab.js): the
// throttling of the DevTools protocol (Network.emulateNetworkConditions) delays the HTTP requests but almost not the
// messages of an open websocket, and context.setOffline() holds the messages of an open websocket without closing it.
const { test, expect } = require('@playwright/test')
const D = require('./support/data')
const { qInput, editorContent, waitForApi, press, type } = require('./support/helpers')
const {
  PENTESTER3, SLOW_3G, sleep, throttle, unthrottle,
  ensureNetworkAudit, createFinding, storedFinding, expectStoredIntact, recordSaves, saveAnswer,
  findingUrl, drawerLink, unsavedDialog, saveButton, collabUser, openFinding, goToFinding,
  editorHTML, collabState, socketConnected, expectConverged, paragraphs, typeAtEndOf
} = require('./support/collab')

let auditId

test.beforeAll(async () => {
  auditId = await ensureNetworkAudit()
})

// Paragraph texts without the HTML spaces (a space typed at the end of a paragraph can be stored as a non-breaking one)
const texts = html => paragraphs(html).map(text => text.replace(/&nbsp;|\u00a0/g, ' '))

// Saved with the button of the page: answer of the API
async function saveWithButton (page, finding) {
  const answer = waitForApi(page, 'PUT', new RegExp(`/findings/${finding.id}$`))
  await saveButton(page).click()
  expect((await answer).status()).toBe(200)
}

// Ctrl+S: waits for the answer of the save request if the page sends one
async function saveWithShortcut (page, finding) {
  const answer = saveAnswer(page, finding.id, 4000)
  await page.keyboard.press('Control+s')
  return answer
}

// Text typed in the description before its content is loaded
const TYPED = 'TYPED BEFORE THE LOADING'

// Content of the collaboration not loaded: read-only editor, nothing written while typing, Save disabled
async function expectNotLoaded (page, finding) {
  const description = editorContent(page, 'Description')
  await expect(description).toHaveAttribute('contenteditable', 'false')
  expect((await collabState(page)).editable).toBe(false)
  await description.click()
  await type(page, TYPED)
  expect(await editorHTML(page)).not.toContain(TYPED)
  await expect(qInput(page, 'Title *')).toHaveValue(finding.title)
  await expect(saveButton(page)).toBeDisabled()
}

// Finding as expected once its content is loaded: the keys typed before the loading are not lost, they are written
// once at the end of the content (last paragraph of the description)
const withTypedText = finding => ({ ...finding, description: finding.description.replace(/<\/p>$/, `${TYPED}</p>`) })

// Content of the collaboration loaded: editable editors showing the saved content, once
async function expectLoaded (page, finding, { timeout = 60_000 } = {}) {
  await expect(qInput(page, 'Title *')).toHaveValue(finding.title)
  await expect(editorContent(page, 'Description')).toHaveAttribute('contenteditable', 'true', { timeout })
  await expect.poll(() => editorHTML(page), { timeout: 10_000 }).toBe(finding.description)
  await expect.poll(() => editorHTML(page, 'Observation'), { timeout: 10_000 }).toBe(finding.observation)
}

// Bodies of the save requests sent: never an empty or other content than the saved one
function expectSavesIntact (saves, finding) {
  for (const body of saves) {
    expect(body.description, 'description sent').toBe(finding.description)
    expect(body.observation, 'observation sent').toBe(finding.observation)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Three users with different networks on the same finding
// ---------------------------------------------------------------------------------------------------------------
test.describe('Three users with different networks on the same finding', () => {
  test.describe.configure({ mode: 'serial' })

  let finding
  let paul // Normal network
  let lea // Slow 3G: throttled HTTP requests, 1.5 s latency on the collaboration websocket (each direction)
  let max // Network cut while typing
  const pages = () => [paul.page, lea.page, max.page]

  test.beforeAll(async ({ browser }) => {
    finding = await createFinding(auditId, 'speeds')
    paul = await collabUser(browser, D.USERS.pentester)
    lea = await collabUser(browser, D.USERS.pentester2, { latency: 1500 })
    max = await collabUser(browser, PENTESTER3)
    // Opened one after the other (opening at the same time: tested in the next group)
    await openFinding(paul.page, auditId, finding, { html: finding.description })
    await openFinding(lea.page, auditId, finding, { timeout: 60_000, html: finding.description })
    await throttle(lea.page, SLOW_3G)
    await openFinding(max.page, auditId, finding, { html: finding.description })
    expect(await expectConverged(pages())).toBe(finding.description)
  })

  test.afterAll(async () => {
    for (const user of [paul, lea, max]) await user?.context.close().catch(() => {})
  })

  test('typing at the same time at different places: same document everywhere, nothing lost or duplicated', async () => {
    await Promise.all([
      typeAtEndOf(paul.page, 'first paragraph.', ' Paul on a fast network.'),
      typeAtEndOf(lea.page, 'never to be lost.', ' Lea on a slow 3G network.'),
      (async () => {
        await editorContent(max.page, 'Description').click()
        await press(max.page, 'Control+End')
        await press(max.page, 'Enter')
        await type(max.page, 'Max adds a third paragraph.')
      })()
    ])
    const html = await expectConverged(pages())
    expect(texts(html)).toEqual([
      `Saved ${finding.key}: first paragraph. Paul on a fast network.`,
      'Second saved paragraph, never to be lost. Lea on a slow 3G network.',
      'Max adds a third paragraph.'
    ])
  })

  test('typing at the same time at the same place: every character kept once, in the order typed by each user', async () => {
    const before = texts(await expectConverged(pages()))
    // One kind of characters per user: the order of the characters of each user can be checked in the merged text
    const typed = { paul: ' paul types lowercase words', lea: ' LEA TYPES UPPERCASE WORDS', max: ' 0123 4567 8901 2345' }
    await Promise.all([
      typeAtEndOf(paul.page, 'first paragraph.', typed.paul),
      typeAtEndOf(lea.page, 'first paragraph.', typed.lea),
      typeAtEndOf(max.page, 'first paragraph.', typed.max)
    ])
    const after = texts(await expectConverged(pages()))
    expect(after.slice(1)).toEqual(before.slice(1))
    expect(after[0].startsWith(before[0])).toBe(true)
    const added = after[0].slice(before[0].length)
    expect(added.length).toBe(typed.paul.length + typed.lea.length + typed.max.length)
    expect(added.replace(/[^a-z]/g, '')).toBe(typed.paul.replace(/[^a-z]/g, ''))
    expect(added.replace(/[^A-Z]/g, '')).toBe(typed.lea.replace(/[^A-Z]/g, ''))
    expect(added.replace(/[^0-9]/g, '')).toBe(typed.max.replace(/[^0-9]/g, ''))
  })

  test('network cut while typing: the text typed offline is sent when the network is back, without loss or duplicate', async () => {
    const before = texts(await expectConverged(pages()))

    // Short loss of the network: requests fail, the open collaboration websocket is kept (messages held)
    await typeAtEndOf(max.page, 'Max adds a third paragraph.', ' Glitch:')
    await max.context.setOffline(true)
    await Promise.all([
      type(max.page, ' typed during a short loss.'),
      typeAtEndOf(paul.page, 'never to be lost.', ' [Paul during the short loss of Max]')
    ])
    await max.context.setOffline(false)
    await expectConverged(pages())

    // Network cut: the collaboration connections of Max are closed, new ones fail until the network is back
    await typeAtEndOf(max.page, 'Max adds a third paragraph.', ' Before the cut,')
    await max.context.setOffline(true)
    max.link.offline()
    await expect.poll(async () => (await collabState(max.page)).status).not.toBe('connected')
    await Promise.all([
      (async () => {
        await type(max.page, ' typed offline')
        await sleep(1000)
        await type(max.page, ' and more offline.')
      })(),
      typeAtEndOf(paul.page, 'first paragraph.', ' [Paul during the cut of Max]'),
      typeAtEndOf(lea.page, 'never to be lost.', ' [Lea during the cut of Max]')
    ])
    // Still editable offline, changes kept locally and not received by the others
    expect((await collabState(max.page)).editable).toBe(true)
    await expect.poll(() => editorHTML(paul.page)).toContain('[Lea during the cut of Max]')
    expect(await editorHTML(paul.page)).not.toContain('typed offline')
    expect(await editorHTML(max.page)).not.toContain('[Paul during the cut of Max]')

    await max.context.setOffline(false)
    max.link.online()
    const after = texts(await expectConverged(pages()))
    expect(after).toEqual([
      `${before[0]} [Paul during the cut of Max]`,
      `${before[1]} [Paul during the short loss of Max] [Lea during the cut of Max]`,
      `${before[2]} Glitch: typed during a short loss. Before the cut, typed offline and more offline.`
    ])
    await expect.poll(() => socketConnected(max.page), { timeout: 30_000 }).toBe(true)
  })

  test('each page reloaded in turn shows the same document', async () => {
    const html = await expectConverged(pages())
    for (const { page } of [paul, lea, max]) {
      await page.reload()
      await expect(qInput(page, 'Title *')).toHaveValue(finding.title, { timeout: 90_000 })
      await expect(editorContent(page, 'Description')).toHaveAttribute('contenteditable', 'true', { timeout: 60_000 })
      await expect.poll(() => editorHTML(page), { timeout: 30_000 }).toBe(html)
    }
    expect(await expectConverged(pages())).toBe(html)
  })

  test('saved with the button: the database holds the document of the editors, shown again once everyone left', async ({ browser }) => {
    const html = await expectConverged(pages())
    await saveWithButton(paul.page, finding)
    expect((await storedFinding(auditId, finding.id)).description).toBe(html)

    await max.page.reload()
    await expect(editorContent(max.page, 'Description')).toHaveAttribute('contenteditable', 'true', { timeout: 60_000 })
    await expect.poll(() => editorHTML(max.page)).toBe(html)

    // Everyone leaves: the collaboration document (never stored by the server) is created again from the database
    for (const user of [paul, lea, max]) await user.context.close()
    const back = await collabUser(browser, D.USERS.pentester2)
    try {
      await openFinding(back.page, auditId, finding)
      // Spaces typed side by side by two users are collapsed when the HTML of the database is parsed
      await expect.poll(async () => (await editorHTML(back.page)).replace(/ {2,}/g, ' ')).toBe(html.replace(/ {2,}/g, ' '))
      expect((await storedFinding(auditId, finding.id)).description).toBe(html)
    } finally {
      await back.context.close()
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Saved content protected while the content of the collaboration is not loaded
// ---------------------------------------------------------------------------------------------------------------
test.describe('Saved content protected while the collaboration content is not loaded', () => {
  let users = []

  async function open (browser, user, options) {
    const created = await collabUser(browser, user, options)
    users.push(created)
    return created
  }

  // Contexts closed after each test: the collaboration document of the audit is unloaded by the server
  test.afterEach(async () => {
    for (const user of users) await user.context.close().catch(() => {})
    users = []
  })

  test('collaboration websocket refused: read-only editor, Ctrl+S keeps the saved content, content shown once back', async ({ browser }) => {
    const finding = await createFinding(auditId, 'refused')
    const paul = await open(browser, D.USERS.pentester)
    const saves = recordSaves(paul.page, finding.id)
    paul.link.offline()
    await paul.page.goto(findingUrl(auditId, finding.id))
    await expect(qInput(paul.page, 'Title *')).toHaveValue(finding.title)
    await sleep(2000) // Several connection attempts refused
    expect((await collabState(paul.page)).status).not.toBe('connected')
    await expectNotLoaded(paul.page, finding)
    await saveWithShortcut(paul.page, finding)
    await expectStoredIntact(auditId, finding)
    const savedBeforeLoading = saves.length

    paul.link.online()
    const typed = withTypedText(finding)
    await expectLoaded(paul.page, typed)
    await saveWithButton(paul.page, finding)
    await expectStoredIntact(auditId, typed)
    expectSavesIntact(saves.slice(0, savedBeforeLoading), finding)
    expectSavesIntact(saves.slice(savedBeforeLoading), typed)
  })

  test('collaboration websocket open but never answered: read-only editor, Ctrl+S keeps the saved content', async ({ browser }) => {
    const finding = await createFinding(auditId, 'unanswered')
    const paul = await open(browser, D.USERS.pentester)
    const saves = recordSaves(paul.page, finding.id)
    paul.link.hang()
    await paul.page.goto(findingUrl(auditId, finding.id))
    await expect(qInput(paul.page, 'Title *')).toHaveValue(finding.title)
    await sleep(2000)
    expect(await collabState(paul.page)).toMatchObject({ status: 'connected', synced: false, editable: false })
    await expectNotLoaded(paul.page, finding)
    await saveWithShortcut(paul.page, finding)
    await expectStoredIntact(auditId, finding)
    const savedBeforeLoading = saves.length

    // Server answering again: the connections without answer are closed, the provider opens new ones
    paul.link.online()
    const typed = withTypedText(finding)
    await expectLoaded(paul.page, typed)
    await saveWithShortcut(paul.page, finding)
    await expectStoredIntact(auditId, typed)
    expectSavesIntact(saves.slice(0, savedBeforeLoading), finding)
    expectSavesIntact(saves.slice(savedBeforeLoading), typed)
  })

  test('collaboration websocket answering after 8 s: read-only until loaded, Ctrl+S keeps the saved content', async ({ browser }) => {
    const finding = await createFinding(auditId, 'slow')
    const paul = await open(browser, D.USERS.pentester)
    const saves = recordSaves(paul.page, finding.id)
    paul.link.online({ serverDelay: 8000 })
    await paul.page.goto(findingUrl(auditId, finding.id))
    await expect(qInput(paul.page, 'Title *')).toHaveValue(finding.title)
    await expectNotLoaded(paul.page, finding)
    await saveWithShortcut(paul.page, finding)
    await expectStoredIntact(auditId, finding)
    const savedBeforeLoading = saves.length

    paul.link.online({ serverDelay: 0 }) // Next messages without delay (the delayed ones keep their delay and order)
    const typed = withTypedText(finding)
    await expectLoaded(paul.page, typed)
    await saveWithButton(paul.page, finding)
    await expectStoredIntact(auditId, typed)
    expectSavesIntact(saves.slice(0, savedBeforeLoading), finding)
    expectSavesIntact(saves.slice(savedBeforeLoading), typed)
  })

  test('collaboration websocket cut several times during the initial loading: content loaded once, nothing overwritten', async ({ browser }) => {
    const finding = await createFinding(auditId, 'cut-loading')
    const paul = await open(browser, D.USERS.pentester)
    const saves = recordSaves(paul.page, finding.id)
    // Connections cut after 1, 2 and 3 messages of the server (2 editors: Description and Observation), then normal
    paul.link.cutPlan = [1, 1, 2, 2, 3, 3]
    await paul.page.goto(findingUrl(auditId, finding.id))
    await expect(qInput(paul.page, 'Title *')).toHaveValue(finding.title)
    await saveWithShortcut(paul.page, finding)
    await expectStoredIntact(auditId, finding)

    await expectLoaded(paul.page, finding)
    // Every planned cut used: the loading went through 6 connections at least (the last one may stay open when the
    // synchronization needs fewer messages than its cut threshold)
    expect(paul.link.cutPlan).toHaveLength(0)
    expect(paul.link.connected).toBeGreaterThanOrEqual(6)
    await sleep(1500) // A late initialization would duplicate the content
    expect(await editorHTML(paul.page)).toBe(finding.description)
    await saveWithButton(paul.page, finding)
    await expectStoredIntact(auditId, finding)
    expectSavesIntact(saves, finding)
  })

  test('page reloaded twice during a slow loading: nothing saved, content intact after the reload', async ({ browser }) => {
    const finding = await createFinding(auditId, 'reload')
    const paul = await open(browser, D.USERS.pentester)
    const saves = recordSaves(paul.page, finding.id)
    paul.link.online({ serverDelay: 8000 })
    await paul.page.goto(findingUrl(auditId, finding.id))
    await expect(qInput(paul.page, 'Title *')).toHaveValue(finding.title)
    await expect(editorContent(paul.page, 'Description')).toHaveAttribute('contenteditable', 'false')
    for (let i = 0; i < 2; i++) {
      await paul.page.reload()
      await expect(qInput(paul.page, 'Title *')).toHaveValue(finding.title)
      await expect(editorContent(paul.page, 'Description')).toHaveAttribute('contenteditable', 'false')
    }
    paul.link.online({ serverDelay: 0 })
    await expectLoaded(paul.page, finding)
    expect(saves).toHaveLength(0)
    await expectStoredIntact(auditId, finding)
  })

  test('navigation to another finding and back while the collaboration websocket is refused: both findings intact', async ({ browser }) => {
    const first = await createFinding(auditId, 'nav-first')
    const second = await createFinding(auditId, 'nav-second')
    const paul = await open(browser, D.USERS.pentester)
    const saves = [...[first, second].map(f => recordSaves(paul.page, f.id))]
    paul.link.offline()
    await paul.page.goto(findingUrl(auditId, first.id))
    await expect(qInput(paul.page, 'Title *')).toHaveValue(first.title)
    await expectNotLoaded(paul.page, first)

    await goToFinding(paul.page, auditId, second)
    await expect(qInput(paul.page, 'Title *')).toHaveValue(second.title)
    await expectNotLoaded(paul.page, second)
    await saveWithShortcut(paul.page, second)

    await goToFinding(paul.page, auditId, first)
    await expect(qInput(paul.page, 'Title *')).toHaveValue(first.title)
    await expect(editorContent(paul.page, 'Description')).toHaveAttribute('contenteditable', 'false')
    await saveWithShortcut(paul.page, first)
    await expectStoredIntact(auditId, first)
    await expectStoredIntact(auditId, second)

    // Websocket back: the editors left on the previous pages connect too (they wait for it before being destroyed)
    paul.link.online()
    await expectLoaded(paul.page, first)
    await sleep(2000)
    expect(await editorHTML(paul.page)).toBe(first.description)
    await goToFinding(paul.page, auditId, second)
    await expectLoaded(paul.page, second)
    await sleep(2000)
    expect(await editorHTML(paul.page)).toBe(second.description)
    await expectStoredIntact(auditId, first)
    await expectStoredIntact(auditId, second)
    expectSavesIntact(saves[0], first)
    expectSavesIntact(saves[1], second)
  })

  test('navigation to another finding and back during a slow loading: Ctrl+S keeps the saved content of both findings', async ({ browser }) => {
    const first = await createFinding(auditId, 'slownav-first')
    const second = await createFinding(auditId, 'slownav-second')
    const paul = await open(browser, D.USERS.pentester)
    const saves = [...[first, second].map(f => recordSaves(paul.page, f.id))]
    paul.link.online({ serverDelay: 8000 })
    await paul.page.goto(findingUrl(auditId, first.id))
    await expect(qInput(paul.page, 'Title *')).toHaveValue(first.title)
    await goToFinding(paul.page, auditId, second)
    await expect(qInput(paul.page, 'Title *')).toHaveValue(second.title)
    await expect(editorContent(paul.page, 'Description')).toHaveAttribute('contenteditable', 'false')
    await saveWithShortcut(paul.page, second)
    await goToFinding(paul.page, auditId, first)
    await expect(qInput(paul.page, 'Title *')).toHaveValue(first.title)
    await expect(editorContent(paul.page, 'Description')).toHaveAttribute('contenteditable', 'false')
    await saveWithShortcut(paul.page, first)
    await expectStoredIntact(auditId, first)
    await expectStoredIntact(auditId, second)

    paul.link.online({ serverDelay: 0 })
    await expect(editorContent(paul.page, 'Description')).toHaveAttribute('contenteditable', 'true', { timeout: 60_000 })
    await expectStoredIntact(auditId, first)
    await expectStoredIntact(auditId, second)
    expectSavesIntact(saves[0], first)
    expectSavesIntact(saves[1], second)
  })

  test('navigation back and forth during a slow loading: content of the finding shown once', async ({ browser }) => {
    const first = await createFinding(auditId, 'roundtrips-first')
    const second = await createFinding(auditId, 'roundtrips-second')
    const paul = await open(browser, D.USERS.pentester)
    paul.link.online({ serverDelay: 10_000 })
    await paul.page.goto(findingUrl(auditId, first.id))
    await expect(qInput(paul.page, 'Title *')).toHaveValue(first.title)
    for (let i = 0; i < 5; i++) {
      for (const finding of [second, first]) {
        await goToFinding(paul.page, auditId, finding)
        await expect(qInput(paul.page, 'Title *')).toHaveValue(finding.title)
      }
    }
    paul.link.online({ serverDelay: 0 })
    await expect(editorContent(paul.page, 'Description')).toHaveAttribute('contenteditable', 'true', { timeout: 60_000 })
    await sleep(12_000) // Delayed messages of the hidden editors
    expect(await editorHTML(paul.page)).toBe(first.description)
    expect(await editorHTML(paul.page, 'Observation')).toBe(first.observation)
  })

  test('slow network: Ctrl+S just after opening another finding, before it is loaded, keeps its saved content', async ({ browser }) => {
    const first = await createFinding(auditId, 'ctrls-first')
    const second = await createFinding(auditId, 'ctrls-second')
    const paul = await open(browser, D.USERS.pentester)
    await openFinding(paul.page, auditId, first)
    const saves = recordSaves(paul.page, second.id)
    const cdp = await throttle(paul.page, SLOW_3G)
    await goToFinding(paul.page, auditId, second)
    const answer = saveAnswer(paul.page, second.id, 20_000)
    await paul.page.keyboard.press('Control+s') // Saved by habit just after the click
    await answer
    await expect(qInput(paul.page, 'Title *')).toHaveValue(second.title, { timeout: 60_000 })
    await unthrottle(cdp)
    expectSavesIntact(saves, second)
    await expectStoredIntact(auditId, second)
  })

  test('slow answer of the finding: Save is usable only once the finding is loaded, the saved content is kept', async ({ browser }) => {
    const finding = await createFinding(auditId, 'button')
    const paul = await open(browser, D.USERS.pentester)
    const saves = recordSaves(paul.page, finding.id)
    await paul.page.route(`**/api/audits/${auditId}/findings/${finding.id}`, async route => {
      if (route.request().method() === 'GET') await sleep(6000)
      await route.continue()
    })
    await paul.page.goto(findingUrl(auditId, finding.id))
    await expect(saveButton(paul.page)).toBeEnabled({ timeout: 30_000 })
    await saveWithButton(paul.page, finding)
    await expect(qInput(paul.page, 'Title *')).toHaveValue(finding.title, { timeout: 30_000 })
    expectSavesIntact(saves, finding)
    await expectStoredIntact(auditId, finding)
  })

  test('slow answer of the finding: the editor is editable only once the saved content is shown, and keeps it', async ({ browser }) => {
    const finding = await createFinding(auditId, 'early-typing')
    const paul = await open(browser, D.USERS.pentester)
    await paul.page.route(`**/api/audits/${auditId}/findings/${finding.id}`, async route => {
      if (route.request().method() === 'GET') await sleep(5000)
      await route.continue()
    })
    await paul.page.goto(findingUrl(auditId, finding.id))
    const description = editorContent(paul.page, 'Description')
    await expect(description).toHaveAttribute('contenteditable', 'true', { timeout: 30_000 })
    await description.click()
    await press(paul.page, 'Control+End')
    await type(paul.page, 'Typed as soon as editable.')
    await expect(qInput(paul.page, 'Title *')).toHaveValue(finding.title, { timeout: 30_000 })
    await expect.poll(() => editorHTML(paul.page), { timeout: 5000 }).toContain('Second saved paragraph, never to be lost.')
    expect(await editorHTML(paul.page)).toContain(`Saved ${finding.key}: first paragraph.`)
    expect(await editorHTML(paul.page)).toContain('Typed as soon as editable.')
    await saveWithButton(paul.page, finding)
    expect((await storedFinding(auditId, finding.id)).description).toContain('Second saved paragraph, never to be lost.')
  })

  test('two users opening the same finding at the same time on a slow network: saved content shown once', async ({ browser }) => {
    const finding = await createFinding(auditId, 'together')
    const paul = await open(browser, D.USERS.pentester, { latency: 1000 })
    const lea = await open(browser, D.USERS.pentester2, { latency: 1000 })
    await Promise.all([
      openFinding(paul.page, auditId, finding, { timeout: 60_000 }),
      openFinding(lea.page, auditId, finding, { timeout: 60_000 })
    ])
    await sleep(3000)
    const html = await expectConverged([paul.page, lea.page])
    expect(html).toBe(finding.description)
    await saveWithButton(paul.page, finding)
    await expectStoredIntact(auditId, finding)
  })

  test('user back online after another user reopened the finding: content not duplicated, offline text kept', async ({ browser }) => {
    const finding = await createFinding(auditId, 'back-online')
    const lea = await open(browser, D.USERS.pentester2)
    await openFinding(lea.page, auditId, finding, { html: finding.description })
    await lea.context.setOffline(true)
    lea.link.offline()
    await expect.poll(async () => (await collabState(lea.page)).status).not.toBe('connected')
    await typeAtEndOf(lea.page, 'first paragraph.', ' [typed by Lea offline]')

    const paul = await open(browser, D.USERS.pentester)
    await openFinding(paul.page, auditId, finding)
    await expect.poll(() => editorHTML(paul.page)).toBe(finding.description)

    await lea.context.setOffline(false)
    lea.link.online()
    await expect.poll(() => editorHTML(paul.page), { timeout: 60_000 }).toContain('[typed by Lea offline]')
    const html = await expectConverged([paul.page, lea.page])
    expect(texts(html)).toEqual([`Saved ${finding.key}: first paragraph. [typed by Lea offline]`, 'Second saved paragraph, never to be lost.'])
    await saveWithButton(paul.page, finding)
    expect((await storedFinding(auditId, finding.id)).description).toBe(html)
  })

  test('save while the network is cut: the user is told that the finding was not saved', async ({ browser }) => {
    const finding = await createFinding(auditId, 'save-offline')
    const paul = await open(browser, D.USERS.pentester)
    await openFinding(paul.page, auditId, finding, { html: finding.description })
    await typeAtEndOf(paul.page, 'never to be lost.', ' Typed before the cut.')
    await paul.context.setOffline(true)
    paul.link.offline()
    await paul.page.keyboard.press('Control+s')
    await expect(paul.page.locator('.q-notification.bg-negative')).toBeVisible({ timeout: 4000 })
    await expect(paul.page.locator('.q-notification.bg-positive')).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Navigation between findings
// ---------------------------------------------------------------------------------------------------------------
test.describe('Navigation between findings', () => {
  test('finding opened without any change: leaving it asks no confirmation', async ({ browser }) => {
    const findings = []
    for (let i = 0; i < 4; i++) findings.push(await createFinding(auditId, `nochange${i}`))
    const paul = await collabUser(browser, D.USERS.pentester)
    try {
      await openFinding(paul.page, auditId, findings[0])
      for (const finding of findings.slice(1)) {
        await sleep(1500) // Editors initialized
        await drawerLink(paul.page, finding.title).click()
        await expect(unsavedDialog(paul.page)).toHaveCount(0, { timeout: 2000 })
        await expect(paul.page).toHaveURL(new RegExp(`${findingUrl(auditId, finding.id)}$`), { timeout: 5000 })
        await expect(editorContent(paul.page, 'Description')).toHaveAttribute('contenteditable', 'true')
      }
    } finally {
      await paul.context.close()
    }
  })
})
