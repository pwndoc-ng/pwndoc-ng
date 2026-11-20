<template>
  <!-- Assisted writing (AI enabled in the settings): action on the selected text, on the caption being written or on
       the whole field, proposal shown before being applied (never applied automatically) -->
  <span class="ai-assist" @mousedown.capture="rememberCaption" @keydown.capture="forgetCaption">
    <q-btn-dropdown size="sm" flat dense no-caps icon="mdi-creation" class="ai-assist-button" :disable="disable || loading" :loading="loading" auto-close no-refocus>
      <q-list dense>
        <q-item-label header class="q-py-xs">{{ $t(targetKey()) }}</q-item-label>
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
          <div v-if="missing" class="ai-missing row items-center no-wrap text-warning q-mb-sm">
            <q-icon name="warning" size="xs" class="q-mr-xs" />{{ $t('ai.imagesMoved', { count: missing }) }}
          </div>
          <div class="row q-col-gutter-md">
            <div class="col-12 col-md-6">
              <div class="text-weight-medium q-mb-xs">{{ $t('ai.original') }}</div>
              <div class="ai-html ai-original" v-html="withImageUrls(htmlEncode(original))"></div>
            </div>
            <div class="col-12 col-md-6">
              <div class="text-weight-medium q-mb-xs">{{ $t('ai.proposed') }}</div>
              <div class="ai-html ai-proposed" v-html="withImageUrls(htmlEncode(proposal))"></div>
            </div>
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps class="ai-cancel" :label="$t('btn.cancel')" v-close-popup />
          <q-btn unelevated no-caps color="primary" class="ai-apply" :label="$t(replaceKey())" @click="apply" />
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
    source: '', // HTML sent: replaced only if unchanged when the proposal is applied
    original: '',
    proposal: '', // HTML of the AI, sanitized, with the images and captions of the text put back by the server
    missing: 0, // Images and captions not kept by the AI: put back at the end of the proposal
    range: null, // Selection replaced ({from, to}), null for the whole field
    caption: null, // Caption whose text is replaced ({pos, type, alt, from, to, whole}: currentCaption), instead of the range
    inline: false // Selection inside a paragraph: the proposal is inserted in the line (paragraph of the AI unwrapped)
  }),

  created: function() {
    this.pressed = false // Menu opened by a press on the button (rememberCaption)
    this.pressedCaption = null // Caption target when the button was pressed: {pos, type, from, to}
  },

  methods: {
    // HTML shown and inserted: sanitized (answers of the AI)
    htmlEncode: Utils.htmlEncode,

    // Sanitized HTML shown: download URL of the images (stored by id), their caption under them
    withImageUrls: function(html) {
      return Utils.withImageUrls(html, true)
    },

    // Editor of the field, not wrapped in a reactive proxy (ProseMirror compares its objects by identity)
    rawEditor: function() {
      return this.editor ? toRaw(this.editor) : null
    },

    hasSelection: function() {
      var editor = this.rawEditor()
      return Boolean(editor && !editor.state.selection.empty)
    },

    // Press on the button: caption the action will apply to, taken before the press moves the focus out of the input of
    // a caption (its selection kept) and kept until the action (the node views of a collaborative editor can be rendered
    // again meanwhile: new inputs, without the selection)
    rememberCaption: function() {
      this.pressed = true
      this.pressedCaption = this.captionTarget(document.activeElement)
    },

    // Menu opened with the keyboard: the focus is already on the button, target read from the editor
    forgetCaption: function() {
      this.pressed = false
      this.pressedCaption = null
    },

    // Caption the action applies to: {pos, type, from, to} (from/to: part of its text selected, null for all of it), or
    // null for the text of the editor. Caption being written (input of a caption of this editor, editor-caption-view.vue),
    // caption selected in the editor, or caption of the selected image (its alt, shown under it: uploadImage.vue)
    captionTarget: function(input) {
      var editor = this.rawEditor()
      if (!editor) return null
      var { selection } = editor.state
      if (input && input.matches && input.matches('.editor-caption__input') && editor.view.dom.contains(input)) {
        var pos = null
        editor.state.doc.descendants((node, nodePos) => {
          if (pos === null && node.type.name === 'caption' && editor.view.nodeDOM(nodePos) && editor.view.nodeDOM(nodePos).contains(input)) pos = nodePos
        })
        var from = Math.min(input.selectionStart, input.selectionEnd)
        var to = Math.max(input.selectionStart, input.selectionEnd)
        if (pos !== null) return { pos, type: 'caption', from: from === to ? null : from, to: from === to ? null : to }
      }
      var node = selection.node
      if (node && (node.type.name === 'caption' || (node.type.name === 'custom_image' && node.attrs.alt)))
        return { pos: selection.from, type: node.type.name, from: null, to: null }
      return null
    },

    // Caption of the action with its current text: {pos, type, alt, from, to, whole}, null if none (or no longer there)
    currentCaption: function() {
      var editor = this.rawEditor()
      var target = this.pressed ? this.pressedCaption : this.captionTarget(null)
      var node = target && editor ? editor.state.doc.nodeAt(target.pos) : null
      if (!node || node.type.name !== target.type) return null
      var alt = node.attrs.alt || ''
      var from = target.from === null ? 0 : Math.min(target.from, alt.length)
      var to = target.to === null ? alt.length : Math.min(target.to, alt.length)
      return { pos: target.pos, type: target.type, alt, from, to, whole: from === 0 && to === alt.length }
    },

    // Header of the menu: what the action applies to
    targetKey: function() {
      var caption = this.currentCaption()
      if (caption) return caption.whole ? 'ai.onCaption' : 'ai.onSelection'
      return this.hasSelection() ? 'ai.onSelection' : 'ai.onField'
    },

    replaceKey: function() {
      if (this.caption) return this.caption.whole ? 'ai.replaceCaption' : 'ai.replaceSelection'
      return this.range ? 'ai.replaceSelection' : 'ai.replaceField'
    },

    // HTML of the caption being written, of the selected text, or of the whole field
    sourceHtml: function() {
      var editor = this.rawEditor()
      var caption = this.currentCaption()
      if (caption) {
        var text = caption.alt.substring(caption.from, caption.to).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        return { html: `<p>${text}</p>`, range: null, caption }
      }
      var { from, to, empty } = editor.state.selection
      if (empty) return { html: editor.getHTML(), range: null, caption: null }
      return { html: this.rangeHtml(editor, { from, to }), range: { from, to }, caption: null }
    },

    // Text of a caption from the sanitized HTML of the AI: paragraphs on one line
    captionText: function(html) {
      var element = document.createElement('div')
      element.innerHTML = html.replace(/<\/(p|li|h[1-6]|pre|td|th)>|<br\s*\/?>/gi, ' ')
      return element.textContent.replace(/\s+/g, ' ').trim()
    },

    // HTML of a range of the field (null: out of the field)
    rangeHtml: function(editor, { from, to }) {
      try {
        return getHTMLFromFragment(editor.state.doc.slice(from, to).content, editor.schema)
      }
      catch (err) {
        return null
      }
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
      var { html, range, caption } = this.sourceHtml()
      this.loading = true
      return AiService.assist(action, html, { instruction, auditId: this.auditId })
      .then((response) => {
        this.source = html
        this.original = Utils.htmlEncode(html)
        this.proposal = Utils.htmlEncode(response.data.datas.html)
        this.missing = response.data.datas.missing || 0
        this.range = range
        this.caption = caption
        this.inline = Boolean(range) && !/<(p|ul|ol|li|h[1-6]|pre|table|blockquote|img|legend|figure)\b/i.test(html)
        this.proposalDialog = true
      })
      .catch((err) => {
        Notify.create({ message: errorMessage(err), color: 'negative', textColor: 'white', position: 'top-right' })
      })
      .finally(() => {
        this.loading = false
      })
    },

    // Proposal applied: replaces the selection (or the whole field) in one change (undoable). Not applied when the text
    // changed during the request (typing, other users of a collaborative editor): it would replace another passage
    apply: function() {
      var editor = this.rawEditor()
      if (this.caption) return this.applyCaption(editor)
      var current = this.range ? this.rangeHtml(editor, this.range) : editor.getHTML()
      if (current !== this.source) {
        Notify.create({ message: this.$t('ai.textChanged'), color: 'warning', textColor: 'white', position: 'top-right' })
        return
      }
      var range = this.range || { from: 0, to: editor.state.doc.content.size }
      var single = this.proposal.match(/^\s*<p>([\s\S]*?)<\/p>\s*$/i)
      var content = this.inline && single && !single[1].includes('<p>') ? single[1] : this.proposal
      editor.commands.insertContentAt(range, content)
      this.proposalDialog = false
      editor.commands.focus()
    },

    // Proposal applied to the text of the caption (or to its part selected), if unchanged since the request
    applyCaption: function(editor) {
      var { pos, type, alt, from, to } = this.caption
      var node = editor.state.doc.nodeAt(pos)
      if (!node || node.type.name !== type || (node.attrs.alt || '') !== alt) {
        Notify.create({ message: this.$t('ai.textChanged'), color: 'warning', textColor: 'white', position: 'top-right' })
        return
      }
      var text = alt.substring(0, from) + this.captionText(this.proposal) + alt.substring(to)
      editor.chain().command(({ tr }) => {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, alt: text })
        return true
      }).run()
      this.proposalDialog = false
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
  img
    max-width: 100%
    height: auto
  .ai-image-caption // Caption of an image (its alt)
    display: block
    text-align: center
    font-style: italic
    font-size: 0.9em
    margin-bottom: 8px
  legend::before // Captions: atoms of the editor, text in their attributes
    content: attr(label) " - " attr(alt)
    font-style: italic
    font-size: 0.9em
</style>
