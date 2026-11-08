// Consistency of the translations (src/i18n) and of the keys used by the code
import { describe, it, expect } from 'vitest'
import { baseCompile } from '@intlify/message-compiler'

import messages from '@/i18n'
import { sourceFiles, readSource, flattenMessages } from '../helpers/source'

const LOCALES = ['en-US', 'fr-FR', 'de-DE', 'zh-CN']
const flat = Object.fromEntries(LOCALES.map((locale) => [locale, flattenMessages(messages[locale])]))
const en = flat['en-US']
const fr = flat['fr-FR']

// 'quantifier' is inserted between a number and a noun: empty except in Chinese (个)
const INTENTIONALLY_EMPTY = ['quantifier']

// Known gaps (see the skipped tests below): the regression tests fail if new ones appear
const KNOWN_MISSING_FR = [
  'btn.accountsEnabled', 'btn.accountsDisabled', 'btn.accountEnabled', 'btn.accountDisabled', 'msg.passwordComplexity',
  'shortName', 'cvssTemporalScore', 'cvssEnvironmentalScore', 'twoStepVerification', 'twoStepVerificationMessage',
  'captions', 'captionsDescription'
]
const isKnownMissingFr = (key) => key.startsWith('cvss.tooltip.') || KNOWN_MISSING_FR.includes(key)
const KNOWN_EMPTY = { 'de-DE': ['extendCvssTemporalEnvironment'] }
const KNOWN_UNDEFINED_KEYS = [
  'action', 'auditType', 'noVulnTypesForLanguage', 'invalidYamlFormat', 'msg.allCollabDeleteNotice',
  'msg.allCollabDeleteOk', 'btn.comfirm', 'settingsUpdatedOk'
]

// Placeholders of a message: list ({0}) and named ({name}) interpolations
function placeholders(message) {
  return [...String(message).matchAll(/\{\s*([\w.]+)\s*\}/g)].map((match) => match[1]).sort()
}

function emptyKeys(locale) {
  return Object.entries(flat[locale])
    .filter(([key, value]) => !INTENTIONALLY_EMPTY.includes(key) && (typeof value !== 'string' || value.trim() === ''))
    .map(([key]) => key)
}

