// components/editor.vue mounted with a real TipTap editor: loading of the initial value and read-only state, v-model,
// change events, differences view, review comments, image zoom, LanguageTool suggestions and collaboration
// (Hocuspocus provider replaced by a fake provider sharing a local Yjs document)
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import { QBtn, QBtnDropdown, QIcon } from 'quasar'
import { Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))
import { api, resetApi } from '../../helpers/api-mock'

// Fake Hocuspocus provider: the test emits its status ('connected') and synchronization ('synced')
const providers = vi.hoisted(() => [])
vi.mock('@hocuspocus/provider', async () => {
  const { Awareness } = await import('y-protocols/awareness')
  class HocuspocusProvider {
    constructor(options) {
      this.options = options
      this.handlers = {}
      this.awareness = new Awareness(options.document)
      this.destroy = vi.fn()
      providers.push(this)
    }
    on(event, handler) {
      (this.handlers[event] = this.handlers[event] || []).push(handler)
      return this
    }
    off() { return this }
    emit(event, payload) { (this.handlers[event] || []).forEach((handler) => handler(payload)) }
    connectAndSync() {
      this.emit('status', { status: 'connected' })
      this.emit('synced', { state: true })
    }
  }
  return { HocuspocusProvider }
})

import Utils from '@/services/utils'
import UserService from '@/services/user'
import SpellcheckService from '@/services/spellcheck'
import { Notify } from 'quasar'
import { createCommentsStore } from '@/services/comments'
import { setInitialCollaborativeContent } from 'components/editor-collaboration'
import { mountEditor, settle, selectText, lastValue, polyfillLayout, fetchNoMatch, waitBubbleMenuTimers } from '../../helpers/editor-component'

let wrapper
const editor = () => wrapper.vm.editor
const html = () => editor().getHTML()
const emitted = (event) => wrapper.emitted(event) || []
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

beforeAll(polyfillLayout)
afterAll(waitBubbleMenuTimers)
beforeEach(() => {
  sessionStorage.setItem('autoCorrectionEnabled', 'false') // No LanguageTool request
  vi.stubGlobal('fetch', fetchNoMatch())
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(async () => {
  // Collaborative editors initialized before being unmounted (their content checked by some tests after the test)
  if (wrapper && providers.length && !wrapper.vm.initialeDataUpdated && !wrapper.vm.collabError) {
    providers.forEach((provider) => provider.connectAndSync())
    await vi.waitFor(() => expect(wrapper.vm.initialeDataUpdated).toBe(true), { timeout: 2000 })
  }
  providers.forEach((provider) => provider.connectAndSync())
  wrapper && wrapper.unmount()
  wrapper = null
  providers.splice(0)
  await flushPromises()
})

describe('initial value and read-only state', () => {
  it('loads the initial value, then becomes editable and emits ready once', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Description <strong>initiale</strong></p>' })
    expect(html()).toBe('<p>Description <strong>initiale</strong></p>')
    expect(editor().isEditable).toBe(true)
    expect(wrapper.find('.ProseMirror').attributes('contenteditable')).toBe('true')
    expect(wrapper.vm.initialeDataUpdated).toBe(true)
    expect(emitted('ready')).toHaveLength(1)
    expect(lastValue(wrapper)).toBe('<p>Description <strong>initiale</strong></p>') // Value not changed
  })

  it('stays read-only when not editable, and follows the editable prop', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>', editable: false })
    expect(editor().isEditable).toBe(false)
    expect(wrapper.find('.ProseMirror').attributes('contenteditable')).toBe('false')
    expect(wrapper.find('.ProseMirror').attributes('tabindex')).toBe('-1') // Focusable to select text (comments)
    expect(emitted('ready')).toHaveLength(1)
    await wrapper.setProps({ editable: true })
    expect(editor().isEditable).toBe(true)
    expect(wrapper.find('.ProseMirror').attributes('tabindex')).toBe('0')
    await wrapper.setProps({ editable: false })
    expect(editor().isEditable).toBe(false)
  })

  it('loads unicode texts and HTML entities unchanged', async () => {
    const value = '<p>Élévation de privilèges « root » — 漢字 🔒 &lt;script&gt;alert(1)&lt;/script&gt; &amp; l’accès</p>'
    wrapper = await mountEditor({ modelValue: value })
    expect(html()).toBe(value)
    expect(editor().getText()).toContain('<script>alert(1)</script>')
    expect(wrapper.find('.ProseMirror script').exists()).toBe(false)
    expect(lastValue(wrapper)).toBe(value)
  })

  it('removes the unsafe HTML of the initial value', async () => {
    wrapper = await mountEditor({ modelValue: '<p>a<script>alert(1)</script><img src=x onerror="alert(2)"></p><p onclick="alert(3)">b</p>' })
    expect(html()).not.toMatch(/script|onerror|onclick/)
    expect(wrapper.find('.ProseMirror').html()).not.toMatch(/<script|onerror=|onclick=/)
  })

  it('gives an empty string to a null value (fields not set in the database)', async () => {
    wrapper = await mountEditor({ modelValue: null }, { vModel: false })
    expect(emitted('update:modelValue')[0]).toEqual([''])
    expect(html()).toBe('<p></p>')
    expect(editor().isEditable).toBe(true)
  })

  it('shows a value received after an empty initialization (custom fields loaded later), without change event', async () => {
    wrapper = await mountEditor({ modelValue: '' })
    expect(wrapper.vm.emptyInitialValue).toBe(true)
    await wrapper.setProps({ modelValue: '<p>Texte par défaut</p>' })
    await flushPromises()
    expect(html()).toBe('<p>Texte par défaut</p>')
    expect(wrapper.vm.emptyInitialValue).toBe(false)
    expect(emitted('editorchange')).toHaveLength(0)
    expect(emitted('ready')).toHaveLength(1)
  })

  it('does not replace the text typed after an empty initialization', async () => {
    wrapper = await mountEditor({ modelValue: '' })
    editor().commands.insertContent('Saisie')
    editor().commands.insertContent(' utilisateur')
    await flushPromises()
    expect(wrapper.props('modelValue')).toBe('<p>Saisie utilisateur</p>')
    await wrapper.setProps({ modelValue: '<p>Valeur tardive</p>' })
    await flushPromises()
    expect(html()).toBe('<p>Saisie utilisateur</p>')
  })

  it('keeps its content once loaded: the editor is the source of the value', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Chargé</p>' })
    await wrapper.setProps({ modelValue: '<p>Autre valeur du parent</p>' })
    await flushPromises()
    expect(html()).toBe('<p>Chargé</p>')
  })

  it('is loaded immediately in the pages of an audit when it is not collaborative', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Section</p>', idUnique: 'basiceditor_section' }, { route: { params: { auditId: 'a1', sectionId: 's1' } } })
    expect(html()).toBe('<p>Section</p>')
    expect(editor().isEditable).toBe(true)
    expect(emitted('ready')).toHaveLength(1)
    expect(providers).toHaveLength(0)
  })

  it('becomes editable with an empty initial value', async () => {
    wrapper = await mountEditor({ modelValue: '' })
    expect(editor().isEditable).toBe(true)
    expect(emitted('ready')).toHaveLength(1)
  })

  // Imported vulnerabilities, Serpico conversions of empty paragraphs (X-4)
  it('becomes editable with an initial value equal to an empty paragraph', async () => {
    wrapper = await mountEditor({ modelValue: '<p></p>' })
    expect(editor().isEditable).toBe(true)
    expect(emitted('ready')).toHaveLength(1)
  })

  it('uses its unique id in the class of its sticky toolbar', async () => {
    wrapper = await mountEditor({ modelValue: '', idUnique: 'basiceditor_poc' })
    expect(wrapper.find('.editor').classes()).toContain('affix-relative-element-basiceditor_poc')
    wrapper.unmount()
    wrapper = await mountEditor({ modelValue: '' })
    expect(wrapper.find('.editor').classes().find((name) => name.startsWith('affix-relative-element-'))).toMatch(/^affix-relative-element-[0-9a-f-]{36}$/)
  })
})

