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
    <!-- Issues of the standard rules or of the AI: filter with the number of each -->
    <q-card-section v-if="showSources" class="q-pt-sm q-pb-none qa-sources">
      <q-btn-toggle v-model="source" dense no-caps unelevated spread toggle-color="primary" color="grey-3" text-color="grey-9" class="qa-source-filter" :options="sourceOptions" />
    </q-card-section>
    <q-card-section class="q-py-sm text-caption text-grey-8 qa-summary">{{ summary }}</q-card-section>
    <!-- Quality check of the findings by the AI (AI enabled in the settings): last check stored with its date -->
    <q-card-section v-if="aiCheck" class="q-py-xs row items-center no-wrap qa-ai">
      <q-btn dense flat no-caps color="primary" icon="mdi-creation" class="qa-ai-run" :label="$t('qa.aiRun')" :loading="aiLoading" @click="runAi" />
      <div class="text-caption text-grey-7 q-ml-sm qa-ai-date">{{ aiAt ? $t('qa.aiLast', { date: new Date(aiAt).toLocaleString() }) : $t('qa.aiNever') }}</div>
    </q-card-section>
    <q-separator />
    <div class="col qa-panel__content">
      <div v-if="error" class="q-pa-md text-negative qa-error">{{ error }}</div>
      <div v-else-if="loaded && issues.length === 0" class="q-pa-md text-grey-7 qa-empty">{{ $t('qa.noIssues') }}</div>
      <div v-else-if="loaded && shownIssues.length === 0" class="q-pa-md text-grey-7 qa-empty-source">{{ $t('qa.noIssuesSource') }}</div>
      <q-list separator>
        <q-item v-for="issue in shownIssues" :key="issue.fingerprint" class="qa-issue" :class="[`qa-issue--${issue.severity}`, `qa-issue--${sourceOf(issue)}`]">
          <q-item-section avatar>
            <q-icon v-bind="icon(issue)" />
          </q-item-section>
          <q-item-section>
            <q-item-label class="qa-message">
              <span v-if="issue.params && issue.params.color" class="qa-swatch" :style="{ background: issue.params.color }" />{{ message(issue) }}
            </q-item-label>
            <q-item-label caption><span v-if="sourceOf(issue) === 'ai'" class="qa-ai-badge"><q-icon name="mdi-creation" size="12px" />{{ $t('qa.sourceAi') }}</span>{{ place(issue) }}</q-item-label>
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
      <q-expansion-item v-if="shownIgnored.length" dense class="qa-ignored" :label="$t('qa.ignoredCount', { count: shownIgnored.length })">
        <q-list separator>
          <q-item v-for="issue in shownIgnored" :key="issue.fingerprint" class="qa-ignored-issue text-grey-7">
            <q-item-section>
              <q-item-label>{{ message(issue) }}</q-item-label>
              <q-item-label caption><span v-if="sourceOf(issue) === 'ai'" class="qa-ai-badge"><q-icon name="mdi-creation" size="12px" />{{ $t('qa.sourceAi') }}</span>{{ place(issue) }}</q-item-label>
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
import AiService, { aiAllowed } from '@/services/ai'
import { SEVERITY_ICONS, issueMessage, issuePlace, issueCounts, openIssue, issueSource, issuesOfSource, sourceCounts } from '@/services/qa'
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
    request: 0, // Number of the last loading: only its answer is shown
    aiAt: null, // Date of the last quality check by the AI
    aiLoading: false,
    source: 'all' // Issues shown: all, standard rules or AI
  }),

  computed: {
    aiCheck: function() {
      return aiAllowed(this.$settings, 'ai:qa')
    },

    // Counts of the severities of the issues shown
    summary: function() {
      var counts = issueCounts(this.shownIssues)
      return $t('qa.summary', counts)
    },

    shownIssues: function() {
      return issuesOfSource(this.issues, this.source)
    },

    shownIgnored: function() {
      return issuesOfSource(this.ignored, this.source)
    },

    // Filter by source shown when the AI can be used or has issues (otherwise all the issues are of the standard rules)
    showSources: function() {
      return this.aiCheck || [...this.issues, ...this.ignored].some((issue) => issueSource(issue) === 'ai')
    },

    sourceOptions: function() {
      var counts = sourceCounts(this.issues)
      return [
        { value: 'all', label: `${$t('qa.sourceAll')} (${counts.all})` },
        { value: 'rules', label: `${$t('qa.sourceRules')} (${counts.rules})` },
        { value: 'ai', label: `${$t('qa.sourceAi')} (${counts.ai})`, icon: 'mdi-creation' }
      ]
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
        this.aiAt = data.data.datas.ai ? data.data.datas.ai.at : null
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

    // Quality check of the findings by the AI, then the issues listed with the others
    runAi: function() {
      this.aiLoading = true
      return AiService.checkAudit(this.auditId)
      .then(() => this.load())
      .catch((err) => { this.error = errorMessage(err) })
      .finally(() => { this.aiLoading = false })
    },

    setIgnored: function(issue, ignored) {
      return AuditService.setAuditQaIgnored(this.auditId, issue.fingerprint, ignored)
      .then(() => this.load())
      .catch((err) => { this.error = errorMessage(err) })
    },

    // Page of the issue, its field and passage shown (audit page)
    open: function(issue) {
      this.$emit('close')
      return openIssue(this.$router, this.auditId, issue)
    },

    icon: (issue) => SEVERITY_ICONS[issue.severity] || SEVERITY_ICONS.info,
    sourceOf: (issue) => issueSource(issue),
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

.qa-ai-badge
  display: inline-flex
  align-items: center
  gap: 2px
  margin-right: 6px
  padding: 0 4px
  border: 1px solid currentColor
  border-radius: 4px
  color: var(--q-primary)
  font-size: 11px
  line-height: 16px

.qa-swatch
  display: inline-block
  width: 10px
  height: 10px
  border-radius: 2px
  margin-right: 6px
  border: 1px solid rgba(0, 0, 0, 0.2)
</style>
