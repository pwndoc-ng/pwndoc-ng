<template>
  <node-view-wrapper class="editor-caption" contenteditable="false">
    <div class="editor-caption__text" :class="{ 'editor-caption--selected': selected }">
      <!-- Label chosen when inserting the caption: handle to select or move the caption -->
      <span class="editor-caption__label" data-drag-handle>{{ node.attrs.label }} - </span>
      <input
        v-if="editable"
        class="editor-caption__input text-italic"
        :value="node.attrs.alt"
        :placeholder="$t('captionText')"
        :size="Math.max((node.attrs.alt || '').length, $t('captionText').length) + 1"
        @input="updateAttributes({ alt: $event.target.value })"
      />
      <span v-else-if="node.attrs.alt" class="text-italic">{{ node.attrs.alt }}</span>
      <span v-else class="text-italic text-grey-7">{{ $t('captionText') }}</span>
    </div>
  </node-view-wrapper>
</template>

<script>
import { NodeViewWrapper, nodeViewProps } from "@tiptap/vue-3";

export default {
  name: "editor-caption-view",
  components: { NodeViewWrapper },
  props: nodeViewProps,

  data() {
    return {
      // Not reactive in the editor: updated by the update event (editor made editable or read-only)
      editable: this.editor.isEditable,
    };
  },

  mounted() {
    this.onEditorUpdate = () => {
      this.editable = this.editor.isEditable;
    };
    this.editor.on("update", this.onEditorUpdate);
  },

  beforeUnmount() {
    this.editor.off("update", this.onEditorUpdate);
  },
};
</script>

<style>
.editor-caption {
  display: table;
  margin: 0 auto 16px auto;
}
.editor-caption__text {
  max-width: 600px;
  padding: 0 4px;
  border-radius: 4px;
}
.editor-caption__label {
  cursor: grab;
}
.editor-caption__input {
  border: none;
  border-bottom: 1px dashed #bdbdbd;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  max-width: 520px;
}
.editor-caption__input:focus {
  border-bottom-color: var(--q-primary);
}
.editor-caption--selected {
  outline: 2px solid var(--q-primary);
}
</style>
