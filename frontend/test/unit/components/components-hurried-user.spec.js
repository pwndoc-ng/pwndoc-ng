// Hurried user in the editors (LanguageTool, internal links menu, pasted images, captions): answers delayed and given by
// the test, typing during the requests, editors destroyed (navigation) while a request or a timer is pending
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import { contentExtensions } from 'components/editor-extensions'
import { LanguageTool } from 'components/languagetool'
import { TriggerMenuExtension } from 'components/internal-link'
import ImageService from '@/services/image'
import Utils from '@/services/utils'
import { mountEditor, deferredCalls, catchWindowErrors } from '../../helpers/misc'
import { trackFileReads } from '../../helpers/editor-component'

const editors = []
let fetchMock
let counter = 0
const unique = (text) => `${text} ${++counter}` // LanguageTool answers are cached by text for the whole module

function track(editor) {
  editors.push(editor)
  return editor
}

function destroy(editor) {
  editors.splice(editors.indexOf(editor), 1)
  editor.destroy()
}

beforeEach(() => {
  sessionStorage.clear()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  editors.splice(0).forEach((editor) => {
    if (editor.isDestroyed) return
    editor.view.dom.parentNode && editor.view.dom.parentNode.remove()
    editor.destroy()
  })
  document.querySelectorAll('.tiptap-trigger-menu').forEach((element) => element.remove())
  window.history.replaceState({}, '', '/')
})

describe('LanguageTool with a hurried user', () => {
  const match = (offset, length) => ({ offset, length, message: 'Faute', replacements: [], rule: { issueType: 'misspelling' } })
  const answer = (matches) => ({ ok: true, json: () => Promise.resolve({ matches }) })

  function editorWith(content, options = {}) {
    const element = document.createElement('div')
    document.body.appendChild(element)
    return track(new Editor({ element, extensions: [StarterKit, LanguageTool.configure({ apiUrl: 'https://lt.test/v2/check', automaticMode: false, ...options })], content }))
  }

  const decorations = (editor) => [...editor.view.dom.querySelectorAll('span.lt')].map((span) => span.textContent)

  it('sends no request when the editor is destroyed before the automatic check', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    fetchMock.mockResolvedValue(answer([]))
    const editor = editorWith(`<p>${unique('Détruit avant')}</p>`, { automaticMode: true })
    destroy(editor)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends no request when the editor is destroyed during the debounce of the typing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    fetchMock.mockResolvedValue(answer([]))
    const editor = editorWith(`<p>${unique('Saisie')}</p>`, { automaticMode: true })
    await vi.advanceTimersByTimeAsync(500)
    await flushPromises()
    fetchMock.mockClear()
    editor.commands.insertContentAt(2, 'x')
    destroy(editor)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checks once after fast typing (debounce)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    fetchMock.mockResolvedValue(answer([]))
    const editor = editorWith(`<p>${unique('Rapide')}</p>`, { automaticMode: true })
    await vi.advanceTimersByTimeAsync(500)
    await flushPromises()
    fetchMock.mockClear()
    for (let i = 0; i < 10; i++) {
      editor.commands.insertContentAt(2, String(i))
      await vi.advanceTimersByTimeAsync(100)
    }
    await vi.advanceTimersByTimeAsync(800)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws nothing when the answer comes after the destruction of the editor', async () => {
    const calls = deferredCalls(fetchMock)
    const editor = editorWith(`<p>${unique('Navigation')}</p>`)
    editor.commands.proofread()
    await flushPromises()
    destroy(editor)
    const errors = await catchWindowErrors(async () => {
      calls[0].resolve(answer([match(0, 3)]))
      await flushPromises()
    })
    expect(errors).toEqual([])
  })

  it('underlines the faulty word when text was typed before it during the request', async () => {
    const calls = deferredCalls(fetchMock)
    const word = unique('exmple').replace(' ', '')
    const editor = editorWith(`<p>Un ${word}</p>`)
    editor.commands.proofread()
    await flushPromises()
    editor.commands.insertContentAt(1, 'Voici ') // Typed during the request
    calls[0].resolve(answer([match(3, word.length)]))
    await flushPromises()
    expect(decorations(editor)).toEqual([word])
  })
})

