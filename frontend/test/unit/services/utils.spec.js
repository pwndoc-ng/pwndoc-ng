// services/utils.js: sanitization of the editors HTML, filters, custom fields, text templates and helpers
import { describe, it, expect, vi, afterEach } from 'vitest'
import DOMPurify from 'dompurify'

import Utils from '@/services/utils'
import { readSource } from '../../helpers/source'

const ID = '5f0c8b9e2a1d4c3b2a1f0e9d' // ID of an uploaded image (24 hex characters)
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

// Parsed result, to check attributes independently of their serialization order
function parse(html) {
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content
}

describe('Utils.htmlEncode (allow-list of the editor HTML)', () => {
  it('returns an empty string for non-string values', () => {
    expect(Utils.htmlEncode(null)).toBe('')
    expect(Utils.htmlEncode(undefined)).toBe('')
    expect(Utils.htmlEncode(42)).toBe('')
    expect(Utils.htmlEncode({ toString: () => '<p>x</p>' })).toBe('')
  })

  it('keeps the text formatting of the editor', () => {
    const html = '<h1>T1</h1><h2>T2</h2><h6>T6</h6><p><b>b</b><strong>s</strong><i>i</i><em>e</em><u>u</u><s>s</s><strike>k</strike><br></p>' +
      '<blockquote><p>quote</p></blockquote><hr><ul><li><p>a</p></li></ul><ol start="3"><li><p>c</p></li></ol>'
    expect(Utils.htmlEncode(html)).toBe(html)
  })

  it('keeps the tables with their colgroup and column widths', () => {
    const html = '<table style="min-width: 75px"><colgroup><col style="width: 120px"><col style="min-width: 25px"></colgroup>' +
      '<tbody><tr><th colspan="2" rowspan="1" colwidth="120,80"><p>H</p></th></tr><tr><td colspan="1" rowspan="2"><p>c</p></td></tr></tbody></table>'
    expect(Utils.htmlEncode(html)).toBe(html)
  })

  it('keeps the highlight colors (mark with data-color and background-color)', () => {
    const html = '<p><mark data-color="#ffd54f" style="background-color: #ffd54f; color: inherit">important</mark></p>'
    const mark = parse(Utils.htmlEncode(html)).querySelector('mark')
    expect(mark.getAttribute('data-color')).toBe('#ffd54f')
    expect(mark.getAttribute('style')).toBe('background-color: #ffd54f; color: inherit')
    expect(Utils.htmlEncode('<mark style="background-color: rgb(255, 213, 79)">x</mark>')).toContain('rgb(255, 213, 79)')
  })

  it('keeps the code blocks with their language and the syntax highlighting spans', () => {
    const html = '<pre><code class="language-javascript"><span class="hljs-keyword">const</span> a = <span class="hljs-title function_">f</span>()</code></pre>' +
      '<pre><code class="language-c++">x</code></pre><pre><code class="language-c#">y</code></pre>'
    expect(Utils.htmlEncode(html)).toBe(html)
  })

  it.each([
    ['ID of an uploaded image', ID],
    ['base64 image', PNG],
    ['https image', 'https://example.com/images/a.png?size=2'],
    ['http image', 'http://intranet/a.jpg']
  ])('keeps the images: %s', (name, src) => {
    const img = parse(Utils.htmlEncode(`<img src="${src}" alt="Screenshot" title="T" class="custom-image" data-width="medium">`)).querySelector('img')
    expect(img.getAttribute('src')).toBe(src)
    expect(img.getAttribute('alt')).toBe('Screenshot')
    expect(img.getAttribute('title')).toBe('T')
    expect(img.getAttribute('class')).toBe('custom-image')
    expect(img.getAttribute('data-width')).toBe('medium')
  })

  it('keeps the figures and the captions (legend label/alt)', () => {
    const html = `<figure><img src="${ID}"><figcaption>Figure 1</figcaption></figure><legend label="Figure" alt="Network diagram"></legend>`
    expect(Utils.htmlEncode(html)).toBe(html)
  })

  it('keeps the links, with target only when it is _blank', () => {
    const link = parse(Utils.htmlEncode('<a href="https://owasp.org/" target="_blank" rel="noopener noreferrer nofollow">OWASP</a>')).querySelector('a')
    expect(link.getAttribute('href')).toBe('https://owasp.org/')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow')
    expect(Utils.htmlEncode('<a href="https://owasp.org/" target="_self">x</a>')).toBe('<a href="https://owasp.org/">x</a>')
    expect(Utils.htmlEncode('<a href="https://owasp.org/" target="_top">x</a>')).toBe('<a href="https://owasp.org/">x</a>')
    expect(Utils.htmlEncode('<a href="mailto:security@example.com">mail</a>')).toBe('<a href="mailto:security@example.com">mail</a>')
  })

  it.each([
    ['script tag', '<p>a</p><script>alert(1)</script>', '<p>a</p>'],
    ['event handler of an image with invalid source', '<img src=x onerror="alert(1)">', '<img>'],
    ['event handler of a valid image', `<img src="${ID}" onerror="alert(1)" onload="alert(2)">`, `<img src="${ID}">`],
    ['event handler of a paragraph', '<p onclick="alert(1)" onmouseover="alert(2)">a</p>', '<p>a</p>'],
    ['event handler of a highlight span', '<span class="hljs-string" onclick="alert(1)">a</span>', '<span class="hljs-string">a</span>'],
    ['javascript: link', '<a href="javascript:alert(1)">x</a>', '<a>x</a>'],
    ['obfuscated javascript: link', '<a href="jav&#x09;ascript:alert(1)">x</a>', '<a>x</a>'],
    ['javascript: link with leading spaces', '<a href="  javascript:alert(1)">x</a>', '<a>x</a>'],
    ['vbscript: link', '<a href="vbscript:msgbox(1)">x</a>', '<a>x</a>'],
    ['data: link', '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>', '<a>x</a>'],
    ['javascript: image', '<img src="javascript:alert(1)">', '<img>'],
    ['data: image which is not an image', '<img src="data:text/html;base64,PHNjcmlwdD4=">', '<img>'],
    ['relative image path', '<img src="../../api/users/me">', '<img>'],
    ['svg with script', '<svg><script>alert(1)</script></svg><p>a</p>', '<p>a</p>'],
    ['svg onload', '<svg onload="alert(1)"></svg>', ''],
    ['math mutation', '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>', ''],
    ['iframe', '<iframe src="https://evil.example"></iframe>', ''],
    ['object/embed', '<object data="x.swf"></object><embed src="x.swf">', ''],
    ['form and inputs', '<form action="https://evil.example"><input name="password"><button>Go</button></form>', 'Go'],
    ['style tag', '<style>body{background:url(https://evil.example/x)}</style><p>a</p>', '<p>a</p>'],
    ['link/meta/base tags', '<link rel="stylesheet" href="https://evil.example/x.css"><meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/">', ''],
    ['details ontoggle', '<details open ontoggle="alert(1)"><summary>s</summary></details>', 's'],
    ['unknown tags (text kept)', '<marquee>m</marquee><div>d</div><font color="red">f</font>', 'mdf'],
    ['style on a paragraph', '<p style="color: red">a</p>', '<p>a</p>'],
    ['style with url()', '<mark style="background-color: red; background-image: url(https://evil.example/t.png)">a</mark>', '<mark>a</mark>'],
    ['style with expression()', '<table style="width: expression(alert(1))"><tbody><tr><td>a</td></tr></tbody></table>', '<table><tbody><tr><td>a</td></tr></tbody></table>'],
    ['style with css escapes', '<col style="width: \\75 rl(x)">', ''],
    ['style with properties not produced by the editor', '<mark style="background-color: red; position: fixed; top: 0">a</mark>', '<mark>a</mark>'],
    ['class not produced by the editor', '<span class="q-dialog fixed-full">a</span><code class="language-js onerror">b</code><img src="' + ID + '" class="custom-image hidden">', `<span>a</span><code>b</code><img src="${ID}">`],
    ['id and name (DOM clobbering)', '<p id="app" name="cookie">a</p><img name="getElementById" src="' + ID + '">', `<p>a</p><img src="${ID}">`],
    ['data attributes not produced by the editor', '<p data-v-app="1">a</p><img src="' + ID + '" data-src="x">', `<p>a</p><img src="${ID}">`],
    ['diff classes outside the diff view', '<span class="diffadd">a</span>', '<span>a</span>'],
    ['attributes of other tags', '<td colspan="2" style="width: 1px" onclick="x">a</td>', '<table><tbody><tr><td colspan="2">a</td></tr></tbody></table>']
  ])('removes XSS / unexpected content: %s', (name, html, expected) => {
    const result = Utils.htmlEncode(html)
    if (name === 'attributes of other tags') // td outside a table is dropped by the HTML parser
      expect(result).not.toMatch(/style|onclick/)
    else
      expect(result).toBe(expected)
    expect(result).not.toMatch(/on\w+=|javascript:|<script|<svg|<iframe|<style/i)
  })

  it('removes mutation XSS payloads (noscript / title)', () => {
    const result = Utils.htmlEncode('<noscript><p title="</noscript><img src=x onerror=alert(1)>">')
    expect(result).not.toMatch(/onerror/)
    const result2 = Utils.htmlEncode('<p title="</p><img src=x onerror=alert(1)>">a</p>')
    expect(parse(result2).querySelector('img')).toBeNull()
  })

  it('does not execute the payloads while sanitizing', () => {
    window.__xssExecuted = false
    Utils.htmlEncode('<img src="x" onerror="window.__xssExecuted = true"><svg onload="window.__xssExecuted = true">')
    expect(window.__xssExecuted).toBe(false)
  })
})

