<template>
  <!-- Review comments of the audit: filters, tour (previous/next), threads -->
  <div class="comments-panel column no-wrap full-height">
    <q-toolbar class="bg-grey-2 text-grey-9">
      <q-icon name="mdi-comment-text-multiple-outline" size="sm" />
      <q-toolbar-title class="text-subtitle1">
        {{ $t('comments.title') }}
        <q-badge v-if="store.openCount()" color="orange-8" rounded class="q-ml-xs">{{ store.openCount() }}</q-badge>
      </q-toolbar-title>
      <q-btn flat round dense icon="close" @click="store.panelOpen = false" />
    </q-toolbar>

    <div class="q-px-sm q-pt-sm row items-center q-gutter-sm">
      <q-btn-toggle
        v-model="store.status"
        dense
        no-caps
        unelevated
        size="sm"
        toggle-color="primary"
        :options="[
          { label: $t('comments.open'), value: 'open' },
          { label: $t('comments.resolved'), value: 'resolved' },
          { label: $t('comments.all'), value: 'all' }
        ]"
      />
      <q-toggle v-model="store.onlyMine" dense size="sm" :label="$t('comments.mine')" />
    </div>

    <!-- Tour of the comments -->
    <div class="q-px-sm row items-center no-wrap">
      <q-btn flat dense round icon="chevron_left" :aria-label="$t('comments.previous')" :disable="!list.length" @click="store.move(-1)">
        <q-tooltip :delay="500">{{ $t('comments.previous') }}</q-tooltip>
      </q-btn>
      <div class="text-caption text-grey-8 q-mx-xs">{{ position }}</div>
      <q-btn flat dense round icon="chevron_right" :aria-label="$t('comments.next')" :disable="!list.length" @click="store.move(1)">
        <q-tooltip :delay="500">{{ $t('comments.next') }}</q-tooltip>
      </q-btn>
      <q-space />
      <q-chip
        v-if="store.targetFilter"
        dense
        removable
        color="blue-1"
        text-color="primary"
        class="ellipsis"
        style="max-width: 200px"
        @remove="clearTargetFilter"
      >
        {{ store.fieldLabel(store.targetFilter) }}
      </q-chip>
    </div>
    <q-separator />

    <!-- New comment -->
    <div v-if="store.draft" class="q-pa-sm bg-orange-1">
      <div class="text-caption text-grey-8 ellipsis">
        {{ $t('comments.newComment') }} : {{ store.locationLabel(store.draft.target) }} › {{ store.fieldLabel(store.draft.target) }}
      </div>
      <div v-if="store.draft.quote" class="comment-quote q-my-xs">« {{ store.draft.quote.exact }} »</div>
      <q-input
        v-model="draftText"
        type="textarea"
        autogrow
        dense
        outlined
        autofocus
        bg-color="white"
        :placeholder="$t('comments.placeholder')"
        @keydown.ctrl.enter="createComment"
        @keydown.meta.enter="createComment"
      />
      <div class="row justify-end q-gutter-sm q-mt-xs">
        <q-btn flat dense no-caps :label="$t('btn.cancel')" @click="store.draft = null" />
        <q-btn color="orange-8" unelevated dense no-caps :label="$t('comments.add')" :disable="!draftText.trim()" @click="createComment" />
      </div>
    </div>

    <q-scroll-area class="col">
      <div v-if="!list.length" class="q-pa-md text-grey-7">{{ $t('comments.none') }}</div>
      <template v-for="group of groups" :key="group.key">
        <div class="text-caption text-weight-bold text-grey-8 q-px-sm q-pt-sm ellipsis">{{ group.label }}</div>
        <q-card
          v-for="comment of group.comments"
          :key="comment._id"
          flat
          bordered
          class="q-ma-sm comment-card"
          :class="{ 'comment-card--active': comment._id === store.activeId, 'comment-card--resolved': comment.resolved }"
          @click="store.select(comment)"
        >
          <q-card-section class="q-pa-sm">
            <div class="row items-center no-wrap">
              <div class="text-caption text-primary ellipsis col">{{ store.fieldLabel(comment.target) }}</div>
              <q-chip v-if="comment.resolved" dense size="sm" color="green-1" text-color="green-9" icon="check">{{ $t('comments.resolvedState') }}</q-chip>
            </div>
            <div v-if="comment.quote" class="comment-quote q-my-xs" :class="{ 'comment-quote--outdated': store.isOutdated(comment) }">
              « {{ comment.quote.exact }} »
            </div>
            <q-badge v-if="store.isOutdated(comment)" color="grey-6" class="q-mb-xs">{{ $t('comments.textChanged') }}</q-badge>
            <div class="comment-text">{{ comment.text }}</div>
            <div class="text-caption text-grey-7 q-mt-xs">
              {{ author(comment.author) }} · {{ date(comment.createdAt) }}
              <span v-if="comment.replies.length && comment._id !== store.activeId"> · {{ $t('comments.repliesCount', { count: comment.replies.length }) }}</span>
            </div>
          </q-card-section>

          <!-- Thread of the selected comment -->
          <template v-if="comment._id === store.activeId">
            <q-separator />
            <q-card-section class="q-pa-sm" @click.stop>
              <div v-for="reply of comment.replies" :key="reply._id" class="q-mb-sm comment-reply">
                <div class="comment-text">{{ reply.text }}</div>
                <div class="text-caption text-grey-7">{{ author(reply.author) }} · {{ date(reply.createdAt) }}</div>
              </div>
              <div v-if="comment.resolved && comment.resolvedBy" class="text-caption text-green-9 q-mb-sm">
                {{ $t('comments.resolvedBy', { name: author(comment.resolvedBy) }) }}
              </div>
              <q-input
                v-model="replyText"
                type="textarea"
                autogrow
                dense
                outlined
                :placeholder="$t('comments.replyPlaceholder')"
                @keydown.ctrl.enter="reply(comment)"
                @keydown.meta.enter="reply(comment)"
              />
              <div class="row items-center q-gutter-xs q-mt-xs">
                <q-btn v-if="store.canDelete(comment)" flat dense round color="negative" icon="delete_outline" @click="remove(comment)">
                  <q-tooltip :delay="500">{{ $t('btn.delete') }}</q-tooltip>
                </q-btn>
                <q-space />
                <q-btn
                  v-if="store.canResolve(comment)"
                  flat
                  dense
                  no-caps
                  :color="comment.resolved ? 'grey-8' : 'green'"
                  :icon="comment.resolved ? 'replay' : 'check'"
                  :label="comment.resolved ? $t('comments.reopen') : $t('comments.resolve')"
                  @click="store.setResolved(comment, !comment.resolved)"
                />
                <q-btn color="primary" unelevated dense no-caps :label="$t('comments.reply')" :disable="!replyText.trim()" @click="reply(comment)" />
              </div>
            </q-card-section>
          </template>
        </q-card>
      </template>
    </q-scroll-area>
  </div>
