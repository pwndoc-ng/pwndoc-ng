// Extensions defining the content of the editors (schema and HTML stored in the database, read by the report
// generator): shared by the editor component and the tests of the HTML format
import StarterKit from '@tiptap/starter-kit' // Includes Link and Underline (TipTap v3)
import Highlight from '@tiptap/extension-highlight'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { Table, TableCell, TableRow, TableHeader } from '@tiptap/extension-table'
import { columnResizing } from '@tiptap/pm/tables'

import CustomImage from './editor-image'
import { Figure } from './figure'
import Caption from './editor-caption'

import css from 'highlight.js/lib/languages/css'
import js from 'highlight.js/lib/languages/javascript'
import http from 'highlight.js/lib/languages/http'
import ts from 'highlight.js/lib/languages/typescript'
import html from 'highlight.js/lib/languages/xml'
import bash from 'highlight.js/lib/languages/bash'
import sql from 'highlight.js/lib/languages/sql'
import json from 'highlight.js/lib/languages/json'
import { all, createLowlight } from 'lowlight'

// Syntax highlighting of the code blocks
export const lowlight = createLowlight(all)
lowlight.register('html', html)
lowlight.register('css', css)
lowlight.register('javascripts', js)
lowlight.register('ts', ts)
lowlight.register('http', http)
lowlight.register('bash', bash)
lowlight.register('sql', sql)
lowlight.register('json', json)

// Tables with resizable columns, also in the editors created read-only and made editable once their content is loaded
// (editor component): the table extension only adds the column resizing to the editors editable at their creation
// (issue #266). Resizing is inactive while the editor is read-only (checked by ProseMirror).
export const ResizableTable = Table.extend({
  addProseMirrorPlugins() {
    const plugins = this.parent?.() || []
    if (!this.options.resizable || this.editor.isEditable) return plugins
    return [
      columnResizing({
        handleWidth: this.options.handleWidth,
        cellMinWidth: this.options.cellMinWidth,
        defaultCellMinWidth: this.options.cellMinWidth,
        View: this.options.View,
        lastColumnResizable: this.options.lastColumnResizable,
      }),
      ...plugins,
    ]
  },
  // Table view of the column resizing plugin
  addNodeView() {
    return this.options.resizable ? null : this.parent?.()
  },
})

// collab: undo / redo provided by the collaboration (Yjs)
// codeBlock: code block extension (the editor component adds its node view, same schema)
export function contentExtensions({ collab = false, codeBlock = CodeBlockLowlight.configure({ lowlight }) } = {}) {
  return [
    StarterKit.configure({
      codeBlock: false, // Code blocks with syntax highlighting
      link: {
        protocols: ['ftp', 'mailto'],
        linkOnPaste: false,
        openOnClick: false,
      },
      trailingNode: false, // Not in TipTap v2: would add an empty paragraph after tables, images and code blocks
      undoRedo: collab ? false : undefined,
    }),
    Highlight.configure({
      multicolor: true,
    }),
    codeBlock,
    ResizableTable.configure({
      resizable: true,
    }),
    TableRow,
    TableHeader,
    TableCell,
    CustomImage.configure({
      HTMLAttributes: {
        class: 'custom-image',
      },
      allowBase64: true,
    }),
    Figure,
    Caption, // <legend label alt>: captions inserted with the labels of the settings
  ]
}