describe('internal links menu with a hurried user', () => {
  const FINDINGS = [{ _id: 'f1', title: 'Injection SQL' }, { _id: 'f2', title: 'XSS' }]

  function editorWith(content = '<p>Voir ::</p>') {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = track(new Editor({ element, extensions: [...contentExtensions(), TriggerMenuExtension], content }))
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0 })
    return editor
  }

  const plugin = (editor) => editor.state.plugins.find((p) => p.key.startsWith('triggerMenu$'))
  const keydown = (editor, key) => plugin(editor).props.handleKeyDown(editor.view, new KeyboardEvent('keydown', { key, cancelable: true }))
  const menu = () => document.querySelector('.tiptap-trigger-menu')
  const answer = () => ({ ok: true, json: () => Promise.resolve({ datas: { findings: FINDINGS } }) })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    window.history.replaceState({}, '', '/audits/a1/findings/f9')
    fetchMock.mockImplementation(() => Promise.resolve(answer()))
  })

  it('shows nothing when the menu was closed before the findings answered', async () => {
    const editor = editorWith()
    const errors = await catchWindowErrors(async () => {
      keydown(editor, ':')
      keydown(editor, 'Escape')
      await vi.advanceTimersByTimeAsync(1000)
      await flushPromises()
    })
    expect(errors).toEqual([])
    expect(menu()).toBeNull()
    document.body.click() // Outside click listener left by the menu
  })

  it('removes the menu when the editor is destroyed', async () => {
    const editor = editorWith()
    keydown(editor, ':')
    destroy(editor)
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(menu()).toBeNull()
  })

  it('inserts the clicked finding once after the menu was reopened quickly', async () => {
    const editor = editorWith()
    keydown(editor, ':')
    keydown(editor, 'Escape')
    keydown(editor, ':')
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    const errors = await catchWindowErrors(() => {
      document.querySelector('.tiptap-trigger-menu .menu-option').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(errors).toEqual([])
    expect(editor.getHTML()).toBe('<p>Voir <a target="_blank" rel="noopener noreferrer nofollow" href="#f1">Injection SQL</a> </p>')
  })

  it('inserts the finding selected with the keyboard once the findings answered', async () => {
    const editor = editorWith()
    keydown(editor, ':')
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    keydown(editor, 'ArrowDown')
    keydown(editor, 'Enter')
    keydown(editor, 'Enter') // Second Enter: new paragraph by the editor, no second link
    expect(editor.getHTML()).toContain('href="#f2">XSS</a> ')
    expect(editor.getHTML().match(/<a /g)).toHaveLength(1)
    document.body.click()
  })
})

describe('pasted images with a hurried user', () => {
  const ID = '6aef2c3a3b1d4e5f60718293'
  let current

  async function editorWith(content = '<p>Texte</p>') {
    current = await mountEditor({ extensions: contentExtensions(), content, mocks: { $settings: {} } })
    return current.editor
  }

  const handlers = (editor) => editor.state.plugins.find((plugin) => plugin.key.startsWith('eventHandler$')).props.handleDOMEvents
  const pasteImage = (editor, name) => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' })
    return handlers(editor).paste(editor.view, { clipboardData: { items: [{ type: 'image/png', getAsFile: () => file }], getData: () => '' }, preventDefault() {} })
  }
  let settle
  const images = (editor) => {
    const result = []
    editor.state.doc.descendants((node) => { if (node.type.name === 'custom_image') result.push(node.attrs.alt) })
    return result
  }

  beforeEach(() => {
    settle = trackFileReads()
    vi.spyOn(Utils, 'resizeImg').mockResolvedValue('data:image/jpeg;base64,AA==')
  })
  afterEach(() => {
    current && current.destroy()
    current = null
  })

  it('inserts the two images pasted quickly, whatever the order of the uploads', async () => {
    const uploads = deferredCalls(vi.spyOn(ImageService, 'createImage'))
    const editor = await editorWith()
    editor.commands.setTextSelection(editor.state.doc.content.size)
    pasteImage(editor, 'premier.png')
    pasteImage(editor, 'second.png')
    await settle()
    expect(uploads).toHaveLength(2)
    uploads[1].resolve({ data: { datas: { _id: `${ID.slice(0, -1)}2` } } })
    await flushPromises()
    uploads[0].resolve({ data: { datas: { _id: ID } } })
    await flushPromises()
    expect(images(editor).sort()).toEqual(['premier.png', 'second.png'])
  })

  it('throws nothing when the upload answers after the destruction of the editor', async () => {
    const uploads = deferredCalls(vi.spyOn(ImageService, 'createImage'))
    const editor = await editorWith()
    pasteImage(editor, 'capture.png')
    await settle()
    current.destroy()
    current = null
    const errors = await catchWindowErrors(async () => {
      uploads[0].resolve({ data: { datas: { _id: ID } } })
      await flushPromises()
    })
    expect(errors).toEqual([])
  })

  it('keeps the text selected during the upload and inserts the image where it was pasted', async () => {
    const uploads = deferredCalls(vi.spyOn(ImageService, 'createImage'))
    const editor = await editorWith('<p>Texte important</p>')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    pasteImage(editor, 'capture.png')
    await settle()
    editor.commands.setTextSelection({ from: 7, to: 16 }) // "important" selected during the upload
    uploads[0].resolve({ data: { datas: { _id: ID } } })
    await flushPromises()
    expect(editor.state.doc.textContent).toBe('Texte important')
    expect(images(editor)).toEqual(['capture.png'])
  })
})

describe('captions with a hurried user', () => {
  it('keeps the last caption text typed quickly', async () => {
    const current = await mountEditor({ extensions: contentExtensions(), content: '<legend label="Figure" alt=""></legend>' })
    const input = current.editor.view.dom.querySelector('.editor-caption input')
    for (const value of ['C', 'Ca', 'Cap', 'Capture é', 'Capture été']) {
      input.value = value
      input.dispatchEvent(new Event('input'))
    }
    await flushPromises()
    expect(current.editor.getHTML()).toBe('<legend label="Figure" alt="Capture été"></legend>')
    current.destroy()
  })

  it('throws nothing when the editor is destroyed right after typing in a caption', async () => {
    const current = await mountEditor({ extensions: contentExtensions(), content: '<legend label="Figure" alt=""></legend>' })
    const input = current.editor.view.dom.querySelector('.editor-caption input')
    const errors = await catchWindowErrors(async () => {
      input.value = 'x'
      input.dispatchEvent(new Event('input'))
      current.destroy()
      await flushPromises()
    })
    expect(errors).toEqual([])
  })
})
