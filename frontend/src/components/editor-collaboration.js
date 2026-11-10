// Collaborative editors (TipTap v3, Yjs documents shared with Hocuspocus)
import { createDocument } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { yUndoPluginKey, ySyncPluginKey, prosemirrorToYXmlFragment } from '@tiptap/y-tiptap'
import * as Y from 'yjs'

// Origin of the Yjs transaction writing the initial content: not tracked by the undo manager of the collaboration
const INITIAL_CONTENT_ORIGIN = 'pwndoc-initial-content'

// Map of the shared document keeping, for each field initialized by a client, the client id of its initial content
// ('init:<field>'): the server refuses a client whose copy of a field was initialized from another value of the database
// (the merge would duplicate the content), see initialContentIds
const META_MAP = 'pwndoc'
const INIT_PREFIX = 'init:'

// Registration of plugins (bubble menus) on a Vue editor: the Vue editor (@tiptap/vue-3) updates its reactive state
// after the reconfiguration of the view, but the plugin views created during the reconfiguration dispatch transactions
// (rendering of the collaboration from Yjs), applied to the previous state. The editor and its view then have different
// plugins: each following transaction recreates the plugin views, the collaboration renders the editor again from Yjs
// (changes not yet in Yjs are lost) and destroys its undo manager. The reactive state is set before the reconfiguration.
export function fixPluginRegistration(editor) {
  if (!editor || !editor.reactiveState) return
  const reconfigure = (plugins) => {
    const state = editor.view.state.reconfigure({ plugins })
    editor.reactiveState.value = state
    editor.view.updateState(state)
    editor.reactiveState.value = editor.view.state
    return editor.view.state
  }
  editor.registerPlugin = (plugin, handlePlugins) => {
    const current = [...editor.view.state.plugins]
    return reconfigure(typeof handlePlugins === 'function' ? handlePlugins(plugin, current) : [...current, plugin])
  }
  editor.unregisterPlugin = (nameOrPluginKey) => {
    if (editor.isDestroyed) return undefined
    const current = editor.view.state.plugins
    let plugins = current
    ;[].concat(nameOrPluginKey).forEach((key) => {
      const prefix = typeof key === 'string' ? `${key}$` : key instanceof PluginKey ? key.key : key
      plugins = plugins.filter((plugin) => !plugin.key.startsWith(prefix))
    })
    return plugins.length === current.length ? undefined : reconfigure(plugins)
  }
}

// 32-bit FNV-1a hash of the UTF-16 code units of a string
export function fnv1a32(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

// Yjs client id of the initial content of a field: the same content written in the same field always gets the same id
export function initialContentClientId(field, doc) {
  return fnv1a32(`${field}\u0000${JSON.stringify(doc.toJSON())}`)
}

// Name of a root type of a Yjs document (shared fields are root XML fragments named after the editor)
function rootTypeName(type) {
  for (const [name, root] of type.doc.share)
    if (root === type) return name
  return null
}

// Client ids of the initial contents of the fields of a Yjs document: {field: clientId}, sent with the authentication
export function initialContentIds(ydoc) {
  const ids = {}
  ydoc.getMap(META_MAP).forEach((value, key) => {
    if (key.startsWith(INIT_PREFIX)) ids[key.slice(INIT_PREFIX.length)] = value
  })
  return ids
}

// Initial content of a collaborative editor, written in the shared Yjs document (not as an editor change, not
// undoable) once the document is synchronized. Content set with setContent could be lost when the collaboration renders
// the editor again from Yjs before the change reached Yjs.
// The shared documents are not loaded by the server: each client writes the value of the database in an empty field.
// The content is built in a temporary document whose client id depends only on the field and the content: clients
// writing the same content (users opening the finding at the same time, client reconnecting after the server reloaded
// the document, editors left before their synchronization) produce the same Yjs items, kept once by Yjs (no duplicate).
// A field with content, even an empty paragraph (text cleared by a user), is kept as it is.
// The client id of the initial content is kept in the meta map of the document, written in the temporary document with
// the client id of the content: everything is applied in one update, without any item of the local client (a local item
// in a transaction applying an update makes Yjs believe that another client uses the id of the document: it changes it,
// the awareness keeps the old one and the own caret of the user is shown as another user, typing misplaced).
// Returns false when the editor is not bound to a Yjs document (content set in the editor, not undoable).
export function setInitialCollaborativeContent(editor, html) {
  const syncState = ySyncPluginKey.getState(editor.view.state)
  if (!syncState || !syncState.type || !syncState.type.doc) {
    editor.chain().setContent(html || '', { emitUpdate: false }).setMeta('addToHistory', false).run()
    return false
  }
  const fragment = syncState.type
  const doc = createDocument(html || '', editor.schema)
  if (fragment.length > 0 || doc.eq(doc.type.createAndFill())) return true // Shared content kept, empty value not written
  const field = rootTypeName(fragment)
  const initial = new Y.Doc()
  initial.clientID = initialContentClientId(field, doc)
  initial.transact(() => {
    prosemirrorToYXmlFragment(doc, initial.getXmlFragment(field))
    initial.getMap(META_MAP).set(INIT_PREFIX + field, initial.clientID)
  })
  Y.applyUpdate(fragment.doc, Y.encodeStateAsUpdate(initial), INITIAL_CONTENT_ORIGIN)
  initial.destroy()
  return true
}

// Safety net: TipTap Collaboration restores the undo manager of the collaboration when the plugin views are recreated,
// but loses track of it when the views are destroyed several times in a row: undone changes could no longer be redone.
// The undo manager must track its own transactions (default of Yjs) to fill the redo stack. Called on each transaction.
export function keepUndoManagerTracking(editor) {
  if (!editor || editor.isDestroyed) return
  const undoState = yUndoPluginKey.getState(editor.view.state)
  const undoManager = undoState && undoState.undoManager
  if (undoManager && !undoManager.trackedOrigins.has(undoManager))
    undoManager.addTrackedOrigin(undoManager)
}
