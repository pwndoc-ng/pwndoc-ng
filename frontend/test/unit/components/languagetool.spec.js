// components/languagetool.js: spell / grammar check of the editors by LanguageTool (requests, decorations, cache,
// auto correction toggle, code not checked), in real TipTap editors with the check through the backend mocked
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Schema } from '@tiptap/pm/model'

import { LanguageTool, changedDescendants, selectionMatch, checkedText } from 'components/languagetool'

const editors = []
let checkMock // Check of a text by LanguageTool through the backend (SpellcheckService.check): text → {matches}
let counter = 0

// Unique texts: the responses are cached by text for the whole module
const unique = (text) => `${text} ${++counter}`

function editorWith(content, options = {}) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, LanguageTool.configure({ check: (text) => checkMock(text), automaticMode: false, ...options })],
    content
  })
  document.body.appendChild(editor.view.dom.parentNode)
  editors.push(editor)
  return editor
}

const match = (offset, length, message = 'Possible spelling mistake', issueType = 'misspelling') => ({
  offset, length, message, shortMessage: 'Spelling', replacements: [{ value: 'fix' }], rule: { id: 'MORFOLOGIK', issueType }
})
const answer = (matches) => Promise.resolve({ matches })
const storage = (editor) => editor.storage.languagetool
const decorations = (editor) => [...editor.view.dom.querySelectorAll('span.lt')]

// Checks of the whole document (asynchronous: request, then decorations)
async function proofread(editor) {
  editor.commands.proofread()
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 10)) // Listeners of the decorations added after the rendering
}

beforeEach(() => {
  sessionStorage.clear()
  checkMock = vi.fn(() => answer([]))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  editors.splice(0).forEach((editor) => {
    editor.view.dom.parentNode && editor.view.dom.parentNode.remove()
    editor.destroy()
  })
})

describe('languagetool requests', () => {
  it('sends the text of the document to the check function (unicode included)', async () => {
    const text = unique('Le paramètre « q » est renvoyé sans encodage & 漢字')
    const editor = editorWith(`<p>${text.replace('&', '&amp;')}</p>`)
    await proofread(editor)
    expect(checkMock).toHaveBeenCalledTimes(1)
    expect(checkMock).toHaveBeenCalledWith(text)
  })

  it('joins the paragraphs with spaces keeping the positions of the document', async () => {
    const first = unique('Premier')
    const editor = editorWith(`<p>${first}</p><p>Second</p>`)
    await proofread(editor)
    const text = checkMock.mock.calls[0][0]
    expect(text).toBe(`${first}  Second`) // Two positions between the paragraphs (end and start of paragraph)
  })

  it('does not send a request for an empty document', async () => {
    const editor = editorWith('<p></p>')
    await proofread(editor)
    expect(checkMock).not.toHaveBeenCalled()
    expect(storage(editor).loading.value).toBe(false)
  })

  it('sends the long documents in several chunks (500 words)', async () => {
    const paragraph = (word) => Array.from({ length: 300 }, () => word).join(' ')
    const editor = editorWith(`<p>${paragraph(unique('alpha').replace(' ', ''))}</p><p>${paragraph('beta')}</p><p>${paragraph('gamma')}</p>`)
    await proofread(editor)
    expect(checkMock).toHaveBeenCalledTimes(2)
    const texts = checkMock.mock.calls.map(([text]) => text)
    expect(texts[0]).toContain('beta')
    expect(texts[1].startsWith('gamma')).toBe(true)
  })

  it('caches the answers of the texts already checked', async () => {
    const text = unique('Texte vérifié une seule fois')
    const editor = editorWith(`<p>${text}</p>`)
    await proofread(editor)
    await proofread(editor)
    const other = editorWith(`<p>${text}</p>`)
    await proofread(other)
    expect(checkMock).toHaveBeenCalledTimes(1)
  })

  it('shows the loading state during the request', async () => {
    let resolve
    checkMock.mockImplementation(() => new Promise((r) => { resolve = r }))
    const editor = editorWith(`<p>${unique('En cours')}</p>`)
    editor.commands.proofread()
    await flushPromises()
    expect(storage(editor).loading.value).toBe(true)
    resolve({ matches: [] })
    await flushPromises()
    expect(storage(editor).loading.value).toBe(false)
    expect(storage(editor).proofReadInitially).toBe(true)
  })

  it('ignores the network errors (no decoration)', async () => {
    checkMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const editor = editorWith(`<p>${unique('Hors ligne')}</p>`)
    await proofread(editor)
    expect(decorations(editor)).toEqual([])
    expect(storage(editor).loading.value).toBe(false)
    expect(console.error).toHaveBeenCalledWith('LanguageTool request failed:', expect.any(TypeError))
  })

  it('ignores the error answers of the server', async () => {
    checkMock.mockRejectedValueOnce({ response: { status: 413, data: { datas: 'Text too long' } } })
    const text = unique('Texte refusé')
    const editor = editorWith(`<p>${text}</p>`)
    await proofread(editor)
    expect(storage(editor).loading.value).toBe(false)
    checkMock.mockImplementation(() => answer([]))
    await proofread(editor)
    expect(checkMock).toHaveBeenCalledTimes(2) // Error answer not cached
  })

  it('does not decorate an editor destroyed during the request', async () => {
    let resolve
    checkMock.mockImplementation(() => new Promise((r) => { resolve = r }))
    const editor = editorWith(`<p>${unique('Détruit')}</p>`)
    const state = storage(editor)
    editor.commands.proofread()
    await flushPromises()
    editors.splice(editors.indexOf(editor), 1)
    editor.destroy()
    expect(state.editorView).toBeNull()
    resolve({ matches: [match(0, 3)] })
    await flushPromises()
    expect(state.loading.value).toBe(true) // Not updated anymore
    expect(state.decorationSet.find()).toEqual([])
  })
})