</template>

<script>
import { defineComponent } from 'vue'
import { Dialog, date } from 'quasar'

import { $t } from '@/boot/i18n'

export default defineComponent({
  name: 'CommentsPanel',

  inject: {
    store: { from: 'auditComments' },
  },

  data() {
    return {
      draftText: '',
      replyText: '',
    }
  },

  computed: {
    list() {
      return this.store.filtered()
    },
    // Comments grouped by commented element (general information, network, each finding, each section)
    groups() {
      const groups = []
      this.list.forEach((comment) => {
        const target = comment.target
        const key = [target.kind, target.findingId || target.sectionId || ''].join(':')
        let group = groups.find((g) => g.key === key)
        if (!group) {
          group = { key, label: this.store.locationLabel(target), comments: [] }
          groups.push(group)
        }
        group.comments.push(comment)
      })
      return groups
    },
    position() {
      const index = this.list.findIndex((c) => c._id === this.store.activeId)
      return index < 0 ? `${this.list.length}` : `${index + 1} / ${this.list.length}`
    },
  },

  watch: {
    'store.activeId'() {
      this.replyText = ''
    },
    'store.draft'(value) {
      if (!value) this.draftText = ''
    },
  },

  methods: {
    async createComment() {
      if (!this.draftText.trim()) return
      if (await this.store.create(this.draftText))
        this.draftText = ''
    },

    async reply(comment) {
      if (!this.replyText.trim()) return
      if (await this.store.reply(comment, this.replyText))
        this.replyText = ''
    },

    remove(comment) {
      Dialog.create({
        title: $t('msg.confirmSuppression'),
        message: $t('comments.deleteConfirm'),
        ok: { label: $t('btn.confirm'), color: 'negative' },
        cancel: { label: $t('btn.cancel'), color: 'white' },
      }).onOk(() => this.store.remove(comment))
    },

    clearTargetFilter() {
      this.store.targetFilter = null
      this.store.draft = null
    },

    author(user) {
      if (!user) return '?'
      const name = [user.firstname, user.lastname].filter((e) => e).join(' ')
      return name || user.username
    },

    date(value) {
      return value ? date.formatDate(value, 'DD/MM/YYYY HH:mm') : ''
    },
  },
})
</script>

<style>
.comments-panel .comment-card {
  cursor: pointer;
}

.comments-panel .comment-card--active {
  border-color: #ff9800;
  box-shadow: 0 0 0 1px #ff9800;
}

.comments-panel .comment-card--resolved {
  opacity: 0.75;
}

.comment-quote {
  font-style: italic;
  color: #616161;
  border-left: 3px solid #ffa000;
  padding-left: 6px;
  white-space: pre-line;
  max-height: 4.5em;
  overflow: hidden;
}

.comment-quote--outdated {
  text-decoration: line-through;
  border-left-color: #9e9e9e;
}

.comment-text {
  white-space: pre-line;
  word-break: break-word;
}

.comment-reply {
  border-left: 2px solid #e0e0e0;
  padding-left: 6px;
}

/* Element shown after navigating to a comment */
.comment-focus {
  animation: comment-focus 1.6s ease-out;
  border-radius: 4px;
}

@keyframes comment-focus {
  0% { box-shadow: 0 0 0 4px rgba(255, 152, 0, 0.9); }
  100% { box-shadow: 0 0 0 14px rgba(255, 152, 0, 0); }
}
</style>
