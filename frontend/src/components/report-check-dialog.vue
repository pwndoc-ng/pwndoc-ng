<template>
  <!-- Check before the generation of a report: errors and warnings of the quality checks of the audit (with the texts
       highlighted in the warning colors), not ignored. Generated anyway or cancelled: warning only -->
  <q-dialog v-model="show" @hide="close(false)">
    <q-card class="report-check-dialog">
      <q-card-section class="row items-center no-wrap q-pb-none">
        <q-icon name="mdi-clipboard-check-outline" color="orange-9" size="sm" class="q-mr-sm" />
        <div class="text-h6">{{ $t('qa.reportCheckTitle') }}</div>
      </q-card-section>
      <q-card-section>
        <div class="text-grey-8 q-mb-sm report-check-summary">{{ $t('qa.reportCheckMessage', counts) }}</div>
        <q-list dense bordered separator class="report-check-dialog__list">
          <q-item v-for="issue in issues" :key="issue.fingerprint" clickable class="report-check-item" @click="open(issue)">
            <q-item-section avatar>
              <q-icon v-bind="icon(issue)" size="xs" />
            </q-item-section>
            <q-item-section>
              <q-item-label class="text-weight-medium">{{ place(issue) }}</q-item-label>
              <q-item-label caption>
                <mark v-if="issue.params && issue.params.color" :style="{ background: issue.params.color }">{{ issue.params.text }}</mark>
                <template v-else>{{ message(issue) }}</template>
              </q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat no-caps class="report-check-cancel" :label="$t('btn.cancel')" @click="close(false)" />
        <q-btn unelevated no-caps color="primary" class="report-check-generate" :label="$t('highlightWarningGenerate')" @click="close(true)" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script>
import AuditService from '@/services/audit'
import { qaEnabled, SEVERITY_ICONS, issueMessage, issuePlace, issueCounts, openIssue } from '@/services/qa'

export default {
  name: 'ReportCheckDialog',

  data: () => ({
    show: false,
    auditId: null,
    issues: [], // Errors and warnings not ignored: {fingerprint, severity, code, params, location}
    resolve: null // Choice of the user: generated anyway (true) or cancelled
  }),

  computed: {
    counts: function() {
      return issueCounts(this.issues)
    }
  },

  methods: {
    // Errors and warnings of the audit, none when the checks are disabled or cannot be run (warning only)
    load: function(auditId) {
      if (!qaEnabled(this.$settings))
        return Promise.resolve([])
      return AuditService.getAuditQa(auditId)
        .then((data) => ((data.data.datas && data.data.datas.issues) || []).filter((issue) => ['error', 'warning'].includes(issue.severity)))
        .catch(() => [])
    },

    // Report to generate: true without error nor warning, otherwise the choice of the user in the dialog
    confirm: function(auditId) {
      return this.load(auditId).then((issues) => issues.length === 0 || new Promise((resolve) => {
        this.close(false) // Previous dialog not answered
        Object.assign(this, { show: true, auditId: auditId, issues: issues, resolve: resolve })
      }))
    },

    // Opens the place of an issue: page, field and passage (the report is not generated)
    open: function(issue) {
      var auditId = this.auditId
      this.close(false)
      return openIssue(this.$router, auditId, issue)
    },

    close: function(generate) {
      var resolve = this.resolve
      this.show = false
      this.resolve = null
      if (resolve) resolve(generate)
    },

    icon: (issue) => SEVERITY_ICONS[issue.severity] || SEVERITY_ICONS.info,
    message: (issue) => issueMessage(issue),
    place: (issue) => issuePlace(issue)
  }
}
</script>

<style lang="stylus">
.report-check-dialog
  width: 680px
  max-width: 90vw

.report-check-dialog__list
  max-height: 55vh
  overflow-y: auto

.report-check-dialog mark
  padding: 0 2px
  color: inherit
</style>
