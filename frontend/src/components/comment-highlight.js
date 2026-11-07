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

// Anchor of a commented image: its source (image id or URL), a hash for long sources (data URIs)
export function imageAnchorKey(src) {
  if (typeof src !== 'string') return ''
  if (src.length <= 200) return src
  let hash = 0x811c9dc5
  for (let i = 0; i < src.length; i++) {
    hash ^= src.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `hash:${src.length}:${hash.toString(16)}`
}

// Images of the document with their anchor ({src, alt, occurrence}: index among identical images)
function documentImages(doc) {
  const images = []
  const counts = {}
  doc.descendants((node, pos) => {
    if (node.attrs && typeof node.attrs.src === 'string' && node.attrs.src) {
      const src = imageAnchorKey(node.attrs.src)
      const alt = node.attrs.alt || ''
      const key = `${src}|${alt}`
      const occurrence = counts[key] || 0
      counts[key] = occurrence + 1
      images.push({ src, alt, occurrence, from: pos, to: pos + node.nodeSize })
    }
    return true
  })
  return images
}

// Anchor of the image node at position pos
export function imageAnchorAt(doc, pos) {
  const image = documentImages(doc).find(img => img.from === pos)
  return image ? { src: image.src, alt: image.alt, occurrence: image.occurrence } : null
}

// Position of the commented image: same source, then same caption and occurrence when possible
export function findImage(doc, image) {
  const candidates = documentImages(doc).filter(img => img.src === image.src)
  return candidates.find(img => img.alt === (image.alt || '') && img.occurrence === (image.occurrence || 0)) ||
    candidates.find(img => img.alt === (image.alt || '')) ||
    candidates[0] || null
}

export const commentHighlightKey = new PluginKey('commentHighlight')

function buildDecorations(doc, comments, activeId) {
  if (!comments || comments.length === 0) return DecorationSet.empty
  const index = docTextIndex(doc)
  const decorations = []
  comments.forEach(comment => {
    const active = comment._id === activeId
    if (comment.image) {
      const node = findImage(doc, comment.image)
      if (node)
        decorations.push(Decoration.node(node.from, node.to, {
          class: 'comment-image-highlight' + (active ? ' comment-image-highlight--active' : ''),
          'data-comment-id': comment._id
        }))
      return
    }
    const range = findQuote(index, comment.quote)
    if (range)
      decorations.push(Decoration.inline(range.from, range.to, {
        class: 'comment-highlight' + (active ? ' comment-highlight--active' : ''),
        'data-comment-id': comment._id
      }))
  })
  return DecorationSet.create(doc, decorations)
}

// Update highlighted comments: editor.view.dispatch(editor.state.tr.setMeta(commentHighlightKey, {comments, activeId}))
export const CommentHighlight = Extension.create({
  name: 'commentHighlight',

  // Set by the editor component: comments target of the field and comments store (used by image node views)
  addStorage() {
    return { target: null, store: null }
  },

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
