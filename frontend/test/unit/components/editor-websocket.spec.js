// components/editor.vue + editor-collaboration.js: loading of the collaborative editors through the websocket, with
// fake timers and a fake Hocuspocus provider driven by the test (connection, synchronization, disconnection).
// The collaboration server is simulated by Yjs documents kept in memory, as the backend does (no persistence:
// backend/src/app.js), with an optional network latency. The content of the API must never be lost, overwritten or
// duplicated, whatever the speed of the websocket.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import * as Y from 'yjs'
import { getSchema, createDocument, getHTMLFromFragment } from '@tiptap/core'
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'

vi.mock('boot/axios', () => import('../../helpers/api-mock'))

// Fake Hocuspocus provider: same events as @hocuspocus/provider v4 ('status' connected / disconnected, 'synced' only
// emitted with state true, 'connect', 'disconnect', 'authenticationFailed'). connect(server) opens the connection, sends
// the token (authentication: a copy of a field initialized from another value of the database is refused), synchronizes
// the documents (sync steps), then the updates are relayed both ways while connected. A destroyed provider does not
// connect anymore.
const collab = vi.hoisted(() => ({ providers: [] }))
vi.mock('@hocuspocus/provider', async () => {
  const Y = await import('yjs')
  const { Awareness } = await import('y-protocols/awareness')
  class HocuspocusProvider {
    constructor(options) {
      this.options = options
      this.document = options.document
      this.handlers = {}
      this.awareness = new Awareness(options.document)
      this.connected = false
      this.destroyed = false
      this.destroy = vi.fn(() => {
        this.disconnect()
        this.destroyed = true
      })
      collab.providers.push(this)
    }
    on(event, handler) {
      (this.handlers[event] = this.handlers[event] || []).push(handler)
      return this
    }
    off(event, handler) {
      this.handlers[event] = (this.handlers[event] || []).filter((h) => h !== handler)
      return this
    }
    emit(event, payload) { (this.handlers[event] || []).forEach((handler) => handler(payload)) }
    connect(server, { sync = true, readOnly = false } = {}) {
      if (this.destroyed) return
      this.server = server
      this.connected = true
      this.emit('connect')
      this.emit('status', { status: 'connected' })
      const token = typeof this.options.token === 'function' ? this.options.token() : this.options.token
      let init = {}
      try { init = JSON.parse(token).init || {} } catch (error) { init = {} }
      if (server.isStale(this.options.name, init)) {
        this.emit('authenticationFailed', { reason: 'stale-document' })
        return
      }
      this.remote = server.doc(this.options.name)
      this.readOnly = readOnly
      if (sync) this.sync()
    }
    // Sync steps: missing updates exchanged, then live updates relayed (with the latency of the server)
    sync() {
      const remote = this.remote
      const later = (fn) => (this.server.latency ? setTimeout(fn, this.server.latency) : fn())
      Y.applyUpdate(this.document, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(this.document)), 'server')
      if (!this.readOnly) Y.applyUpdate(remote, Y.encodeStateAsUpdate(this.document, Y.encodeStateVector(remote)), this)
      this.toServer = (update, origin) => {
        if (origin !== 'server' && !this.readOnly) later(() => this.connected && Y.applyUpdate(remote, update, this))
      }
      this.fromServer = (update, origin) => {
        if (origin !== this) later(() => this.connected && Y.applyUpdate(this.document, update, 'server'))
      }
      this.document.on('update', this.toServer)
      remote.on('update', this.fromServer)
      this.emit('synced', { state: true })
    }
    disconnect() {
      if (!this.connected) return
      this.connected = false
      if (this.toServer) {
        this.document.off('update', this.toServer)
        this.remote.off('update', this.fromServer)
        this.toServer = this.fromServer = null
      }
      this.emit('status', { status: 'disconnected' })
      this.emit('disconnect', { event: {} })
    }
  }
  return { HocuspocusProvider }
})

// Initial content written in the shared document: spied (the editor must not write over the content)
vi.mock('components/editor-collaboration', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, setInitialCollaborativeContent: vi.fn(original.setInitialCollaborativeContent) }
})

import { api, resetApi } from '../../helpers/api-mock'
import Utils from '@/services/utils'
import { setInitialCollaborativeContent, initialContentClientId } from 'components/editor-collaboration'
import { contentExtensions } from 'components/editor-extensions'
import { mountEditor, polyfillLayout, fetchNoMatch, waitBubbleMenuTimers } from '../../helpers/editor-component'
import { mockNotify } from '../../helpers/quasar'

// Collaboration server: one Yjs document per room (audit), kept in memory
class FakeServer {
  constructor() {
    this.docs = new Map()
    this.latency = 0
  }
  doc(name) {
    if (!this.docs.has(name)) this.docs.set(name, new Y.Doc())
    return this.docs.get(name)
  }
  restart() { this.docs = new Map() } // Documents lost (no persistence)
  init(name, field = FIELD) { return this.docs.has(name) ? this.docs.get(name).getMap('pwndoc').get(`init:${field}`) : undefined }
  // Authentication (backend/src/app.js): a loaded document refuses a copy whose field was initialized with another id
  isStale(name, init) {
    return this.docs.has(name) && Object.entries(init).some(([field, id]) => {
      const current = this.init(name, field)
      return current !== undefined && current !== id
    })
  }
}

