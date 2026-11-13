// services/qa.js: quality checks enabled, messages, places and pages of the issues, counts
import { describe, it, expect, vi } from 'vitest'
import { qaEnabled, issueMessage, issuePlace, issuePath, issueCounts, issueTarget, openIssue, qaFocus, issueSource, issuesOfSource, sourceCounts } from '@/services/qa'

const location = (extra) => ({ kind: 'finding', id: 'f1', name: 'SQLi', field: null, label: null, ...extra })

describe('quality checks service', () => {
  it('runs the checks when a check or the highlight warning is enabled', () => {
    expect(qaEnabled({ qa: { public: { checks: { completeness: true, images: false } } } })).toBe(true)
    expect(qaEnabled({ qa: { public: { checks: { completeness: false, images: false } } } })).toBe(false)
    expect(qaEnabled({ qa: { public: { checks: { completeness: false } } }, report: { public: { highlightWarning: true } } })).toBe(true)
    expect(qaEnabled({ report: { enabled: false, public: { highlightWarning: true } } })).toBe(false)
    expect(qaEnabled({})).toBe(false)
    expect(qaEnabled(undefined)).toBe(false)
  })

  it('gives the message of an issue with its parameters', () => {
    expect(issueMessage({ code: 'commentsOpen', params: { count: 3 } })).toBe('3 review comments not resolved')
    expect(issueMessage({ code: 'referenceInvalid', params: { reference: 'htps://x.y' } })).toBe('Invalid link: "htps://x.y"')
    expect(issueMessage({ code: 'duplicateTitle', params: { other: 'SQL-Injection' } })).toBe('Same title as "SQL-Injection"')
  })

  it('gives the place of an issue: finding, section, general information, network, vulnerability with its language', () => {
    expect(issuePlace({ location: location({ field: 'remediation' }) })).toBe('SQLi · Remediation')
    expect(issuePlace({ location: location({ field: 'references' }) })).toBe('SQLi · References')
    expect(issuePlace({ location: location({ field: 'customFields.c1', label: 'Impact' }) })).toBe('SQLi · Impact')
    expect(issuePlace({ location: location({ field: 'cvss' }) })).toBe('SQLi · CVSS')
    expect(issuePlace({ location: { kind: 'general', name: 'Audit', field: 'summary' } })).toBe('General Information')
    expect(issuePlace({ location: { kind: 'network', name: 'Audit' } })).toBe('Network Scan')
    expect(issuePlace({ location: { kind: 'vulnerability', name: 'XSS', locale: 'fr', field: 'description' } })).toBe('XSS (fr) · Description')
  })

  it('gives the page of the place of an issue', () => {
    expect(issuePath('a1', { location: location() })).toBe('/audits/a1/findings/f1')
    expect(issuePath('a1', { location: { kind: 'section', id: 's1' } })).toBe('/audits/a1/sections/s1')
    expect(issuePath('a1', { location: { kind: 'network' } })).toBe('/audits/a1/network')
    expect(issuePath('a1', { location: { kind: 'general' } })).toBe('/audits/a1/general')
  })

  it('gives the field of an issue as a target of the audit page (same as the review comments)', () => {
    expect(issueTarget({ location: location({ field: 'description' }) })).toEqual({ kind: 'finding', findingId: 'f1', field: 'description' })
    expect(issueTarget({ location: location({ field: 'cvss' }) })).toEqual({ kind: 'finding', findingId: 'f1', field: 'cvssv3' })
    expect(issueTarget({ location: location({ field: null }) })).toEqual({ kind: 'finding', findingId: 'f1', field: undefined })
    expect(issueTarget({ location: { kind: 'section', id: 's1', field: 'customFields.c1' } })).toEqual({ kind: 'section', sectionId: 's1', field: 'customFields.c1' })
    expect(issueTarget({ location: { kind: 'general', field: 'customFields.c2' } })).toEqual({ kind: 'general', field: 'customFields.c2' })
    expect(issueTarget({ location: { kind: 'network' } })).toEqual({ kind: 'network' })
  })

  it('opens an issue: requested to the audit page, page of the issue opened unless already shown', async () => {
    const issue = { location: location({ field: 'description', passage: { text: 'q' } }) }
    const router = { push: vi.fn(() => Promise.resolve()), currentRoute: { value: { path: '/audits/a1/general' } } }
    await openIssue(router, 'a1', issue)
    expect(qaFocus.request).toEqual({ auditId: 'a1', issue })
    expect(router.push).toHaveBeenCalledWith('/audits/a1/findings/f1')
    router.currentRoute.value.path = '/audits/a1/findings/f1'
    await openIssue(router, 'a1', issue)
    expect(router.push).toHaveBeenCalledTimes(1)
    qaFocus.request = null
  })

  it('counts the issues by severity', () => {
    expect(issueCounts([{ severity: 'error' }, { severity: 'warning' }, { severity: 'warning' }, { severity: 'info' }])).toEqual({ error: 1, warning: 2, info: 1 })
    expect(issueCounts(undefined)).toEqual({ error: 0, warning: 0, info: 0 })
  })

  it('separates the issues of the standard rules and of the AI, and counts them', () => {
    const issues = [{ check: 'completeness' }, { check: 'ai' }, { check: 'images' }, { check: 'ai' }, {}]
    expect(issues.map(issueSource)).toEqual(['rules', 'ai', 'rules', 'ai', 'rules'])
    expect(issuesOfSource(issues, 'ai')).toEqual([issues[1], issues[3]])
    expect(issuesOfSource(issues, 'rules')).toEqual([issues[0], issues[2], issues[4]])
    expect(issuesOfSource(issues, 'all')).toEqual(issues)
    expect(sourceCounts(issues)).toEqual({ all: 5, rules: 3, ai: 2 })
    expect(sourceCounts(undefined)).toEqual({ all: 0, rules: 0, ai: 0 })
  })
})
