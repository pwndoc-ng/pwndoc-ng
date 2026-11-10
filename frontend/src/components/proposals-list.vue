<template>
  <!-- Vulnerability proposals: own ones for authors, all of them for reviewers -->
  <div>
    <div class="row items-center q-gutter-sm q-mb-sm">
      <q-btn-toggle
        v-model="status"
        dense
        no-caps
        unelevated
        toggle-color="primary"
        :options="statusOptions"
        @update:model-value="load"
      />
      <q-toggle v-if="isReviewer" v-model="mine" dense :label="$t('proposals.mine')" @update:model-value="load" />
      <q-chip v-if="vulnerabilityFilter" dense removable color="blue-1" text-color="primary" @remove="$emit('clear-vulnerability')">
        {{ vulnerabilityFilter.title }}
      </q-chip>
      <q-space />
      <q-btn flat round dense icon="refresh" @click="load" />
    </div>

    <q-table
      flat
      bordered
      :rows="rows"
      :columns="columns"
      row-key="_id"
      :loading="loading"
      :no-data-label="$t('proposals.none')"
      :pagination="{ rowsPerPage: 25, sortBy: 'createdAt', descending: true }"
      @row-click="(event, row) => $refs.review.open(row._id)"
    >
      <template #body-cell-kind="props">
        <q-td :props="props">
          <q-chip dense square :color="kindInfo(props.row.kind).color" text-color="white">{{ kindInfo(props.row.kind).label }}</q-chip>
        </q-td>
      </template>
      <template #body-cell-status="props">
        <q-td :props="props">
          <q-chip dense :color="statusInfo(props.row.status).color" text-color="white" :icon="statusInfo(props.row.status).icon">
            {{ statusInfo(props.row.status).label }}
          </q-chip>
          <q-tooltip v-if="props.row.reviewComment" max-width="400px">« {{ props.row.reviewComment }} »</q-tooltip>
        </q-td>
      </template>
    </q-table>

    <proposal-review ref="review" @changed="onChanged" />
  </div>
</template>

<script>
import { defineComponent } from 'vue'
import { date } from 'quasar'

import ProposalReview from 'components/proposal-review'
import VulnerabilityService from '@/services/vulnerability'
import UserService from '@/services/user'
import { statusInfo, kindInfo, userName } from '@/services/proposals'
import { $t } from '@/boot/i18n'

export default defineComponent({
  name: 'ProposalsList',

  components: { ProposalReview },

  props: {
    // {id, title}: proposals of one vulnerability
    vulnerabilityFilter: { type: Object, default: null },
  },

  emits: ['changed', 'clear-vulnerability'],

  data() {
    return {
      status: 'pending',
      mine: false,
      rows: [],
      loading: false,
      // Number of the last request: only its answer is shown (filters changed quickly, answers in any order)
      lastRequest: 0,
    }
  },

  computed: {
    isReviewer() {
      return UserService.isAllowed('vulnerabilities:update')
    },
    statusOptions() {
      return ['pending', 'accepted', 'partial', 'rejected'].map((value) => ({ value, label: statusInfo(value).label }))
        .concat([{ value: 'all', label: $t('proposals.all') }])
    },
    columns() {
      return [
        { name: 'kind', label: $t('proposals.kindColumn'), field: 'kind', align: 'left' },
        { name: 'title', label: $t('title'), field: (row) => row.title, align: 'left', sortable: true },
        { name: 'locale', label: $t('language'), field: 'locale', align: 'left' },
        { name: 'creator', label: $t('proposals.author'), field: (row) => userName(row.creator), align: 'left', sortable: true },
        { name: 'createdAt', label: $t('proposals.date'), field: 'createdAt', align: 'left', sortable: true, format: (value) => date.formatDate(value, 'DD/MM/YYYY HH:mm') },
        { name: 'status', label: $t('proposals.statusColumn'), field: 'status', align: 'left' },
        { name: 'reviewer', label: $t('proposals.reviewer'), field: (row) => row.reviewer ? userName(row.reviewer) : '', align: 'left' },
      ]
    },
  },

  watch: {
    vulnerabilityFilter() {
      this.load()
    },
  },

  mounted() {
    this.load()
  },

  methods: {
    statusInfo,
    kindInfo,

    async load() {
      const request = ++this.lastRequest
      this.loading = true
      try {
        const params = { status: this.status }
        if (this.mine) params.mine = 'true'
        if (this.vulnerabilityFilter) params.vulnerability = this.vulnerabilityFilter.id
        const response = await VulnerabilityService.getProposals(params)
        if (request === this.lastRequest)
          this.rows = response.data.datas
      }
      catch (err) {
        console.log(err)
      }
      if (request === this.lastRequest)
        this.loading = false
    },

    onChanged() {
      this.load()
      this.$emit('changed')
    },
  },
})
</script>