describe('loading of the content (loading prop, collaboration)', () => {
  it('waits for the value of the page (loading prop): read-only with a loading state, then loads the last value', async () => {
    wrapper = await mountEditor({ modelValue: '', loading: true })
    expect(editor().isEditable).toBe(false)
    expect(wrapper.vm.initialeDataUpdated).toBe(false)
    expect(wrapper.find('.editor-loading').exists()).toBe(true)
    expect(wrapper.find('.editor').attributes('aria-busy')).toBe('true')
    expect(emitted('ready')).toHaveLength(0)
    await wrapper.setProps({ modelValue: '<p>Description enregistrée</p>' })
    expect(html()).toBe('<p></p>')
    await wrapper.setProps({ loading: false })
    expect(html()).toBe('<p>Description enregistrée</p>')
    expect(editor().isEditable).toBe(true)
    expect(wrapper.find('.editor-loading').exists()).toBe(false)
    expect(wrapper.find('.editor').attributes('aria-busy')).toBe('false')
    expect(emitted('ready')).toHaveLength(1)
    expect(emitted('editorchange')).toHaveLength(0)
  })

  it('toolbar disabled until the content is loaded', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>', loading: true })
    const bold = () => wrapper.findAllComponents(QBtn).find((button) => button.findAllComponents(QIcon).some((icon) => icon.props('name') === 'format_bold'))
    expect(bold().props('disable')).toBe(true)
    expect(wrapper.find('input[type=file]').attributes('disabled')).toBeDefined()
    await wrapper.setProps({ loading: false })
    expect(bold().props('disable')).toBe(false)
    expect(wrapper.find('input[type=file]').attributes('disabled')).toBeUndefined()
  })

  it('collaborative editor: loading state until the shared document is synchronized', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Initial</p>', idUnique: 'basiceditor_description', collab: true }, { route: { params: { auditId: 'a1', findingId: 'f1' } } })
    expect(wrapper.find('.editor-loading').exists()).toBe(true)
    providers[0].connectAndSync()
    await flushPromises()
    expect(wrapper.find('.editor-loading').exists()).toBe(false)
    expect(html()).toBe('<p>Initial</p>')
  })

  // TipTap moves the element of a shown bubble menu into the content: the conditional nodes (loading, disconnection) are
  // kept in fixed wrappers, never inserted before a moved bubble menu (NotFoundError in the browsers, page no longer
  // updated: checked by the E2E tests 13-hurried-user, the patch path of jsdom does not reproduce the error)
  it('keeps the loading and connection states in fixed wrappers, apart from the bubble menus moved by TipTap', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte sélectionné</p>', idUnique: 'basiceditor_description', collab: true }, { route: { params: { auditId: 'a1', findingId: 'f1' } } })
    const state = wrapper.find('.editor-state').element
    providers[0].connectAndSync()
    await flushPromises()
    editor().view.focus()
    editor().commands.setTextSelection({ from: 1, to: 6 })
    // Formatting menu shown (moved into the content by TipTap) after its update delay; LanguageTool menu not shown for a
    // selection without reported mistake
    const menus = wrapper.findAllComponents({ name: 'BubbleMenu' })
    const moved = () => menus.map((menu) => !!menu.element.parentNode && menu.element.parentNode.classList.contains('editor__content'))
    await vi.waitFor(() => expect(moved()).toEqual([true, false]), { timeout: 3000 })
    expect(wrapper.findAll('.editor-menu-wrapper')).toHaveLength(2)
    providers[0].emit('status', { status: 'disconnected' })
    await flushPromises()
    expect(wrapper.find('.editor-state .editor-disconnected').exists()).toBe(true)
    providers[0].connectAndSync()
    await flushPromises()
    expect(wrapper.find('.editor-disconnected').exists()).toBe(false)
    expect(wrapper.find('.editor-state').element).toBe(state)
    expect([...wrapper.find('.editor').element.children].filter((child) => child.classList.contains('editor-state'))).toHaveLength(1)
  })

  it('never shows the caret of its own client (client id of the document unchanged by the initial content)', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte sélectionné</p>', idUnique: 'basiceditor_description', collab: true }, { route: { params: { auditId: 'a1', findingId: 'f1' } } })
    const clientID = providers[0].options.document.clientID
    providers[0].connectAndSync()
    await flushPromises()
    expect(providers[0].options.document.clientID).toBe(clientID)
    editor().view.focus()
    editor().commands.setTextSelection({ from: 1, to: 6 })
    await wait(50)
    expect(wrapper.findAll('.collaboration-carets__caret')).toHaveLength(0)
    expect(wrapper.find('.ProseMirror').text()).toBe('Texte sélectionné')
  })

  // E.g. default text of a custom field in the custom data page: the server refuses an empty document name
  it('collaborative editor without document name (no audit, no idUnique): not shared, loaded at once', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte par défaut</p>', collab: true })
    expect(wrapper.vm.shared).toBe(false)
    expect(providers).toHaveLength(0)
    expect(editor().isEditable).toBe(true)
    expect(emitted('ready')).toHaveLength(1)
    expect(wrapper.find('.editor-loading').exists()).toBe(false)
    expect(wrapper.find('.editor-unavailable').exists()).toBe(false)
    expect(wrapper.find('.editor-disconnected').exists()).toBe(false)
    editor().commands.insertContentAt(editor().state.doc.content.size - 1, ' modifié')
    editor().commands.undo() // History of the editor (not of a collaboration)
    expect(html()).toBe('<p>Texte par défaut</p>')
  })

  it('shared as soon as it has a document name: audit of the page, or idUnique outside the audits', async () => {
    wrapper = await mountEditor({ modelValue: '', collab: true }, { route: { params: { auditId: 'a1', sectionId: 's1' } } })
    expect(wrapper.vm.documentName).toBe('a1')
    expect(providers).toHaveLength(1)
    wrapper.unmount()
    wrapper = await mountEditor({ modelValue: '', collab: true, idUnique: '64ab12-description' })
    expect(wrapper.vm.documentName).toBe('64ab12/description')
    expect(wrapper.vm.shared).toBe(true)
  })

  it('field of the shared document named with the section of the page', async () => {
    wrapper = await mountEditor({ modelValue: '', idUnique: 'basiceditor_section', collab: true }, { route: { params: { auditId: 'a1', sectionId: 's1' } } })
    expect(wrapper.vm.fullId).toBe('a1-s1-basiceditor_section')
    expect(providers[0].options.name).toBe('a1')
  })
})

