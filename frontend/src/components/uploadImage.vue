<template>
  <node-view-wrapper>
    <figure style="margin: auto; display: table; width: 600px">
      <q-img
        :src="src"
        :class="{ selected: selected }"
        style="max-width: 600px"
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
        <q-popup-edit v-model="alt" auto-save>
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

export default defineComponent({
  components: {
    NodeViewWrapper,
  },

  //["node", "updateAttrs", "view", "getPos", "selected"],
  props: nodeViewProps,

  data() {
    return {
      imageError: false
    }
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
  },

  methods: {
    selectImage() {
      const { state } = this.editor.view;
      let { tr } = state;
      const selection = tr.setNodeMarkup(this.getPos(), undefined, state.doc);
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
