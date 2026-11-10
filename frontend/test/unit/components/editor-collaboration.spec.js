// Collaborative editors (TipTap v3 + Yjs): initial content written in the shared document, undo / redo after the
// plugin views are recreated (bubble menus registering their plugin)
import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import * as Y from 'yjs'

import { createDocument } from '@tiptap/core'
import { fixPluginRegistration, setInitialCollaborativeContent, keepUndoManagerTracking, fnv1a32, initialContentClientId, initialContentIds } from 'components/editor-collaboration'

const editors = []

function collaborativeEditor(ydoc = new Y.Doc(), field = 'field') {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ undoRedo: false, trailingNode: false }),
      Collaboration.configure({ document: ydoc, field: field })
    ]
  })
  fixPluginRegistration(editor) // As the editor component
  editors.push(editor)
  return editor
}

// Plugins registered after the creation of the editor, like the bubble menus (the plugin views are recreated)
function registerPlugins(editor, count = 2) {
  for (let i = 0; i < count; i++)
    editor.registerPlugin(new Plugin({ key: new PluginKey(`menu${i}`), view: () => ({}) }))
}

const undoManager = (editor) => yUndoPluginKey.getState(editor.view.state).undoManager
const appendText = (editor, text) => editor.commands.insertContentAt(editor.view.state.doc.content.size - 1, text)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
})

describe('setInitialCollaborativeContent', () => {
  it('writes the content in the shared Yjs document and shows it in the editor', () => {
    const ydoc = new Y.Doc()
    const editor = collaborativeEditor(ydoc)
    expect(setInitialCollaborativeContent(editor, '<p>Description <strong>initiale</strong></p><ul><li><p>point</p></li></ul>')).toBe(true)

    expect(editor.getHTML()).toBe('<p>Description <strong>initiale</strong></p><ul><li><p>point</p></li></ul>')
    expect(ydoc.getXmlFragment('field').length).toBe(2)

    // Another client of the document receives the content
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(ydoc))
    const otherEditor = collaborativeEditor(other)
    expect(otherEditor.getHTML()).toBe(editor.getHTML())
  })

  it('keeps the content when plugins are registered (editor rendered again from Yjs)', () => {
    const editor = collaborativeEditor()
    registerPlugins(editor)
    setInitialCollaborativeContent(editor, '<p>Contenu initial</p>')
    registerPlugins(editor, 2)
    editor.commands.setTextSelection(1)
    expect(editor.getHTML()).toBe('<p>Contenu initial</p>')
  })

  it('writes nothing for an empty value, then the value arriving later', () => {
    const editor = collaborativeEditor()
    setInitialCollaborativeContent(editor, '')
    expect(editor.getHTML()).toBe('<p></p>')
    setInitialCollaborativeContent(editor, '<p>Valeur arrivée plus tard</p>')
    expect(editor.getHTML()).toBe('<p>Valeur arrivée plus tard</p>')
  })

  it('is not an undoable change of the user', () => {
    const editor = collaborativeEditor()
    setInitialCollaborativeContent(editor, '<p>Contenu initial</p>')
    expect(undoManager(editor).undoStack.length).toBe(0)
  })

  it('sets the content in the editor when it is not collaborative, without update event', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit] })
    editors.push(editor)
    const onUpdate = vi.fn()
    editor.on('update', onUpdate)
    expect(setInitialCollaborativeContent(editor, '<p>Sans collaboration</p>')).toBe(false)
    expect(editor.getHTML()).toBe('<p>Sans collaboration</p>')
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

