// Content of the editors (TipTap v3): HTML stored in the database and read by the report generator (html2ooxml),
// internal links, anchors of the review comments
import { describe, it, expect, vi } from 'vitest'
import { Editor, createDocument } from '@tiptap/core'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import { contentExtensions } from 'components/editor-extensions'
import { encodeOption, decodeOption } from 'components/internal-link'
import { docTextIndex, quoteFromRange, findQuote, imageAnchorKey, imageAnchorAt, findImage } from 'components/comment-highlight'

// HTML of the editors for a corpus of contents: reference output of TipTap v3, identical to TipTap v2 except the
// default colspan="1" rowspan="1" of the table cells, no longer written (ignored by the report generator)
import FIXTURE from '../../fixtures/editor-html.json'

const extensions = contentExtensions()
const roundTrip = (html) => {
  const editor = new Editor({ element: null, extensions, content: html })
  const result = editor.getHTML()
  editor.destroy()
  return result
}
const docOf = (html) => createDocument(html, new Editor({ element: null, extensions }).schema)

describe('HTML of the editors', () => {
  it.each(Object.entries(FIXTURE))('%j', (input, expected) => {
    expect(roundTrip(input)).toBe(expected)
  })

  it('is stable (HTML of the editor read again unchanged)', () => {
    Object.values(FIXTURE).forEach((html) => expect(roundTrip(html)).toBe(html))
  })

  it('keeps the attributes read by the report generator', () => {
    const html = roundTrip('<img src="6aef2c3a3b1d4e5f60718293" alt="Capture" data-width="medium">')
    expect(html).toBe('<img class="custom-image" src="6aef2c3a3b1d4e5f60718293" alt="Capture" data-width="medium">')
    expect(roundTrip('<pre><code class="language-sql">SELECT 1;</code></pre>')).toBe('<pre><code class="language-sql">SELECT 1;</code></pre>')
    expect(roundTrip('<table><tbody><tr><td colwidth="150"><p>x</p></td></tr></tbody></table>')).toContain('colwidth="150"')
  })

  it('does not keep unsafe links nor unknown widths', () => {
    expect(roundTrip('<p><a href="javascript:alert(1)">js</a></p>')).toBe('<p>js</p>')
    expect(roundTrip('<img src="6aef2c3a3b1d4e5f60718293" alt="x" data-width="huge">')).not.toContain('data-width')
  })

  it('does not add an empty paragraph after tables, images and code blocks', () => {
    expect(roundTrip('<p>a</p><pre><code>b</code></pre>')).toBe('<p>a</p><pre><code>b</code></pre>')
    expect(roundTrip('<img src="6aef2c3a3b1d4e5f60718293" alt="">')).toBe('<img class="custom-image" src="6aef2c3a3b1d4e5f60718293" alt="">')
  })

  it('collaborative editors: same content, undo / redo of the collaboration', () => {
    const names = (options) => contentExtensions(options).flatMap((extension) => extension.name)
    expect(names({ collab: true })).toEqual(names({ collab: false }))
    const starterKit = contentExtensions({ collab: true })[0]
    expect(starterKit.options.undoRedo).toBe(false)
    expect(contentExtensions()[0].options.undoRedo).toBeUndefined()
  })
})

describe('Internal links (titles of the findings in the menu options)', () => {
  const titles = ['Injection SQL', 'Élévation de privilèges', 'L’injection de commande', 'Œuvre', '100% des comptes',
    'XSS <script>"x"</script> & \'y\'', '漢字', 'emoji 🔒', '']

  it.each(titles)('%j encoded and decoded without loss', (title) => {
    expect(decodeOption(encodeOption(title))).toBe(title)
  })

  it('encoded value usable in an HTML attribute and a CSS selector', () => {
    titles.forEach((title) => expect(encodeOption(title)).toMatch(/^[A-Za-z0-9+/=]*$/))
  })
})

describe('Anchors of the review comments', () => {
  const doc = docOf('<p>Le paramètre q est renvoyé sans encodage.</p><p>Le paramètre q est filtré.</p><img src="6aef2c3a3b1d4e5f60718293" alt="Capture"><img src="6aef2c3a3b1d4e5f60718293" alt="Capture">')

  it('text index of the document (blocks separated by a new line)', () => {
    const index = docTextIndex(doc)
    // Images are blocks: new line after the last paragraph
    expect(index.text).toBe('Le paramètre q est renvoyé sans encodage.\nLe paramètre q est filtré.\n')
    expect(index.positions.length).toBe(index.text.length)
  })

  it('quote of a selection and its position in the document', () => {
    const index = docTextIndex(doc)
    const start = index.positions[index.text.indexOf('filtré')]
    const quote = quoteFromRange(doc, start, start + 'filtré'.length)
    expect(quote.exact).toBe('filtré')
    expect(quote.prefix.endsWith('paramètre q est ')).toBe(true)
    expect(findQuote(index, quote)).toEqual({ from: start, to: start + 'filtré'.length })
  })

  it('repeated text: occurrence with the closest context', () => {
    const index = docTextIndex(doc)
    const second = index.text.indexOf('paramètre', 10)
    const from = index.positions[second]
    const quote = quoteFromRange(doc, from, from + 'paramètre'.length)
    expect(findQuote(index, quote).from).toBe(from)
  })

  it('quote no longer present or empty', () => {
    const index = docTextIndex(doc)
    expect(findQuote(index, { exact: 'absent du texte' })).toBeNull()
    expect(findQuote(index, null)).toBeNull()
    expect(quoteFromRange(doc, 0, 1)).toBeNull()
  })

  it('images: anchor by source, caption and occurrence', () => {
    const positions = []
    doc.descendants((node, pos) => { if (node.type.name === 'custom_image') positions.push(pos) })
    const second = imageAnchorAt(doc, positions[1])
    expect(second).toEqual({ src: '6aef2c3a3b1d4e5f60718293', alt: 'Capture', occurrence: 1 })
    expect(findImage(doc, second).from).toBe(positions[1])
    expect(findImage(doc, { src: 'absent' })).toBeNull()
  })

  it('long image sources (base64) anchored by a hash', () => {
    const data = 'data:image/png;base64,' + 'A'.repeat(500)
    expect(imageAnchorKey(data)).toMatch(/^hash:522:[0-9a-f]+$/)
    expect(imageAnchorKey(data)).toBe(imageAnchorKey(data))
    expect(imageAnchorKey('6aef2c3a3b1d4e5f60718293')).toBe('6aef2c3a3b1d4e5f60718293')
    expect(imageAnchorKey(null)).toBe('')
  })
})
