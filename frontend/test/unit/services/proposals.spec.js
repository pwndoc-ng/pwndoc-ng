// services/proposals.js: display helpers of the vulnerability proposals
import { describe, it, expect, vi } from 'vitest'

import { statusInfo, kindInfo, userName, PROPOSAL_FIELDS } from '@/services/proposals'
import { i18n } from '@/boot/i18n'

describe('proposals display helpers', () => {
  it.each([
    ['pending', 'Pending', 'orange-8', 'hourglass_empty'],
    ['accepted', 'Accepted', 'green', 'check_circle'],
    ['partial', 'Partially accepted', 'teal', 'mdi-progress-check'],
    ['rejected', 'Refused', 'negative', 'cancel']
  ])('describes the %s status', (status, label, color, icon) => {
    expect(statusInfo(status)).toEqual({ label, color, icon })
  })

  it('considers a proposal without status as pending', () => {
    expect(statusInfo(undefined)).toEqual(statusInfo('pending'))
    expect(statusInfo(null)).toEqual(statusInfo('pending'))
    expect(statusInfo('')).toEqual(statusInfo('pending'))
  })

  it('returns undefined for an unknown status', () => {
    expect(statusInfo('archived')).toBeUndefined()
  })

  it('describes the kinds of proposals (creation, update by default)', () => {
    expect(kindInfo('creation')).toEqual({ label: 'Creation', color: 'light-blue-7' })
    expect(kindInfo('update')).toEqual({ label: 'Update', color: 'blue-grey-6' })
    expect(kindInfo(undefined)).toEqual(kindInfo('update'))
  })

  it('translates the labels in the current language', () => {
    const labels = () => ['pending', 'accepted', 'partial', 'rejected'].map((status) => statusInfo(status).label)
    const english = labels()
    i18n.global.locale.value = 'fr-FR'
    try {
      const french = labels()
      expect(french).not.toEqual(english)
      expect(french.every((label) => label && !label.startsWith('proposals.'))).toBe(true)
    }
    finally {
      i18n.global.locale.value = 'en-US'
    }
  })

  it.each([
    [{ firstname: 'Ada', lastname: 'Lovelace', username: 'ada' }, 'Ada Lovelace'],
    [{ firstname: 'Ada', lastname: '', username: 'ada' }, 'Ada'],
    [{ lastname: 'Lovelace', username: 'ada' }, 'Lovelace'],
    [{ username: 'ada' }, 'ada'],
    [null, '?'],
    [undefined, '?']
  ])('names the user %j "%s"', (user, expected) => {
    expect(userName(user)).toBe(expected)
  })
})

describe('PROPOSAL_FIELDS', () => {
  it('lists each field once', () => {
    const fields = PROPOSAL_FIELDS.map((def) => def.field)
    expect(new Set(fields).size).toBe(fields.length)
    expect(fields).toEqual(['title', 'vulnType', 'category', 'description', 'observation', 'remediation', 'references', 'cvssv3', 'priority', 'remediationComplexity'])
  })

  it('marks the fields of the vulnerability (not of a language detail) and the editor fields', () => {
    expect(PROPOSAL_FIELDS.filter((def) => def.vuln).map((def) => def.field)).toEqual(['category', 'cvssv3', 'priority', 'remediationComplexity'])
    expect(PROPOSAL_FIELDS.filter((def) => def.html).map((def) => def.field)).toEqual(['description', 'observation', 'remediation'])
    expect(PROPOSAL_FIELDS.filter((def) => def.list).map((def) => def.field)).toEqual(['references'])
  })

  it('has translated labels and values (same values as the finding page)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = i18n.global.t
    for (const def of PROPOSAL_FIELDS) {
      if (def.label !== 'CVSS') expect(i18n.global.te(def.label, 'en-US'), def.label).toBe(true)
      for (const value of Object.values(def.values || {})) expect(i18n.global.te(value, 'en-US'), value).toBe(true)
    }
    expect(PROPOSAL_FIELDS.find((def) => def.field === 'priority').values).toEqual({ 1: 'low', 2: 'medium', 3: 'high', 4: 'urgent' })
    expect(t('urgent')).toBe('Urgent')
    expect(warn).not.toHaveBeenCalled()
  })
})