describe('deterministic initial content (shared documents not loaded by the server)', () => {
  const sync = (from, to) => Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)))
  const VALUE = '<p>Description <strong>enregistrée</strong> — « 漢字 »</p><ul><li><p>point</p></li></ul>'

  it('same content written by two clients in the same field: same Yjs items, kept once', () => {
    const [ann, bob] = [new Y.Doc(), new Y.Doc()]
    setInitialCollaborativeContent(collaborativeEditor(ann), VALUE)
    setInitialCollaborativeContent(collaborativeEditor(bob), VALUE)
    sync(ann, bob)
    sync(bob, ann)
    expect(ann.getXmlFragment('field').length).toBe(2)
    expect(Y.encodeStateAsUpdate(ann)).toEqual(Y.encodeStateAsUpdate(bob))
    const merged = collaborativeEditor(ann)
    expect(merged.getHTML()).toBe(VALUE)
  })

  it('client reconnecting with its copy after the server reloaded the document from the same value: not duplicated', () => {
    const ann = new Y.Doc()
    const annEditor = collaborativeEditor(ann)
    setInitialCollaborativeContent(annEditor, VALUE)
    annEditor.commands.insertContentAt(1, 'Ann: ') // Not saved
    const reloaded = new Y.Doc() // Server restarted: Bob writes the value of the database again
    setInitialCollaborativeContent(collaborativeEditor(reloaded), VALUE)
    sync(ann, reloaded)
    sync(reloaded, ann)
    expect(collaborativeEditor(reloaded).getHTML()).toBe('<p>Ann: Description <strong>enregistrée</strong> — « 漢字 »</p><ul><li><p>point</p></li></ul>')
  })

  it('keeps a field with content, even an empty paragraph (text cleared by a user)', () => {
    const ydoc = new Y.Doc()
    const editor = collaborativeEditor(ydoc)
    setInitialCollaborativeContent(editor, '<p>Texte</p>')
    editor.commands.clearContent()
    expect(editor.getHTML()).toBe('<p></p>')
    setInitialCollaborativeContent(editor, '<p>Ancienne valeur</p>')
    expect(editor.getHTML()).toBe('<p></p>')
    expect(ydoc.getXmlFragment('field').length).toBe(1)
  })

  it.each(['', '<p></p>', null])('writes nothing for the empty value %j', (value) => {
    const ydoc = new Y.Doc()
    setInitialCollaborativeContent(collaborativeEditor(ydoc), value)
    expect(ydoc.getXmlFragment('field').length).toBe(0)
  })

  it('client id: 32-bit FNV-1a of the field, a NUL character and the JSON of the content', () => {
    // Reference values of the algorithm (also used by the tests of the backend emulating the clients)
    expect(fnv1a32('')).toBe(0x811c9dc5)
    expect(fnv1a32('a')).toBe(0xe40c292c)
    expect(fnv1a32('foobar')).toBe(0xbf9cf968)
    const editor = collaborativeEditor()
    const doc = createDocument('<p>Texte</p>', editor.schema)
    expect(initialContentClientId('a1-f1-basiceditor_description', doc)).toBe(fnv1a32(`a1-f1-basiceditor_description\u0000${JSON.stringify(doc.toJSON())}`))
    expect(initialContentClientId('a1-f2-basiceditor_description', doc)).not.toBe(initialContentClientId('a1-f1-basiceditor_description', doc))
    expect(initialContentClientId('a1-f1-basiceditor_description', createDocument('<p>Texte.</p>', editor.schema))).not.toBe(initialContentClientId('a1-f1-basiceditor_description', doc))
  })

  it('items of the initial content written with the client id of the content', () => {
    const ydoc = new Y.Doc()
    const editor = collaborativeEditor(ydoc, 'a1-f1-basiceditor_description')
    setInitialCollaborativeContent(editor, '<p>Texte</p>')
    const expected = initialContentClientId('a1-f1-basiceditor_description', createDocument('<p>Texte</p>', editor.schema))
    // Items of the field written by the client id of the content (the meta map entry is written by the client of the document)
    expect(ydoc.getXmlFragment('a1-f1-basiceditor_description').toArray().map((node) => node._item.id.client)).toEqual([expected])
  })

  it('keeps the client id of the initial content of the field in the meta map, in the same transaction', () => {
    const ydoc = new Y.Doc()
    const editor = collaborativeEditor(ydoc, 'a1-f1-basiceditor_description')
    const origins = []
    ydoc.on('afterTransaction', (transaction) => origins.push(transaction.origin))
    setInitialCollaborativeContent(editor, '<p>Texte</p>')
    expect(origins).toEqual(['pwndoc-initial-content'])
    const expected = initialContentClientId('a1-f1-basiceditor_description', createDocument('<p>Texte</p>', editor.schema))
    expect(ydoc.getMap('pwndoc').get('init:a1-f1-basiceditor_description')).toBe(expected)
    expect(initialContentIds(ydoc)).toEqual({ 'a1-f1-basiceditor_description': expected })
  })

  // A local item in a transaction applying an update makes Yjs believe that another client uses the client id of the
  // document: it changes it ("[yjs] Changed the client-id"), the awareness keeps the old one (own caret shown as another
  // user, typing misplaced)
  it('keeps the client id of the document (entry of the meta map written with the client id of the content)', () => {
    const ydoc = new Y.Doc()
    const clientID = ydoc.clientID
    const editor = collaborativeEditor(ydoc, 'a1-f1-basiceditor_description')
    setInitialCollaborativeContent(editor, '<p>Texte</p>')
    expect(ydoc.clientID).toBe(clientID)
    const expected = initialContentClientId('a1-f1-basiceditor_description', createDocument('<p>Texte</p>', editor.schema))
    expect(ydoc.getMap('pwndoc')._map.get('init:a1-f1-basiceditor_description').id.client).toBe(expected)
  })

  it('writes no id when nothing is written (field with content, empty value)', () => {
    const ydoc = new Y.Doc()
    const editor = collaborativeEditor(ydoc)
    setInitialCollaborativeContent(editor, '')
    expect(initialContentIds(ydoc)).toEqual({})
    editor.commands.insertContent('Saisie')
    setInitialCollaborativeContent(editor, '<p>Valeur</p>')
    expect(initialContentIds(ydoc)).toEqual({})
  })

  it('ids of the initial contents of all the fields of the document, other keys ignored', () => {
    const ydoc = new Y.Doc()
    setInitialCollaborativeContent(collaborativeEditor(ydoc, 'f-description'), '<p>a</p>')
    setInitialCollaborativeContent(collaborativeEditor(ydoc, 'f-observation'), '<p>b</p>')
    ydoc.getMap('pwndoc').set('other', 1)
    expect(Object.keys(initialContentIds(ydoc)).sort()).toEqual(['f-description', 'f-observation'])
  })

  it('not undoable in an editor without collaboration (loaded value)', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit] })
    editors.push(editor)
    setInitialCollaborativeContent(editor, '<p>Valeur chargée</p>')
    editor.commands.undo()
    expect(editor.getHTML()).toBe('<p>Valeur chargée</p>')
  })
})