describe('collaboration refused or values of unusual types', () => {
  const ROUTE = { params: { auditId: 'a1', findingId: 'f1' } }
  const mountCollab = (props = {}) => mountEditor({ modelValue: '<p>Valeur <strong>enregistrée</strong></p>', idUnique: 'basiceditor_description', collab: true, ...props }, { route: ROUTE })
  const bold = () => wrapper.findAllComponents(QBtn).find((button) => button.findAllComponents(QIcon).some((icon) => icon.props('name') === 'format_bold'))

  it.each(['permission-denied', 'Forbidden'])('authentication refused (%s) before the synchronization: no retries, read-only, value of the page shown, no ready', async (reason) => {
    wrapper = await mountCollab()
    const refused = providers[0]
    refused.emit('authenticationFailed', { reason })
    await flushPromises()
    expect(refused.destroy).toHaveBeenCalledTimes(1) // Provider stopped: no endless retries
    expect(wrapper.find('.editor-loading').exists()).toBe(false)
    expect(wrapper.find('.editor').attributes('aria-busy')).toBe('false')
    expect(wrapper.find('.editor-unavailable').text()).toContain(wrapper.vm.$t('editorCollabUnavailable', [reason]))
    expect(wrapper.find('.editor-preview .ProseMirror').html()).toContain('Valeur <strong>enregistrée</strong>')
    expect(editor().isEditable).toBe(false)
    expect(bold().props('disable')).toBe(true)
    expect(emitted('ready')).toHaveLength(0)
    expect(emitted('update:modelValue')).toHaveLength(0) // Value of the page kept
    refused.connectAndSync() // Late events of the stopped provider ignored
    await flushPromises()
    expect(wrapper.vm.initialeDataUpdated).toBe(false)
  })

  it('retries the collaboration on demand: new connection, loaded once synchronized', async () => {
    wrapper = await mountCollab()
    providers[0].emit('authenticationFailed', { reason: 'permission-denied' })
    await flushPromises()
    await wrapper.find('.editor-unavailable button').trigger('click')
    await flushPromises()
    expect(providers).toHaveLength(2)
    expect(wrapper.find('.editor-loading').exists()).toBe(true)
    expect(wrapper.find('.editor-unavailable').exists()).toBe(false)
    providers[1].connectAndSync()
    await flushPromises()
    expect(html()).toBe('<p>Valeur <strong>enregistrée</strong></p>')
    expect(editor().isEditable).toBe(true)
    expect(emitted('ready')).toHaveLength(1)
  })

  it('authentication refused after the loading (rights removed): read-only, content kept, state shown', async () => {
    wrapper = await mountCollab()
    providers[0].connectAndSync()
    await flushPromises()
    expect(editor().isEditable).toBe(true)
    providers[0].emit('authenticationFailed', { reason: 'Forbidden' })
    await flushPromises()
    expect(providers[0].destroy).toHaveBeenCalledTimes(1)
    expect(editor().isEditable).toBe(false)
    expect(html()).toBe('<p>Valeur <strong>enregistrée</strong></p>')
    expect(wrapper.find('.editor-preview').exists()).toBe(false) // Shared content shown by the editor
    expect(wrapper.find('.editor-unavailable').exists()).toBe(true)
    expect(bold().props('disable')).toBe(true)
    await wrapper.setProps({ editable: true })
    expect(editor().isEditable).toBe(false)
    expect(emitted('ready')).toHaveLength(1)
  })

  it.each([
    [123, '<p>123</p>'],
    [['Low', 'High'], '<p>Low, High</p>'],
    [{ level: 'High' }, '<p>{"level":"High"}</p>'],
    [true, '<p>true</p>'],
    [null, '<p></p>']
  ])('loads the imported value %j of a rich text field as text, without exception', async (value, expected) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) // Prop of type String
    wrapper = await mountCollab({ modelValue: value })
    providers[0].connectAndSync()
    await flushPromises()
    expect(html()).toBe(expected)
    expect(wrapper.vm.initialeDataUpdated).toBe(true)
    expect(emitted('ready')).toHaveLength(1)
    warn.mockRestore()
  })

  it('loads the values of unusual types without collaboration too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    wrapper = await mountEditor({ modelValue: 42, collab: false }, { vModel: false })
    expect(html()).toBe('<p>42</p>')
    expect(editor().isEditable).toBe(true)
  })
})

describe('keys typed before the content is loaded', () => {
  const press = (key, options = {}) => wrapper.find('.ProseMirror').trigger('keydown', { key, ...options })

  it('keeps them and types them at the end of the content once loaded (change of the user)', async () => {
    wrapper = await mountEditor({ modelValue: '', loading: true })
    for (const key of ['É', 'a', 'r', 'l', 'y', ' ', '<', 'b', '>']) await press(key)
    await press('s', { ctrlKey: true }) // Shortcut: not typed
    await press('Enter')
    expect(html()).toBe('<p></p>')
    await wrapper.setProps({ modelValue: '<p>Contenu enregistré</p>', loading: false })
    expect(html()).toBe('<p>Contenu enregistréÉarly &lt;b&gt;</p>')
    expect(emitted('editorchange')).toHaveLength(1)
    expect(lastValue(wrapper)).toBe('<p>Contenu enregistréÉarly &lt;b&gt;</p>')
  })

  it('types them in a new paragraph after a last image', async () => {
    wrapper = await mountEditor({ modelValue: '', loading: true })
    await press('x')
    await wrapper.setProps({ modelValue: '<p>a</p><img src="6aef2c3a3b1d4e5f60718293" alt="Capture">', loading: false })
    expect(html()).toBe('<p>a</p><img class="custom-image" src="6aef2c3a3b1d4e5f60718293" alt="Capture"><p>x</p>')
  })

  it('does not keep them in a read-only editor, nor once loaded', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Relu</p>', editable: false, loading: true })
    await press('x')
    await wrapper.setProps({ loading: false })
    expect(html()).toBe('<p>Relu</p>')
    expect(wrapper.vm.earlyText).toBe('')
  })
})