describe('code not checked', () => {
  it('replaces the code blocks and the inline code by spaces, keeping the positions of the words', async () => {
    const first = unique('Texte')
    const editor = editorWith(`<p>${first} <code>exmple()</code> fin</p><pre><code>SELEKT * FROM t</code></pre><p>Après</p>`)
    await proofread(editor)
    expect(checkMock).toHaveBeenCalledWith(`${first} ${' '.repeat(8)} fin  ${' '.repeat(15)}  Après`)
  })

  it('places the matches of the text after the code at their position', async () => {
    const first = unique('Code')
    const offset = `${first} `.length + 'x()'.length + 1
    checkMock.mockImplementation(() => answer([match(offset, 6)]))
    const editor = editorWith(`<p>${first} <code>x()</code> Exmple</p>`)
    await proofread(editor)
    expect(decorations(editor).map((span) => span.textContent)).toEqual(['Exmple'])
  })

  it('does not show the matches touching the code (repeated whitespace of the spaces replacing it), shows the others', async () => {
    const first = unique('Appel')
    const editor = editorWith(`<p>${first} <code>fonction()</code> Exmple</p><pre><code>SELEKT * FROM t</code></pre><p>Fin</p>`)
    checkMock.mockImplementation((text) => {
      // LanguageTool: runs of spaces reported (WHITESPACE_RULE), and the misspelled word
      const whitespace = [...text.matchAll(/ {2,}/g)].map((m) => ({ ...match(m.index, m[0].length, 'Repeated whitespace', 'whitespace'), rule: { id: 'WHITESPACE_RULE', issueType: 'whitespace' } }))
      return answer([...whitespace, match(text.indexOf('Exmple'), 6)])
    })
    await proofread(editor)
    expect(decorations(editor).map((span) => span.textContent)).toEqual(['Exmple'])
    expect(editor.view.dom.querySelector('code span.lt, pre span.lt')).toBeNull()
  })

  it('sends nothing for a document of code only', async () => {
    const editor = editorWith(`<pre><code>${unique('only_code')}</code></pre>`)
    await proofread(editor)
    expect(checkMock).not.toHaveBeenCalled()
    expect(storage(editor).loading.value).toBe(false)
  })

  it('checks the document after the proofread command, ending with a code block (no mismatched transaction)', async () => {
    const editor = editorWith(`<p>${unique('Avant')}</p><pre><code>x</code></pre>`)
    expect(() => editor.commands.proofread()).not.toThrow()
    await flushPromises()
    expect(checkMock).toHaveBeenCalledTimes(1)
  })

  it('checks a changed paragraph without its code, and nothing for a changed code block', async () => {
    const editor = editorWith(`<p>${unique('Changé')} <code>x</code> fin</p><pre><code>${unique('code')}</code></pre>`)
    const [paragraph, codeBlock] = [editor.state.doc.child(0), editor.state.doc.child(1)]
    await storage(editor).proofreadNodeAndUpdateItsDecorations(paragraph, 0)
    expect(checkMock.mock.calls[0][0]).toBe(checkedText(paragraph))
    expect(checkMock.mock.calls[0][0]).toMatch(/ {3}fin$/)
    await storage(editor).proofreadNodeAndUpdateItsDecorations(codeBlock.firstChild, paragraph.nodeSize + 1) // Text of the code block
    await storage(editor).proofreadNodeAndUpdateItsDecorations(codeBlock, paragraph.nodeSize)
    expect(checkMock).toHaveBeenCalledTimes(1)
  })
})

