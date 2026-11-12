// components/internal-link.js: menu of the findings of the audit opened by "::" in the editors, inserting an internal
// link to a finding (real TipTap editor, fetch of the audit mocked)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { Editor } from '@tiptap/core'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

import { contentExtensions } from 'components/editor-extensions'
import { TriggerMenuExtension, decodeOption } from 'components/internal-link'

const FINDINGS = [
  { _id: 'f1', title: 'Injection SQL' },
  { _id: 'f2', title: 'Élévation de privilèges' },
  { _id: 'f3', title: 'XSS <script>"x"</script> & \'y\'' },
  { _id: 'f4', title: '100% des comptes 🔒 漢字' }
]

const editors = []
let fetchMock

function editorWith(content = '<p>Voir ::</p>') {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({ element, extensions: [...contentExtensions(), TriggerMenuExtension], content })
  editor.commands.setTextSelection(editor.state.doc.content.size - 1) // End of the paragraph
  vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ top: 10, bottom: 30, left: 20, right: 20 }) // No layout in jsdom
  editors.push(editor)
  return editor
}

const plugin = (editor) => editor.state.plugins.find((p) => p.key.startsWith('triggerMenu$'))
const keydown = (editor, key) => plugin(editor).props.handleKeyDown(editor.view, new KeyboardEvent('keydown', { key, cancelable: true }))
// Key typed by the user: inserted unless the plugin handles it
const type = (editor, key) => {
  const handled = keydown(editor, key)
  if (!handled && key.length === 1) editor.commands.insertContent(key)
  return handled
}
const menu = () => document.querySelector('.tiptap-trigger-menu')
const options = () => [...document.querySelectorAll('.tiptap-trigger-menu .menu-option')]
const selectedTitle = () => decodeOption(document.querySelector('.menu-option.selected').getAttribute('data-value'))
const answer = (findings) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ datas: { findings } }) })

// Menu opened by the third ":" of ":::" and options loaded
async function openMenu(editor) {
  const handled = keydown(editor, ':')
  await vi.advanceTimersByTimeAsync(1000)
  await flushPromises()
  return handled
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  fetchMock = vi.fn(() => answer(FINDINGS))
  vi.stubGlobal('fetch', fetchMock)
  window.history.replaceState({}, '', '/audits/a1b2/findings/f9')
})
afterEach(() => {
  vi.useRealTimers()
  document.body.click() // Closes a menu left open
  editors.splice(0).forEach((editor) => {
    editor.view.dom.parentNode && editor.view.dom.parentNode.remove()
    editor.destroy()
  })
  document.querySelectorAll('.tiptap-trigger-menu').forEach((element) => element.remove())
  window.history.replaceState({}, '', '/')
})