const schema = getSchema(contentExtensions({ collab: true }))
const ROOM = 'a1'
const ROUTE = { params: { auditId: ROOM, findingId: 'f1' } }
const FIELD = 'a1-f1-basiceditor_description'
const VALUE = '<p>Description de l’API — « injection » 🔒</p>'
const TEXT = 'Description de l’API'

let server
let wrappers
let unmounted

const advance = (ms) => vi.advanceTimersByTimeAsync(ms)
const count = (html, text) => html.split(text).length - 1
const fragment = (field = FIELD, room = ROOM) => server.doc(room).getXmlFragment(field)
const serverHTML = (field = FIELD, room = ROOM) => getHTMLFromFragment(yXmlFragmentToProseMirrorRootNode(fragment(field, room), schema).content, schema)
const html = (wrapper) => wrapper.vm.editor.getHTML()
const values = (wrapper) => (wrapper.emitted('update:modelValue') || []).map(([value]) => value)
const provider = (wrapper) => wrapper.vm.provider

// Content written in the shared document by another user (or the server)
function writeOnServer(content, field = FIELD, room = ROOM) {
  const doc = server.doc(room)
  doc.transact(() => prosemirrorToYXmlFragment(createDocument(content, schema), doc.getXmlFragment(field)), 'other-user')
}

// Collaborative editor of the description of finding f1 (editors of the finding page: idUnique and route of the finding)
async function openEditor(props = {}, { user = 'ann', route = ROUTE } = {}) {
  const wrapper = await mountEditor(
    { modelValue: VALUE, idUnique: 'basiceditor_description', collab: true, ...props },
    { route, user: { username: user, id: user, roles: '*' } }
  )
  wrappers.push(wrapper)
  return wrapper
}

function leave(wrapper) {
  wrapper.unmount()
  unmounted.add(wrapper)
}

// Transactions changing the document of the editor (content written by the editor or received)
function trackChanges(wrapper) {
  const changes = []
  wrapper.vm.editor.on('transaction', ({ transaction }) => { if (transaction.docChanged) changes.push(transaction) })
  return changes
}

beforeAll(polyfillLayout)
afterAll(waitBubbleMenuTimers)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  resetApi()
  sessionStorage.setItem('autoCorrectionEnabled', 'false') // No LanguageTool request
  vi.stubGlobal('fetch', fetchNoMatch())
  vi.spyOn(console, 'log').mockImplementation(() => {})
  setInitialCollaborativeContent.mockClear()
  server = new FakeServer()
  wrappers = []
  unmounted = new Set()
})
afterEach(async () => {
  wrappers.filter((wrapper) => !unmounted.has(wrapper)).forEach((wrapper) => wrapper.unmount())
  await advance(1000)
  collab.providers.forEach((p) => p.awareness.destroy())
  collab.providers.splice(0)
  vi.useRealTimers()
})

describe('websocket never connected', () => {
  it('stays read-only without writing over the value of the page, the state shown (server not answering)', async () => {
    const wrapper = await openEditor()
    const changes = trackChanges(wrapper)
    await advance(100500)
    expect(wrapper.vm.editor.isEditable).toBe(false)
    expect(wrapper.vm.initialeDataUpdated).toBe(false)
    expect(wrapper.emitted('ready')).toBeUndefined()
    expect(values(wrapper)).toEqual([]) // Never an empty value
    expect(wrapper.props('modelValue')).toBe(VALUE)
    expect(setInitialCollaborativeContent).not.toHaveBeenCalled()
    expect(changes).toHaveLength(0) // No setContent
    expect(provider(wrapper).document.getXmlFragment(FIELD).length).toBe(0) // Nothing to push at a later connection
    expect(wrapper.find('.editor-loading').exists()).toBe(false) // Not loading forever
    expect(wrapper.find('.editor-unavailable').text()).toContain(wrapper.vm.$t('editorCollabUnreachable'))
    expect(wrapper.find('.editor-preview').text()).toBe('Description de l’API — « injection » 🔒')
    expect(wrapper.find('.editor').attributes('aria-busy')).toBe('false')
  })

  it('gives nothing to the page synchronizing its editors (save, navigation) during the wait', async () => {
    const wrapper = await openEditor({ noSync: true })
    await advance(3000)
    Utils.syncEditors({ basiceditor_description: wrapper.vm })
    expect(values(wrapper)).toEqual([])
  })

  it('connection after a long wait: the shared document and the value of the page are not overwritten', async () => {
    writeOnServer('<p>Texte partagé</p>')
    const wrapper = await openEditor()
    await advance(101000)
    provider(wrapper).connect(server)
    await advance(2000)
    expect(html(wrapper)).toBe('<p>Texte partagé</p>')
    expect(serverHTML()).toBe('<p>Texte partagé</p>')
    expect(values(wrapper)).not.toContain('')
    expect(wrapper.find('.editor-loading').exists()).toBe(false)
  })

  it('connection after the end of the wait (> 100 s): loads the value and becomes editable', async () => {
    const wrapper = await openEditor()
    await advance(101000)
    provider(wrapper).connect(server)
    await advance(1000)
    expect(wrapper.vm.editor.isEditable).toBe(true)
    expect(html(wrapper)).toBe(VALUE)
    expect(wrapper.emitted('ready')).toHaveLength(1)
  })
})

