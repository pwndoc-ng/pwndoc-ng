<template>
  <!-- Review of a vulnerability proposal: comparison field by field, accept selection / refuse with a reason -->
  <q-dialog v-model="visible" full-width>
    <q-card v-if="detail" class="proposal-review column no-wrap" style="max-width: 1400px; max-height: 92vh">
      <q-toolbar class="bg-grey-2 text-grey-9">
        <q-chip dense square :color="kind.color" text-color="white">{{ kind.label }}</q-chip>
        <q-toolbar-title class="text-subtitle1 ellipsis">
          {{ proposal.title }} <span class="text-caption text-grey-7">({{ proposal.locale }})</span>
        </q-toolbar-title>
        <q-chip dense :color="status.color" text-color="white" :icon="status.icon">{{ status.label }}</q-chip>
        <q-btn flat round dense icon="close" v-close-popup />
      </q-toolbar>

      <q-card-section class="q-py-sm text-caption text-grey-8">
        {{ $t('proposals.proposedBy', { name: userName(proposal.creator), date: formatDate(proposal.createdAt) }) }}
        <template v-if="proposal.source && proposal.source.audit">
          · <router-link :to="`/audits/${proposal.source.audit}/findings/${proposal.source.finding}`" @click="visible = false">{{ $t('proposals.openFinding') }}</router-link>
        </template>
      </q-card-section>

      <q-banner v-if="proposal.status && proposal.status !== 'pending'" dense :class="`bg-${status.color} text-white q-mx-md q-mb-sm rounded-borders`">
        <template #avatar><q-icon :name="status.icon" /></template>
        {{ $t('proposals.reviewedBy', { status: status.label, name: userName(proposal.reviewer), date: formatDate(proposal.reviewedAt) }) }}
        <div v-if="proposal.reviewComment" class="text-italic">« {{ proposal.reviewComment }} »</div>
      </q-banner>
      <q-banner v-if="!detail.vulnerability" dense class="bg-grey-3 q-mx-md q-mb-sm rounded-borders">{{ $t('proposals.vulnerabilityDeleted') }}</q-banner>
      <q-separator />

      <q-card-section class="col scroll">
        <div v-if="!rows.length" class="text-grey-7">{{ $t('proposals.noChange') }}</div>
        <div v-for="row of rows" :key="row.field" class="q-mb-lg">
          <div class="row items-center q-mb-xs">
            <q-checkbox v-if="selectable" v-model="selected" :val="row.field" dense class="q-mr-sm" />
            <q-icon v-else-if="isAccepted(row.field)" name="check_circle" color="green" class="q-mr-sm" />
            <q-icon v-else-if="proposal.status === 'partial'" name="remove_circle_outline" color="grey" class="q-mr-sm" />
            <div class="text-weight-bold">{{ row.label }}</div>
          </div>
          <basic-editor
            v-if="row.html"
            :key="row.field + detail.proposal._id"
            :model-value="row.proposed || ''"
            :diff="row.current || ''"
            :editable="false"
            :toolbar="[]"
            :collab="false"
            noSync
          />
          <div v-else class="row q-col-gutter-md">
            <div class="col-6">
              <div class="text-caption text-grey-7">{{ $t('proposals.current') }}</div>
              <div class="proposal-value proposal-value--current">{{ row.current || '—' }}</div>
            </div>
            <div class="col-6">
              <div class="text-caption text-grey-7">{{ $t('proposals.proposed') }}</div>
              <div class="proposal-value proposal-value--proposed">{{ row.proposed || '—' }}</div>
            </div>
          </div>
        </div>
      </q-card-section>

      <template v-if="pending && (isReviewer || isAuthor)">
        <q-separator />
        <q-card-actions class="q-px-md">
          <template v-if="isReviewer">
            <q-btn v-if="selectable" flat no-caps :label="allSelected ? $t('proposals.unselectAll') : $t('proposals.selectAll')" @click="toggleAll" />
            <q-space />
            <q-btn flat no-caps color="negative" :label="$t('proposals.reject')" @click="reject" />
            <q-btn
              unelevated
              no-caps
              color="positive"
              :disable="!creation && !selected.length"
              :label="creation ? $t('proposals.acceptCreation') : $t('proposals.acceptSelection', { count: selected.length })"
              @click="accept"
            />
          </template>
          <template v-else>
            <q-space />
            <q-btn flat no-caps color="negative" :label="$t('proposals.withdraw')" @click="withdraw" />
          </template>
        </q-card-actions>
      </template>
    </q-card>
  </q-dialog>
</template>

<script>
import { defineComponent } from 'vue'
import { Dialog, Notify, date } from 'quasar'

import BasicEditor from 'components/editor'
import VulnerabilityService from '@/services/vulnerability'
import UserService from '@/services/user'
import { statusInfo, kindInfo, userName, PROPOSAL_FIELDS } from '@/services/proposals'
import { $t } from '@/boot/i18n'

