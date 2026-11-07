import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

// Review comments on passages of a text field.
// A passage is stored as a text quote ({exact, prefix, suffix}) and highlighted with decorations:
// the document (HTML saved, Yjs collaboration) is never modified, read-only users can comment.

const CONTEXT_LENGTH = 32

// Plain text of the document with the position of each character (blocks separated by '\n')
export function docTextIndex(doc) {
  let text = ''
  const positions = []
  doc.descendants((node, pos) => {
    if (node.isText) {
      for (let i = 0; i < node.text.length; i++) {
        text += node.text[i]
        positions.push(pos + i)
      }
    }
    else if (node.isBlock && text.length > 0 && text[text.length - 1] !== '\n') {
      text += '\n'
      positions.push(null)
    }
    return true
  })
  return { text, positions }
}

// Text quote of the range [from, to[ of the document
export function quoteFromRange(doc, from, to) {
  const index = docTextIndex(doc)
  let start = index.positions.findIndex(pos => pos !== null && pos >= from)
  if (start < 0) return null
  let end = start
  while (end < index.positions.length && (index.positions[end] === null || index.positions[end] < to))
    end++
  const exact = index.text.substring(start, end)
  if (!exact.trim()) return null
  return {
    exact: exact,
    prefix: index.text.substring(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: index.text.substring(end, end + CONTEXT_LENGTH)
  }
}

// Document range of a quote: occurrence whose context matches best, null if the text is no longer present
export function findQuote(index, quote) {
  if (!quote || !quote.exact) return null
  let best = null
  let bestScore = -1
  let start = index.text.indexOf(quote.exact)
  while (start >= 0) {
    const end = start + quote.exact.length
    let score = 0
    const prefix = quote.prefix || ''
    const suffix = quote.suffix || ''
    while (score < prefix.length && index.text[start - 1 - score] === prefix[prefix.length - 1 - score]) score++
    let suffixScore = 0
    while (suffixScore < suffix.length && index.text[end + suffixScore] === suffix[suffixScore]) suffixScore++
    score += suffixScore
    if (score > bestScore) {
      bestScore = score
      best = { start, end }
    }
    start = index.text.indexOf(quote.exact, start + 1)
  }
  if (!best) return null
  const startPos = index.positions.slice(best.start, best.end).find(pos => pos !== null)
  const endPos = [...index.positions.slice(best.start, best.end)].reverse().find(pos => pos !== null)
  if (startPos === undefined || endPos === undefined) return null
  return { from: startPos, to: endPos + 1 }
}

export const commentHighlightKey = new PluginKey('commentHighlight')

function buildDecorations(doc, comments, activeId) {
  if (!comments || comments.length === 0) return DecorationSet.empty
  const index = docTextIndex(doc)
  const decorations = []
  comments.forEach(comment => {
    const range = findQuote(index, comment.quote)
    if (range)
      decorations.push(Decoration.inline(range.from, range.to, {
        class: 'comment-highlight' + (comment._id === activeId ? ' comment-highlight--active' : ''),
        'data-comment-id': comment._id
      }))
  })
  return DecorationSet.create(doc, decorations)
}

// Update highlighted comments: editor.view.dispatch(editor.state.tr.setMeta(commentHighlightKey, {comments, activeId}))
export const CommentHighlight = Extension.create({
  name: 'commentHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: commentHighlightKey,
        state: {
          init: () => ({ comments: [], activeId: null, decorations: DecorationSet.empty }),
          apply(tr, value, oldState, newState) {
            const meta = tr.getMeta(commentHighlightKey)
            if (meta) {
              return { ...meta, decorations: buildDecorations(newState.doc, meta.comments, meta.activeId) }
            }
            if (tr.docChanged)
              return { ...value, decorations: buildDecorations(newState.doc, value.comments, value.activeId) }
            return value
          }
        },
        props: {
          decorations(state) {
            return commentHighlightKey.getState(state).decorations
          }
        }
      })
    ]
  }
})
