<template>
  <!-- Review comments of a field of the audit (only in the audit edit page) -->
  <q-btn
    v-if="store && target"
    class="comment-button"
    :data-comment-field="key"
    flat
    round
    dense
    size="sm"
    :icon="count ? 'mdi-comment-text-multiple-outline' : 'mdi-comment-outline'"
    :color="openCount ? 'orange-8' : 'grey-6'"
    @click.stop="store.openTarget(target)"
  >
    <q-badge v-if="openCount" color="orange-8" floating rounded>{{ openCount }}</q-badge>
    <q-tooltip :delay="500">{{ $t('comments.commentField') }}</q-tooltip>
  </q-btn>
</template>

<script>
import { defineComponent } from 'vue'
import { targetKey } from '@/services/comments'

export default defineComponent({
  name: 'CommentButton',

  inject: {
    store: { from: 'auditComments', default: null },
  },

  props: {
    // {kind: general|network|finding|section, findingId?, sectionId?, field}
    target: { type: Object, default: null },
  },

  computed: {
    key() {
      return targetKey(this.target)
    },
    count() {
      return this.store ? this.store.forTarget(this.target).length : 0
    },
    openCount() {
      return this.store ? this.store.openCountForTarget(this.target) : 0
    },
  },
})
</script>
