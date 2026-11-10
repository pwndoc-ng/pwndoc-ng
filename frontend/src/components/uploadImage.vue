<template>
  <node-view-wrapper class="editor-image-page">
    <figure class="editor-image" :style="{ width: displayWidth }">
      <!-- Width choice, shown when the image is selected (single click) -->
      <div
        v-if="selected && editable"
        class="editor-image__width"
        contenteditable="false"
        @mousedown.stop.prevent
      >
        <q-btn-toggle
          :model-value="width"
          :options="widthOptions"
          dense
          no-caps
          unelevated
          size="sm"
          color="white"
          text-color="primary"
          toggle-color="primary"
          @update:model-value="setWidth"
        />
      </div>
      <!-- Review comments on the image (editors of an audit) -->
      <div v-if="commentContext()" class="editor-image__comments" contenteditable="false" @mousedown.stop.prevent>
        <q-btn v-if="imageOpenComments.length" round dense size="sm" color="orange-8" icon="mdi-comment-text-outline" @click.stop="showImageComments">
          <q-badge color="red" floating rounded>{{ imageOpenComments.length }}</q-badge>
        </q-btn>
        <q-btn class="editor-image__comment-add" round dense size="sm" color="orange-8" icon="mdi-comment-plus-outline" @click.stop="commentImage">
          <q-tooltip :delay="500">{{ $t('comments.commentImage') }}</q-tooltip>
        </q-btn>
      </div>
      <q-img
        :src="src"
        :alt="alt"
        :class="{ selected: selected }"
        style="width: 100%"
        @error="handleImageError"
        spinner-color="primary"
        spinner-size="82px"
      />
      <div v-if="imageError" class="text-center q-pa-md">
        <q-icon name="error" color="negative" size="48px" />
        <div class="text-caption text-negative q-mt-sm">
          Impossible de charger l'image
        </div>
        <q-btn 
          flat 
          color="primary" 
          size="sm" 
          @click="retryLoad"
          class="q-mt-sm"
        >
          Réessayer
        </q-btn>
      </div>
      <div>
        <q-input
          input-class="text-center cursor-pointer"
          readonly
          borderless
          dense
          v-model="alt"
          placeholder="Caption"
        />
        <q-popup-edit v-model="alt" auto-save :disable="!editable">
          <q-input
            input-class="text-center"
            autofocus
            v-model="alt"
            placeholder="Caption"
          />
        </q-popup-edit>
      </div>
    </figure>
  </node-view-wrapper>
</template>
<script>
import { defineComponent } from 'vue';

import { NodeViewWrapper, nodeViewProps } from "@tiptap/vue-3";
import Utils from "@/services/utils";
import { $t } from "@/boot/i18n";
import { imageAnchorAt, findImage } from "./comment-highlight";

// Image width in % of the text width (large: between page margins), same values as the report
// generator (backend/src/lib/report-generator.js IMAGE_WIDTH_RATIOS)
const WIDTH_PERCENTS = { small: 50, medium: 75, large: 100 };

export default defineComponent({
  components: {
    NodeViewWrapper,
  },

  //["node", "updateAttrs", "view", "getPos", "selected"],
  props: nodeViewProps,

  data() {
    return {
      imageError: false,
      // Not reactive in the editor: updated by the update event (editor made editable or read-only)
      editable: this.editor.isEditable,
    }
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

  computed: {
    src: {
      get() {
        return Utils.normalizeImageUrl(this.node.attrs.src);
      },
      set(src) {
        this.updateAttributes({
          src,
        });
      },
    },
    alt: {
      get() {
        return this.node.attrs.alt;
      },
      set(alt) {
        this.updateAttributes({
          alt,
        });
      },
    },
    // Width chosen for this image, default width from settings otherwise
    width() {
      const settings = this.$settings && this.$settings.report && this.$settings.report.public;
      return this.node.attrs.width || (settings && settings.imageDefaultWidth) || "large";
    },
    displayWidth() {
      return `${WIDTH_PERCENTS[this.width] || 100}%`;
    },
    // Open comments anchored on this image (same image node in the document)
    imageOpenComments() {
      const context = this.commentContext();
      if (!context) return [];
      const doc = this.editor.state.doc;
      const pos = this.getPos();
      if (pos === undefined) return []; // Node view not in the document (TipTap v3: getPos can be undefined)
      return context.store.forTarget(context.target).filter((comment) => {
        if (!comment.image || comment.resolved) return false;
        const found = findImage(doc, comment.image);
        return !!found && found.from === pos;
      });
    },
    widthOptions() {
      return [
        { label: $t("imageWidthSmall"), value: "small" },
        { label: $t("imageWidthMedium"), value: "medium" },
        { label: $t("imageWidthLarge"), value: "large" },
      ];
    },
  },

  methods: {
    // Comments target and store of the field, set by the editor component (null outside an audit)
    commentContext() {
      const storage = this.editor && this.editor.storage.commentHighlight;
      return storage && storage.store && storage.target ? storage : null;
    },
    commentImage() {
      const context = this.commentContext();
      const pos = this.getPos();
      if (pos === undefined) return;
      const anchor = imageAnchorAt(this.editor.state.doc, pos);
      if (context && anchor) context.store.startComment(context.target, null, anchor);
    },
    showImageComments() {
      const context = this.commentContext();
      if (context && this.imageOpenComments.length) context.store.show(this.imageOpenComments[0]._id);
    },
    setWidth(width) {
      this.updateAttributes({ width });
    },

    selectImage() {
      const pos = this.getPos();
      if (pos === undefined) return;
      const { state } = this.editor.view;
      let { tr } = state;
      const selection = tr.setNodeMarkup(pos, undefined, state.doc);
      this.editor.view.dispatch(selection);
    },

    handleImageError() {
      this.imageError = true;
    },

    retryLoad() {
      this.imageError = false;
      this.$forceUpdate();
    }
  },
});
</script>

<style>
/* Page-like area: image widths are a percentage of it, as in the report (text width) */
.editor-image-page {
  max-width: 800px;
  margin: 0 auto;
}

.editor-image {
  position: relative;
  margin: 0 auto;
}

.editor-image__comments {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: flex;
  gap: 4px;
}

/* Add comment button shown when hovering the image */
.editor-image__comment-add {
  opacity: 0;
  transition: opacity 0.15s;
}

.editor-image:hover .editor-image__comment-add {
  opacity: 1;
}

.editor-image__width {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  border-radius: 4px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
}
</style>
