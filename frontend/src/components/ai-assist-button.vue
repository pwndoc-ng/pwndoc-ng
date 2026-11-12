<template>
  <!-- Assisted writing (AI enabled in the settings): action on the selected text or on the whole field, proposal shown
       before being applied (never applied automatically) -->
  <span class="ai-assist">
    <q-btn-dropdown size="sm" flat dense no-caps icon="mdi-creation" class="ai-assist-button" :disable="disable || loading" :loading="loading" auto-close no-refocus>
      <q-list dense>
        <q-item-label header class="q-py-xs">{{ $t(hasSelection() ? 'ai.onSelection' : 'ai.onField') }}</q-item-label>
        <q-item v-for="action in actions" :key="action" clickable class="ai-action" :data-action="action" @click="run(action)">
          <q-item-section>{{ $t(`ai.actions.${action}`) }}</q-item-section>
        </q-item>
        <q-separator />
        <q-item clickable class="ai-action" data-action="custom" @click="askInstruction">
          <q-item-section>{{ $t('ai.actions.custom') }}</q-item-section>
        </q-item>
      </q-list>
    </q-btn-dropdown>
    <q-tooltip :delay="500">{{ $t('ai.title') }}</q-tooltip>

    <!-- Instruction of the user -->
    <q-dialog v-model="instructionDialog">
      <q-card class="ai-instruction-dialog" style="width: 520px; max-width: 90vw">
        <q-card-section class="text-h6">{{ $t('ai.actions.custom') }}</q-card-section>
        <q-card-section class="q-pt-none">
          <q-input v-model="instruction" type="textarea" autogrow outlined autofocus maxlength="2000" :label="$t('ai.instruction')" class="ai-instruction" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps :label="$t('btn.cancel')" v-close-popup />
          <q-btn unelevated no-caps color="primary" class="ai-instruction-run" :label="$t('ai.send')" :disable="!instruction.trim()" @click="runInstruction" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Proposal of the AI: applied by the user only -->
    <q-dialog v-model="proposalDialog">
      <q-card class="ai-proposal-dialog" style="width: 900px; max-width: 95vw">
        <q-card-section class="row items-center no-wrap q-pb-none">
          <q-icon name="mdi-creation" color="primary" size="sm" class="q-mr-sm" />
          <div class="text-h6">{{ $t('ai.proposal') }}</div>
        </q-card-section>
        <q-card-section>
          <div class="text-caption text-grey-7 q-mb-sm">{{ $t('ai.proposalInfo') }}</div>
          <div class="row q-col-gutter-md">
            <div class="col-12 col-md-6">
              <div class="text-weight-medium q-mb-xs">{{ $t('ai.original') }}</div>
              <div class="ai-html ai-original" v-html="htmlEncode(original)"></div>
            </div>
            <div class="col-12 col-md-6">
              <div class="text-weight-medium q-mb-xs">{{ $t('ai.proposed') }}</div>
              <div class="ai-html ai-proposed" v-html="htmlEncode(proposal)"></div>
            </div>
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps class="ai-cancel" :label="$t('btn.cancel')" v-close-popup />
          <q-btn unelevated no-caps color="primary" class="ai-apply" :label="$t(range ? 'ai.replaceSelection' : 'ai.replaceField')" @click="apply" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </span>
</template>

<script>
import { toRaw } from 'vue'
import { Notify } from 'quasar'
import { getHTMLFromFragment } from '@tiptap/core'
import AiService, { AI_ACTIONS } from '@/services/ai'
import { errorMessage } from '@/services/audit'
import Utils from '@/services/utils'

export default {
  name: 'AiAssistButton',
  props: {
    editor: { type: Object, default: null },
    auditId: { type: String, default: '' }, // Audit of the text (pseudonymization)
    disable: { type: Boolean, default: false }
  },

  data: () => ({
    actions: AI_ACTIONS,
    loading: false,
    instructionDialog: false,
    instruction: '',
    proposalDialog: false,
    original: '',
    proposal: '', // HTML of the AI, sanitized
    range: null, // Selection replaced ({from, to}), null for the whole field
    inline: false // Selection inside a paragraph: the proposal is inserted in the line (paragraph of the AI unwrapped)
  }),

  methods: {
    // HTML shown and inserted: sanitized (answers of the AI)
    htmlEncode: Utils.htmlEncode,

    // Editor of the field, not wrapped in a reactive proxy (ProseMirror compares its objects by identity)
    rawEditor: function() {
      return this.editor ? toRaw(this.editor) : null
    },

    hasSelection: function() {
      var editor = this.rawEditor()
      return Boolean(editor && !editor.state.selection.empty)
    },

    // HTML of the selected text, or of the whole field
    sourceHtml: function() {
      var editor = this.rawEditor()
      var { from, to, empty } = editor.state.selection
      if (empty) return { html: editor.getHTML(), range: null }
      return { html: getHTMLFromFragment(editor.state.doc.slice(from, to).content, editor.schema), range: { from, to } }
    },

    askInstruction: function() {
      this.instruction = ''
      this.instructionDialog = true
    },

    runInstruction: function() {
      this.instructionDialog = false
      return this.run('custom', this.instruction.trim())
    },

    run: function(action, instruction) {
      if (!this.editor || this.loading) return
      var { html, range } = this.sourceHtml()
      this.loading = true
      return AiService.assist(action, html, { instruction, auditId: this.auditId })
      .then((response) => {
        this.original = Utils.htmlEncode(html)
        this.proposal = Utils.htmlEncode(response.data.datas.html)
        this.range = range
        this.inline = Boolean(range) && !/<(p|ul|ol|li|h[1-6]|pre|table|blockquote)\b/i.test(html)
        this.proposalDialog = true
      })
      .catch((err) => {
        Notify.create({ message: errorMessage(err), color: 'negative', textColor: 'white', position: 'top-right' })
      })
      .finally(() => {
        this.loading = false
      })
    },

    // Proposal applied: replaces the selection (or the whole field) in one change (undoable)
    apply: function() {
      var editor = this.rawEditor()
      var size = editor.state.doc.content.size
      var range = this.range && this.range.to <= size ? this.range : { from: 0, to: size }
      var single = this.proposal.match(/^\s*<p>([\s\S]*?)<\/p>\s*$/i)
      var content = this.inline && single && !single[1].includes('<p>') ? single[1] : this.proposal
      editor.commands.insertContentAt(range, content)
      this.proposalDialog = false
      editor.commands.focus()
    }
  }
}
</script>

<style lang="stylus">
.ai-html
  border: 1px solid #e0e0e0
  border-radius: 4px
  padding: 8px
  max-height: 50vh
  overflow-y: auto
  background: #fafafa
</style>
