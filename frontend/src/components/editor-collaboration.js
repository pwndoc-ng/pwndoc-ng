// Collaborative editors (TipTap v3, Yjs documents shared with Hocuspocus)
import { createDocument } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { yUndoPluginKey, ySyncPluginKey, prosemirrorToYXmlFragment } from '@tiptap/y-tiptap'

// Origin of the Yjs transaction writing the initial content: not tracked by the undo manager of the collaboration
const INITIAL_CONTENT_ORIGIN = 'pwndoc-initial-content'

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

// Initial content of a collaborative editor whose shared document is empty: written in the Yjs document (not as an
// editor change, not undoable). Content set with setContent could be lost when the collaboration renders the editor
// again from Yjs before the change reached Yjs.
// Returns false when the editor is not bound to a Yjs document (content set in the editor).
export function setInitialCollaborativeContent(editor, html) {
  const syncState = ySyncPluginKey.getState(editor.view.state)
  if (!syncState || !syncState.type || !syncState.type.doc) {
    editor.commands.setContent(html || '', { emitUpdate: false })
    return false
  }
  const fragment = syncState.type
  fragment.doc.transact(() => {
    prosemirrorToYXmlFragment(createDocument(html || '', editor.schema), fragment)
  }, INITIAL_CONTENT_ORIGIN)
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