describe('slow or fast websocket', () => {
  it.each([0, 300, 1000, 2750, 10000, 60000, 99000])('connected after %i ms: loads the value of the page in the empty shared document', async (delay) => {
    const wrapper = await openEditor()
    await advance(delay)
    expect(wrapper.vm.editor.isEditable).toBe(false)
    provider(wrapper).connect(server)
    await advance(600)
    expect(html(wrapper)).toBe(VALUE)
    expect(serverHTML()).toBe(VALUE)
    expect(fragment().length).toBe(1)
    expect(wrapper.vm.editor.isEditable).toBe(true)
    expect(wrapper.emitted('ready')).toHaveLength(1)
    expect(wrapper.emitted('editorchange')).toBeUndefined()
    expect(values(wrapper).every((value) => value === VALUE)).toBe(true)
  })

  it.each([300, 5000])('shared document already filled (connected after %i ms): shows it, the value of the API is not injected again', async (delay) => {
    writeOnServer('<p>Texte en cours d’édition par Bob</p><p>Second paragraphe</p>')
    const wrapper = await openEditor()
    await advance(delay)
    provider(wrapper).connect(server)
    await advance(600)
    expect(html(wrapper)).toBe('<p>Texte en cours d’édition par Bob</p><p>Second paragraphe</p>')
    expect(serverHTML()).toBe('<p>Texte en cours d’édition par Bob</p><p>Second paragraphe</p>')
    expect(count(serverHTML(), TEXT)).toBe(0)
    expect(wrapper.vm.editor.isEditable).toBe(true)
    expect(values(wrapper)).not.toContain('')
  })

  // The collaboration binding writes the editor in the shared field only once its document differs from the default
  // empty one (y-tiptap): the transactions of the page before the synchronization (clicks, selection, comments
  // highlights, carets of the other users) must not fill the field, which would prevent the initial content
  it('writes nothing in the shared field before the synchronization, whatever the transactions of the editor', async () => {
    const wrapper = await openEditor()
    const editor = wrapper.vm.editor
    editor.commands.focus()
    editor.commands.setTextSelection(1)
    editor.view.dispatch(editor.state.tr.setMeta('pwndoc-test', true))
    const other = new (provider(wrapper).awareness.constructor)(new Y.Doc())
    other.setLocalStateField('user', { name: 'bob', color: '#000000' })
    const { encodeAwarenessUpdate, applyAwarenessUpdate } = await import('y-protocols/awareness')
    applyAwarenessUpdate(provider(wrapper).awareness, encodeAwarenessUpdate(other, [other.clientID]), 'server')
    await advance(1000)
    expect(provider(wrapper).document.getXmlFragment(FIELD).length).toBe(0)
    other.destroy()
    provider(wrapper).connect(server)
    await advance(100)
    expect(serverHTML()).toBe(VALUE)
    expect(fragment().length).toBe(1)
  })

  it('connected but not yet synced: waits for the synchronization before loading anything', async () => {
    writeOnServer('<p>Contenu du serveur</p>')
    const wrapper = await openEditor()
    provider(wrapper).connect(server, { sync: false })
    await advance(3000)
    expect(wrapper.vm.status).toBe('connected')
    expect(wrapper.vm.editor.isEditable).toBe(false)
    expect(setInitialCollaborativeContent).not.toHaveBeenCalled()
    provider(wrapper).sync()
    await advance(600)
    expect(html(wrapper)).toBe('<p>Contenu du serveur</p>')
    expect(count(serverHTML(), TEXT)).toBe(0)
  })

  it('loads the content of the code blocks and unicode texts through the shared document unchanged', async () => {
    const value = '<p>Requête « GET » — 漢字</p><pre><code class="language-sql">SELECT * FROM users;\nDROP TABLE x;</code></pre>'
    const wrapper = await openEditor({ modelValue: value })
    provider(wrapper).connect(server)
    await advance(600)
    expect(wrapper.vm.editor.getText()).toContain('SELECT * FROM users;\nDROP TABLE x;')
    expect(serverHTML()).toBe('<p>Requête « GET » — 漢字</p><pre><code class="language-sql">SELECT * FROM users;\nDROP TABLE x;</code></pre>')
  })
})