describe('Utils.htmlEncodeDiff (differences between versions)', () => {
  it('keeps the diff markers of the version comparison', () => {
    const html = '<p><span class="diffeq">same </span><span class="diffrem">old</span><span class="diffadd">new</span></p>'
    expect(Utils.htmlEncodeDiff(html)).toBe(html)
  })

  it('applies the same allow-list as htmlEncode', () => {
    expect(Utils.htmlEncodeDiff('<span class="diffadd" onclick="x">a</span><script>alert(1)</script>')).toBe('<span class="diffadd">a</span>')
    expect(Utils.htmlEncodeDiff('<span class="diffadd evil">a</span>')).toBe('<span>a</span>')
    expect(Utils.htmlEncodeDiff('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>')
    expect(Utils.htmlEncodeDiff(`<img src="${ID}" class="custom-image">`)).toBe(`<img src="${ID}" class="custom-image">`)
    expect(Utils.htmlEncodeDiff(null)).toBe('')
  })

  it('does not allow the diff classes in htmlEncode once the diff purifier is created', () => {
    Utils.htmlEncodeDiff('<span class="diffadd">a</span>')
    expect(Utils.htmlEncode('<span class="diffadd">a</span>')).toBe('<span>a</span>')
  })

  it('does not change the configuration of the global DOMPurify instance', () => {
    Utils.htmlEncode('<p>a</p>')
    expect(DOMPurify.sanitize('<p style="color: red" id="x">a</p>')).toBe('<p style="color: red" id="x">a</p>')
  })
})

describe('Utils.customFilter', () => {
  const rows = [
    { name: 'Élodie', company: { name: 'ACME' }, score: 3 },
    { name: 'Bob', company: { name: 'Évian' }, score: 5 },
    { name: 'Alice', company: null, score: 3 }
  ]

  it('filters case and accent insensitively on nested paths', () => {
    expect(Utils.customFilter(rows, { name: 'elo' }).map((r) => r.name)).toEqual(['Élodie'])
    expect(Utils.customFilter(rows, { 'company.name': 'EVIAN' }).map((r) => r.name)).toEqual(['Bob'])
    expect(Utils.customFilter(rows, { name: 'b', 'company.name': 'ev' }).map((r) => r.name)).toEqual(['Bob'])
  })

  it('keeps all the rows with empty terms and handles missing values', () => {
    expect(Utils.customFilter(rows, { name: '', 'company.name': '' })).toHaveLength(3)
    expect(Utils.customFilter(rows, { 'company.name': 'a' }).map((r) => r.name)).toEqual(['Élodie', 'Bob'])
  })

  it('compares non-string values strictly', () => {
    expect(Utils.customFilter(rows, { score: 3 }).map((r) => r.name)).toEqual(['Élodie', 'Alice'])
  })

  it('returns the falsy rows value as is', () => {
    expect(Utils.customFilter(undefined, { name: 'a' })).toBeUndefined()
    expect(Utils.customFilter(null, {})).toBeNull()
  })
})

describe('Utils.filterCustomFields', () => {
  const fields = [
    { _id: 'f1', label: 'Finding field', display: 'finding', displaySub: '', fieldType: 'input', text: [{ locale: 'fr', value: 'Défaut' }, { locale: 'en', value: 'Default' }] },
    { _id: 'f2', label: 'Web finding field', display: 'finding', displaySub: 'Web', fieldType: 'checkbox' },
    { _id: 'v1', label: 'Vuln field', display: 'vulnerability', displaySub: '', fieldType: 'select-multiple' },
    { _id: 'v2', label: 'Network vuln field', display: 'vulnerability', displaySub: 'Network', fieldType: 'text' },
    { _id: 'g1', label: 'General field', display: 'general', displaySub: '', fieldType: 'date' },
    { _id: 's1', label: 'Section field', display: 'section', displaySub: 'intro', fieldType: 'text' }
  ]
  const ids = (result) => result.map((entry) => entry.customField._id)

  it('selects the fields displayed in each page', () => {
    expect(ids(Utils.filterCustomFields('finding', '', fields))).toEqual(['f1', 'v1'])
    expect(ids(Utils.filterCustomFields('finding', 'Web', fields))).toEqual(['f1', 'f2', 'v1'])
    expect(ids(Utils.filterCustomFields('finding', 'Network', fields))).toEqual(['f1', 'v1', 'v2'])
    expect(ids(Utils.filterCustomFields('vulnerability', 'Network', fields))).toEqual(['v1', 'v2'])
    expect(ids(Utils.filterCustomFields('audit-general', '', fields))).toEqual(['g1'])
    expect(ids(Utils.filterCustomFields('section', 'intro', fields))).toEqual(['s1'])
    expect(ids(Utils.filterCustomFields('section', 'other', fields))).toEqual([])
    expect(ids(Utils.filterCustomFields('unknown-page', '', fields))).toEqual([])
    expect(Utils.filterCustomFields('finding', '')).toEqual([])
  })

  it('sets the default text of the locale, an empty array for multiple values', () => {
    const result = Utils.filterCustomFields('finding', 'Web', fields, [], 'fr')
    expect(result.map((entry) => entry.text)).toEqual(['Défaut', [], []])
    expect(Utils.filterCustomFields('finding', '', fields, [], 'de')[0].text).toBe('')
    expect(Utils.filterCustomFields('finding', '', fields, [])[0].text).toBe('')
  })

  it('takes the saved text of the object (custom field given as id or populated object)', () => {
    const objectFields = [{ customField: 'f1', text: 'Saved' }, { customField: { _id: 'v1' }, text: ['A', 'B'] }]
    const result = Utils.filterCustomFields('finding', '', fields, objectFields, 'en')
    expect(result.map((entry) => entry.text)).toEqual(['Saved', ['A', 'B']])
  })

  it('removes the default texts from the returned definitions', () => {
    const [entry] = Utils.filterCustomFields('finding', '', fields, [], 'en')
    expect(entry.customField).not.toHaveProperty('text')
    expect(entry.customField).toMatchObject({ _id: 'f1', label: 'Finding field', fieldType: 'input' })
    expect(fields[0].text).toHaveLength(2) // Definitions not modified
  })
})

describe('Utils.renderTemplate (plain text, displayed with text interpolation)', () => {
  it('replaces the variables case insensitively and keeps the unknown ones', () => {
    expect(Utils.renderTemplate('{ID} - {Title} {unknown}', { id: 'IDX-001', title: 'SQLi' })).toBe('IDX-001 - SQLi {unknown}')
  })

  it('evaluates the function variables only when they are used', () => {
    const score = vi.fn(() => '9.8')
    expect(Utils.renderTemplate('{title}', { title: 'A', score })).toBe('A')
    expect(score).not.toHaveBeenCalled()
    expect(Utils.renderTemplate('{title} ({score})', { title: 'A', score })).toBe('A (9.8)')
    expect(score).toHaveBeenCalledTimes(1)
  })

  it('renders null / undefined values as empty strings and numbers as text', () => {
    expect(Utils.renderTemplate('[{a}][{b}][{c}][{d}]', { a: null, b: undefined, c: 0, d: false })).toBe('[][][0][false]')
  })

  it('renders the custom fields by label (case insensitive, trimmed)', () => {
    const customFields = [
      { customField: { label: 'Asset Owner', fieldType: 'input' }, text: 'Team A' },
      { customField: { label: 'Tags', fieldType: 'select-multiple' }, text: ['web', 'auth'] },
      { customField: { label: 'Details', fieldType: 'text' }, text: '<p>Line <b>1</b></p><p>Line 2</p>' },
      null,
      { customField: { fieldType: 'input' }, text: 'no label' }
    ]
    expect(Utils.renderTemplate('{custom.asset owner} | {CUSTOM. Tags } | {custom.details} | {custom.missing}', {}, customFields))
      .toBe('Team A | web, auth | Line 1 Line 2 | ')
    expect(Utils.renderTemplate('{custom.x}', {}, null)).toBe('')
  })

  it('does not interpret HTML: the result is raw text', () => {
    const result = Utils.renderTemplate('{title}', { title: '<img src=x onerror=alert(1)>' })
    expect(result).toBe('<img src=x onerror=alert(1)>')
  })

  it('returns an empty string when the template is not a string', () => {
    expect(Utils.renderTemplate(undefined, {})).toBe('')
    expect(Utils.renderTemplate(null, {})).toBe('')
  })

  it('is displayed with text interpolation in the audit sidebar and the settings preview (never v-html)', () => {
    const auditPage = readSource('pages/audits/edit/index.vue')
    expect(auditPage).toMatch(/\{\{\s*getFindingLabel\(finding\)\s*\}\}/)
    expect(readSource('pages/settings/settings.html')).toMatch(/\{\{\s*findingTemplatePreview\s*\}\}/)
    for (const file of ['pages/audits/edit/index.vue', 'pages/settings/settings.html']) {
      const vHtml = [...readSource(file).matchAll(/v-html="([^"]*)"/g)].map((match) => match[1])
      expect(vHtml.filter((expression) => /getFindingLabel|findingTemplatePreview|renderTemplate/.test(expression))).toEqual([])
    }
  })
})

describe('Utils.findingTemplateVariables', () => {
  const finding = {
    title: 'SQL Injection', vulnType: 'Web', category: 'Injection', cvssv3: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    priority: 4, remediationComplexity: 3, scope: '<p>srv-01</p><p>srv-02</p>'
  }

  it('gives the report identifier from the position of the finding', () => {
    expect(Utils.findingTemplateVariables(finding, { index: 0 }).identifier()).toBe('IDX-001')
    expect(Utils.findingTemplateVariables(finding, { index: 41 }).identifier()).toBe('IDX-042')
    expect(Utils.findingTemplateVariables(finding, { index: -1 }).identifier()).toBe('')
  })

  it('translates the severity, priority and remediation complexity', () => {
    const variables = Utils.findingTemplateVariables(finding, { index: 0, cvss: () => ({ severity: 'Critical', score: '9.8' }) })
    expect(variables.severity()).toBe('Critical')
    expect(variables.cvssScore()).toBe('9.8')
    expect(variables.priority).toBe('Urgent')
    expect(variables.remediationComplexity).toBe('Complex')
    expect(variables.cvssVector).toBe(finding.cvssv3)
    expect(variables.affected()).toBe('srv-01 srv-02')
    expect(Utils.findingTemplateVariables({}, { cvss: () => ({ severity: 'None' }) }).severity()).toBe('')
  })

  it('renders the default sidebar template variables', () => {
    const cvss = vi.fn(() => ({ severity: 'High', score: '8.1' }))
    const variables = Utils.findingTemplateVariables(finding, { index: 2, cvss })
    expect(Utils.renderTemplate('{identifier} {title} [{severity} {cvssScore}] {affected}', variables)).toBe('IDX-003 SQL Injection [High 8.1] srv-01 srv-02')
    expect(Object.keys(variables)).toEqual(['title', 'identifier', 'vulnType', 'category', 'severity', 'cvssScore', 'cvssVector', 'priority', 'remediationComplexity', 'affected'])
  })
})

describe('Utils.htmlToText and customFieldToText', () => {
  it('separates the blocks and collapses the spaces', () => {
    expect(Utils.htmlToText('<p>First</p><p>Second</p><ul><li>a</li><li>b</li></ul><p>line<br>break</p><h1>T</h1><table><tr><td>c1</td><td>c2</td></tr></table>'))
      .toBe('First Second a b line break T c1 c2')
    expect(Utils.htmlToText('<p>a &amp; b &lt;c&gt;</p>')).toBe('a & b <c>')
  })

  it('returns an empty string for empty or non-string values', () => {
    expect(Utils.htmlToText('')).toBe('')
    expect(Utils.htmlToText(null)).toBe('')
    expect(Utils.htmlToText(['<p>a</p>'])).toBe('')
  })

  it('does not run the scripts nor load the images of the HTML (inert document)', () => {
    window.__htmlToText = false
    const created = vi.spyOn(document, 'createElement')
    expect(Utils.htmlToText('<img src="x" onerror="window.__htmlToText = true"><p>a</p>')).toBe('a')
    expect(window.__htmlToText).toBe(false)
    expect(created).not.toHaveBeenCalled()
  })

  it('converts the custom fields to text', () => {
    expect(Utils.customFieldToText({ customField: { fieldType: 'checkbox' }, text: ['a', 'b'] })).toBe('a, b')
    expect(Utils.customFieldToText({ customField: { fieldType: 'text' }, text: '<p>x</p><p>y</p>' })).toBe('x y')
    expect(Utils.customFieldToText({ customField: { fieldType: 'input' }, text: '<b>raw</b>' })).toBe('<b>raw</b>')
    expect(Utils.customFieldToText({ customField: { fieldType: 'date' }, text: '2024-01-31' })).toBe('2024-01-31')
  })
})

describe('Utils helpers', () => {
  it('normalizes strings (lower case, no accents)', () => {
    expect(Utils.normalizeString('ÉtÉ Àçcentué')).toBe('ete accentue')
  })

  it('defines unique audit view states', () => {
    const values = Object.values(Utils.AUDIT_VIEW_STATE)
    expect(new Set(values).size).toBe(values.length)
    expect(Utils.AUDIT_VIEW_STATE.EDIT).toBe(0)
    expect(Utils.AUDIT_VIEW_STATE.APPROVED_READONLY).toBe(10)
    expect(Object.keys(Utils.AUDIT_VIEW_STATE)).toEqual(['EDIT', 'EDIT_READONLY', 'REVIEW', 'REVIEW_EDITOR', 'REVIEW_APPROVED',
      'REVIEW_ADMIN', 'REVIEW_ADMIN_APPROVED', 'REVIEW_READONLY', 'APPROVED', 'APPROVED_APPROVED', 'APPROVED_READONLY'])
  })

  it.each([
    ['Passw0rdX', true],
    ['abcDEF12', true],
    ['short1A', false],
    ['alllowercase1', false],
    ['ALLUPPERCASE1', false],
    ['NoDigitsHere', false],
    ['', false]
  ])('strongPassword(%j) -> %s', (password, expected) => {
    expect(Utils.strongPassword(password)).toBe(expected)
  })

  it.each([
    ['https://example.com/a.PNG', true],
    ['http://example.com/a.jpg?x=1', true],
    ['https://example.com/download?id=1&type=image/png', true],
    ['https://cdn.example.com/api/images/12', true],
    ['https://example.com/uploads/a', true],
    ['https://example.com/page.html', false],
    ['ftp://example.com/a.png', false],
    ['/api/images/12', false],
    ['', false],
    [null, false],
    [42, false]
  ])('isImageUrl(%j) -> %s', (url, expected) => {
    expect(Utils.isImageUrl(url)).toBe(expected)
  })

  it.each([
    ['', ''],
    [null, ''],
    [ID, `api/images/download/${ID}`],
    ['https://example.com/a.png', 'https://example.com/a.png'],
    ['http://example.com/a.png', 'http://example.com/a.png'],
    [PNG, PNG]
  ])('normalizeImageUrl(%j) -> %j', (url, expected) => {
    expect(Utils.normalizeImageUrl(url)).toBe(expected)
  })

  it('syncs the basic editors of the refs, including the ones of child components', () => {
    const editor = { updateHTML: vi.fn() }
    const listEditor = { updateHTML: vi.fn() }
    const childEditor = { updateHTML: vi.fn() }
    const other = { updateHTML: vi.fn() }
    Utils.syncEditors({
      basiceditor_description: editor,
      basiceditor_list: [listEditor, listEditor],
      basiceditor_missing: null,
      customfields: { $refs: { basiceditor_custom: [childEditor] } },
      input: other
    })
    expect(editor.updateHTML).toHaveBeenCalledTimes(1)
    expect(listEditor.updateHTML).toHaveBeenCalledTimes(2)
    expect(childEditor.updateHTML).toHaveBeenCalledTimes(1)
    expect(other.updateHTML).not.toHaveBeenCalled()
  })
})

describe('Utils.resizeImg', () => {
  let OriginalImage
  afterEach(() => {
    if (OriginalImage) window.Image = OriginalImage
    OriginalImage = null
  })

  // jsdom has no image decoding nor canvas: they are simulated
  function mockImage(width, height, dataUrl) {
    OriginalImage = window.Image
    window.Image = class {
      set src(value) {
        this._src = value
        this.width = width
        this.height = height
        setTimeout(() => this.onload.call(this))
      }
    }
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toDataURL: vi.fn(() => dataUrl) }
    const create = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? canvas : create(tag)))
    return canvas
  }

  it('downscales large images to 1920px wide, keeping the ratio and the PNG format', async () => {
    const original = 'data:image/png;base64,' + 'A'.repeat(5000)
    const canvas = mockImage(3840, 2160, 'data:image/png;base64,small')
    await expect(Utils.resizeImg(original)).resolves.toBe('data:image/png;base64,small')
    expect(canvas.width).toBe(1920)
    expect(canvas.height).toBe(1080)
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png')
  })

  it('encodes the photos in JPEG and keeps the original when it is smaller', async () => {
    const original = 'data:image/jpeg;base64,small'
    const canvas = mockImage(800, 600, 'data:image/jpeg;base64,' + 'B'.repeat(5000))
    await expect(Utils.resizeImg(original)).resolves.toBe(original)
    expect(canvas.width).toBe(800)
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.9)
  })
})
