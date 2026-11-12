import { reactive } from 'vue'
import { $t } from '@/boot/i18n'

// Quality checks (backend lib/qa.js): issues {fingerprint, check, severity, code, params, location} shown in the audit,
// before the generation of a report and on the vulnerabilities page

export const SEVERITIES = ['error', 'warning', 'info']
export const SEVERITY_ICONS = { error: { name: 'mdi-alert-circle', color: 'negative' }, warning: { name: 'mdi-alert', color: 'orange-8' }, info: { name: 'mdi-information', color: 'info' } }

// Quality checks or the warning of the highlighted texts enabled in the settings (checked before a report generation)
export function qaEnabled(settings) {
  var checks = settings && settings.qa && settings.qa.public && settings.qa.public.checks
  var report = settings && settings.report
  var highlights = Boolean(report && report.enabled !== false && report.public && report.public.highlightWarning)
  return highlights || Boolean(checks && Object.values(checks).some((enabled) => enabled !== false))
}

// Message of an issue (parameters of the backend, e.g. {count}, {text})
export function issueMessage(issue) {
  return $t(`qa.codes.${issue.code}`, issue.params || {})
}

// Place of an issue: finding, section or vulnerability, and field
export function issuePlace(issue) {
  var location = issue.location || {}
  var fields = { description: $t('description'), observation: $t('observation'), remediation: $t('remediation'), poc: $t('proofs'), scope: $t('affectedAssets'), references: $t('qa.references'), cvss: 'CVSS' }
  var field = location.label || fields[location.field] || ''
  var place = location.kind === 'general' ? $t('generalInformation') : location.kind === 'network' ? $t('networkScan') : location.name
  if (location.locale) place = `${place} (${location.locale})`
  return field ? `${place} · ${field}` : place
}

// Page of the place of an issue of an audit
export function issuePath(auditId, issue) {
  var location = issue.location || {}
  if (location.kind === 'finding') return `/audits/${auditId}/findings/${location.id}`
  if (location.kind === 'section') return `/audits/${auditId}/sections/${location.id}`
  if (location.kind === 'network') return `/audits/${auditId}/network`
  return `/audits/${auditId}/general`
}

// Field of an issue as a target of the audit page (same as the review comments): {kind, findingId | sectionId, field}
export function issueTarget(issue) {
  var location = issue.location || {}
  var field = location.field === 'cvss' ? 'cvssv3' : location.field || undefined
  if (location.kind === 'finding') return { kind: 'finding', findingId: location.id, field: field }
  if (location.kind === 'section') return { kind: 'section', sectionId: location.id, field: field }
  if (location.kind === 'network') return { kind: 'network' }
  return { kind: 'general', field: field }
}

// Issue to show by the audit page (field, passage), requested before the navigation to the audit: {auditId, issue}
export const qaFocus = reactive({ request: null })

// Opens the place of an issue of an audit: page, then the field and its passage shown by the audit page
export function openIssue(router, auditId, issue) {
  qaFocus.request = { auditId: auditId, issue: issue }
  var path = issuePath(auditId, issue)
  if (router.currentRoute && router.currentRoute.value && router.currentRoute.value.path === path) return Promise.resolve()
  return Promise.resolve(router.push(path)).catch(() => {})
}

// Number of issues of each severity: {error, warning, info}
export function issueCounts(issues) {
  var counts = { error: 0, warning: 0, info: 0 }
  ;(issues || []).forEach((issue) => { counts[issue.severity] = (counts[issue.severity] || 0) + 1 })
  return counts
}
