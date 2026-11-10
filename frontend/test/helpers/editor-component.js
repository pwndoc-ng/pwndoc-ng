// Mounting of components/editor.vue with a real TipTap editor (specs editor-component and editor-toolbar)
// The spec files mock boot/axios (and @hocuspocus/provider for the collaborative editors).
import { vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { QBtn, QIcon } from 'quasar'

import BasicEditor from 'components/editor'
import UserService from '@/services/user'

export const SETTINGS = { report: { public: { captions: ['Figure', 'Table', 'Listing'] } } }

// Dropdowns of the toolbar (text format, highlight, captions) rendered inline: their menu is not opened in jsdom
export const DropdownStub = {
  name: 'QBtnDropdown',
  props: ['icon', 'label'],
  template: '<div class="q-btn-dropdown-stub" :data-icon="icon" :data-label="label"><slot /></div>'
}

// Layout APIs missing in jsdom, used by ProseMirror (selection scrolled into view by focus()) and by the button to
// comment a selected passage (position of the selection)
export function polyfillLayout() {
  const rect = { top: 120, left: 40, right: 140, bottom: 140, width: 100, height: 20, x: 40, y: 120 }
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => rect
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}
  if (!document.elementFromPoint) document.elementFromPoint = () => null
  window.scrollBy = () => {}
  window.scrollTo = () => {}
}

// Editor mounted in the document. With vModel, the parent keeps the value of v-model (props updated on each emit).
export async function mountEditor(props = {}, { route = { params: {} }, settings = SETTINGS, provide = {}, vModel = true, user, stubs = { QBtnDropdown: DropdownStub } } = {}) {
  UserService.user = user || { username: 'ann', id: 'u1', roles: '*' }
  let wrapper
  // (values emitted while mounting, before the wrapper exists, are not given back)
  const listeners = vModel ? { 'onUpdate:modelValue': (value) => wrapper && wrapper.setProps({ modelValue: value }) } : {}
  wrapper = mount(BasicEditor, {
    props: { collab: false, ...props, ...listeners },
    attachTo: document.body,
    global: {
      mocks: { $route: route, $settings: settings },
      directives: { sticky: {} }, // vue3-sticky-directive (boot/sticky)
      stubs,
      provide
    }
  })
  await flushPromises()
  return wrapper
}

// Vue editor state updated after two animation frames (@tiptap/vue-3 debounced reactive state)
export async function settle(ms = 40) {
  await new Promise((resolve) => setTimeout(resolve, ms))
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await flushPromises()
}

// Button of the toolbar with the icon
export function toolbarButton(wrapper, icon) {
  return wrapper.findAllComponents(QBtn).find((button) =>
    button.props('icon') === icon || button.findAllComponents(QIcon).some((child) => child.props('name') === icon))
}

// Item of an inline dropdown (stub) with the text or the style
export function dropdownItems(wrapper, icon) {
  const dropdown = wrapper.findAll('.q-btn-dropdown-stub').find((element) => element.attributes('data-icon') === icon)
  return dropdown ? dropdown.findAll('.q-item') : []
}

// Text of the editor selected from the character `from` (1 = start of the first paragraph) to `to`
export function select(editor, from, to) {
  editor.commands.setTextSelection({ from, to })
}

// Selection of a word of the editor
export function selectText(editor, text) {
  let found = null
  editor.state.doc.descendants((node, pos) => {
    if (found === null && node.isText && node.text.includes(text)) found = pos + node.text.indexOf(text)
  })
  if (found === null) throw new Error(`"${text}" not found in the editor`)
  editor.commands.setTextSelection({ from: found, to: found + text.length })
  return { from: found, to: found + text.length }
}

// Last value emitted for v-model
export function lastValue(wrapper) {
  const emitted = wrapper.emitted('update:modelValue') || []
  return emitted.length ? emitted[emitted.length - 1][0] : undefined
}

export const fetchNoMatch = () => vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ matches: [] }) }))

// Images read by FileReader (asynchronous in jsdom): the reads in progress are counted to wait for them, instead of a
// fixed delay too short when the tests run slowly. Returns the function waiting for the end of the reads.
export function trackFileReads() {
  let pending = 0
  const Reader = globalThis.FileReader
  vi.stubGlobal('FileReader', class extends Reader {
    readAsDataURL(blob) {
      pending++
      this.addEventListener('loadend', () => setTimeout(() => { pending-- }), { once: true })
      return super.readAsDataURL(blob)
    }
  })
  return async () => {
    await vi.waitFor(() => { if (pending > 0) throw new Error('Image still being read') }, { timeout: 5000 })
    await flushPromises()
  }
}

// The bubble menus of TipTap update after a delay of 250 ms following a selection change, with a timer not cleared when
// the editor is destroyed (@tiptap/extension-bubble-menu): waited for at the end of the spec files mounting the editor,
// otherwise it fires once the jsdom environment is torn down ("document is not defined")
export const waitBubbleMenuTimers = () => new Promise((resolve) => setTimeout(resolve, 400))
