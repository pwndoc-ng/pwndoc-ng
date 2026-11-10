// Stub of components/editor.vue (TipTap editor, out of the scope of these tests):
//   vi.mock('components/editor', () => import('../../helpers/editor-stub'))
import { h } from 'vue'

export default {
  name: 'BasicEditor',
  props: ['modelValue', 'diff', 'editable', 'toolbar', 'collab', 'noSync', 'idUnique', 'commentTarget', 'loading'],
  emits: ['update:modelValue', 'editorchange'],
  methods: {
    updateHTML() {}
  },
  render() {
    return h('div', {
      class: 'basic-editor-stub',
      'data-model': this.modelValue,
      'data-diff': this.diff,
      'data-editable': String(this.editable)
    })
  }
}