describe('value of the page arriving after the editor', () => {
  it('value received during the wait (empty at first): loaded once in the shared document', async () => {
    const wrapper = await openEditor({ modelValue: '' })
    await advance(1000)
    await wrapper.setProps({ modelValue: VALUE })
    await advance(200)
    provider(wrapper).connect(server)
    await advance(1000)
    expect(html(wrapper)).toBe(VALUE)
    expect(serverHTML()).toBe(VALUE)
    expect(values(wrapper)).not.toContain('')
  })

  it.each([2100, 2300])('value changed during the wait (connected at %i ms): loaded once, never duplicated', async (connectAt) => {
    const wrapper = await openEditor({ modelValue: '<p>Ancienne valeur</p>' })
    await advance(1200)
    await wrapper.setProps({ modelValue: '<p>Nouvelle valeur</p>' })
    await advance(connectAt - 1200)
    provider(wrapper).connect(server)
    await advance(1500)
    expect(fragment().length).toBe(1)
    expect(html(wrapper)).toBe(serverHTML())
  })

  it('value changed during the wait: the last value is loaded', async () => {
    const wrapper = await openEditor({ modelValue: '<p>Ancienne valeur</p>' })
    await advance(1200)
    await wrapper.setProps({ modelValue: '<p>Nouvelle valeur</p>' })
    await advance(1100) // Connected at 2300 ms: the loop of the old value checks first (2500 ms)
    provider(wrapper).connect(server)
    await advance(1500)
    expect(html(wrapper)).toBe('<p>Nouvelle valeur</p>')
    expect(wrapper.props('modelValue')).toBe('<p>Nouvelle valeur</p>')
    expect(wrapper.emitted('ready')).toHaveLength(1)
  })

  it('empty value then value of the page after the synchronization (emptyInitialValue): loaded once', async () => {
    const wrapper = await openEditor({ modelValue: '' })
    provider(wrapper).connect(server)
    await advance(600)
    expect(wrapper.vm.emptyInitialValue).toBe(true)
    expect(wrapper.vm.editor.isEditable).toBe(true)
    await wrapper.setProps({ modelValue: VALUE })
    await flushPromises()
    expect(html(wrapper)).toBe(VALUE)
    expect(serverHTML()).toBe(VALUE)
    expect(wrapper.emitted('editorchange')).toBeUndefined()
  })

  it('empty value, shared document filled by another user before the value of the page: not overwritten', async () => {
    const wrapper = await openEditor({ modelValue: '' })
    provider(wrapper).connect(server)
    await advance(600)
    writeOnServer('<p>Saisie de Bob</p>')
    await advance(100)
    await wrapper.setProps({ modelValue: VALUE })
    await flushPromises()
    expect(html(wrapper)).toBe('<p>Saisie de Bob</p>')
    expect(serverHTML()).toBe('<p>Saisie de Bob</p>')
  })

  it('empty value then text typed by the user before the value of the page: not overwritten', async () => {
    const wrapper = await openEditor({ modelValue: '' })
    provider(wrapper).connect(server)
    await advance(600)
    wrapper.vm.editor.commands.insertContent('Saisie')
    wrapper.vm.editor.commands.insertContent(' rapide')
    await wrapper.setProps({ modelValue: VALUE })
    await flushPromises()
    expect(html(wrapper)).toBe('<p>Saisie rapide</p>')
    expect(serverHTML()).toBe('<p>Saisie rapide</p>')
  })

  it('field cleared by another user: the old value of the API is not injected again', async () => {
    writeOnServer('<p></p>')
    expect(fragment().length).toBe(1)
    const wrapper = await openEditor()
    provider(wrapper).connect(server)
    await advance(600)
    expect(serverHTML()).toBe('<p></p>')
    expect(html(wrapper)).toBe('<p></p>')
  })
})

describe('several users and restart of the collaboration server', () => {
  it('second user opening the page later: gets the content of the first one, nothing injected again', async () => {
    const ann = await openEditor({}, { user: 'ann' })
    provider(ann).connect(server)
    await advance(600)
    ann.vm.editor.commands.insertContentAt(ann.vm.editor.state.doc.content.size - 1, ' (modifiée)')
    const bob = await openEditor({}, { user: 'bob' }) // Value of the API: not saved by ann
    provider(bob).connect(server)
    await advance(600)
    expect(html(bob)).toBe('<p>Description de l’API — « injection » 🔒 (modifiée)</p>')
    expect(count(serverHTML(), TEXT)).toBe(1)
  })

  it('shares the changes of the users of the same finding (field named with the finding and idUnique)', async () => {
    const ann = await openEditor({}, { user: 'ann' })
    const bob = await openEditor({}, { user: 'bob' })
    provider(ann).connect(server)
    await advance(600)
    provider(bob).connect(server)
    await advance(600)
    ann.vm.editor.commands.insertContentAt(1, 'Ann: ')
    expect(html(bob)).toContain('Ann: Description')
  })

  // Both write the same initial content (same Yjs items, see editor-collaboration.js), kept once
  it('two users opening the same finding at the same time: the value is loaded once', async () => {
    server.latency = 50
    const ann = await openEditor({}, { user: 'ann' })
    const bob = await openEditor({}, { user: 'bob' })
    provider(ann).connect(server)
    provider(bob).connect(server)
    await advance(1000)
    expect(fragment().length).toBe(1)
    expect(count(html(ann), TEXT)).toBe(1)
    expect(count(html(bob), TEXT)).toBe(1)
  })

  it('collaboration server restarted while a user edits: its content is restored once at the reconnection', async () => {
    const ann = await openEditor({}, { user: 'ann' })
    provider(ann).connect(server)
    await advance(600)
    ann.vm.editor.commands.insertContentAt(ann.vm.editor.state.doc.content.size - 1, ' (non enregistrée)')
    provider(ann).disconnect()
    server.restart()
    await advance(3000)
    provider(ann).connect(server)
    await advance(600)
    expect(serverHTML()).toBe('<p>Description de l’API — « injection » 🔒 (non enregistrée)</p>')
    expect(html(ann)).toBe(serverHTML())
  })

  // Same value of the database: same initial content (same Yjs items and init id), the copy of ann is accepted and merged
  it('collaboration server restarted: a user opening the finding before the reconnection of another does not duplicate the content, the unsaved text is kept', async () => {
    const ann = await openEditor({}, { user: 'ann' })
    provider(ann).connect(server)
    await advance(600)
    ann.vm.editor.commands.insertContentAt(ann.vm.editor.state.doc.content.size - 1, ' (non enregistrée)')
    provider(ann).disconnect()
    server.restart()
    const bob = await openEditor({}, { user: 'bob' })
    provider(bob).connect(server)
    await advance(600)
    provider(ann).connect(server)
    await advance(600)
    expect(fragment().length).toBe(1)
    expect(count(serverHTML(), TEXT)).toBe(1)
    expect(serverHTML()).toBe('<p>Description de l’API — « injection » 🔒 (non enregistrée)</p>')
    expect(html(bob)).toBe(serverHTML())
  })

  it('read-only user (reviewer): its connection does not write in the shared document', async () => {
    const reviewer = await openEditor({ editable: false }, { user: 'rita' })
    provider(reviewer).connect(server, { readOnly: true })
    await advance(600)
    expect(html(reviewer)).toBe(VALUE)
    expect(fragment().length).toBe(0)
    const author = await openEditor({}, { user: 'ann' })
    provider(author).connect(server)
    await advance(600)
    expect(serverHTML()).toBe(VALUE)
  })

  it('reviewer opening the finding before the author: sees the content once', async () => {
    const reviewer = await openEditor({ editable: false }, { user: 'rita' })
    provider(reviewer).connect(server, { readOnly: true })
    await advance(600)
    const author = await openEditor({}, { user: 'ann' })
    provider(author).connect(server)
    await advance(600)
    expect(count(html(reviewer), TEXT)).toBe(1)
  })

  // Editor of the sections page with its stable idUnique (P0-2, sections.html: without idUnique the field was a random
  // uuid, never shared): field named with the section, as the fields of the findings
  it('two users of the same section share its text', async () => {
    const route = { params: { auditId: ROOM, sectionId: 's1' } }
    const props = { modelValue: '<p>Synthèse</p>', collab: true, noSync: true, idUnique: 's1-section-text' }
    const ann = await mountEditor(props, { route, user: { username: 'ann', id: 'ann' } })
    const bob = await mountEditor(props, { route, user: { username: 'bob', id: 'bob' } })
    expect(ann.vm.fullId).toBe('a1-s1-s1-section-text')
    wrappers.push(ann, bob)
    provider(ann).connect(server)
    provider(bob).connect(server)
    await advance(1000)
    ann.vm.editor.commands.insertContentAt(1, 'Ann: ')
    expect(html(bob)).toBe('<p>Ann: Synthèse</p>')
    expect(serverHTML('a1-s1-s1-section-text')).toBe('<p>Ann: Synthèse</p>')
  })
})