describe('languagetool decorations', () => {
  it('decorates the matches with their issue type and the details of the match', async () => {
    const text = unique('Ceci est un exmple')
    checkMock.mockImplementation(() => answer([match(12, 6), match(0, 4, 'Style', 'style')]))
    const editor = editorWith(`<p>${text}</p>`)
    await proofread(editor)
    const spans = decorations(editor)
    expect(spans.map((span) => [span.textContent, span.className])).toEqual([['Ceci', 'lt lt-style'], ['exmple', 'lt lt-misspelling']])
    expect(JSON.parse(spans[1].getAttribute('data-match'))).toMatchObject({ offset: 12, length: 6, message: 'Possible spelling mistake' })
  })

  it('places the matches of the following paragraphs and chunks at their position', async () => {
    const paragraph = (word) => Array.from({ length: 300 }, () => word).join(' ')
    checkMock.mockImplementation((text) => {
      return answer(text.startsWith('delta') ? [match(0, 5)] : [match(text.indexOf('zeta'), 4)])
    })
    const editor = editorWith(`<p>${paragraph(unique('epsilon').replace(' ', ''))}</p><p>zeta ${paragraph('eta')}</p><p>${paragraph('delta')}</p>`)
    await proofread(editor)
    expect(decorations(editor).map((span) => span.textContent)).toEqual(['zeta', 'delta'])
  })

  it('moves the decorations with the changes of the document', async () => {
    const text = unique('Un exmple')
    checkMock.mockImplementation(() => answer([match(3, 6)]))
    const editor = editorWith(`<p>${text}</p>`)
    await proofread(editor)
    editor.commands.insertContentAt(1, 'Voici ')
    expect(decorations(editor).map((span) => span.textContent)).toEqual(['exmple'])
  })

  it('selects the match on click (message and replacements of the suggestion menu)', async () => {
    checkMock.mockImplementation(() => answer([match(0, 6)]))
    const editor = editorWith(`<p>${unique('Exmple de texte')}</p>`)
    await proofread(editor)
    const [span] = decorations(editor)
    span.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(storage(editor).match.value).toMatchObject({ offset: 0, length: 6, replacements: [{ value: 'fix' }] })
    expect(window.getSelection().toString()).toBe('Exmple')
  })

  it('removes the listeners of the decorations when the editor is destroyed', async () => {
    checkMock.mockImplementation(() => answer([match(0, 6)]))
    const editor = editorWith(`<p>${unique('Exmple détruit')}</p>`)
    await proofread(editor)
    const [span] = decorations(editor)
    const remove = vi.spyOn(span, 'removeEventListener')
    editors.splice(editors.indexOf(editor), 1)
    editor.destroy()
    expect(remove).toHaveBeenCalledWith('click', expect.any(Function))
  })

  it('selects the match in the editor of the clicked decoration only', async () => {
    checkMock.mockImplementation(() => answer([match(0, 6)]))
    const first = editorWith(`<p>${unique('Exmple premier')}</p>`)
    await proofread(first)
    const second = editorWith(`<p>${unique('Exmple second')}</p>`)
    await proofread(second)
    decorations(first)[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(storage(first).match.value).toMatchObject({ offset: 0 })
    expect(storage(second).match.value).toBeNull()
  })

  it('gives the match of the selection only for a selection inside a mistake (suggestion menu)', async () => {
    checkMock.mockImplementation(() => answer([match(0, 6)]))
    const editor = editorWith(`<p>${unique('Exmple de texte')}</p>`)
    await proofread(editor)
    editor.commands.setTextSelection({ from: 1, to: 7 }) // The mistake
    expect(storage(editor).match.value).toMatchObject({ offset: 0, length: 6 })
    editor.commands.setTextSelection({ from: 2, to: 4 }) // Part of the mistake
    expect(storage(editor).match.value).toMatchObject({ offset: 0 })
    editor.commands.setTextSelection({ from: 8, to: 13 }) // Text without mistake
    expect(storage(editor).match.value).toBeNull()
    editor.commands.setTextSelection({ from: 1, to: 10 }) // Larger than the mistake
    expect(storage(editor).match.value).toBeNull()
    editor.commands.setTextSelection(3) // Cursor in the mistake, nothing selected
    expect(storage(editor).match.value).toBeNull()
    expect(selectionMatch(null, editor.state.selection)).toBeNull()
  })

  it('keeps the match when the mouse leaves the mistake (suggestion menu reached with the mouse)', async () => {
    checkMock.mockImplementation(() => answer([match(0, 6)]))
    const editor = editorWith(`<p>${unique('Exmple quitté')}</p>`)
    await proofread(editor)
    const [span] = decorations(editor)
    span.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    span.dispatchEvent(new MouseEvent('mouseleave'))
    expect(storage(editor).match.value).toMatchObject({ offset: 0 })
  })

  it('disables the spell check of the browser in the editor', () => {
    const editor = editorWith('<p>x</p>')
    expect(editor.view.dom.getAttribute('spellcheck')).toBe('false')
  })
})

describe('ignored words (approved by the administrators)', () => {
  it('does not report the ignored words, whatever their case', async () => {
    checkMock.mockImplementation(() => answer([match(0, 4), match(5, 6)]))
    const editor = editorWith(`<p>${unique('Nmap Exmple')}</p>`, { ignoredWords: () => ['nmap'] })
    await proofread(editor)
    expect(decorations(editor).map((span) => span.textContent)).toEqual(['Exmple'])
  })

  it('reads the ignored words given as a promise', async () => {
    checkMock.mockImplementation(() => answer([match(0, 4)]))
    const editor = editorWith(`<p>${unique('Burp suite')}</p>`, { ignoredWords: () => Promise.resolve(['burp']) })
    await proofread(editor)
    expect(decorations(editor)).toHaveLength(0)
  })

  it('reports all the mistakes when the ignored words cannot be loaded', async () => {
    checkMock.mockImplementation(() => answer([match(0, 4)]))
    const editor = editorWith(`<p>${unique('Burp erreur')}</p>`, { ignoredWords: () => Promise.reject(new Error('403')) })
    await proofread(editor)
    expect(decorations(editor).map((span) => span.textContent)).toEqual(['Burp'])
  })

  it('does not report the ignored words in the changed paragraphs', async () => {
    const editor = editorWith(`<p>${unique('Nmap Exmple')}</p>`, { ignoredWords: () => ['nmap'] })
    checkMock.mockImplementation(() => answer([match(0, 4), match(5, 6)]))
    await storage(editor).proofreadNodeAndUpdateItsDecorations(editor.state.doc.firstChild.firstChild, 1) // Text node at 1
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(decorations(editor).map((span) => span.textContent)).toEqual(['Exmple'])
  })
})

describe('auto correction toggle (profile)', () => {
  it('sends no request while the auto correction is disabled', async () => {
    sessionStorage.setItem('autoCorrectionEnabled', 'false')
    const editor = editorWith(`<p>${unique('Désactivé')}</p>`)
    await proofread(editor)
    expect(checkMock).not.toHaveBeenCalled()
  })

  it('removes the decorations when the auto correction is disabled and checks again when enabled', async () => {
    checkMock.mockImplementation(() => answer([match(0, 6)]))
    const editor = editorWith(`<p>${unique('Exmple bascule')}</p>`)
    await proofread(editor)
    expect(decorations(editor)).toHaveLength(1)
    sessionStorage.setItem('autoCorrectionEnabled', 'false')
    storage(editor).updateLanguageToolState()
    await flushPromises()
    expect(decorations(editor)).toHaveLength(0)
    sessionStorage.setItem('autoCorrectionEnabled', 'true')
    storage(editor).updateLanguageToolState()
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(decorations(editor)).toHaveLength(1)
  })
})

describe('languagetool automatic mode and commands', () => {
  it('checks the document after its loading in automatic mode', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const editor = editorWith(`<p>${unique('Automatique')}</p>`, { automaticMode: true })
      expect(checkMock).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(500)
      expect(checkMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('checks the changed paragraphs after a pause in the typing (debounce)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    try {
      const editor = editorWith(`<p>${unique('Saisie')}</p>`, { automaticMode: true, debounceDelay: 800 })
      await vi.advanceTimersByTimeAsync(500) // Initial check
      checkMock.mockClear()
      editor.commands.insertContentAt(2, 'a')
      editor.commands.insertContentAt(3, 'b')
      await vi.advanceTimersByTimeAsync(700)
      expect(checkMock).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(200)
      expect(checkMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not toggle the proofreading (not implemented)', () => {
    const editor = editorWith('<p>x</p>')
    expect(editor.commands.toggleProofreading()).toBe(false)
  })

  it('gives a separate state to each editor', () => {
    const first = editorWith('<p>a</p>')
    const second = editorWith('<p>b</p>')
    expect(storage(first)).not.toBe(storage(second))
    expect(storage(first).editorId).not.toBe(storage(second).editorId)
  })
})

describe('changedDescendants', () => {
  const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } })
  const doc = (...texts) => schema.node('doc', null, texts.map((text) => schema.node('paragraph', null, text ? [schema.text(text)] : [])))

  it('calls the function for the changed nodes only, with their position', () => {
    const before = doc('un', 'deux', 'trois')
    const after = before.copy(before.content.replaceChild(1, schema.node('paragraph', null, [schema.text('DEUX')])))
    const visited = []
    changedDescendants(before, after, 0, (node, pos) => visited.push([node.type.name, node.textContent, pos]))
    expect(visited).toEqual([['paragraph', 'DEUX', 4], ['text', 'DEUX', 5]])
  })

  it('visits all the descendants of an added node', () => {
    const before = doc('un')
    const after = before.copy(before.content.addToEnd(schema.node('paragraph', null, [schema.text('nouveau')])))
    const visited = []
    changedDescendants(before, after, 0, (node, pos) => visited.push([node.type.name, pos]))
    expect(visited).toEqual([['paragraph', 4], ['text', 5]])
  })

  it('calls nothing for an identical document', () => {
    const before = doc('un', 'deux')
    const visited = []
    changedDescendants(before, before, 0, (node) => visited.push(node))
    expect(visited).toEqual([])
  })
})