describe('toolbar menus', () => {
  // The menu is closed after a choice and the focus is not given back to its button (the editor keeps it)
  it('format, highlight and captions menus close without taking the focus back from the editor', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' }, { stubs: {} })
    const dropdowns = wrapper.findAllComponents(QBtnDropdown)
    expect(dropdowns.map((dropdown) => dropdown.props('noRefocus'))).toEqual([true, true, true])
    expect(dropdowns.slice(0, 2).map((dropdown) => dropdown.props('autoClose'))).toEqual([true, true])
    expect(dropdowns.map((dropdown) => dropdown.props('disable'))).toEqual([false, false, false])
  })

  it('menus disabled in a read-only editor', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>', editable: false }, { stubs: {} })
    expect(wrapper.findAllComponents(QBtnDropdown).map((dropdown) => dropdown.props('disable'))).toEqual([true, true, true])
  })
})

describe('v-model', () => {
  it('emits the HTML of the editor on each change', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    editor().commands.insertContentAt(editor().state.doc.content.size - 1, ' modifié')
    expect(lastValue(wrapper)).toBe('<p>Texte modifié</p>')
    await flushPromises()
    expect(wrapper.props('modelValue')).toBe('<p>Texte modifié</p>')
  })

  it('emits an empty string when the content is cleared', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    editor().commands.clearContent(true)
    expect(lastValue(wrapper)).toBe('')
  })

  it('keeps an empty paragraph followed by other content', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    editor().commands.setContent('<p></p><p>Suite</p>', { emitUpdate: true })
    expect(lastValue(wrapper)).toBe('<p></p><p>Suite</p>')
  })

  it('noSync: emits the value only when the page synchronizes its editors (Utils.syncEditors)', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>', noSync: true })
    const count = emitted('update:modelValue').length
    editor().commands.insertContentAt(editor().state.doc.content.size - 1, ' avec image')
    expect(emitted('update:modelValue')).toHaveLength(count)
    Utils.syncEditors({ basiceditor_description: wrapper.vm, other: null })
    expect(lastValue(wrapper)).toBe('<p>Texte avec image</p>')
  })

  it('emits the code blocks highlighted, as read by the report generator', async () => {
    wrapper = await mountEditor({ modelValue: '<pre><code class="language-sql">SELECT * FROM users WHERE id = 1;</code></pre>' })
    expect(lastValue(wrapper)).toMatch(/^<pre><code class="language-sql"><span class="hljs-keyword">SELECT<\/span>/)
  })

  it('keeps the line breaks of the highlighted code blocks when they are loaded again', async () => {
    const value = '<pre><code class="language-http"><span class="hljs-keyword">GET</span> /index.php HTTP/1.1\n<span class="hljs-attribute">Host</span>: example.com\n</code></pre>'
    wrapper = await mountEditor({ modelValue: value })
    expect(editor().getText()).toContain('HTTP/1.1\nHost: example.com')
    expect(lastValue(wrapper)).toMatch(/HTTP\/1\.1(<\/span>)?\n<span class="hljs-attribute">Host/)
    expect(lastValue(wrapper)).toContain('hljs-attribute')
  })

  it('emits the code blocks of an unknown language as plain text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    wrapper = await mountEditor({ modelValue: '<pre><code class="language-cobolx">MOVE A TO B &lt;x&gt;</code></pre>' })
    expect(lastValue(wrapper)).toBe('<pre><code class="language-cobolx">MOVE A TO B &lt;x&gt;</code></pre>')
    expect(warn).toHaveBeenCalled()
  })

  it('flattens and highlights the code blocks (helpers)', async () => {
    wrapper = await mountEditor({ modelValue: '' })
    expect(wrapper.vm.flattenCodeBlocks(null)).toBeNull()
    expect(wrapper.vm.flattenCodeBlocks('<p>a</p>')).toBe('<p>a</p>')
    expect(wrapper.vm.flattenCodeBlocks('<pre><code><span class="hljs-string">"x"</span>\n</code></pre>')).toBe('<pre><code>"x"\n</code></pre>')
    expect(wrapper.vm.highlightAllCodeBlocks('')).toBe('')
    expect(wrapper.vm.highlightAllCodeBlocks('<pre><code class="language-json">{"a": 1}</code></pre>')).toContain('<span class="hljs-attr">"a"</span>')
  })

  it('does not emit before the initial value is loaded', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Initial</p>', idUnique: 'basiceditor_description', collab: true }, { route: { params: { auditId: 'a1', findingId: 'f1' } } })
    expect(wrapper.vm.initialeDataUpdated).toBe(false)
    wrapper.vm.updateHTML()
    expect(emitted('update:modelValue')).toHaveLength(0)
  })
})

describe('change events (unsaved changes of the pages)', () => {
  it('does not emit editorchange when the initial value is loaded', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    expect(emitted('editorchange')).toHaveLength(0)
  })

  it('emits editorchange on the changes following the first one', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    editor().commands.insertContentAt(editor().state.doc.content.size - 1, ' un')
    editor().commands.insertContentAt(editor().state.doc.content.size - 1, ' deux')
    expect(emitted('editorchange').length).toBeGreaterThanOrEqual(1)
  })

  it('emits editorchange on the first change after the loading', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    editor().commands.insertContentAt(editor().state.doc.content.size - 1, ' modifié')
    expect(emitted('editorchange')).toHaveLength(1)
  })

  it('does not emit editorchange when the editor is made read-only or editable', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    await wrapper.setProps({ editable: false })
    await wrapper.setProps({ editable: true })
    expect(emitted('editorchange')).toHaveLength(0)
  })

  it('does not emit editorchange for the content received from the collaboration, only for the changes of the user', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>', idUnique: 'basiceditor_description', collab: true }, { route: { params: { auditId: 'a1', findingId: 'f1' } } })
    providers[0].connectAndSync()
    await flushPromises()
    expect(emitted('editorchange')).toHaveLength(0)
    const other = new Editor({ element: document.createElement('div'), extensions: [StarterKit.configure({ undoRedo: false }), Collaboration.configure({ document: providers[0].options.document, field: 'a1-f1-basiceditor_description' })] })
    other.commands.insertContentAt(1, 'Bob: ')
    expect(html()).toBe('<p>Bob: Texte</p>')
    expect(lastValue(wrapper)).toBe('<p>Bob: Texte</p>') // Value of the page kept up to date
    expect(emitted('editorchange')).toHaveLength(0)
    editor().commands.insertContentAt(editor().state.doc.content.size - 1, ' (Ann)')
    expect(emitted('editorchange')).toHaveLength(1)
    other.destroy()
  })

  it('emits editorchange for an undo of the collaboration (change of the user)', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>', idUnique: 'basiceditor_description', collab: true }, { route: { params: { auditId: 'a1', findingId: 'f1' } } })
    providers[0].connectAndSync()
    await flushPromises()
    editor().commands.insertContentAt(editor().state.doc.content.size - 1, ' ajouté')
    expect(emitted('editorchange')).toHaveLength(1)
    editor().commands.undo()
    expect(html()).toBe('<p>Texte</p>')
    expect(emitted('editorchange')).toHaveLength(2)
  })
})