describe('disconnection and reconnection during the edition', () => {
  it('keeps the changes made while disconnected and merges them with the changes of the others', async () => {
    const ann = await openEditor({}, { user: 'ann' })
    const bob = await openEditor({}, { user: 'bob' })
    provider(ann).connect(server)
    await advance(600)
    provider(bob).connect(server)
    await advance(600)
    provider(ann).disconnect()
    expect(ann.vm.editor.isEditable).toBe(true)
    ann.vm.editor.commands.insertContentAt(ann.vm.editor.state.doc.content.size - 1, ' hors ligne')
    bob.vm.editor.commands.insertContentAt(1, 'Bob: ')
    expect(html(bob)).not.toContain('hors ligne')
    await advance(5000)
    provider(ann).connect(server)
    await advance(600)
    const merged = '<p>Bob: Description de l’API — « injection » 🔒 hors ligne</p>'
    expect(html(ann)).toBe(merged)
    expect(html(bob)).toBe(merged)
    expect(serverHTML()).toBe(merged)
    expect(values(ann).at(-1)).toBe(merged)
    expect(ann.emitted('ready')).toHaveLength(1) // Nothing loaded again at the reconnection
  })

  it('disconnected and reconnected during the wait (before the first synchronization): loads the value once', async () => {
    writeOnServer('<p>Déjà partagé</p>')
    const wrapper = await openEditor()
    provider(wrapper).connect(server, { sync: false })
    await advance(200)
    provider(wrapper).disconnect()
    await advance(1500)
    provider(wrapper).connect(server)
    await advance(600)
    expect(html(wrapper)).toBe('<p>Déjà partagé</p>')
    expect(count(serverHTML(), TEXT)).toBe(0)
  })

  // Hocuspocus does not emit 'synced' with false on a disconnection: the editor resets its synchronized state itself
  it('reconnected before the initialization: waits for the new synchronization (no duplicate)', async () => {
    const wrapper = await openEditor()
    provider(wrapper).connect(server) // Empty shared document
    await advance(200)
    provider(wrapper).disconnect() // Before the check of the editor (500 ms)
    writeOnServer('<p>Écrit par Bob pendant la coupure</p>')
    await advance(100)
    provider(wrapper).connect(server, { sync: false }) // Status connected, synchronization in progress
    await advance(300)
    provider(wrapper).sync()
    await advance(600)
    expect(html(wrapper)).toBe('<p>Écrit par Bob pendant la coupure</p>')
    expect(count(serverHTML(), TEXT)).toBe(0)
  })

  it('leaving the page while disconnected destroys the editor and closes the provider', async () => {
    const wrapper = await openEditor()
    provider(wrapper).connect(server)
    await advance(600)
    provider(wrapper).disconnect()
    const tiptap = wrapper.vm.editor
    const p = provider(wrapper)
    leave(wrapper)
    await advance(1000)
    expect(p.destroy).toHaveBeenCalledTimes(1)
    expect(tiptap.isDestroyed).toBe(true)
  })
})