export default defineComponent({
  name: 'ProposalReview',

  components: { BasicEditor },

  emits: ['changed'],

  data() {
    return {
      visible: false,
      detail: null,
      selected: [],
    }
  },

  computed: {
    proposal() {
      return this.detail.proposal
    },
    status() {
      return statusInfo(this.proposal.status)
    },
    kind() {
      return kindInfo(this.proposal.kind)
    },
    creation() {
      return this.proposal.kind === 'creation'
    },
    pending() {
      return !this.proposal.status || this.proposal.status === 'pending'
    },
    isReviewer() {
      return UserService.isAllowed('vulnerabilities:update')
    },
    isAuthor() {
      return this.proposal.creator && this.proposal.creator._id === UserService.user.id
    },
    selectable() {
      return this.pending && this.isReviewer && !this.creation && !!this.detail.vulnerability
    },
    allSelected() {
      return this.rows.length > 0 && this.selected.length === this.rows.length
    },
    // Fields shown: changed fields of an update, proposed values of a creation
    rows() {
      const proposal = this.proposal
      const vuln = this.detail.vulnerability || {}
      const currentDetail = (vuln.details || []).find((d) => d.locale === proposal.locale) || {}
      const changed = this.detail.changedFields
      const show = (field, proposed) => (this.creation ? !this.isEmpty(proposed) : changed.includes(field)) ||
        (proposal.acceptedFields || []).includes(field)
      const rows = []
      PROPOSAL_FIELDS.forEach((def) => {
        const proposed = proposal[def.field]
        if (!show(def.field, proposed)) return
        const current = this.creation ? '' : (def.vuln ? vuln[def.field] : currentDetail[def.field])
        rows.push({
          field: def.field,
          label: def.label === 'CVSS' ? def.label : $t(def.label),
          html: !!def.html,
          current: this.display(def, current),
          proposed: this.display(def, proposed),
        })
      })
      ;(proposal.customFields || []).forEach((entry) => {
        const customField = entry.customField || {}
        const id = customField._id || customField
        const field = `customFields.${id}`
        if (!show(field, entry.text)) return
        const currentEntry = (currentDetail.customFields || []).find((e) => (e.customField && (e.customField._id || e.customField)) === id)
        const def = { html: customField.fieldType === 'text', list: Array.isArray(entry.text) }
        rows.push({
          field: field,
          label: customField.label || $t('customFields'),
          html: def.html,
          current: this.creation ? '' : this.display(def, currentEntry && currentEntry.text),
          proposed: this.display(def, entry.text),
        })
      })
      return rows
    },
  },

  methods: {
    userName,

    async open(proposalId) {
      try {
        const response = await VulnerabilityService.getProposal(proposalId)
        this.detail = response.data.datas
        this.selected = this.rows.map((row) => row.field) // Everything selected by default
        this.visible = true
      }
      catch (err) {
        this.notifyError(err)
      }
    },

    isEmpty(value) {
      return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
    },

    display(def, value) {
      if (this.isEmpty(value)) return ''
      if (def.html) return value
      if (def.values) return def.values[value] ? $t(def.values[value]) : String(value)
      if (Array.isArray(value)) return value.join('\n')
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
    },

    isAccepted(field) {
      return (this.proposal.acceptedFields || []).includes(field)
    },

    formatDate(value) {
      return value ? date.formatDate(value, 'DD/MM/YYYY HH:mm') : ''
    },

    toggleAll() {
      this.selected = this.allSelected ? [] : this.rows.map((row) => row.field)
    },

    async accept() {
      try {
        const response = await VulnerabilityService.acceptProposal(this.proposal._id, this.creation ? [] : this.selected)
        this.notify(response.data.datas.status === 'partial' ? $t('proposals.partiallyAcceptedOk') : $t('proposals.acceptedOk'))
        this.done()
      }
      catch (err) {
        this.notifyError(err)
      }
    },

    reject() {
      Dialog.create({
        title: $t('proposals.reject'),
        message: $t('proposals.rejectReason'),
        prompt: { model: '', type: 'textarea', isValid: (value) => !!value.trim() },
        ok: { label: $t('proposals.reject'), color: 'negative' },
        cancel: { label: $t('btn.cancel'), color: 'white' },
        persistent: true,
      }).onOk(async (comment) => {
        try {
          await VulnerabilityService.rejectProposal(this.proposal._id, comment)
          this.notify($t('proposals.rejectedOk'))
          this.done()
        }
        catch (err) {
          this.notifyError(err)
        }
      })
    },

    withdraw() {
      Dialog.create({
        title: $t('proposals.withdraw'),
        message: $t('proposals.withdrawConfirm'),
        ok: { label: $t('btn.confirm'), color: 'negative' },
        cancel: { label: $t('btn.cancel'), color: 'white' },
      }).onOk(async () => {
        try {
          await VulnerabilityService.withdrawProposal(this.proposal._id)
          this.notify($t('proposals.withdrawnOk'))
          this.done()
        }
        catch (err) {
          this.notifyError(err)
        }
      })
    },

    done() {
      this.visible = false
      this.$emit('changed')
      window.dispatchEvent(new Event('proposals-changed')) // Counter of the navigation bar
    },

    notify(message) {
      Notify.create({ message, color: 'positive', textColor: 'white', position: 'top-right' })
    },

    notifyError(err) {
      Notify.create({
        message: (err.response && err.response.data && err.response.data.datas) || err.message,
        color: 'negative',
        textColor: 'white',
        position: 'top-right',
      })
    },
  },
})
</script>

<style>
.proposal-review .proposal-value {
  white-space: pre-line;
  word-break: break-word;
  padding: 6px 8px;
  border-radius: 4px;
  min-height: 34px;
}

.proposal-review .proposal-value--current {
  background: rgba(244, 67, 54, 0.08);
}

.proposal-review .proposal-value--proposed {
  background: rgba(76, 175, 80, 0.12);
}

/* Read-only comparison: no empty space under short texts */
.proposal-review .editor__content .ProseMirror {
  min-height: 0;
}
</style>