describe('differences with another version', () => {
  const diffView = () => wrapper.find('.editor__content > .ProseMirror')
  const toggleButton = () => wrapper.findAll('button').find((button) => button.text() === 'toggle diff')

  it('shows the parts added and removed since the other version', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Le paramètre est filtré</p>', diff: '<p>Le paramètre est renvoyé</p>' })
    expect(toggleButton().exists()).toBe(true)
    expect(wrapper.vm.toggleDiff).toBe(true)
    expect(wrapper.find('.diffadd').text()).toContain('filtré')
    expect(wrapper.find('.diffrem').text()).toContain('renvoyé')
    expect(wrapper.find('.ProseMirror[contenteditable]').exists()).toBe(false) // Editor hidden
  })

  it('shows the editor when the differences are hidden', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Nouveau</p>', diff: '<p>Ancien</p>' })
    await toggleButton().trigger('click')
    expect(wrapper.vm.toggleDiff).toBe(false)
    expect(wrapper.find('.ProseMirror[contenteditable]').exists()).toBe(true)
    expect(toggleButton().classes()).not.toContain('is-active')
    await toggleButton().trigger('click')
    expect(wrapper.find('.ProseMirror[contenteditable]').exists()).toBe(false)
  })

  it('shows only the editor when the differences are hidden', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Nouveau</p>', diff: '<p>Ancien</p>' })
    await toggleButton().trigger('click')
    expect(wrapper.find('.diffadd').exists()).toBe(false)
    expect(wrapper.findAll('.editor__content')).toHaveLength(1)
  })

  it('renders no differences block in an editor without other version', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    expect(wrapper.findAll('.editor__content')).toHaveLength(1)
  })

  it.each([
    ['<p>Identique</p>', '<p>Identique</p>'],
    ['', ''],
    ['<p>Texte</p>', undefined]
  ])('has no differences toggle for %j and %j', async (modelValue, diff) => {
    wrapper = await mountEditor({ modelValue, diff })
    expect(toggleButton()).toBeUndefined()
  })

  it('shows a whole text added or removed', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Ajouté</p>', diff: '' })
    expect(wrapper.find('.diffadd').text()).toBe('Ajouté')
    wrapper.unmount()
    wrapper = await mountEditor({ modelValue: '', diff: '<p>Supprimé</p>' })
    expect(wrapper.find('.diffrem').text()).toBe('Supprimé')
  })

  it('sanitizes both versions before showing the differences', async () => {
    wrapper = await mountEditor({
      modelValue: '<p>ok <img src=x onerror="alert(1)"></p><script>alert(2)</script>',
      diff: '<p>ok</p><p onmouseover="alert(3)">ancien</p>'
    })
    const view = diffView().html()
    expect(view).not.toMatch(/onerror|onmouseover|<script/)
  })

  it('shows the images of the differences with their download URL', async () => {
    wrapper = await mountEditor({ modelValue: '<p>a</p><img src="6aef2c3a3b1d4e5f60718293" alt="Capture">', diff: '<p>a</p>' })
    const images = diffView().findAll('img')
    expect(images).toHaveLength(1)
    expect(images[0].attributes('src')).toBe('api/images/download/6aef2c3a3b1d4e5f60718293')
  })
})

describe('image zoom', () => {
  const loaded = (img, width = 800) => {
    Object.defineProperty(img, 'complete', { value: true, configurable: true })
    Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true })
  }

  it('shows a loaded image in full screen with its caption on double click', async () => {
    wrapper = await mountEditor({ modelValue: '<p>a</p><img src="6aef2c3a3b1d4e5f60718293" alt="Capture été">', diff: '<p>a</p>' })
    const img = wrapper.find('.editor__content img')
    loaded(img.element)
    await img.trigger('dblclick')
    expect(wrapper.vm.zoom).toMatchObject({ show: true, alt: 'Capture été', fullSize: false })
    expect(wrapper.vm.zoom.src).toContain('api/images/download/6aef2c3a3b1d4e5f60718293')
    await flushPromises()
    const zoomed = document.querySelector('.editor-image-zoom img')
    expect(zoomed.getAttribute('alt')).toBe('Capture été')
    expect(document.querySelector('.editor-image-zoom__caption').textContent).toBe('Capture été')
    zoomed.click()
    expect(wrapper.vm.zoom.fullSize).toBe(true)
  })

  it('ignores the images not loaded and the other elements', async () => {
    wrapper = await mountEditor({ modelValue: '<p>a</p><img src="6aef2c3a3b1d4e5f60718293" alt="Cassée">', diff: '<p>a</p>' })
    const img = wrapper.find('.editor__content img')
    loaded(img.element, 0)
    await img.trigger('dblclick')
    await wrapper.find('.editor__content p').trigger('dblclick')
    expect(wrapper.vm.zoom.show).toBe(false)
  })

  it('zooms the images of the editor (image of the q-img of the node view)', async () => {
    wrapper = await mountEditor({ modelValue: '<img src="6aef2c3a3b1d4e5f60718293" alt="Dans l’éditeur">' })
    await settle()
    const qImg = wrapper.find('.ProseMirror .q-img')
    expect(qImg.exists()).toBe(true)
    qImg.findAll('img').forEach((img) => loaded(img.element))
    if (!qImg.find('img').exists()) {
      // q-img renders its <img> once loading starts: the layer over the image is what receives the double click
      const img = document.createElement('img')
      img.alt = 'Dans l’éditeur'
      img.src = 'api/images/download/6aef2c3a3b1d4e5f60718293'
      loaded(img)
      qImg.element.appendChild(img)
    }
    await qImg.trigger('dblclick')
    expect(wrapper.vm.zoom.show).toBe(true)
    expect(wrapper.vm.zoom.src).toContain('api/images/download/6aef2c3a3b1d4e5f60718293')
  })
})

