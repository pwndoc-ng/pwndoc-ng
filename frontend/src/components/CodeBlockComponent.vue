<template>
    <node-view-wrapper class="code-block">
      <select contenteditable="false" v-model="selectedLanguage" :disabled="!editable">
        <option :value="null">
          auto
        </option>
        <option disabled>
          —
        </option>
        <option v-for="(language, index) in languages" :value="language" :key="index">
          {{ language }}
        </option>
      </select>
      <pre><code><node-view-content /></code></pre>
    </node-view-wrapper>
  </template>
  
  <script>
  import { NodeViewContent, nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
  
  export default {
    components: {
      NodeViewWrapper,
      NodeViewContent,
    },
  
    props: nodeViewProps,
  
    data() {
      return {
        languages: this.extension.options.lowlight.listLanguages(),
        // Not reactive in the editor: updated by the update event (editor made editable or read-only)
        editable: this.editor.isEditable,
      }
    },

    mounted() {
      this.onEditorUpdate = () => {
        this.editable = this.editor.isEditable
      }
      this.editor.on('update', this.onEditorUpdate)
    },

    beforeUnmount() {
      this.editor.off('update', this.onEditorUpdate)
    },
  
    computed: {
      selectedLanguage: {
        get() {
          return this.node.attrs.language
        },
        set(language) {
          this.updateAttributes({ language })
        },
      },
    },
  }
  </script>
  
  <style lang="scss">
  .tiptap {
    .code-block {
      position: relative;
  
      select {
        position: absolute;
        right: 0.5rem;
        top: 0.5rem;
      }
    }
  }
  </style>