import { api } from 'boot/axios'
import UserService from '@/services/user'

// AI assistance (backend lib/ai.js), when enabled in the settings: assisted writing, quality check by the AI
export const AI_ACTIONS = ['correct', 'rephrase', 'shorten', 'translateFr', 'translateEn', 'fromNotes']

// AI enabled in the settings and allowed to the user (permission)
export function aiAllowed(settings, permission) {
  return Boolean(settings && settings.ai && settings.ai.enabled && UserService.isAllowed(permission))
}

export default {
  // Proposal of the AI for an action on an HTML fragment: {html}. auditId: audit of the text (pseudonymization)
  assist: function(action, html, { instruction, auditId } = {}) {
    return api.post('ai/assist', { action, html, instruction: instruction || undefined, auditId: auditId || undefined }, { timeout: 0 })
  },

  // Quality check of the findings of an audit by the AI (stored): {at, issues}
  checkAudit: function(auditId) {
    return api.post(`audits/${auditId}/qa/ai`, {}, { timeout: 0 })
  },

  // Test of the connection to the AI server with the saved settings: {provider, models, answer}
  testConnection: function() {
    return api.post('ai/test', {}, { timeout: 0 })
  }
}