describe('review comments', () => {
  const TARGET = { kind: 'finding', findingId: 'f1', field: 'description' }
  const quote = (exact, prefix = '', suffix = '') => ({ exact, prefix, suffix })
  const comment = (id, extra = {}) => ({ _id: id, target: TARGET, quote: quote('renvoyé'), resolved: false, author: { _id: 'u2' }, ...extra })
  let audit
  let store

  function newStore(state = 'EDIT', items = []) {
    audit = reactive({ state, findings: [{ _id: 'f1', title: 'XSS' }] })
    store = createCommentsStore('a1', { getAudit: () => audit, getCustomFields: () => [], canEdit: () => true, navigate: vi.fn() })
    store.items = items
    return store
  }

  const mountCommented = (props = {}, state = 'EDIT', items = []) =>
    mountEditor({ modelValue: '<p>Le paramètre q est renvoyé sans encodage.</p>', commentTarget: TARGET, ...props }, { provide: { auditComments: newStore(state, items) } })

  // Passage selected in the DOM (mouse or keyboard selection)
  function selectInDom(text) {
    const node = [...wrapper.find('.ProseMirror p').element.childNodes].find((child) => child.nodeType === 3 && child.textContent.includes(text))
    const start = node.textContent.indexOf(text)
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, start + text.length)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)
  }

  afterEach(() => window.getSelection().removeAllRanges())

  // Menus of the selection (TipTap moves their element out of the editor until they are shown)
  const bubbleMenus = () => wrapper.findAllComponents({ name: 'BubbleMenu' })

  it('shows the passage of an opened quality issue in its field only, until the user clicks in the field', async () => {
    wrapper = await mountCommented()
    await settle()
    store.focus = { ...TARGET, key: 'finding:f1:observation', passage: { text: 'renvoyé' }, at: 1 } // Other field
    await settle()
    expect(wrapper.findAll('.qa-passage')).toHaveLength(0)
    store.focus = { ...TARGET, key: 'finding:f1:description', passage: { text: 'RENVOYÉ sans' }, at: 2 }
    await settle()
    const passage = wrapper.find('.qa-passage')
    expect(passage.text()).toBe('renvoyé sans')
    expect(passage.attributes('data-qa-passage')).toBe('2')
    await wrapper.find('.editor__content').trigger('mousedown')
    await settle()
    expect(wrapper.findAll('.qa-passage')).toHaveLength(0)
    store.focus = { ...TARGET, key: 'finding:f1:description', passage: { text: 'paramètre' }, at: 3 } // Opened again
    await settle()
    expect(wrapper.find('.qa-passage').text()).toBe('paramètre')
    store.focus = { ...TARGET, key: 'finding:f1:description', commentId: 'c1', at: 4 } // Comment shown
    await settle()
    expect(wrapper.findAll('.qa-passage')).toHaveLength(0)
  })

  it('highlights the open comments on passages of the field only', async () => {
    wrapper = await mountCommented({}, 'EDIT', [
      comment('c1'),
      comment('c2', { quote: quote('sans'), resolved: true }),
      comment('c3', { target: { ...TARGET, field: 'observation' }, quote: quote('paramètre') }),
      comment('c4', { quote: null }) // Comment of the whole field
    ])
    await settle()
    const highlights = wrapper.findAll('.comment-highlight')
    expect(highlights).toHaveLength(1)
    expect(highlights[0].text()).toBe('renvoyé')
    expect(highlights[0].attributes('data-comment-id')).toBe('c1')
  })

  it('follows the comments of the store (new comment, active comment)', async () => {
    wrapper = await mountCommented()
    await settle()
    expect(wrapper.findAll('.comment-highlight')).toHaveLength(0)
    store.items = [comment('c1', { quote: quote('encodage') })]
    await settle()
    expect(wrapper.find('.comment-highlight').text()).toBe('encodage')
    store.activeId = 'c1'
    await settle()
    expect(wrapper.find('.comment-highlight').classes()).toContain('comment-highlight--active')
  })

  it('shows the comment of a highlighted passage when it is clicked', async () => {
    wrapper = await mountCommented({}, 'EDIT', [comment('c1')])
    await settle()
    await wrapper.find('.comment-highlight').trigger('click')
    expect(store.activeId).toBe('c1')
    expect(store.panelOpen).toBe(true)
  })

  it('comments the selected passage from the formatting menu of an audit in edition', async () => {
    wrapper = await mountCommented()
    expect(wrapper.vm.commentInFormatMenu).toBe(true)
    expect(bubbleMenus()).toHaveLength(2) // Formatting and LanguageTool menus
    const menu = bubbleMenus().find((component) => component.classes('editor-bubble-menu'))
    selectText(editor(), 'renvoyé')
    await menu.find('.editor-bubble-menu__comment').trigger('click')
    expect(store.draft).toEqual({ target: TARGET, quote: { exact: 'renvoyé', prefix: 'Le paramètre q est ', suffix: ' sans encodage.' }, image: null })
    expect(store.panelOpen).toBe(true)
  })

  it('does not comment an empty or blank selection', async () => {
    wrapper = await mountCommented()
    editor().commands.setTextSelection(3)
    wrapper.vm.commentSelectedText()
    expect(store.draft).toBeNull()
  })

  it('audit in review: no formatting menu, a button comments the passage selected in the read-only editor', async () => {
    wrapper = await mountCommented({ editable: false }, 'REVIEW')
    expect(wrapper.vm.commentMode).toBe(true)
    expect(bubbleMenus()).toHaveLength(0)
    selectInDom('sans encodage')
    await wrapper.find('.ProseMirror').trigger('mouseup')
    expect(wrapper.vm.commentSelection).toMatchObject({ quote: { exact: 'sans encodage' }, top: 120, left: 90 })
    const button = wrapper.find('.comment-selection-btn')
    expect(button.text()).toBe(wrapper.vm.$t('comments.commentSelection'))
    expect(button.attributes('style')).toContain('top: 80px')
    await button.trigger('click')
    expect(store.draft.quote.exact).toBe('sans encodage')
    expect(wrapper.vm.commentSelection).toBeNull()
    expect(window.getSelection().rangeCount).toBe(0)
  })

  it('selection with the keyboard in review', async () => {
    wrapper = await mountCommented({ editable: false }, 'APPROVED')
    selectInDom('paramètre')
    await wrapper.find('.ProseMirror').trigger('keyup')
    expect(wrapper.vm.commentSelection.quote.exact).toBe('paramètre')
  })

  it('ignores the collapsed selections and the selections outside of the editor', async () => {
    wrapper = await mountCommented({ editable: false }, 'REVIEW')
    window.getSelection().removeAllRanges()
    wrapper.vm.checkCommentSelection()
    expect(wrapper.vm.commentSelection).toBeNull()
    const outside = document.createElement('p')
    outside.textContent = 'Texte hors éditeur'
    document.body.appendChild(outside)
    const range = document.createRange()
    range.selectNodeContents(outside)
    window.getSelection().addRange(range)
    wrapper.vm.checkCommentSelection()
    expect(wrapper.vm.commentSelection).toBeNull()
    outside.remove()
  })

  it('hides the comment button when the page scrolls, and stops listening when unmounted', async () => {
    wrapper = await mountCommented({ editable: false }, 'REVIEW')
    selectInDom('paramètre')
    wrapper.vm.checkCommentSelection()
    expect(wrapper.vm.commentSelection).not.toBeNull()
    window.dispatchEvent(new Event('scroll'))
    expect(wrapper.vm.commentSelection).toBeNull()
    const remove = vi.spyOn(window, 'removeEventListener')
    const hide = wrapper.vm.hideCommentSelection
    wrapper.unmount()
    wrapper = null
    expect(remove).toHaveBeenCalledWith('scroll', hide, true)
  })

  it('has no comment action outside of the audits (no store or no target)', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte de vulnérabilité</p>', commentTarget: TARGET })
    expect(wrapper.vm.commentable).toBe(false)
    expect(bubbleMenus().some((menu) => menu.find('.editor-bubble-menu__comment').exists())).toBe(false)
    selectText(editor(), 'Texte')
    const range = document.createRange()
    range.selectNodeContents(wrapper.find('.ProseMirror p').element)
    window.getSelection().addRange(range)
    wrapper.vm.checkCommentSelection()
    expect(wrapper.vm.commentSelection).toBeNull()
    wrapper.unmount()
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' }, { provide: { auditComments: newStore() } })
    expect(wrapper.vm.commentable).toBe(false)
    expect(wrapper.vm.quoteComments).toEqual([])
  })

  it('gives the comment target and store to the image node views', async () => {
    wrapper = await mountCommented()
    expect(editor().storage.commentHighlight.target).toEqual(TARGET)
    expect(editor().storage.commentHighlight.store).toBe(store)
  })
})

