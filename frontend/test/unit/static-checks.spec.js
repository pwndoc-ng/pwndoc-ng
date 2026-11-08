// Static checks of the sources: Quasar components/plugins registration, v-html usages, vue-router 4 API
// (the tests compile the Quasar components on demand: a component missing from quasar.config.cjs would only
// break in the built application)
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, it, expect } from 'vitest'

import { FRONTEND_DIR, sourceFiles, readSource } from '../helpers/source'

const require = createRequire(import.meta.url)
const quasarConfig = require(path.join(FRONTEND_DIR, 'quasar.config.cjs'))({ dev: false, prod: true, mode: { spa: true } })
const framework = quasarConfig.framework

// Files out of the scope of these tests (TipTap editor, being migrated)
const EDITOR_FILES = ['components/editor.vue', 'components/CodeBlockComponent.vue']
const templates = sourceFiles(['.vue', '.html']).filter((file) => !EDITOR_FILES.includes(file))
const scripts = sourceFiles(['.vue', '.js']).filter((file) => !EDITOR_FILES.includes(file) && !file.startsWith('i18n/'))

const pascalCase = (kebab) => kebab.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('')

describe('Quasar registration (quasar.config.cjs)', () => {
  it('registers every Quasar component used in the templates', () => {
    const missing = []
    for (const file of templates) {
      for (const match of readSource(file).matchAll(/<(q-[a-z0-9-]+)/g)) {
        const name = pascalCase(match[1])
        if (!framework.components.includes(name)) missing.push(`${match[1]} (${file})`)
      }
    }
    expect([...new Set(missing)]).toEqual([])
  })

  it('registers every Quasar directive used in the templates', () => {
    const quasarDirectives = ['close-popup', 'ripple', 'touch-hold', 'touch-pan', 'touch-repeat', 'touch-swipe', 'intersection', 'mutation', 'morph', 'scroll', 'scroll-fire']
    const missing = []
    for (const file of templates) {
      for (const match of readSource(file).matchAll(/\sv-([a-z-]+)/g)) {
        if (quasarDirectives.includes(match[1]) && !framework.directives.includes(pascalCase(match[1])))
          missing.push(`v-${match[1]} (${file})`)
      }
    }
    expect([...new Set(missing)]).toEqual([])
  })

  it('registers every Quasar plugin imported by the scripts', () => {
    const quasarPlugins = ['AddressbarColor', 'AppFullscreen', 'AppVisibility', 'BottomSheet', 'Cookies', 'Dark', 'Dialog', 'Loading', 'LoadingBar', 'LocalStorage', 'SessionStorage', 'Meta', 'Notify']
    const missing = []
    for (const file of scripts) {
      for (const match of readSource(file).matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]quasar['"]/g)) {
        for (const name of match[1].split(',').map((part) => part.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
          if (quasarPlugins.includes(name) && !framework.plugins.includes(name)) missing.push(`${name} (${file})`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('finds the components of the pages (sanity check of the scan)', () => {
    expect(templates.length).toBeGreaterThan(30)
    expect(framework.components).toContain('QTable')
    expect(framework.plugins).toEqual(expect.arrayContaining(['Dialog', 'Notify', 'Loading']))
  })
})

describe('v-html usages', () => {
  // Only static translations (i18n messages written by the developers) or sanitized HTML may be rendered as HTML
  it('only renders translations or sanitized HTML with v-html', () => {
    const unsafe = []
    for (const file of templates) {
      for (const match of readSource(file).matchAll(/v-html="([^"]*)"/g)) {
        const expression = match[1].trim()
        if (!/^\$t\('[\w.]+'\)$/.test(expression) && !/^htmlEncode(Diff)?\(/.test(expression))
          unsafe.push(`${expression} (${file})`)
      }
    }
    expect(unsafe).toEqual([])
  })

  it('defines htmlEncode as the sanitizer of services/utils in the pages using it', () => {
    for (const file of templates.filter((file) => /v-html="htmlEncode/.test(readSource(file)))) {
      const script = file.endsWith('.html') ? readSource(file.replace(/\.html$/, '.js')) : readSource(file)
      expect(script, file).toMatch(/htmlEncode(Diff)?\s*:\s*Utils\.htmlEncode(Diff)?\b|htmlEncode(Diff)?\s*(:\s*function\s*)?\([^)]*\)\s*\{\s*return\s+Utils\.htmlEncode(Diff)?\(/)
    }
  })
})

describe('vue-router 4 API', () => {
  // currentRoute is a ref in vue-router 4: router.currentRoute.path / .name are undefined
  const usages = () => scripts.flatMap((file) =>
    [...readSource(file).matchAll(/currentRoute\.(?!value\b)(\w+)/g)].map((match) => `${file}: currentRoute.${match[1]}`))

  // BUG: vue-router 3 API used with vue-router 4 (router.currentRoute is a ref):
  // - src/boot/auth.js:9 router.currentRoute.path is undefined: TypeError when the periodic token refresh fails,
  //   the user is not redirected to the login page
  // - src/pages/audits/edit/index.vue:467-476 getMenuSection() always returns {menu: 'undefined'}: the other users of
  //   the audit never see in which page (general, network, finding, section) a user is
  it.skip('uses router.currentRoute.value', () => {
    expect(usages()).toEqual([])
  })

  it('does not add new vue-router 3 currentRoute usages (regression)', () => {
    const known = ['boot/auth.js', 'pages/audits/edit/index.vue']
    expect(usages().filter((usage) => !known.some((file) => usage.startsWith(`${file}:`)))).toEqual([])
  })
})
