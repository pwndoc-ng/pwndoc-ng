// components/languagetool.js: spell / grammar check of the editors by LanguageTool (requests, decorations, cache,
// auto correction toggle), in real TipTap editors with fetch mocked
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Schema } from '@tiptap/pm/model'

import { LanguageTool, changedDescendants } from 'components/languagetool'

const API = 'https://pwndoc.test/v2/check'
const editors = []
let fetchMock
let counter = 0

// Unique texts: the responses are cached by text for the whole module
const unique = (text) => `${text} ${++counter}`

function editorWith(content, options = {}) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, LanguageTool.configure({ apiUrl: API, automaticMode: false, ...options })],
    content
  })
  document.body.appendChild(editor.view.dom.parentNode)
  editors.push(editor)
  return editor
}

const match = (offset, length, message = 'Possible spelling mistake', issueType = 'misspelling') => ({
  offset, length, message, shortMessage: 'Spelling', replacements: [{ value: 'fix' }], rule: { id: 'MORFOLOGIK', issueType }
})
const answer = (matches) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ matches }) })
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
  fetchMock = vi.fn(() => answer([]))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  editors.splice(0).forEach((editor) => {
    editor.view.dom.parentNode && editor.view.dom.parentNode.remove()
    editor.destroy()
  })
})

describe('languagetool requests', () => {
  it('sends the text of the document to the LanguageTool API (form encoded, unicode included)', async () => {
    const text = unique('Le paramètre « q » est renvoyé sans encodage & 漢字')
    const editor = editorWith(`<p>${text.replace('&', '&amp;')}</p>`)
    await proofread(editor)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(API)
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(options.body).toBe(`text=${encodeURIComponent(text)}&language=auto&enabledOnly=false`)
    expect(new URLSearchParams(options.body).get('text')).toBe(text)
  })

  it('joins the paragraphs with spaces keeping the positions of the document', async () => {
    const first = unique('Premier')
    const editor = editorWith(`<p>${first}</p><p>Second</p>`)
    await proofread(editor)
    const text = new URLSearchParams(fetchMock.mock.calls[0][1].body).get('text')
    expect(text).toBe(`${first}  Second`) // Two positions between the paragraphs (end and start of paragraph)
  })

  it('does not send a request for an empty document', async () => {
    const editor = editorWith('<p></p>')
    await proofread(editor)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(storage(editor).loading.value).toBe(false)
  })

  it('sends the long documents in several chunks (500 words)', async () => {
    const paragraph = (word) => Array.from({ length: 300 }, () => word).join(' ')
    const editor = editorWith(`<p>${paragraph(unique('alpha').replace(' ', ''))}</p><p>${paragraph('beta')}</p><p>${paragraph('gamma')}</p>`)
    await proofread(editor)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const texts = fetchMock.mock.calls.map(([, options]) => new URLSearchParams(options.body).get('text'))
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
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows the loading state during the request', async () => {
    let resolve
    fetchMock.mockImplementation(() => new Promise((r) => { resolve = r }))
    const editor = editorWith(`<p>${unique('En cours')}</p>`)
    editor.commands.proofread()
    await flushPromises()
    expect(storage(editor).loading.value).toBe(true)
    resolve({ ok: true, json: () => Promise.resolve({ matches: [] }) })
    await flushPromises()
    expect(storage(editor).loading.value).toBe(false)
    expect(storage(editor).proofReadInitially).toBe(true)
  })

  it('ignores the network errors (no decoration)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const editor = editorWith(`<p>${unique('Hors ligne')}</p>`)
    await proofread(editor)
    expect(decorations(editor)).toEqual([])
    expect(storage(editor).loading.value).toBe(false)
    expect(console.error).toHaveBeenCalledWith('LanguageTool request failed:', expect.any(TypeError))
  })

  it('ignores the error answers of the server', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 413, json: () => Promise.resolve({ error: 'Text too long' }) })
    const text = unique('Texte refusé')
    const editor = editorWith(`<p>${text}</p>`)
    await proofread(editor)
    expect(storage(editor).loading.value).toBe(false)
    fetchMock.mockImplementation(() => answer([]))
    await proofread(editor)
    expect(fetchMock).toHaveBeenCalledTimes(2) // Error answer not cached
  })

  it('does not decorate an editor destroyed during the request', async () => {
    let resolve
    fetchMock.mockImplementation(() => new Promise((r) => { resolve = r }))
    const editor = editorWith(`<p>${unique('Détruit')}</p>`)
    const state = storage(editor)
    editor.commands.proofread()
    await flushPromises()
    editors.splice(editors.indexOf(editor), 1)
    editor.destroy()
    expect(state.editorView).toBeNull()
    resolve({ ok: true, json: () => Promise.resolve({ matches: [match(0, 3)] }) })
    await flushPromises()
    expect(state.loading.value).toBe(true) // Not updated anymore
    expect(state.decorationSet.find()).toEqual([])
  })
})