describe('editor destroyed while waiting for the websocket (fast navigation)', () => {
  it('never connected: no error and nothing written after leaving the page', async () => {
    const wrapper = await openEditor()
    const p = provider(wrapper)
    await advance(300)
    leave(wrapper)
    await advance(101000)
    expect(p.document.getXmlFragment(FIELD).length).toBe(0)
    expect(setInitialCollaborativeContent).not.toHaveBeenCalled()
    expect(values(wrapper)).toEqual([])
  })

  it('finding left for another one during the wait: the new finding gets only its own content', async () => {
    const first = await openEditor({ modelValue: '<p>Finding 1</p>' })
    await advance(300)
    leave(first) // The old editor never connects
    const second = await openEditor({ modelValue: '<p>Finding 2</p>' }, { route: { params: { auditId: ROOM, findingId: 'f2' } } })
    provider(second).connect(server)
    await advance(600)
    expect(html(second)).toBe('<p>Finding 2</p>')
    expect(serverHTML('a1-f2-basiceditor_description')).toBe('<p>Finding 2</p>')
    expect(fragment('a1-f1-basiceditor_description').length).toBe(0)
  })

  it('initialized editor left: closes the provider, destroys the editor and removes its window listeners', async () => {
    const wrapper = await openEditor()
    provider(wrapper).connect(server)
    await advance(600)
    const tiptap = wrapper.vm.editor
    const p = provider(wrapper)
    const remove = vi.spyOn(window, 'removeEventListener')
    leave(wrapper)
    await advance(200)
    expect(p.destroy).toHaveBeenCalledTimes(1)
    expect(tiptap.isDestroyed).toBe(true)
    expect(remove).toHaveBeenCalledWith('autoCorrectionToggleChanged', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function), true)
    // Changes of the others are no longer received
    writeOnServer('<p>Après le départ</p>')
    expect(tiptap.isDestroyed).toBe(true)
  })

  it('left during the wait: closes the provider and removes the listeners without waiting for the connection', async () => {
    const wrapper = await openEditor()
    const p = provider(wrapper)
    const remove = vi.spyOn(window, 'removeEventListener')
    await advance(300)
    leave(wrapper)
    await advance(1000)
    expect(p.destroy).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith('autoCorrectionToggleChanged', expect.any(Function))
  })

  it('connection arriving after leaving the page: no error, nothing written', async () => {
    const wrapper = await openEditor()
    const tiptap = wrapper.vm.editor
    const getHTML = vi.spyOn(tiptap, 'getHTML')
    const p = provider(wrapper)
    await advance(50)
    leave(wrapper)
    await advance(1410) // Connected at 1460 ms: the loop checks at 1500 ms, beforeUnmount at 1550 ms
    p.connect(server)
    await advance(1000)
    expect(getHTML).not.toHaveBeenCalled()
    expect(fragment().length).toBe(0)
    expect(wrapper.emitted('ready')).toBeUndefined()
  })

  it('image uploaded after the editor was destroyed: nothing inserted, no error', async () => {
    vi.useRealTimers()
    let resolveUpload
    api.post.mockImplementation(() => new Promise((resolve) => { resolveUpload = resolve }))
    vi.spyOn(Utils, 'resizeImg').mockResolvedValue('data:image/png;base64,iVBORw0KGgo=')
    const wrapper = await mountEditor({ modelValue: '<p>Preuve</p>', collab: false })
    wrappers.push(wrapper)
    const tiptap = wrapper.vm.editor
    wrapper.vm.importImage([new File([new Uint8Array([137, 80, 78, 71])], 'poc.png', { type: 'image/png' })])
    await vi.waitFor(() => expect(api.post).toHaveBeenCalled())
    leave(wrapper)
    await flushPromises()
    resolveUpload({ data: { datas: { _id: '6aef2c3a3b1d4e5f60718293' } } })
    await flushPromises()
    expect(tiptap.isDestroyed).toBe(true)
    expect(values(wrapper).some((value) => value.includes('6aef2c3a3b1d4e5f60718293'))).toBe(false)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  })
})

