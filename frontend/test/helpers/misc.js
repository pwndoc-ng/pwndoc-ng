// Real TipTap editors with their Vue node views (image, caption, code block) rendered in the context of a test app
// (Quasar, i18n and global mocks), as done by the EditorContent component of the editor
import { h, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { Editor, EditorContent } from '@tiptap/vue-3'

// Editor created empty (node views rendered once EditorContent gives the app context), then filled with the content
export async function mountEditor({ extensions, content = '', editable = true, mocks = {} }) {
  const editor = new Editor({ extensions, editable })
  const wrapper = mount({ render: () => h(EditorContent, { editor }) }, { attachTo: document.body, global: { mocks } })
  await nextTick()
  await nextTick()
  if (content) editor.commands.setContent(content)
  await flushPromises()
  return {
    editor,
    wrapper,
    destroy() {
      wrapper.unmount()
      editor.destroy()
    }
  }
}

// Vue node views of the editor (ProseMirror node view descriptions with a VueRenderer), in document order
export function nodeViews(editor) {
  const views = []
  const walk = (desc) => {
    if (desc.spec && desc.spec.renderer) views.push(desc.spec)
    ;(desc.children || []).forEach(walk)
  }
  walk(editor.view.docView)
  return views
}

// Component instance (proxy) of a node view
export const nodeViewComponent = (view) => view.renderer.ref

// Component instances named `name` rendered by a component instance (node views are not in the tree of the wrapper)
export function findInstances(instance, name) {
  const found = []
  const visit = (vnode) => {
    if (!vnode) return
    if (vnode.component) {
      if (vnode.component.type.name === name) found.push(vnode.component.proxy)
      visit(vnode.component.subTree)
    } else if (Array.isArray(vnode.children)) {
      vnode.children.forEach(visit)
    }
  }
  visit(instance.$.subTree)
  return found
}

// Position of the first node of the type in the document
export function nodePosition(editor, typeName, index = 0) {
  const positions = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === typeName) positions.push(pos)
  })
  return positions[index]
}

// Promise resolved / rejected by the test (API answers delayed and given in any order)
export function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Spy answering each call with a new deferred promise: deferreds[i] answers the call i
export function deferredCalls(spy) {
  const deferreds = []
  spy.mockImplementation(() => {
    const call = deferred()
    deferreds.push(call)
    return call.promise
  })
  return deferreds
}

// Errors thrown in event listeners (reported by jsdom on window) during fn
export async function catchWindowErrors(fn) {
  const errors = []
  const onError = (event) => {
    errors.push(event.error || event.message)
    event.preventDefault()
  }
  window.addEventListener('error', onError)
  try {
    await fn()
  } finally {
    window.removeEventListener('error', onError)
  }
  return errors
}