describe('languagetool decorations', () => {
  it('decorates the matches with their issue type and the details of the match', async () => {
    const text = unique('Ceci est un exmple')
    fetchMock.mockImplementation(() => answer([match(12, 6), match(0, 4, 'Style', 'style')]))
    const editor = editorWith(`<p>${text}</p>`)
    await proofread(editor)
    const spans = decorations(editor)
    expect(spans.map((span) => [span.textContent, span.className])).toEqual([['Ceci', 'lt lt-style'], ['exmple', 'lt lt-misspelling']])
    expect(JSON.parse(spans[1].getAttribute('data-match'))).toMatchObject({ offset: 12, length: 6, message: 'Possible spelling mistake' })
  })

  it('places the matches of the following paragraphs and chunks at their position', async () => {
    const paragraph = (word) => Array.from({ length: 300 }, () => word).join(' ')
    fetchMock.mockImplementation((url, { body }) => {
      const text = new URLSearchParams(body).get('text')
      return answer(text.startsWith('delta') ? [match(0, 5)] : [match(text.indexOf('zeta'), 4)])
    })
    const editor = editorWith(`<p>${paragraph(unique('epsilon').replace(' ', ''))}</p><p>zeta ${paragraph('eta')}</p><p>${paragraph('delta')}</p>`)
    await proofread(editor)
    expect(decorations(editor).map((span) => span.textContent)).toEqual(['zeta', 'delta'])
  })

  it('moves the decorations with the changes of the document', async () => {
    const text = unique('Un exmple')
    fetchMock.mockImplementation(() => answer([match(3, 6)]))
    const editor = editorWith(`<p>${text}</p>`)
    await proofread(editor)
    editor.commands.insertContentAt(1, 'Voici ')
    expect(decorations(editor).map((span) => span.textContent)).toEqual(['exmple'])
  })

  it('selects the match on click (message and replacements of the suggestion menu)', async () => {
    fetchMock.mockImplementation(() => answer([match(0, 6)]))
    const editor = editorWith(`<p>${unique('Exmple de texte')}</p>`)
    await proofread(editor)
    const [span] = decorations(editor)
    span.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(storage(editor).match.value).toMatchObject({ offset: 0, length: 6, replacements: [{ value: 'fix' }] })
    expect(window.getSelection().toString()).toBe('Exmple')
  })

  it('removes the listeners of the decorations when the editor is destroyed', async () => {
    fetchMock.mockImplementation(() => answer([match(0, 6)]))
    const editor = editorWith(`<p>${unique('Exmple détruit')}</p>`)
    await proofread(editor)
    const [span] = decorations(editor)
    const remove = vi.spyOn(span, 'removeEventListener')
    editors.splice(editors.indexOf(editor), 1)
    editor.destroy()
    expect(remove).toHaveBeenCalledWith('click', expect.any(Function))
  })

  it('selects the match in the editor of the clicked decoration only', async () => {
    fetchMock.mockImplementation(() => answer([match(0, 6)]))
    const first = editorWith(`<p>${unique('Exmple premier')}</p>`)
    await proofread(first)
    const second = editorWith(`<p>${unique('Exmple second')}</p>`)
    await proofread(second)
    decorations(first)[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(storage(first).match.value).toMatchObject({ offset: 0 })
    expect(storage(second).match.value).toBeNull()
  })

  it('disables the spell check of the browser in the editor', () => {
    const editor = editorWith('<p>x</p>')
    expect(editor.view.dom.getAttribute('spellcheck')).toBe('false')
  })
})

describe('auto correction toggle (profile)', () => {
  it('sends no request while the auto correction is disabled', async () => {
    sessionStorage.setItem('autoCorrectionEnabled', 'false')
    const editor = editorWith(`<p>${unique('Désactivé')}</p>`)
    await proofread(editor)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('removes the decorations when the auto correction is disabled and checks again when enabled', async () => {
    fetchMock.mockImplementation(() => answer([match(0, 6)]))
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
      expect(fetchMock).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(500)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('checks the changed paragraphs after a pause in the typing (debounce)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    try {
      const editor = editorWith(`<p>${unique('Saisie')}</p>`, { automaticMode: true, debounceDelay: 800 })
      await vi.advanceTimersByTimeAsync(500) // Initial check
      fetchMock.mockClear()
      editor.commands.insertContentAt(2, 'a')
      editor.commands.insertContentAt(3, 'b')
      await vi.advanceTimersByTimeAsync(700)
      expect(fetchMock).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('requires a document id to ignore a suggestion', () => {
    const editor = editorWith('<p>x</p>')
    expect(() => editor.commands.ignoreLanguageToolSuggestion()).toThrow('Please provide a unique Document ID')
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