describe('internal link menu opening', () => {
  it('opens the menu after "::" with a loading state, then lists the findings of the audit', async () => {
    const editor = editorWith()
    expect(keydown(editor, ':')).toBe(true)
    expect(menu()).not.toBeNull()
    expect(menu().style.top).toBe('10px')
    expect(menu().style.left).toBe('20px')
    expect(menu().querySelector('.loading-state')).not.toBeNull()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/api/audits/a1b2`)
    expect(options().map((option) => decodeOption(option.getAttribute('data-value')))).toEqual(FINDINGS.map((f) => f.title))
    expect(options().map((option) => option.getAttribute('data-index'))).toEqual(['f1', 'f2', 'f3', 'f4'])
    expect(selectedTitle()).toBe('Injection SQL')
  })

  it('shows the titles as text (no HTML interpretation), unicode included', async () => {
    const editor = editorWith()
    await openMenu(editor)
    expect(menu().querySelector('script')).toBeNull()
    expect(options()[2].textContent).toContain('XSS <script>"x"</script> & \'y\'')
    expect(options()[3].textContent).toContain('100% des comptes 🔒 漢字')
  })

  it('does not open the menu without "::" before the cursor', () => {
    const editor = editorWith('<p>Voir :</p>')
    expect(keydown(editor, 'a')).toBe(false)
    expect(menu()).toBeNull()
  })

  it('does not open the menu with another key after "::" (arrows, Tab, letters)', () => {
    const editor = editorWith()
    for (const key of ['ArrowRight', 'ArrowLeft', 'Tab', 'a', '1'])
      expect(keydown(editor, key)).toBe(false)
    expect(menu()).toBeNull()
  })

  it('does not open the menu outside the audits (vulnerabilities)', async () => {
    window.history.replaceState({}, '', '/vulnerabilities')
    const editor = editorWith()
    expect(keydown(editor, ':')).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(menu()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows an error when the findings cannot be loaded', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({ datas: 'Insufficient privileges' }) })
    const editor = editorWith()
    await openMenu(editor)
    expect(menu().querySelector('.error-state').textContent).toContain('Failed to fetch options')
    expect(options()).toEqual([])
  })

  it('shows an empty state for an audit without findings', async () => {
    fetchMock.mockImplementation(() => answer([]))
    const editor = editorWith()
    await openMenu(editor)
    expect(menu().querySelector('.empty-state')).not.toBeNull()
  })

  it('lists the findings as soon as they are loaded', async () => {
    const editor = editorWith()
    keydown(editor, ':')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalled()
    expect(options()).toHaveLength(4)
  })

  it('adds the style of the menu once', () => {
    const count = () => [...document.head.querySelectorAll('style')].filter((style) => style.textContent.includes('.tiptap-trigger-menu')).length
    editorWith()
    const before = count()
    editorWith()
    editorWith()
    expect(count()).toBe(before)
  })
})

describe('internal link menu navigation and insertion', () => {
  it('moves the selection with the arrows (cycling)', async () => {
    const editor = editorWith()
    await openMenu(editor)
    expect(keydown(editor, 'ArrowDown')).toBe(true)
    expect(selectedTitle()).toBe('Élévation de privilèges')
    keydown(editor, 'ArrowUp')
    keydown(editor, 'ArrowUp')
    expect(selectedTitle()).toBe('100% des comptes 🔒 漢字')
    keydown(editor, 'ArrowDown')
    expect(selectedTitle()).toBe('Injection SQL')
  })

  it('inserts a link to the selected finding with Enter, in place of "::"', async () => {
    const editor = editorWith()
    await openMenu(editor)
    keydown(editor, 'ArrowDown')
    expect(keydown(editor, 'Enter')).toBe(true)
    expect(editor.getHTML()).toBe('<p>Voir <a target="_blank" rel="noopener noreferrer nofollow" href="#f2">Élévation de privilèges</a> </p>')
    expect(menu()).toBeNull()
    // The cursor is after the space, out of the link
    expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1)
    editor.commands.insertContent('suite')
    expect(editor.getHTML()).toContain('</a> suite</p>')
  })

  it('inserts the clicked finding', async () => {
    const editor = editorWith()
    await openMenu(editor)
    options()[3].querySelector('.icon').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(editor.getHTML()).toContain('href="#f4">100% des comptes 🔒 漢字</a> ')
    expect(menu()).toBeNull()
  })

  it('inserts the titles with special characters unchanged', async () => {
    const editor = editorWith()
    await openMenu(editor)
    keydown(editor, 'ArrowDown')
    keydown(editor, 'ArrowDown')
    keydown(editor, 'Enter')
    expect(editor.state.doc.textContent).toBe('Voir XSS <script>"x"</script> & \'y\' ')
    expect(editor.getHTML()).toContain('href="#f3">XSS &lt;script&gt;"x"&lt;/script&gt; &amp; \'y\'</a>')
  })

  it('closes the menu with Backspace and lets the character be deleted', async () => {
    const editor = editorWith()
    await openMenu(editor)
    expect(keydown(editor, 'Backspace')).toBe(false)
    expect(menu()).toBeNull()
  })

  it('closes the menu with a click outside', async () => {
    const editor = editorWith()
    await openMenu(editor)
    document.body.click()
    expect(menu()).toBeNull()
  })

  it('closes the menu with another key', async () => {
    const editor = editorWith()
    await openMenu(editor)
    keydown(editor, 'Escape')
    expect(menu()).toBeNull()
    expect(editor.state.doc.textContent).toBe('Voir ::')
  })

  it('lets the user type the characters following "::" (IPv6 address)', () => {
    const editor = editorWith('<p>fe80</p>')
    for (const key of [':', ':', '1', 'a', 'b']) type(editor, key)
    expect(editor.state.doc.textContent).toContain('ab')
  })

  it('types "::" in the text', () => {
    const editor = editorWith('<p>fe80</p>')
    type(editor, ':')
    type(editor, ':')
    expect(editor.state.doc.textContent).toBe('fe80::')
    expect(menu()).toBeNull()
  })
})

// Shortcut documented in the README: ":::" typed in the editor opens the menu of the findings
describe('internal link ":::" shortcut (README)', () => {
  it('opens the menu when a third ":" is typed after "::"', async () => {
    const editor = editorWith('<p>Voir</p>')
    type(editor, ':')
    type(editor, ':')
    expect(type(editor, ':')).toBe(true) // Third ":" handled by the menu, not typed
    expect(menu()).not.toBeNull()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(options()).toHaveLength(4)
    expect(editor.state.doc.textContent).toBe('Voir::')
  })

  it('inserts the link in place of ":::" (no ":" left in the text)', async () => {
    const editor = editorWith('<p>Voir</p>')
    for (const key of [':', ':', ':']) type(editor, key)
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    keydown(editor, 'Enter')
    expect(editor.getHTML()).toBe('<p>Voir<a target="_blank" rel="noopener noreferrer nofollow" href="#f1">Injection SQL</a> </p>')
  })
})