describe('ids of the initial contents (authentication of the copies)', () => {
  const token = (wrapper) => JSON.parse(provider(wrapper).options.token())

  it('keeps the id of the initial content of the field and sends the ids with the authentication', async () => {
    const wrapper = await openEditor()
    expect(token(wrapper)).toEqual({ init: {} })
    provider(wrapper).connect(server)
    await advance(100)
    const id = server.init(ROOM)
    expect(id).toBe(initialContentClientId(FIELD, createDocument(VALUE, schema)))
    expect(token(wrapper)).toEqual({ init: { [FIELD]: id } })
  })

  it('field filled by another user: its id is kept and sent', async () => {
    const ann = await openEditor({}, { user: 'ann' })
    provider(ann).connect(server)
    await advance(100)
    const bob = await openEditor({ modelValue: '<p>Autre valeur</p>' }, { user: 'bob' })
    provider(bob).connect(server)
    await advance(100)
    expect(html(bob)).toBe(VALUE)
    expect(token(bob)).toEqual({ init: { [FIELD]: server.init(ROOM) } })
  })

  it('copy initialized from an older value of the database refused: the shared document is loaded again, the user notified, nothing duplicated', async () => {
    const notify = mockNotify()
    const ann = await openEditor({}, { user: 'ann' })
    provider(ann).connect(server)
    await advance(100)
    provider(ann).disconnect()
    ann.vm.editor.commands.insertContentAt(ann.vm.editor.state.doc.content.size - 1, ' (non partagé)')
    server.restart() // Document unloaded, then initialized again from the value saved since
    const bob = await openEditor({ modelValue: '<p>Version enregistrée par Bob</p>' }, { user: 'bob' })
    provider(bob).connect(server)
    await advance(100)
    const stale = provider(ann)
    stale.connect(server)
    await flushPromises()
    expect(stale.destroy).toHaveBeenCalledTimes(1)
    expect(provider(ann)).not.toBe(stale)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ message: ann.vm.$t('editorDocumentReloaded'), color: 'warning' }))
    expect(ann.find('.editor-loading').exists()).toBe(true)
    expect(token(ann)).toEqual({ init: {} })
    provider(ann).connect(server)
    await advance(100)
    expect(html(ann)).toBe('<p>Version enregistrée par Bob</p>')
    expect(serverHTML()).toBe('<p>Version enregistrée par Bob</p>')
    expect(fragment().length).toBe(1)
    expect(ann.vm.editor.isEditable).toBe(true)
    expect(token(ann)).toEqual({ init: { [FIELD]: server.init(ROOM) } })
  })

  it('other fields initialized meanwhile: the copy is accepted (no conflict on its fields)', async () => {
    const ann = await openEditor({}, { user: 'ann' })
    provider(ann).connect(server)
    await advance(100)
    provider(ann).disconnect()
    server.restart()
    const observation = await openEditor({ modelValue: '<p>Observation</p>', idUnique: 'basiceditor_observation' }, { user: 'bob' })
    provider(observation).connect(server)
    await advance(100)
    provider(ann).connect(server)
    await advance(100)
    expect(provider(ann).destroy).not.toHaveBeenCalled()
    expect(serverHTML()).toBe(VALUE)
    expect(serverHTML('a1-f1-basiceditor_observation')).toBe('<p>Observation</p>')
  })

  it('document not loaded on the server: the copy of a lone user seeds it (no loss after a network drop)', async () => {
    const ann = await openEditor()
    provider(ann).connect(server)
    await advance(100)
    const id = server.init(ROOM)
    provider(ann).disconnect()
    ann.vm.editor.commands.insertContentAt(ann.vm.editor.state.doc.content.size - 1, ' (hors ligne)')
    server.restart()
    provider(ann).connect(server)
    await advance(100)
    expect(serverHTML()).toBe('<p>Description de l’API — « injection » 🔒 (hors ligne)</p>')
    expect(server.init(ROOM)).toBe(id)
  })
})

describe('collaboration server not answering', () => {
  it('shows the state after the delay with the value of the page read-only, then loads once synchronized', async () => {
    const wrapper = await openEditor()
    await advance(14000)
    expect(wrapper.find('.editor-loading').exists()).toBe(true)
    await advance(1100)
    expect(wrapper.find('.editor-loading').exists()).toBe(false)
    expect(wrapper.find('.editor-unavailable').text()).toContain(wrapper.vm.$t('editorCollabUnreachable'))
    expect(wrapper.find('.editor-preview').text()).toBe('Description de l’API — « injection » 🔒')
    expect(wrapper.vm.editor.isEditable).toBe(false)
    expect(provider(wrapper).destroy).not.toHaveBeenCalled() // The provider keeps trying
    expect(fragment().length).toBe(0)
    provider(wrapper).connect(server)
    await flushPromises()
    expect(wrapper.find('.editor-unavailable').exists()).toBe(false)
    expect(wrapper.find('.editor-preview').exists()).toBe(false)
    expect(html(wrapper)).toBe(VALUE)
    expect(serverHTML()).toBe(VALUE)
    expect(wrapper.vm.editor.isEditable).toBe(true)
  })

  it('page still loading its value (shared document synchronized): not reported as not answering', async () => {
    const wrapper = await openEditor({ modelValue: '', loading: true })
    provider(wrapper).connect(server)
    await advance(20000)
    expect(wrapper.find('.editor-unavailable').exists()).toBe(false)
    expect(wrapper.find('.editor-loading').exists()).toBe(true)
  })

  it('synchronized before the delay: never reported', async () => {
    const wrapper = await openEditor()
    await advance(5000)
    provider(wrapper).connect(server)
    await advance(20000)
    expect(wrapper.find('.editor-unavailable').exists()).toBe(false)
  })
})

describe('duplicated custom fields (imported data)', () => {
  it('two editors of the same field with different values: both loaded, no exception, one content', async () => {
    const props = { idUnique: 'cf1-custom-f1' }
    const first = await openEditor({ ...props, modelValue: '<p>Valeur 1</p>' })
    const second = await openEditor({ ...props, modelValue: '<p>Valeur 2</p>' })
    provider(first).connect(server)
    provider(second).connect(server)
    await advance(100)
    expect(first.emitted('ready')).toHaveLength(1)
    expect(second.emitted('ready')).toHaveLength(1)
    expect(html(first)).toBe('<p>Valeur 1</p>')
    expect(html(second)).toBe('<p>Valeur 1</p>')
    expect(serverHTML('a1-f1-cf1-custom-f1')).toBe('<p>Valeur 1</p>')
  })
})

