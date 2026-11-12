// services/qa.js: quality checks enabled, messages, places and pages of the issues, counts
import { describe, it, expect } from 'vitest'
import { qaEnabled, issueMessage, issuePlace, issuePath, issueCounts } from '@/services/qa'

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

  it('counts the issues by severity', () => {
    expect(issueCounts([{ severity: 'error' }, { severity: 'warning' }, { severity: 'warning' }, { severity: 'info' }])).toEqual({ error: 1, warning: 2, info: 1 })
    expect(issueCounts(undefined)).toEqual({ error: 0, warning: 0, info: 0 })
  })
})
