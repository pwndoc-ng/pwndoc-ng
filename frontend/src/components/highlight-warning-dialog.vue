<template>
  <!-- Texts highlighted in the warning colors of the settings (generic texts to replace), listed before the generation of a
       report: generated anyway or cancelled. Warning only -->
  <q-dialog v-model="show" @hide="close(false)">
    <q-card class="highlight-dialog">
      <q-card-section class="row items-center no-wrap q-pb-none">
        <q-icon name="mdi-marker" color="orange-9" size="sm" class="q-mr-sm" />
        <div class="text-h6">{{ $t('highlightWarningDialogTitle') }}</div>
      </q-card-section>
      <q-card-section>
        <div class="text-grey-8 q-mb-sm">{{ $t('highlightWarningDialogMessage') }}</div>
        <q-list dense bordered separator class="highlight-dialog__list">
          <q-item v-for="(item, index) in items" :key="index" clickable class="highlight-item" @click="open(item)">
            <q-item-section>
              <q-item-label class="text-weight-medium">{{ place(item) }}</q-item-label>
              <q-item-label v-for="(highlight, textIndex) in item.texts" :key="textIndex" caption>
                <mark :style="{ background: highlight.color }">{{ highlight.text }}</mark>
              </q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat no-caps class="highlight-cancel" :label="$t('btn.cancel')" @click="close(false)" />
        <q-btn unelevated no-caps color="primary" class="highlight-generate" :label="$t('highlightWarningGenerate')" @click="close(true)" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script>
import AuditService, { highlightWarningEnabled } from '@/services/audit'
import { $t } from '@/boot/i18n'

export default {
  name: 'HighlightWarningDialog',

  data: () => ({
    show: false,
    auditId: null,
    items: [], // Places of the audit with highlighted texts: {kind, id, name, field, label, texts: [{text, color}]}
    resolve: null // Choice of the user: generated anyway (true) or cancelled
  }),

  methods: {
    // Highlighted texts of an audit: {colors, items}, none when the warning is disabled or when they cannot be loaded
    load: function(auditId) {
      if (!highlightWarningEnabled(this.$settings))
        return Promise.resolve({ colors: [], items: [] })
      return AuditService.getAuditHighlights(auditId)
        .then((data) => data.data.datas)
        .catch(() => ({ colors: [], items: [] }))
    },

    // Report to generate: true without highlighted texts, otherwise the choice of the user in the dialog
    confirm: function(auditId) {
      return this.load(auditId).then((result) => result.items.length === 0 || new Promise((resolve) => {
        this.close(false) // Previous dialog not answered
        Object.assign(this, { show: true, auditId: auditId, items: result.items, resolve: resolve })
      }))
    },

    // Place of a highlighted text: finding or section, and field
    place: function(item) {
      var fields = { description: $t('description'), observation: $t('observation'), remediation: $t('remediation'), poc: $t('proofs'), scope: $t('affectedAssets') }
      var field = item.label || fields[item.field] || ''
      var place = item.kind === 'general' ? $t('generalInformation') : item.name
      return field ? `${place} · ${field}` : place
    },

    // Opens the place of a highlighted text (the report is not generated)
    open: function(item) {
      var auditId = this.auditId
      this.close(false)
      var path = item.kind === 'finding' ? `findings/${item.id}` : item.kind === 'section' ? `sections/${item.id}` : 'general'
      this.$router.push(`/audits/${auditId}/${path}`)
    },

    close: function(generate) {
      var resolve = this.resolve
      this.show = false
      this.resolve = null
      if (resolve) resolve(generate)
    }
  }
}
</script>

<style lang="stylus">
.highlight-dialog
  width: 640px
  max-width: 90vw

.highlight-dialog__list
  max-height: 50vh
  overflow-y: auto

.highlight-dialog mark
  padding: 0 2px
  color: inherit
</style>
