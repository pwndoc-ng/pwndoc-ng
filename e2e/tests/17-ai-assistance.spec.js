// AI assistance with an inference server of the network (stub e2e/ai-stub, compatible with OpenAI): test of the
// connection in the settings, assisted writing in an editor (proposal applied by the user only, images never sent, names
// of the client replaced by tokens), quality check of the findings by the AI. Own audit (unique name, deleted at the end),
// settings restored at the end.
const { test, expect, request: playwrightRequest } = require('@playwright/test')
const D = require('./support/data')
const { qInput, editorContent, editorCard, loginUI, apiAs, datas, ensureBaseData, ensureAudit } = require('./support/helpers')

test.describe.configure({ mode: 'serial' })

const RUN = Date.now().toString(36)
const pentester = D.USERS.pentester
const AUDIT_NAME = `E2E AI Audit ${RUN}`
const COMPANY = `E2E AI Corp ${RUN}`
const STUB = 'http://ai-stub:8000'

let auditId
const ids = {}
const REASONING = '{"chat_template_kwargs": {"enable_thinking": false}}' // Reasoning of the model set in the settings

async function setAi (values) {
  const api = await apiAs(D.USERS.admin)
  const response = await api.put('/api/settings', { data: { ai: values } })
  expect(response.ok(), await response.text()).toBeTruthy()
  await api.dispose()
}

// Requests received by the AI server
async function stubRequests () {
  const api = await playwrightRequest.newContext()
  const requests = await (await api.get(`${STUB}/e2e/requests`)).json()
  await api.dispose()
  return requests
}

test.beforeAll(async () => {
  await ensureBaseData()
  await setAi({ enabled: true, private: { url: `${STUB}/v1`, model: 'e2e-model', pseudonymize: true, extraParameters: REASONING } })
  const api = await apiAs(pentester)
  auditId = await ensureAudit(api, AUDIT_NAME)
  expect((await api.put(`/api/audits/${auditId}/general`, { data: { company: { name: COMPANY } } })).ok()).toBeTruthy()
  const findings = [
    { title: 'E2E AI Writing', description: `<p>Contact ${COMPANY} about the parameter.</p><img class="custom-image" src="data:image/png;base64,iVBORw0KGgo=" alt="proof.png">` },
    { title: 'E2E AI Empty', description: '' }
  ]
  for (const finding of findings)
    expect((await api.post(`/api/audits/${auditId}/findings`, { data: finding })).ok()).toBeTruthy()
  for (const finding of (await datas(await api.get(`/api/audits/${auditId}`))).findings)
    ids[finding.title] = finding._id
  await api.dispose()
})

test.afterAll(async () => {
  await setAi({ enabled: false, private: { url: '', model: '', pseudonymize: false, extraParameters: '' } })
  const api = await apiAs(pentester)
  await api.delete(`/api/audits/${auditId}`)
  await api.dispose()
})

test('settings: test of the connection to the AI server', async ({ page }) => {
  await loginUI(page, D.USERS.admin)
  await page.goto('/settings?tab=ai')
  const card = page.locator('.ai-settings')
  await expect(card.locator('.ai-url input')).toHaveValue(`${STUB}/v1`)
  await expect(card.locator('.ai-extra-parameters textarea')).toHaveValue(REASONING)
  await card.locator('.ai-test').click()
  // Answer, tokens of the reasoning of the model, time taken, models of the server
  await expect(card.locator('.ai-test-result')).toHaveText(/^Connection working · Answer: OK · Reasoning: 7 tokens · \d+(\.\d)? s · Models: e2e-model$/)
  // An example of the reasoning parameters fills the field
  await card.locator('.ai-extra-parameters-example').filter({ hasText: '{"reasoning_effort": "none"}' }).click()
  await expect(card.locator('.ai-extra-parameters textarea')).toHaveValue('{"reasoning_effort": "none"}')
})

test('assisted writing: proposal shown, applied by the user, no image nor client name sent', async ({ page }) => {
  await loginUI(page, pentester)
  await page.goto(`/audits/${auditId}/findings/${ids['E2E AI Writing']}`)
  await expect(qInput(page, 'Title *')).toHaveValue('E2E AI Writing')
  await expect(editorContent(page, 'Description')).toHaveAttribute('contenteditable', 'true')
  const before = (await stubRequests()).length

  await editorCard(page, 'Description').locator('.ai-assist-button').click()
  await page.locator('.ai-action[data-action="correct"]').click()
  const dialog = page.locator('.ai-proposal-dialog')
  await expect(dialog.locator('.ai-proposed')).toContainText(`[AI] Contact ${COMPANY} about the parameter.`)
  await expect(editorContent(page, 'Description')).not.toContainText('[AI]') // Not applied before the choice of the user
  await dialog.locator('.ai-apply').click()
  await expect(editorContent(page, 'Description')).toContainText(`[AI] Contact ${COMPANY} about the parameter.`)

  const sent = JSON.stringify((await stubRequests()).slice(before))
  expect(sent).toContain('[[TERM_1]]')
  expect(sent).toContain('"chat_template_kwargs":{"enable_thinking":false}') // Parameters of the settings added
  expect(sent).not.toContain(COMPANY)
  expect(sent).not.toContain('iVBORw0KGgo')
  expect(sent).not.toContain('<img')
})

test('quality check of the findings by the AI, listed with the other checks', async ({ page }) => {
  await loginUI(page, pentester)
  await page.goto(`/audits/${auditId}/general`)
  await page.locator('.qa-button').click()
  const panel = page.locator('.qa-panel')
  await expect(panel.locator('.qa-ai-date')).toHaveText('Never checked by the AI')
  await panel.locator('.qa-ai-run').click()
  await expect(panel.locator('.qa-issue').filter({ hasText: 'E2E AI: description of E2E AI Empty missing' })).toContainText('E2E AI Empty · Description')
  await expect(panel.locator('.qa-ai-date')).toContainText('Last check by the AI')
})
