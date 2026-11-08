// Collaborative editors (TipTap v3 + Yjs): initial content written in the shared document, undo / redo after the
// plugin views are recreated (bubble menus registering their plugin)
import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import * as Y from 'yjs'

import { fixPluginRegistration, setInitialCollaborativeContent, keepUndoManagerTracking } from 'components/editor-collaboration'

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

  it('replaces an empty shared content (empty paragraph)', () => {
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
