// services/ai.js: AI enabled and allowed, requests of the assisted writing, of the quality check and of the test
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import AiService, { aiAllowed, AI_ACTIONS } from '@/services/ai'
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

  it('sends the action, the HTML, the instruction and the audit, without timeout', () => {
    AiService.assist('correct', '<p>x</p>', { auditId: 'a1' })
    expect(api.post).toHaveBeenCalledWith('ai/assist', { action: 'correct', html: '<p>x</p>', instruction: undefined, auditId: 'a1' }, { timeout: 0 })
    AiService.assist('custom', '<p>x</p>', { instruction: 'Pirate' })
    expect(api.post).toHaveBeenLastCalledWith('ai/assist', { action: 'custom', html: '<p>x</p>', instruction: 'Pirate', auditId: undefined }, { timeout: 0 })
    expect(AI_ACTIONS).toEqual(['correct', 'rephrase', 'shorten', 'translateFr', 'translateEn', 'fromNotes'])
  })

  it('checks an audit and tests the connection', () => {
    AiService.checkAudit('a1')
    expect(api.post).toHaveBeenCalledWith('audits/a1/qa/ai', {}, { timeout: 0 })
    AiService.testConnection()
    expect(api.post).toHaveBeenLastCalledWith('ai/test', {}, { timeout: 0 })
  })
})
