import { $t } from '@/boot/i18n'

// Display of vulnerability proposals (updates or creations proposed from findings)

export function statusInfo(status) {
  return {
    pending: { label: $t('proposals.status.pending'), color: 'orange-8', icon: 'hourglass_empty' },
    accepted: { label: $t('proposals.status.accepted'), color: 'green', icon: 'check_circle' },
    partial: { label: $t('proposals.status.partial'), color: 'teal', icon: 'mdi-progress-check' },
    rejected: { label: $t('proposals.status.rejected'), color: 'negative', icon: 'cancel' }
  }[status || 'pending']
}

export function kindInfo(kind) {
  return kind === 'creation'
    ? { label: $t('proposals.kind.creation'), color: 'light-blue-7' }
    : { label: $t('proposals.kind.update'), color: 'blue-grey-6' }
}

export function userName(user) {
  if (!user) return '?'
  const name = [user.firstname, user.lastname].filter((e) => e).join(' ')
  return name || user.username
}

// Fields of a vulnerability that can be proposed (label: i18n key)
export const PROPOSAL_FIELDS = [
  { field: 'title', label: 'title' },
  { field: 'vulnType', label: 'type' },
  { field: 'category', label: 'category', vuln: true },
  { field: 'description', label: 'description', html: true },
  { field: 'observation', label: 'observation', html: true },
  { field: 'remediation', label: 'remediation', html: true },
  { field: 'references', label: 'references', list: true },
  { field: 'cvssv3', label: 'CVSS', vuln: true },
  { field: 'priority', label: 'priority', vuln: true, values: { 1: 'low', 2: 'medium', 3: 'high', 4: 'urgent' } },
  { field: 'remediationComplexity', label: 'remediationDifficulty', vuln: true, values: { 1: 'easy', 2: 'medium', 3: 'complex' } }
]