// Static keys used in the templates and scripts: $t('key'...)
function usedKeys() {
  const keys = new Map()
  for (const file of sourceFiles()) {
    if (file.startsWith('i18n/')) continue
    for (const match of readSource(file).matchAll(/\$t[ce]?\(\s*(['"])([^'"]+)\1/g)) {
      if (!keys.has(match[2])) keys.set(match[2], new Set())
      keys.get(match[2]).add(file)
    }
  }
  return keys
}

describe('i18n messages', () => {
  it('declares the 4 languages of the language selector', () => {
    expect(Object.keys(messages).sort()).toEqual([...LOCALES].sort())
  })

  // BUG: 115 en-US keys are not translated in fr-FR (French users see English): the 103 cvss.tooltip.* texts of the
  // CVSS calculator, btn.account(s)Enabled/Disabled, msg.passwordComplexity, shortName, cvssTemporalScore,
  // cvssEnvironmentalScore, twoStepVerification, twoStepVerificationMessage, captions, captionsDescription
  it.skip('has every en-US key translated in fr-FR', () => {
    expect(Object.keys(en).filter((key) => !(key in fr))).toEqual([])
  })

  it('has no fr-FR translation missing besides the known ones (regression)', () => {
    const missing = Object.keys(en).filter((key) => !(key in fr) && !isKnownMissingFr(key))
    expect(missing).toEqual([])
  })

  it('has no fr-FR key unknown in en-US (dead or misspelled key)', () => {
    expect(Object.keys(fr).filter((key) => !(key in en))).toEqual([])
  })

  it.each(['en-US', 'fr-FR', 'zh-CN'])('has no empty message in %s (an empty translation is displayed, no fallback)', (locale) => {
    expect(emptyKeys(locale)).toEqual([])
  })

  // BUG: src/i18n/de-DE/index.js:507 extendCvssTemporalEnvironment is '' (Settings page: empty label in German,
  // vue-i18n does not fall back to English for an empty string)
  it.skip('has no empty message in de-DE', () => {
    expect(emptyKeys('de-DE')).toEqual([])
  })

  it('has no empty message in de-DE besides the known one (regression)', () => {
    expect(emptyKeys('de-DE').filter((key) => !KNOWN_EMPTY['de-DE'].includes(key))).toEqual([])
  })

  it('uses the same placeholders in en-US and fr-FR', () => {
    const mismatches = Object.keys(en)
      .filter((key) => key in fr && placeholders(en[key]).join() !== placeholders(fr[key]).join())
      .map((key) => `${key}: ${JSON.stringify(en[key])} / ${JSON.stringify(fr[key])}`)
    expect(mismatches).toEqual([])
  })

  it.each(['de-DE', 'zh-CN'])('uses the en-US placeholders in the translated messages of %s', (locale) => {
    const mismatches = Object.keys(flat[locale])
      .filter((key) => key in en && placeholders(en[key]).join() !== placeholders(flat[locale][key]).join())
    expect(mismatches).toEqual([])
  })

  it.each(LOCALES)('has only valid vue-i18n message syntax in %s (@, |, {} are special characters)', (locale) => {
    const errors = []
    for (const [key, message] of Object.entries(flat[locale])) {
      if (typeof message !== 'string') continue
      baseCompile(message, { onError: (error) => errors.push(`${key}: ${error.message} in ${JSON.stringify(message)}`) })
    }
    expect(errors).toEqual([])
  })

  it('reports the keys of de-DE and zh-CN falling back to English (informative, not an error)', () => {
    for (const locale of ['de-DE', 'zh-CN']) {
      const missing = Object.keys(en).filter((key) => !(key in flat[locale]))
      if (missing.length)
        console.info(`[i18n] ${locale}: ${missing.length} keys displayed in English:\n  ${missing.join('\n  ')}`)
      // Keys only present in a partial translation are never displayed: they must exist in en-US
      expect(Object.keys(flat[locale]).filter((key) => !(key in en))).toEqual([])
    }
  })
})

describe('i18n keys used by the code', () => {
  const keys = usedKeys()
  const undefinedKeys = () => [...keys.keys()].filter((key) => !(key in en))

  it('finds the $t() calls of the sources', () => {
    expect(keys.size).toBeGreaterThan(300)
  })

  // BUG: keys used by the code but not defined: the raw key is displayed instead of a text
  // - pages/settings/settings.js:61 'btn.comfirm' (typo of btn.confirm, button of the revert defaults dialog)
  // - pages/settings/settings.js:176 'settingsUpdatedOk' (defined as msg.settingsUpdatedOk)
  // - pages/data/dump/dump.js:125,357,499,641 'invalidYamlFormat' (defined as err.invalidYamlFormat)
  // - pages/data/dump/dump.js:683,691 'msg.allCollabDeleteNotice' / 'msg.allCollabDeleteOk' (defined as msg.allUsersDelete*)
  // - pages/audits/list/audits-list.html:90 'auditType' (only comments.auditType exists)
  // - pages/audits/edit/findings/add/add.html:102 'action'
  // - pages/data/custom/custom.html:531 'noVulnTypesForLanguage'
  it.skip('only uses keys defined in en-US (a missing key is displayed raw)', () => {
    expect(undefinedKeys()).toEqual([])
  })

  it('uses no undefined key besides the known ones (regression)', () => {
    const missing = undefinedKeys()
      .filter((key) => !KNOWN_UNDEFINED_KEYS.includes(key))
      .map((key) => `${key} (${[...keys.get(key)].join(', ')})`)
    expect(missing).toEqual([])
  })

  it('only uses keys pointing to a message, not to a group of messages', () => {
    const groups = [...keys.keys()].filter((key) => key in messages['en-US'] && typeof messages['en-US'][key] === 'object')
    expect(groups).toEqual([])
  })
})
