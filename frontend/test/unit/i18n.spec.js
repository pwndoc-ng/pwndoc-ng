// Consistency of the translations (src/i18n) and of the keys used by the code
import { describe, it, expect } from 'vitest'
import { baseCompile } from '@intlify/message-compiler'

import messages from '@/i18n'
import { sourceFiles, readSource, flattenMessages } from '../helpers/source'

const LOCALES = ['en-US', 'fr-FR', 'de-DE', 'zh-CN', 'pt-BR']
// Translations kept complete (no fallback to English)
const COMPLETE = ['fr-FR', 'pt-BR']
const flat = Object.fromEntries(LOCALES.map((locale) => [locale, flattenMessages(messages[locale])]))
const en = flat['en-US']

// 'quantifier' is inserted between a number and a noun: empty except in Chinese (个)
const INTENTIONALLY_EMPTY = ['quantifier']

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
  it('declares the 5 languages of the language selector', () => {
    expect(Object.keys(messages).sort()).toEqual([...LOCALES].sort())
  })

  it.each(COMPLETE)('has every en-US key translated in %s', (locale) => {
    expect(Object.keys(en).filter((key) => !(key in flat[locale]))).toEqual([])
  })

  it.each(COMPLETE)('has no %s key unknown in en-US (dead or misspelled key)', (locale) => {
    expect(Object.keys(flat[locale]).filter((key) => !(key in en))).toEqual([])
  })

  it.each(LOCALES)('has no empty message in %s (an empty translation is displayed, no fallback)', (locale) => {
    expect(emptyKeys(locale)).toEqual([])
  })

  it.each(COMPLETE)('uses the same placeholders in en-US and %s', (locale) => {
    const translated = flat[locale]
    const mismatches = Object.keys(en)
      .filter((key) => key in translated && placeholders(en[key]).join() !== placeholders(translated[key]).join())
      .map((key) => `${key}: ${JSON.stringify(en[key])} / ${JSON.stringify(translated[key])}`)
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

  it('only uses keys defined in en-US (a missing key is displayed raw)', () => {
    expect(undefinedKeys().map((key) => `${key} (${[...keys.get(key)].join(', ')})`)).toEqual([])
  })

  it('only uses keys pointing to a message, not to a group of messages', () => {
    const groups = [...keys.keys()].filter((key) => key in messages['en-US'] && typeof messages['en-US'][key] === 'object')
    expect(groups).toEqual([])
  })
})
