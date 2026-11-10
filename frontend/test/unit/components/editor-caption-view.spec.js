// components/editor-caption.js and editor-caption-view.vue: captions of figures, tables and code blocks
// (<legend label alt>), node view in real TipTap editors
import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import { contentExtensions } from 'components/editor-extensions'
import { mountEditor, nodeViews } from '../../helpers/misc'
import { i18n } from '@/boot/i18n'

let current
async function editorWith(content, editable = true) {
  current = await mountEditor({ extensions: contentExtensions(), content, editable })
  return current.editor
}

const captions = (editor) => [...editor.view.dom.querySelectorAll('.editor-caption')]
const placeholder = () => i18n.global.t('captionText')

afterEach(() => {
  current && current.destroy()
  current = null
})

describe('caption node view in an editable editor', () => {
  it('shows the label and an input with the caption text', async () => {
    const editor = await editorWith('<legend label="Table" alt="Ports ouverts"></legend>')
    const [caption] = captions(editor)
    expect(caption.querySelector('.editor-caption__label').textContent).toBe('Table - ')
    const input = caption.querySelector('input')
    expect(input.value).toBe('Ports ouverts')
    expect(input.placeholder).toBe(placeholder())
    expect(caption.getAttribute('contenteditable')).toBe('false')
  })

  it('sizes the input on the longest of the text and the placeholder', async () => {
    const long = 'Résultat du scan des ports ouverts du serveur'
    const editor = await editorWith(`<legend label="Figure" alt="${long}"></legend><legend label="Figure" alt="x"></legend>`)
    const [first, second] = captions(editor).map((caption) => caption.querySelector('input'))
    expect(first.size).toBe(long.length + 1)
    expect(second.size).toBe(placeholder().length + 1)
  })

  it('updates the caption text of the document when typing (unicode included)', async () => {
    const editor = await editorWith('<p>Texte</p><legend label="Figure" alt=""></legend>')
    const onUpdate = vi.fn()
    editor.on('update', onUpdate)
    const input = captions(editor)[0].querySelector('input')
    input.value = 'Capture « été » 漢字 🔒'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(editor.getHTML()).toBe('<p>Texte</p><legend label="Figure" alt="Capture « été » 漢字 🔒"></legend>')
    expect(onUpdate).toHaveBeenCalled() // Change saved by the editor component
  })

  it('escapes the quotes of the caption text in the HTML', async () => {
    const editor = await editorWith('<legend label="Figure" alt=""></legend>')
    const input = captions(editor)[0].querySelector('input')
    input.value = 'a "quoted" <b>text</b> & more'
    input.dispatchEvent(new Event('input'))
    expect(editor.getHTML()).toBe('<legend label="Figure" alt="a &quot;quoted&quot; &lt;b&gt;text&lt;/b&gt; &amp; more"></legend>')
    expect(captions(editor)[0].querySelector('b')).toBeNull()
  })

  it('shows the label as text', async () => {
    const editor = await editorWith('<legend label="<img src=x onerror=alert(1)>" alt=""></legend>')
    const [caption] = captions(editor)
    expect(caption.querySelector('img')).toBeNull()
    expect(caption.querySelector('.editor-caption__label').textContent).toBe('<img src=x onerror=alert(1)> - ')
  })

  it('inserts captions with the labels of the settings (caption command)', async () => {
    const editor = await editorWith('<p>Texte</p>')
    editor.commands.setTextSelection(editor.state.doc.content.size)
    editor.commands.caption({ label: 'Tableau', alt: '' })
    await flushPromises()
    expect(captions(editor).map((caption) => caption.querySelector('.editor-caption__label').textContent)).toEqual(['Tableau - '])
    expect(editor.getHTML()).toBe('<p>Texte</p><legend label="Tableau" alt=""></legend>')
  })

  it('uses the default label and text of the captions without attributes', async () => {
    const editor = await editorWith('<legend></legend>')
    expect(editor.getHTML()).toBe('<legend label="Figure" alt=""></legend>')
    expect(captions(editor)[0].querySelector('input').value).toBe('')
  })

  it('selects the caption (node selection)', async () => {
    const editor = await editorWith('<p>a</p><legend label="Figure" alt="x"></legend>')
    const text = () => captions(editor)[0].querySelector('.editor-caption__text')
    editor.commands.setTextSelection(1)
    await flushPromises()
    expect(text().classList.contains('editor-caption--selected')).toBe(false)
    editor.commands.setNodeSelection(3)
    await flushPromises()
    expect(text().classList.contains('editor-caption--selected')).toBe(true)
  })

  it('removes the node view when the caption is deleted', async () => {
    const editor = await editorWith('<p>a</p><legend label="Figure" alt="x"></legend>')
    expect(nodeViews(editor)).toHaveLength(1)
    editor.commands.setNodeSelection(3)
    editor.commands.deleteSelection()
    await flushPromises()
    expect(captions(editor)).toHaveLength(0)
    expect(editor.getHTML()).toBe('<p>a</p>')
  })
})

describe('caption node view in a read-only editor', () => {
  it('shows the caption text without input', async () => {
    const editor = await editorWith('<legend label="Figure" alt="Capture"></legend>', false)
    const [caption] = captions(editor)
    expect(caption.querySelector('input')).toBeNull()
    expect(caption.querySelector('.text-italic').textContent).toBe('Capture')
  })

  it('shows the placeholder in grey without caption text', async () => {
    const editor = await editorWith('<legend label="Figure" alt=""></legend>', false)
    const text = captions(editor)[0].querySelector('.text-grey-7')
    expect(text.textContent).toBe(placeholder())
  })

  it('shows the input once the editor is made editable (content loaded) and hides it when read-only again', async () => {
    const editor = await editorWith('<legend label="Figure" alt="Capture"></legend>', false)
    editor.setEditable(true)
    await flushPromises()
    expect(captions(editor)[0].querySelector('input').value).toBe('Capture')
    editor.setEditable(false)
    await flushPromises()
    expect(captions(editor)[0].querySelector('input')).toBeNull()
  })

  it('stops following the editor once destroyed', async () => {
    const editor = await editorWith('<legend label="Figure" alt="x"></legend>')
    const off = vi.spyOn(editor, 'off')
    editor.commands.setContent('<p>no caption</p>')
    await flushPromises()
    expect(off).toHaveBeenCalledWith('update', expect.any(Function))
  })
})
