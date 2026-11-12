<template>
  <!-- Quality checks of an audit (without AI, no link requested): issues by severity, place opened, issues ignored for all
       the users of the audit and restored -->
  <q-card class="qa-panel column no-wrap">
    <q-card-section class="row items-center no-wrap q-py-sm bg-blue-grey-5 text-white">
      <q-icon name="mdi-clipboard-check-outline" size="sm" class="q-mr-sm" />
      <div class="text-h6 col">{{ $t('qa.title') }}</div>
      <q-btn flat round dense icon="refresh" class="qa-refresh" :loading="loading" @click="load">
        <q-tooltip :delay="500">{{ $t('qa.refresh') }}</q-tooltip>
      </q-btn>
      <q-btn flat round dense icon="close" class="qa-close" @click="$emit('close')" />
    </q-card-section>
    <q-card-section class="q-py-sm text-caption text-grey-8 qa-summary">{{ summary }}</q-card-section>
    <q-separator />
    <div class="col qa-panel__content">
      <div v-if="error" class="q-pa-md text-negative qa-error">{{ error }}</div>
      <div v-else-if="loaded && issues.length === 0" class="q-pa-md text-grey-7 qa-empty">{{ $t('qa.noIssues') }}</div>
      <q-list separator>
        <q-item v-for="issue in issues" :key="issue.fingerprint" class="qa-issue" :class="`qa-issue--${issue.severity}`">
          <q-item-section avatar>
            <q-icon v-bind="icon(issue)" />
          </q-item-section>
          <q-item-section>
            <q-item-label class="qa-message">
              <span v-if="issue.params && issue.params.color" class="qa-swatch" :style="{ background: issue.params.color }" />{{ message(issue) }}
            </q-item-label>
            <q-item-label caption>{{ place(issue) }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <div class="row no-wrap">
              <q-btn flat round dense size="sm" icon="mdi-arrow-right" class="qa-open" @click="open(issue)">
                <q-tooltip :delay="500">{{ $t('qa.open') }}</q-tooltip>
              </q-btn>
              <q-btn v-if="editable" flat round dense size="sm" icon="mdi-eye-off-outline" class="qa-ignore" @click="setIgnored(issue, true)">
                <q-tooltip :delay="500">{{ $t('qa.ignore') }}</q-tooltip>
              </q-btn>
            </div>
          </q-item-section>
        </q-item>
      </q-list>
      <q-expansion-item v-if="ignored.length" dense class="qa-ignored" :label="$t('qa.ignoredCount', { count: ignored.length })">
        <q-list separator>
          <q-item v-for="issue in ignored" :key="issue.fingerprint" class="qa-ignored-issue text-grey-7">
            <q-item-section>
              <q-item-label>{{ message(issue) }}</q-item-label>
              <q-item-label caption>{{ place(issue) }}</q-item-label>
            </q-item-section>
            <q-item-section v-if="editable" side>
              <q-btn flat round dense size="sm" icon="mdi-eye-outline" class="qa-restore" @click="setIgnored(issue, false)">
                <q-tooltip :delay="500">{{ $t('qa.restore') }}</q-tooltip>
              </q-btn>
            </q-item-section>
          </q-item>
        </q-list>
      </q-expansion-item>
    </div>
  </q-card>
</template>

<script>
import AuditService, { errorMessage } from '@/services/audit'
import { SEVERITY_ICONS, issueMessage, issuePlace, issuePath, issueCounts } from '@/services/qa'
import { $t } from '@/boot/i18n'

export default {
  name: 'QaPanel',
  props: {
    auditId: { type: String, required: true },
    editable: { type: Boolean, default: false } // Issues can be ignored (user allowed to update the audit)
  },
  emits: ['update', 'close'],

  data: () => ({
    issues: [],
    ignored: [],
    loading: false,
    loaded: false,
    error: '',
    request: 0 // Number of the last loading: only its answer is shown
  }),

  computed: {
    summary: function() {
      var counts = issueCounts(this.issues)
      return $t('qa.summary', counts)
    }
  },

  mounted: function() {
    this.load()
  },

  methods: {
    load: function() {
      var request = ++this.request
      this.loading = true
      return AuditService.getAuditQa(this.auditId)
      .then((data) => {
        if (request !== this.request) return
        this.issues = data.data.datas.issues
        this.ignored = data.data.datas.ignored
        this.error = ''
        this.loaded = true
        this.$emit('update', issueCounts(this.issues))
      })
      .catch((err) => {
        if (request === this.request) this.error = errorMessage(err)
      })
      .finally(() => {
        if (request === this.request) this.loading = false
      })
    },

    setIgnored: function(issue, ignored) {
      return AuditService.setAuditQaIgnored(this.auditId, issue.fingerprint, ignored)
      .then(() => this.load())
      .catch((err) => { this.error = errorMessage(err) })
    },

    open: function(issue) {
      this.$emit('close')
      this.$router.push(issuePath(this.auditId, issue))
    },

    icon: (issue) => SEVERITY_ICONS[issue.severity] || SEVERITY_ICONS.info,
    message: (issue) => issueMessage(issue),
    place: (issue) => issuePlace(issue)
  }
}
</script>

<style lang="stylus">
.qa-panel
  width: 460px
  max-width: 100vw
  height: 100%

.qa-panel__content
  overflow-y: auto

.qa-swatch
  display: inline-block
  width: 10px
  height: 10px
  border-radius: 2px
  margin-right: 6px
  border: 1px solid rgba(0, 0, 0, 0.2)
</style>
