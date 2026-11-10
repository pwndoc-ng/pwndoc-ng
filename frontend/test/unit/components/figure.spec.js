// components/figure.js: figures (<figure><img><figcaption>) of the contents imported or written before the custom
// images, commands and input rule (real TipTap editors)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import { contentExtensions } from 'components/editor-extensions'
import { inputRegex } from 'components/figure'

const ID = '6aef2c3a3b1d4e5f60718293'
const editors = []

function editorWith(content, options = {}) {
  const editor = new Editor({ element: null, extensions: contentExtensions(), content, ...options })
  editors.push(editor)
  return editor
}

const figures = (editor) => {
  const result = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'figure') result.push({ ...node.attrs, caption: node.textContent })
  })
  return result
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
})

describe('figure parsing and rendering', () => {
  it('reads the image attributes and the caption of the figure', () => {
    const editor = editorWith(`<figure><img src="${ID}" alt="Schéma" title="Réseau"><figcaption>Légende « été » 🔒</figcaption></figure>`)
    expect(figures(editor)).toEqual([{ src: ID, alt: 'Schéma', title: 'Réseau', caption: 'Légende « été » 🔒' }])
    expect(editor.getHTML()).toBe(`<figure><img src="${ID}" alt="Schéma" title="Réseau" draggable="false" contenteditable="false"><figcaption>Légende « été » 🔒</figcaption></figure>`)
  })

  it('keeps the inline formatting of the caption', () => {
    const editor = editorWith(`<figure><img src="${ID}"><figcaption>Vue <strong>serveur</strong></figcaption></figure>`)
    expect(editor.getHTML()).toContain('<figcaption>Vue <strong>serveur</strong></figcaption>')
  })

  it('accepts a figure with a caption but without image', () => {
    const editor = editorWith('<figure><figcaption>Sans image</figcaption></figure>')
    expect(figures(editor)).toEqual([{ src: null, alt: null, title: null, caption: 'Sans image' }])
    expect(editor.getHTML()).toBe('<figure><img draggable="false" contenteditable="false"><figcaption>Sans image</figcaption></figure>')
  })

  it.each([
    `<figure><img src="${ID}" alt="Schéma"></figure>`,
    '<figure></figure>'
  ])('accepts a figure without caption %s', (html) => {
    expect(() => editorWith(html)).not.toThrow()
  })

  it('escapes the attributes of the image', () => {
    const editor = editorWith(`<figure><img src="${ID}" alt='"><script>alert(1)</script>'><figcaption>x</figcaption></figure>`)
    expect(editor.getHTML()).toContain('alt="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"')
  })
})

describe('figure commands', () => {
  it('inserts a figure with a caption and puts the cursor at the end of the caption', () => {
    const editor = editorWith('<p>Texte</p>')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    expect(editor.commands.setFigure({ src: ID, alt: 'Capture', caption: 'Écran de connexion' })).toBe(true)
    expect(figures(editor)).toEqual([{ src: ID, alt: 'Capture', title: null, caption: 'Écran de connexion' }])
    const { $from } = editor.state.selection
    expect($from.parent.type.name).toBe('figure')
    expect($from.parentOffset).toBe('Écran de connexion'.length)
  })

  it('inserts a figure without caption', () => {
    const editor = editorWith('<p>Texte</p>')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.setFigure({ src: ID })
    expect(figures(editor)).toEqual([{ src: ID, alt: null, title: null, caption: '' }])
  })

  it('does not convert anything without image or figure in the selection', () => {
    const editor = editorWith('<p>Texte</p>')
    editor.commands.selectAll()
    expect(editor.commands.imageToFigure()).toBe(false)
    expect(editor.commands.figureToImage()).toBe(false)
  })

  it('converts the selected image to a figure', () => {
    const editor = editorWith(`<p>a</p><img src="${ID}" alt="Capture">`)
    editor.commands.selectAll()
    expect(editor.commands.imageToFigure()).toBe(true)
    expect(figures(editor).map((figure) => figure.src)).toEqual([ID])
  })

  it('converts the selected figure to an image', () => {
    const editor = editorWith(`<p>a</p><figure><img src="${ID}"><figcaption>x</figcaption></figure>`)
    editor.commands.selectAll()
    expect(editor.commands.figureToImage()).toBe(true)
    expect(figures(editor)).toEqual([])
    expect(editor.getHTML()).toContain(`<img class="custom-image" src="${ID}"`)
  })
})

describe('figure input rule (markdown image)', () => {
  it('recognizes the markdown image syntax, with an optional title', () => {
    expect(inputRegex.exec('![Capture](https://example.com/a.png)').slice(1, 4)).toEqual(['Capture', 'https://example.com/a.png', undefined])
    expect(inputRegex.exec('![Capture](https://example.com/a.png "Titre")').slice(1, 4)).toEqual(['Capture', 'https://example.com/a.png', 'Titre'])
    expect(inputRegex.test('![Capture]()')).toBe(false)
    expect(inputRegex.test('[lien](https://example.com)')).toBe(false)
  })

  // Input rules are disabled in the editor component (disableInputRules), enabled here
  it('creates a figure with the source and the alternative text of the markdown image', () => {
    const editor = editorWith('<p></p>', { enableInputRules: true, element: document.createElement('div') }) // View of the input rules
    editor.commands.insertContent('![Capture](https://example.com/a.png')
    const { from } = editor.state.selection
    editor.view.someProp('handleTextInput', (handler) => handler(editor.view, from, from, ')', () => editor.state.tr.insertText(')', from, from)))
    expect(figures(editor)).toEqual([{ src: 'https://example.com/a.png', alt: 'Capture', title: null, caption: '' }])
  })
})