describe('fixPluginRegistration', () => {
  it('changes made right after a plugin registration are kept', async () => {
    const editor = collaborativeEditor()
    setInitialCollaborativeContent(editor, '<p>Texte</p>')
    registerPlugins(editor, 2)
    appendText(editor, ' un')
    registerPlugins(editor, 1)
    appendText(editor, ' deux')
    expect(editor.getText()).toBe('Texte un deux')
    expect(editor.state).toBe(editor.view.state) // Reactive state of the Vue editor and state of the view
    await wait(50)
    expect(editor.getHTML()).toBe('<p>Texte un deux</p>')
  })

  it('registered plugins are kept by the following transactions', () => {
    const editor = collaborativeEditor()
    registerPlugins(editor, 2)
    appendText(editor, 'x')
    const keys = editor.view.state.plugins.map((plugin) => plugin.key)
    // Plugin keys are unique: menu0$, menu0$1...
    expect(keys.some((key) => key.startsWith('menu0$'))).toBe(true)
    expect(keys.some((key) => key.startsWith('menu1$'))).toBe(true)
    expect(editor.state.plugins).toBe(editor.view.state.plugins)
  })

  it('plugins can be unregistered by name or key', () => {
    const editor = collaborativeEditor()
    const key = new PluginKey('removable')
    editor.registerPlugin(new Plugin({ key }))
    registerPlugins(editor, 1)
    expect(editor.unregisterPlugin(key)).toBeDefined()
    expect(editor.unregisterPlugin('menu0')).toBeDefined()
    expect(editor.unregisterPlugin('absent')).toBeUndefined()
    expect(editor.view.state.plugins.some((plugin) => /^(removable|menu0)\$/.test(plugin.key))).toBe(false)
    expect(editor.state).toBe(editor.view.state)
  })

  it('does nothing on editors without reactive state', () => {
    expect(() => fixPluginRegistration(null)).not.toThrow()
    expect(() => fixPluginRegistration({})).not.toThrow()
  })
})

describe('keepUndoManagerTracking', () => {
  it('undone changes can be redone after the plugin views were recreated several times', async () => {
    const editor = collaborativeEditor()
    editor.on('transaction', () => keepUndoManagerTracking(editor))
    setInitialCollaborativeContent(editor, '<p>Texte</p>')
    registerPlugins(editor, 3)

    appendText(editor, ' un')
    await wait(600) // New undo step (capture timeout of 500 ms)
    appendText(editor, ' deux')
    expect(editor.getText()).toBe('Texte un deux')

    editor.commands.undo()
    expect(editor.getText()).toBe('Texte un')
    expect(undoManager(editor).redoStack.length).toBe(1)
    editor.commands.redo()
    expect(editor.getText()).toBe('Texte un deux')
    editor.commands.undo()
    editor.commands.undo()
    expect(editor.getText()).toBe('Texte')
  })

  it('tracks the undo manager again when it was lost', () => {
    const editor = collaborativeEditor()
    const manager = undoManager(editor)
    manager.trackedOrigins.delete(manager)
    keepUndoManagerTracking(editor)
    expect(manager.trackedOrigins.has(manager)).toBe(true)
  })

  it('does nothing for editors without collaboration or destroyed', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit] })
    expect(() => keepUndoManagerTracking(editor)).not.toThrow()
    editor.destroy()
    expect(() => keepUndoManagerTracking(editor)).not.toThrow()
    expect(() => keepUndoManagerTracking(null)).not.toThrow()
  })
})
