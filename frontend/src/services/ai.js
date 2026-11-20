import { api } from 'boot/axios'
import UserService from '@/services/user'

// AI assistance (backend lib/ai.js), when enabled in the settings: assisted writing, quality check by the AI
export const AI_ACTIONS = ['correct', 'rephrase', 'shorten', 'translateFr', 'translateEn', 'fromNotes']

// AI enabled in the settings and allowed to the user (permission)
export function aiAllowed(settings, permission) {
  return Boolean(settings && settings.ai && settings.ai.enabled && UserService.isAllowed(permission))
}

// Requests to the AI run in the background (backend lib/ai-jobs.js): the request answers its job at once (202), whose
// result is then asked until it is ready, less often over time. No request stays open while the AI answers (minutes):
// the proxies would cut it (504). Same answer as a direct request ({data: {datas: result}}), errors of the AI as errors
// of the request (status and message of the server)
export const POLL_DELAYS = [500, 1000, 1500, 2000, 3000]
const LOST_POLLS = 5 // Requests for the result lost in a row (network, proxy) before giving up

export async function jobResult(started, delays = POLL_DELAYS) {
  const response = await started
  const job = response && response.status === 202 && response.data && response.data.datas && response.data.datas.job
  if (!job) return response
  for (let attempt = 0, lost = 0; ; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, delays[Math.min(attempt, delays.length - 1)]))
    let poll
    try {
      poll = await api.get(`ai/jobs/${job}`)
      lost = 0
    }
    catch (err) {
      const answered = err.response && err.response.data && err.response.data.status === 'error' // Answer of pwndoc
      if (answered || ++lost > LOST_POLLS) throw err
      continue
    }
    if (poll.data.datas.state === 'done') return { ...poll, data: { ...poll.data, datas: poll.data.datas.result } }
  }
}

export default {
  // Proposal of the AI for an action on an HTML fragment: {html, missing}. auditId: audit of the text (pseudonymization)
  assist: function(action, html, { instruction, auditId } = {}) {
    return jobResult(api.post('ai/assist', { action, html, instruction: instruction || undefined, auditId: auditId || undefined }))
  },

  // Quality check of the findings of an audit by the AI (stored): {at, issues}
  checkAudit: function(auditId) {
    return jobResult(api.post(`audits/${auditId}/qa/ai`, {}))
  },

  // Test of the connection to the AI server with the saved settings: {models, answer, reasoningTokens, seconds}
  testConnection: function() {
    return jobResult(api.post('ai/test', {}))
  }
}