describe('connection state shown to the user', () => {
  it('shows the disconnection while editing, hidden once connected again', async () => {
    const wrapper = await openEditor()
    provider(wrapper).connect(server)
    await advance(100)
    expect(wrapper.find('.editor-disconnected').exists()).toBe(false)
    provider(wrapper).disconnect()
    await flushPromises()
    expect(wrapper.find('.editor-disconnected').text()).toBe(wrapper.vm.$t('editorDisconnected'))
    expect(wrapper.vm.editor.isEditable).toBe(true) // Changes kept locally
    provider(wrapper).connect(server)
    await flushPromises()
    expect(wrapper.find('.editor-disconnected').exists()).toBe(false)
  })

  it('non collaborative editors: no connection state', async () => {
    const wrapper = await mountEditor({ modelValue: VALUE, collab: false })
    wrappers.push(wrapper)
    expect(wrapper.find('.editor-disconnected').exists()).toBe(false)
    expect(wrapper.find('.editor-loading').exists()).toBe(false)
  })
})

describe('value of the page loading (loading prop)', () => {
  it('waits for the value of the page: read-only, nothing written in the shared document, then loads the last value', async () => {
    const wrapper = await openEditor({ modelValue: '', loading: true })
    provider(wrapper).connect(server)
    await advance(1000)
    expect(wrapper.vm.initialeDataUpdated).toBe(false)
    expect(wrapper.vm.editor.isEditable).toBe(false)
    expect(wrapper.find('.editor-loading').exists()).toBe(true)
    expect(fragment().length).toBe(0)
    await wrapper.setProps({ modelValue: VALUE, loading: false })
    await flushPromises()
    expect(html(wrapper)).toBe(VALUE)
    expect(serverHTML()).toBe(VALUE)
    expect(wrapper.vm.editor.isEditable).toBe(true)
    expect(wrapper.emitted('ready')).toHaveLength(1)
    expect(wrapper.emitted('editorchange')).toBeUndefined()
  })

  it('page loaded before the synchronization: initialized once synchronized', async () => {
    const wrapper = await openEditor({ modelValue: '', loading: true })
    await wrapper.setProps({ modelValue: VALUE, loading: false })
    expect(wrapper.vm.initialeDataUpdated).toBe(false)
    provider(wrapper).connect(server)
    await flushPromises()
    expect(html(wrapper)).toBe(VALUE)
    expect(fragment().length).toBe(1)
  })

  it('shared document filled by another user while the page loads: its content is kept', async () => {
    const wrapper = await openEditor({ modelValue: '', loading: true })
    provider(wrapper).connect(server)
    writeOnServer('<p>Saisie de Bob</p>')
    await advance(300)
    await wrapper.setProps({ modelValue: VALUE, loading: false })
    await flushPromises()
    expect(html(wrapper)).toBe('<p>Saisie de Bob</p>')
    expect(count(serverHTML(), TEXT)).toBe(0)
  })
})

describe('fast navigation between the findings', () => {
  // Editors left before their synchronization are destroyed: they never write in the shared document
  it('back and forth before the synchronization (A → B → A): content of the finding written once', async () => {
    const left = []
    for (const findingId of ['f1', 'f2', 'f1', 'f2']) {
      const wrapper = await openEditor({ modelValue: `<p>Contenu de ${findingId}</p>` }, { route: { params: { auditId: ROOM, findingId } } })
      await advance(200)
      left.push(provider(wrapper))
      leave(wrapper)
    }
    const shown = await openEditor({ modelValue: '<p>Contenu de f1</p>' })
    left.forEach((p) => p.connect(server)) // Late messages of the editors left
    provider(shown).connect(server)
    await advance(1000)
    expect(left.every((p) => p.destroy.mock.calls.length === 1)).toBe(true)
    expect(serverHTML()).toBe('<p>Contenu de f1</p>')
    expect(html(shown)).toBe('<p>Contenu de f1</p>')
    expect(fragment('a1-f2-basiceditor_description').length).toBe(0)
  })
})

describe('non collaborative editors (collab: false)', () => {
  const VULN_ROUTE = { params: {} }

  it('no websocket and no wait: editable at once', async () => {
    const wrapper = await mountEditor({ modelValue: VALUE, collab: false, idUnique: '64ab12cd-description' }, { route: VULN_ROUTE })
    wrappers.push(wrapper)
    expect(collab.providers).toHaveLength(0)
    expect(wrapper.vm.editor.isEditable).toBe(true)
    expect(wrapper.emitted('ready')).toHaveLength(1)
    expect(html(wrapper)).toBe(VALUE)
  })

  it.each([0, 2000, 30000])('value received %i ms after an empty initialization: loaded without change event', async (delay) => {
    const wrapper = await mountEditor({ modelValue: '', collab: false, idUnique: 'undefined-description' }, { route: VULN_ROUTE })
    wrappers.push(wrapper)
    await advance(delay)
    const before = values(wrapper).length // ('' emitted at the loading of the empty value: unchanged)
    await wrapper.setProps({ modelValue: VALUE })
    await flushPromises()
    expect(html(wrapper)).toBe(VALUE)
    expect(wrapper.emitted('editorchange')).toBeUndefined()
    expect(values(wrapper).slice(before)).not.toContain('')
  })

  it('late value after text typed by the user: not overwritten', async () => {
    const wrapper = await mountEditor({ modelValue: '', collab: false }, { route: VULN_ROUTE })
    wrappers.push(wrapper)
    wrapper.vm.editor.commands.insertContent('Saisie rapide')
    await flushPromises()
    await wrapper.setProps({ modelValue: VALUE })
    await flushPromises()
    expect(html(wrapper)).toBe('<p>Saisie rapide</p>')
  })
})
