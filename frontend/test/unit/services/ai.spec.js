// services/ai.js: AI enabled and allowed, requests of the assisted writing, of the quality check and of the test, run in
// the background (result of the job asked until ready)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import AiService, { aiAllowed, AI_ACTIONS, POLL_DELAYS } from '@/services/ai'
import UserService from '@/services/user'
import { api, resetApi } from '../../helpers/api-mock'

beforeEach(() => resetApi())

describe('AI service', () => {
  it('is offered when the AI is enabled in the settings and allowed to the user', () => {
    UserService.user = { username: 'ann', roles: ['ai:assist'] }
    expect(aiAllowed({ ai: { enabled: true } }, 'ai:assist')).toBe(true)
    expect(aiAllowed({ ai: { enabled: true } }, 'ai:qa')).toBe(false)
    expect(aiAllowed({ ai: { enabled: false } }, 'ai:assist')).toBe(false)
    expect(aiAllowed({}, 'ai:assist')).toBe(false)
    expect(aiAllowed(undefined, 'ai:assist')).toBe(false)
  })

  it('sends the action, the HTML, the instruction and the audit', () => {
    AiService.assist('correct', '<p>x</p>', { auditId: 'a1' })
    expect(api.post).toHaveBeenCalledWith('ai/assist', { action: 'correct', html: '<p>x</p>', instruction: undefined, auditId: 'a1' })
    AiService.assist('custom', '<p>x</p>', { instruction: 'Pirate' })
    expect(api.post).toHaveBeenLastCalledWith('ai/assist', { action: 'custom', html: '<p>x</p>', instruction: 'Pirate', auditId: undefined })
    expect(AI_ACTIONS).toEqual(['correct', 'rephrase', 'shorten', 'translateFr', 'translateEn', 'fromNotes'])
  })

  it('checks an audit and tests the connection', () => {
    AiService.checkAudit('a1')
    expect(api.post).toHaveBeenCalledWith('audits/a1/qa/ai', {})
    AiService.testConnection()
    expect(api.post).toHaveBeenLastCalledWith('ai/test', {})
  })
})

describe('requests to the AI run in the background', () => {
  const started = (job = 'j1') => ({ status: 202, data: { status: 'success', datas: { job } } })
  const running = { status: 200, data: { status: 'success', datas: { state: 'running' } } }
  const done = (result) => ({ status: 200, data: { status: 'success', datas: { state: 'done', result } } })

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('asks for the result of the job until it is ready, less often over time, and answers it as a direct request', async () => {
    api.post.mockResolvedValue(started())
    api.get.mockResolvedValueOnce(running).mockResolvedValueOnce(running).mockResolvedValueOnce(done({ html: '<p>ok</p>', missing: 0 }))
    const answer = AiService.assist('correct', '<p>x</p>')
    await vi.advanceTimersByTimeAsync(499)
    expect(api.get).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(api.get).toHaveBeenCalledWith('ai/jobs/j1')
    await vi.advanceTimersByTimeAsync(1000)
    expect(api.get).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1500)
    expect((await answer).data.datas).toEqual({ html: '<p>ok</p>', missing: 0 })
    expect(api.get).toHaveBeenCalledTimes(3)
    expect(POLL_DELAYS[POLL_DELAYS.length - 1]).toBe(3000) // At most every 3 seconds
  })

  it('answers the errors of the AI (status and message of the server) and the requests refused before starting', async () => {
    api.post.mockResolvedValue(started())
    const error = { response: { status: 502, data: { status: 'error', datas: 'The AI server is not available' } } }
    api.get.mockResolvedValueOnce(running).mockRejectedValueOnce(error)
    const answer = AiService.checkAudit('a1').catch((err) => err)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await answer).toBe(error)
    expect(api.get).toHaveBeenCalledTimes(2)
    // Refused at once (no job): the error of the request
    api.post.mockRejectedValue({ response: { status: 403, data: { status: 'error', datas: 'AI assistance is disabled' } } })
    await expect(AiService.testConnection()).rejects.toMatchObject({ response: { status: 403 } })
    // Server without background requests: the answer itself
    api.post.mockResolvedValue({ status: 200, data: { status: 'success', datas: { html: '<p>direct</p>' } } })
    expect((await AiService.assist('correct', '<p>x</p>')).data.datas).toEqual({ html: '<p>direct</p>' })
  })

  it('asks again when a request for the result is lost (network, proxy), up to a limit', async () => {
    api.post.mockResolvedValue(started())
    const lost = { message: 'Network Error' }
    const proxy = { response: { status: 504, data: '<html>Gateway Time-out</html>' } }
    api.get.mockRejectedValueOnce(lost).mockRejectedValueOnce(proxy).mockResolvedValueOnce(done({ answer: 'OK' }))
    const answer = AiService.testConnection()
    await vi.advanceTimersByTimeAsync(5000)
    expect((await answer).data.datas).toEqual({ answer: 'OK' })
    api.get.mockReset()
    api.get.mockRejectedValue(lost)
    const failing = AiService.testConnection().catch((err) => err)
    await vi.advanceTimersByTimeAsync(30000)
    expect(await failing).toBe(lost)
    expect(api.get).toHaveBeenCalledTimes(6) // 5 lost in a row retried
  })
})