describe('assisted writing (AI)', () => {
  const AI = { report: { public: { captions: ['Figure'] } }, ai: { enabled: true } }
  const aiButton = () => wrapper.findComponent({ name: 'AiAssistButton' })

  it('offers the AI in the toolbar when it is enabled in the settings and allowed to the user', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' }, { settings: AI, route: { params: { auditId: 'a1' } } })
    expect(aiButton().exists()).toBe(true)
    expect(aiButton().props('auditId')).toBe('a1')
    expect(aiButton().props('editor')).toBe(editor())
  })

  it('does not offer the AI when it is disabled or not allowed', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    expect(aiButton().exists()).toBe(false)
    wrapper.unmount()
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' }, { settings: AI, user: { username: 'viewer', id: 'u2', roles: ['audits:read'] } })
    expect(aiButton().exists()).toBe(false)
  })
})

describe('languagetool suggestions', () => {
  beforeEach(() => resetApi()) // Calls of the spell check counted per test

  it('shows a default message without error under the cursor', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    expect(wrapper.vm.matchMessage).toBe('No Message')
    expect(wrapper.vm.replacements).toEqual([])
  })

  it('shows the message and replacements of the error, and replaces the selection by a suggestion', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Le paramètre est renvoyer.</p>' })
    editor().storage.languagetool.match.value = { message: 'Faute d’accord possible', replacements: [{ value: 'renvoyé' }, { value: 'renvoyée' }] }
    await flushPromises()
    expect(wrapper.vm.matchMessage).toBe('Faute d’accord possible')
    expect(wrapper.vm.replacements.map((r) => r.value)).toEqual(['renvoyé', 'renvoyée'])
    selectText(editor(), 'renvoyer')
    wrapper.vm.acceptSuggestion({ value: 'renvoyé' })
    expect(html()).toBe('<p>Le paramètre est renvoyé.</p>')
    expect(lastValue(wrapper)).toBe('<p>Le paramètre est renvoyé.</p>')
  })

  const MISTAKE = { message: 'Faute d’accord possible', replacements: [{ value: 'renvoyé' }], rule: { issueType: 'misspelling' } }

  it('shows the LanguageTool menu only while a reported mistake is selected (not for any selected text)', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Le paramètre est renvoyer.</p>' })
    expect(wrapper.vm.showLanguageToolMenu()).toBe(false)
    selectText(editor(), 'paramètre est')
    expect(wrapper.vm.showLanguageToolMenu()).toBe(false) // Selected text without mistake
    editor().storage.languagetool.match.value = MISTAKE
    expect(wrapper.vm.showLanguageToolMenu()).toBe(true)
    editor().setEditable(false)
    expect(wrapper.vm.showLanguageToolMenu()).toBe(false) // Read only: no suggestion to apply
  })

  it('proposes the selected word to ignore: pending until approved by an administrator', async () => {
    const notify = vi.spyOn(Notify, 'create').mockImplementation(() => {})
    const propose = vi.spyOn(SpellcheckService, 'proposeWord').mockResolvedValue({ data: { datas: { word: 'renvoyer', status: 'pending' } } })
    const clear = vi.spyOn(SpellcheckService, 'clearCache')
    wrapper = await mountEditor({ modelValue: '<p>Le paramètre est renvoyer.</p>' })
    selectText(editor(), 'renvoyer')
    editor().storage.languagetool.match.value = MISTAKE
    await flushPromises()
    expect(wrapper.vm.ignorableWord).toBe('renvoyer')
    wrapper.vm.proposeIgnoredWord()
    await flushPromises()
    expect(propose).toHaveBeenCalledWith('renvoyer')
    expect(clear).not.toHaveBeenCalled()
    expect(notify.mock.calls[0][0].message).toBe('"renvoyer" proposed: it will be ignored once approved by an administrator')
    expect(editor().state.selection.empty).toBe(true) // Menu closed
  })

  it('ignores at once the word proposed by an administrator: approved words loaded again, document checked again', async () => {
    vi.spyOn(Notify, 'create').mockImplementation(() => {})
    vi.spyOn(SpellcheckService, 'proposeWord').mockResolvedValue({ data: { datas: { word: 'renvoyer', status: 'approved' } } })
    const clear = vi.spyOn(SpellcheckService, 'clearCache')
    wrapper = await mountEditor({ modelValue: '<p>Le paramètre est renvoyer.</p>' })
    const proofread = vi.spyOn(editor().storage.languagetool, 'proofreadAndDecorateWholeDoc')
    selectText(editor(), 'renvoyer')
    editor().storage.languagetool.match.value = MISTAKE
    await flushPromises()
    wrapper.vm.proposeIgnoredWord()
    await flushPromises()
    expect(clear).toHaveBeenCalled()
    expect(proofread).toHaveBeenCalled()
  })

  it('does not propose a selection of several words, nor without the permission', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Le paramètre est renvoyer.</p>' })
    selectText(editor(), 'est renvoyer')
    editor().storage.languagetool.match.value = MISTAKE
    await flushPromises()
    expect(wrapper.vm.ignorableWord).toBeNull()
    UserService.user = { username: 'viewer', roles: ['audits:read'] }
    selectText(editor(), 'renvoyer')
    editor().storage.languagetool.match.value = { ...MISTAKE }
    await flushPromises()
    expect(wrapper.vm.ignorableWord).toBeNull()
  })

  it('notifies the error of a proposal', async () => {
    const notify = vi.spyOn(Notify, 'create').mockImplementation(() => {})
    vi.spyOn(SpellcheckService, 'proposeWord').mockRejectedValue({ response: { data: { datas: 'Insufficient privileges' } } })
    wrapper = await mountEditor({ modelValue: '<p>Le paramètre est renvoyer.</p>' })
    selectText(editor(), 'renvoyer')
    editor().storage.languagetool.match.value = MISTAKE
    await flushPromises()
    wrapper.vm.proposeIgnoredWord()
    await flushPromises()
    expect(notify.mock.calls[0][0]).toMatchObject({ message: 'Insufficient privileges', color: 'negative' })
  })

  it('checks the document again when the auto correction is toggled, until unmounted', async () => {
    wrapper = await mountEditor({ modelValue: '<p>Texte</p>' })
    const update = vi.spyOn(editor().storage.languagetool, 'updateLanguageToolState')
    window.dispatchEvent(new Event('autoCorrectionToggleChanged'))
    expect(update).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    wrapper = null
    await flushPromises()
    window.dispatchEvent(new Event('autoCorrectionToggleChanged'))
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('sends the text to the spell check of the backend when the auto correction is enabled (LanguageTool not exposed)', async () => {
    sessionStorage.setItem('autoCorrectionEnabled', 'true')
    api.post.mockResolvedValue({ data: { datas: { matches: [] } } })
    wrapper = await mountEditor({ modelValue: '<p>Un texte a vérifier</p>' })
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('spellcheck/check', { text: 'Un texte a vérifier', language: 'auto' }), { timeout: 2000 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not check the texts without the permission', async () => {
    sessionStorage.setItem('autoCorrectionEnabled', 'true')
    wrapper = await mountEditor({ modelValue: '<p>Un texte a vérifier</p>' }, { user: { username: 'viewer', id: 'u2', roles: ['audits:read'] } })
    await wait(800)
    expect(api.post).not.toHaveBeenCalledWith('spellcheck/check', expect.anything())
  })
})

describe('collaboration', () => {
  const AUDIT_ROUTE = { params: { auditId: 'a1', findingId: 'f1' } }
  const mountCollab = (props = {}, route = AUDIT_ROUTE) =>
    mountEditor({ modelValue: '<p>Initial</p>', idUnique: 'basiceditor_description', collab: true, ...props }, { route })
  const synced = async (provider = providers[0]) => {
    provider.connectAndSync()
    await wait(600) // The editor checks the connection every 500 ms
    await flushPromises()
  }

  it('connects to the document of the audit with the field of the finding', async () => {
    wrapper = await mountCollab()
    expect(providers).toHaveLength(1)
    const { options } = providers[0]
    expect(options.name).toBe('a1')
    expect(JSON.parse(options.token())).toEqual({ init: {} }) // Ids of the initial contents (none before the synchronization)
    expect(options.url).toBe(`wss://${window.location.hostname}${window.location.port ? ':' + window.location.port : ''}/collab/`)
    expect(wrapper.vm.fullId).toBe('a1-f1-basiceditor_description')
    await synced()
    expect(options.document.getXmlFragment('a1-f1-basiceditor_description').length).toBe(1)
  })

  it('uses the unique id as document outside of the audits (first dash replaced)', async () => {
    wrapper = await mountCollab({ idUnique: '64ab12-description' }, { params: {} })
    expect(providers[0].options.name).toBe('64ab12/description')
    expect(wrapper.vm.fullId).toBe('64ab12-description')
  })

  it('stays read-only until the shared document is connected and synced, then loads the initial value', async () => {
    wrapper = await mountCollab()
    await wait(100)
    expect(editor().isEditable).toBe(false)
    expect(emitted('ready')).toHaveLength(0)
    expect(wrapper.vm.status).toBe('connecting')
    await synced()
    expect(wrapper.vm.status).toBe('connected')
    expect(html()).toBe('<p>Initial</p>')
    expect(editor().isEditable).toBe(true)
    expect(emitted('ready')).toHaveLength(1)
    expect(emitted('editorchange')).toHaveLength(0)
  })

  it('keeps the content of the shared document edited by another user', async () => {
    wrapper = await mountCollab()
    const other = new Editor({ element: document.createElement('div'), extensions: [StarterKit.configure({ undoRedo: false }), Collaboration.configure({ document: providers[0].options.document, field: 'a1-f1-basiceditor_description' })] })
    setInitialCollaborativeContent(other, '<p>Texte partagé en cours d’édition</p>')
    await synced()
    expect(html()).toBe('<p>Texte partagé en cours d’édition</p>')
    expect(emitted('ready')).toHaveLength(1)
    other.destroy()
  })

  it('shares the changes in the Yjs document', async () => {
    wrapper = await mountCollab()
    await synced()
    const other = new Editor({ element: document.createElement('div'), extensions: [StarterKit.configure({ undoRedo: false }), Collaboration.configure({ document: providers[0].options.document, field: 'a1-f1-basiceditor_description' })] })
    expect(other.getHTML()).toBe('<p>Initial</p>')
    editor().commands.insertContentAt(editor().state.doc.content.size - 1, ' modifié')
    expect(other.getHTML()).toBe('<p>Initial modifié</p>')
    other.destroy()
  })

  it('stays read-only after the synchronization when it is not editable (audit in review)', async () => {
    wrapper = await mountCollab({ editable: false })
    await synced()
    expect(html()).toBe('<p>Initial</p>')
    expect(editor().isEditable).toBe(false)
  })

  it('shows the caret of the user with its color', async () => {
    wrapper = await mountCollab()
    expect(providers[0].awareness.getLocalState().user).toEqual({ name: 'ann', color: wrapper.vm.stringToColour('ann') })
  })

  it('gives a stable color to each user', async () => {
    wrapper = await mountEditor({ modelValue: '' })
    const { stringToColour } = wrapper.vm
    expect(stringToColour('ann')).toMatch(/^#[0-9a-f]{6}$/)
    expect(stringToColour('ann')).toBe(stringToColour('ann'))
    expect(stringToColour('bob')).not.toBe(stringToColour('ann'))
    expect(stringToColour('')).toBe('#000000')
    expect(stringToColour('Élodie 漢字')).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('closes the connection and destroys the editor when unmounted', async () => {
    wrapper = await mountCollab()
    await synced()
    const tiptap = editor()
    wrapper.unmount()
    wrapper = null
    await flushPromises()
    expect(providers[0].destroy).toHaveBeenCalledTimes(1)
    expect(tiptap.isDestroyed).toBe(true)
  })

  it('stops waiting for the collaboration when unmounted: nothing read nor written when the connection arrives', async () => {
    wrapper = await mountCollab()
    const tiptap = editor()
    const getHTML = vi.spyOn(tiptap, 'getHTML')
    wrapper.unmount()
    wrapper = null
    providers[0].connectAndSync()
    await wait(700)
    expect(tiptap.isDestroyed).toBe(true)
    expect(getHTML).not.toHaveBeenCalled()
  })

  it('closes the connection when unmounted before being connected (server unreachable)', async () => {
    wrapper = await mountCollab()
    wrapper.unmount()
    wrapper = null
    await wait(300)
    expect(providers[0].destroy).toHaveBeenCalledTimes(1)
  })
})
