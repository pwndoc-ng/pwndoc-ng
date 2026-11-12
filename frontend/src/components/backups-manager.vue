<template>
  <div>
    <q-card>
      <q-card-section class="row items-center q-col-gutter-sm">
        <div class="col-md col-12">
          <div class="text-grey-8"><q-icon name="mdi-backup-restore" class="q-mr-xs" />{{ $t('backup.title') }}</div>
          <div class="text-caption text-grey-7">{{ $t('backup.info') }}</div>
          <div v-if="schedule" class="text-caption text-grey-7 backup-schedule">
            <q-icon name="mdi-calendar-clock" class="q-mr-xs" />
            <template v-if="schedule.enabled && schedule.nextRun">
              {{ $t('backup.schedule.next', [formatDate(schedule.nextRun)]) }} · {{ schedule.encrypted ? $t('backup.schedule.encrypted') : $t('backup.schedule.notEncrypted') }}
            </template>
            <template v-else>{{ $t('backup.schedule.disabled') }}</template>
          </div>
        </div>
        <div v-if="canCreate" class="col-md-auto col-12 q-gutter-sm">
          <q-btn unelevated no-caps color="secondary" icon="mdi-database-export" :label="$t('backup.create')" :disable="!!serverOperation" @click="openCreate" />
          <q-btn outline no-caps color="secondary" icon="mdi-upload" :label="$t('backup.upload')" :loading="upload.running" @click="$refs.uploadInput.click()" />
          <input ref="uploadInput" type="file" accept=".zip,.enc" class="hidden" @change="uploadBackup" />
        </div>
      </q-card-section>
      <q-linear-progress v-if="upload.running" :value="upload.progress" color="secondary" size="4px" />
      <q-banner v-if="serverOperation" dense class="bg-blue-1 text-grey-9 backup-server-operation">
        <template #avatar><q-icon name="mdi-progress-clock" color="secondary" /></template>
        {{ $t(`backup.serverOperation.${serverOperation.type}`) }} · {{ progressText(serverOperation) }}
        <q-linear-progress :value="progressFraction(serverOperation) || 0" :indeterminate="progressFraction(serverOperation) === null" color="secondary" size="4px" class="q-mt-xs" />
      </q-banner>
      <q-table
        flat
        :rows="backups"
        :columns="columns"
        row-key="id"
        :loading="loading"
        :pagination="{ rowsPerPage: 10 }"
        :no-data-label="$t('backup.noBackup')"
        class="backups-table"
      >
        <template #body-cell-name="props">
          <q-td :props="props">
            <q-icon v-if="props.row.encrypted" name="mdi-lock" color="grey-7" class="q-mr-xs">
              <q-tooltip>{{ $t('backup.encrypted') }}</q-tooltip>
            </q-icon>
            {{ displayName(props.row) }}
            <q-chip v-if="props.row.origin === 'uploaded'" dense size="sm" color="grey-3" text-color="grey-8" icon="mdi-upload">{{ $t('backup.uploaded') }}</q-chip>
            <q-chip v-if="props.row.origin === 'scheduled'" dense size="sm" color="grey-3" text-color="grey-8" icon="mdi-calendar-clock">{{ $t('backup.scheduled') }}</q-chip>
          </q-td>
        </template>
        <template #body-cell-content="props">
          <q-td :props="props">
            <q-chip v-if="props.row.type" dense size="sm" :color="props.row.type === 'full' ? 'secondary' : 'blue-grey-6'" text-color="white">
              {{ $t(`backup.type.${props.row.type}`) }}
              <q-tooltip v-if="props.row.type === 'partial'" max-width="320px">{{ categoryList(props.row.categories) }}</q-tooltip>
            </q-chip>
            <span v-else class="text-caption text-grey-7">{{ $t('backup.contentUnknown') }}</span>
          </q-td>
        </template>
        <template #body-cell-actions="props">
          <q-td :props="props" class="text-right">
            <q-btn v-if="canRead" flat round dense size="sm" color="secondary" icon="mdi-download" :loading="downloading === props.row.id" @click="downloadBackup(props.row)">
              <q-tooltip>{{ $t('backup.download') }}</q-tooltip>
            </q-btn>
            <q-btn v-if="canRestore" flat round dense size="sm" color="warning" icon="mdi-backup-restore" :disable="!!serverOperation" @click="openRestore(props.row)">
              <q-tooltip>{{ $t('backup.restore') }}</q-tooltip>
            </q-btn>
            <q-btn v-if="canDelete" flat round dense size="sm" color="negative" icon="delete" @click="deleteBackup(props.row)">
              <q-tooltip>{{ $t('btn.delete') }}</q-tooltip>
            </q-btn>
          </q-td>
        </template>
      </q-table>
    </q-card>

    <!-- Creation: all the data or a selection, optional encryption -->
    <q-dialog v-model="create.show" :persistent="create.running">
      <q-card class="backup-dialog">
        <q-card-section class="row items-center">
          <div class="text-h6">{{ $t('backup.create') }}</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup :disable="create.running" />
        </q-card-section>
        <q-separator />
        <q-card-section class="q-gutter-y-md">
          <q-input v-model="create.name" outlined dense maxlength="100" :label="$t('name')" />
          <q-option-group
            v-model="create.type"
            inline
            :options="[{ label: $t('backup.type.full'), value: 'full' }, { label: $t('backup.type.partial'), value: 'partial' }]"
          />
          <div v-if="create.type === 'partial'" class="backup-categories">
            <div class="text-caption text-grey-7 q-mb-xs">{{ $t('backup.selectData') }}</div>
            <template v-for="group in groups(allCategories)" :key="group.key">
              <q-checkbox
                v-if="group.categories.length > 1"
                dense
                class="full-width q-mb-xs"
                :model-value="groupState(group, create.categories)"
                :label="$t(`backup.categories.${group.key}`)"
                @update:model-value="(value) => toggleGroup(create, group, value, true)"
              />
              <q-checkbox
                v-for="category in group.categories"
                :key="category"
                dense
                class="full-width q-mb-xs"
                :class="{ 'q-pl-lg': group.categories.length > 1 }"
                :model-value="create.categories.includes(category)"
                :disable="requiredBy(category, create.categories).length > 0"
                :label="$t(`backup.categories.${category}`)"
                @update:model-value="(value) => toggleCategory(create, category, value, true)"
              >
                <q-tooltip v-if="requiredBy(category, create.categories).length > 0">
                  {{ $t('backup.requiredBy', [categoryList(requiredBy(category, create.categories))]) }}
                </q-tooltip>
              </q-checkbox>
            </template>
          </div>
          <div class="row q-col-gutter-md">
            <q-input class="col-sm-6 col-12" v-model="create.password" type="password" outlined dense autocomplete="new-password" :label="$t('backup.password')" :hint="$t('backup.passwordInfo')" />
            <q-input
              class="col-sm-6 col-12"
              v-model="create.confirm"
              type="password"
              outlined
              dense
              autocomplete="new-password"
              :disable="!create.password"
              :label="$t('backup.passwordConfirm')"
              :error="!!create.password && !!create.confirm && create.password !== create.confirm"
              :error-message="$t('backup.passwordsMismatch')"
            />
          </div>
          <div v-if="create.running" class="backup-progress">
            <q-linear-progress :value="progressValue || 0" :indeterminate="progressValue === null" color="secondary" size="6px" />
            <div class="text-caption text-grey-7 q-mt-xs">{{ progressLabel }}</div>
          </div>
        </q-card-section>
        <q-card-actions align="right" class="q-px-md q-pb-md">
          <q-btn flat no-caps :label="$t('btn.cancel')" v-close-popup :disable="create.running" />
          <q-btn
            unelevated
            no-caps
            color="secondary"
            icon="mdi-database-export"
            :label="$t('backup.createBtn')"
            :loading="create.running"
            :disable="(create.type === 'partial' && create.categories.length === 0) || (!!create.password && create.password !== create.confirm)"
            @click="createBackup"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Restore: data of the backup replaced or merged -->
    <q-dialog v-model="restore.show" :persistent="restore.running">
      <q-card v-if="restore.backup" class="backup-dialog">
        <q-card-section class="row items-center">
          <div class="text-h6">{{ $t('backup.restoreTitle', [displayName(restore.backup)]) }}</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup :disable="restore.running" />
        </q-card-section>
        <q-separator />
        <q-card-section class="q-gutter-y-md">
          <div class="text-caption text-grey-7">{{ formatDate(restore.backup.createdAt || restore.backup.addedAt) }}</div>
          <q-option-group
            v-model="restore.mode"
            :options="[
              { label: $t('backup.mode.merge'), value: 'merge' },
              { label: $t('backup.mode.replace'), value: 'replace' },
            ]"
          />
          <div class="text-caption text-grey-8 q-pl-sm">{{ $t(`backup.modeInfo.${restore.mode}`) }}</div>
          <div v-if="restore.backup.categories" class="backup-categories">
            <div class="text-caption text-grey-7 q-mb-xs">{{ $t('backup.selectRestoredData') }}</div>
            <template v-for="group in groups(restore.backup.categories)" :key="group.key">
              <q-checkbox
                v-if="group.categories.length > 1"
                dense
                class="full-width q-mb-xs"
                :model-value="groupState(group, restore.categories)"
                :label="$t(`backup.categories.${group.key}`)"
                @update:model-value="(value) => toggleGroup(restore, group, value, false)"
              />
              <q-checkbox
                v-for="category in group.categories"
                :key="category"
                dense
                class="full-width q-mb-xs"
                :class="{ 'q-pl-lg': group.categories.length > 1 }"
                :model-value="restore.categories.includes(category)"
                :label="`${$t(`backup.categories.${category}`)}${countOf(restore.backup, category)}`"
                @update:model-value="(value) => toggleCategory(restore, category, value, false)"
              />
            </template>
          </div>
          <div v-else class="text-caption text-grey-8">{{ $t('backup.contentUnknownInfo') }}</div>
          <q-input v-if="restore.backup.encrypted" v-model="restore.password" type="password" outlined dense autocomplete="off" :label="$t('backup.importPassword')" />
          <q-banner dense class="rounded-borders" :class="restore.mode === 'replace' ? 'bg-red-1 text-negative' : 'bg-orange-1 text-orange-10'">
            <template #avatar><q-icon name="warning" :color="restore.mode === 'replace' ? 'negative' : 'orange-10'" /></template>
            {{ $t(`backup.restoreWarning.${restore.mode}`) }}
          </q-banner>
          <div v-if="restore.running" class="backup-progress">
            <q-linear-progress :value="progressValue || 0" :indeterminate="progressValue === null" :color="restore.mode === 'replace' ? 'negative' : 'warning'" size="6px" />
            <div class="text-caption text-grey-7 q-mt-xs">{{ progressLabel }}</div>
          </div>
        </q-card-section>
        <q-card-actions align="right" class="q-px-md q-pb-md">
          <q-btn flat no-caps :label="$t('btn.cancel')" v-close-popup :disable="restore.running" />
          <q-btn
            unelevated
            no-caps
            :color="restore.mode === 'replace' ? 'negative' : 'warning'"
            icon="mdi-backup-restore"
            :label="$t('backup.restoreBtn')"
            :loading="restore.running"
            :disable="(!!restore.backup.categories && restore.categories.length === 0) || (restore.backup.encrypted && !restore.password)"
            @click="confirmRestore"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script>
import { Dialog, Notify, date } from 'quasar'

import BackupService from '@/services/backup'
import UserService from '@/services/user'

import { $t } from '@/boot/i18n'

export default {
  name: 'BackupsManager',

  data() {
    return {
      backups: [],
      loading: false,
      downloading: null,
      upload: { running: false, progress: 0 },
      create: { show: false, running: false, name: '', type: 'full', categories: [], password: '', confirm: '' },
      restore: { show: false, running: false, backup: null, mode: 'merge', categories: [], password: '' },
      schedule: null, // Automatic backups: {enabled, encrypted, nextRun}
      serverOperation: null, // Creation or restore running on the server, not started from this page (automatic backup...)
      serverTimer: null,
      left: false, // Page left: no more checks
      progress: null, // Creation or restore running on the server: {type, step, done, total}
      progressTimer: null,
    }
  },

  computed: {
    canRead() { return UserService.isAllowed('backups:read') },
    canCreate() { return UserService.isAllowed('backups:create') },
    canRestore() { return UserService.isAllowed('backups:restore') },
    canDelete() { return UserService.isAllowed('backups:delete') },
    // Progress of the creation or the restore started from this page
    progressValue() { return this.progressFraction(this.progress) },
    progressLabel() { return this.progressText(this.progress) },
    allCategories() { return BackupService.CATEGORY_GROUPS.flatMap((group) => group.categories) },
    columns() {
      return [
        { name: 'name', label: $t('name'), field: 'name', align: 'left', sortable: true },
        { name: 'createdAt', label: $t('date'), field: (row) => row.createdAt || row.addedAt, format: (value) => this.formatDate(value), align: 'left', sortable: true },
        { name: 'content', label: $t('backup.content'), field: 'type', align: 'left' },
        { name: 'size', label: $t('backup.size'), field: 'size', format: (value) => this.formatSize(value), align: 'right', sortable: true },
        { name: 'actions', label: '', field: 'id', align: 'right' },
      ]
    },
  },

  mounted() {
    if (this.canRead) {
      this.getBackups()
      this.checkServerOperation()
    }
  },

  beforeUnmount() {
    this.left = true
    clearTimeout(this.serverTimer)
    this.stopProgress()
  },

  methods: {
    notifyError: async function(err) {
      Notify.create({ message: await BackupService.errorMessage(err), color: 'negative', textColor: 'white', position: 'top-right', timeout: 10000 })
    },

    getBackups: function() {
      this.loading = true
      BackupService.getBackups()
        .then((response) => { this.backups = response.data.datas })
        .catch((err) => this.notifyError(err))
        .finally(() => { this.loading = false })
      // Next automatic backup (changes once one is made): not shown if it cannot be read
      BackupService.getSchedule()
        .then((response) => { this.schedule = response.data.datas })
        .catch(() => { this.schedule = null })
    },

    // Progress of the creation or the restore, read every second while the request runs
    watchProgress: function() {
      this.stopProgress()
      this.progressTimer = setInterval(() => {
        BackupService.getProgress()
          .then((response) => { if (this.progressTimer) this.progress = response.data.datas })
          .catch(() => {})
      }, 1000)
    },

    stopProgress: function() {
      clearInterval(this.progressTimer)
      this.progressTimer = null
      this.progress = null
    },

    // Fraction done of an operation, null when unknown (indeterminate bar)
    progressFraction: function(progress) {
      return progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : null
    },

    progressText: function(progress) {
      if (!progress) return $t('backup.progress.start')
      var fraction = this.progressFraction(progress)
      var percent = fraction === null ? '' : ` (${Math.floor(fraction * 100)} %)`
      if (progress.step === 'data') return `${$t('backup.progress.data', [progress.done, progress.total])}${percent}`
      return `${$t(`backup.progress.${progress.step}`)}${percent}`
    },

    // Operation of the server not started from this page (automatic backup, other user): shown with its progress, the list is
    // refreshed at its end. Checked every 15 seconds, every second while it runs; not while an operation of this page runs
    checkServerOperation: function() {
      if (this.progressTimer)
        return this.nextServerCheck(15000)
      BackupService.getProgress()
        .then((response) => {
          if (this.left || this.progressTimer) return
          var progress = response.data.datas && response.data.datas.type ? response.data.datas : null
          var finished = this.serverOperation && !progress
          this.serverOperation = progress
          if (finished) this.getBackups()
          this.nextServerCheck(progress ? 1000 : 15000)
        })
        .catch(() => this.nextServerCheck(15000))
    },

    nextServerCheck: function(delay) {
      clearTimeout(this.serverTimer)
      if (!this.left) this.serverTimer = setTimeout(() => this.checkServerOperation(), delay)
    },

    // Name of a backup: automatic backups named by the server, in the language of the interface
    displayName: function(backup) {
      return backup.origin === 'scheduled' && backup.name === 'Automatic backup' ? $t('backup.scheduledName') : backup.name
    },

    formatDate: function(value) {
      return value ? date.formatDate(value, 'YYYY-MM-DD HH:mm') : ''
    },

    formatSize: function(bytes) {
      if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
      return `${Math.max(1, Math.round(bytes / 1024))} KB`
    },

    categoryList: function(categories) {
      return (categories || []).map((category) => $t(`backup.categories.${category}`)).join(', ')
    },

    // Number of documents of a category in a backup: ' (12)'
    countOf: function(backup, category) {
      var collections = { audits: 'Audit', images: 'Image', vulnerabilities: 'Vulnerability', users: 'User', companies: 'Company', clients: 'Client',
        templates: 'Template', languages: 'Language', auditTypes: 'AuditType', vulnerabilityTypes: 'VulnerabilityType',
        vulnerabilityCategories: 'VulnerabilityCategory', customFields: 'CustomField', customSections: 'CustomSection', spellcheckWords: 'SpellcheckWord', settings: null }
      var count = collections[category] && backup.collections ? backup.collections[collections[category]] : undefined
      return count === undefined ? '' : ` (${count})`
    },

    /* Selection of the data (creation: dependencies always selected, restore: categories of the backup) */

    // Groups of the selection tree containing some of the given categories
    groups: function(categories) {
      return BackupService.CATEGORY_GROUPS
        .map((group) => ({ key: group.key, categories: group.categories.filter((category) => categories.includes(category)) }))
        .filter((group) => group.categories.length > 0)
    },

    // Selected categories needing this category
    requiredBy: function(category, selected) {
      return selected.filter((other) => (BackupService.DEPENDENCIES[other] || []).includes(category))
    },

    groupState: function(group, selected) {
      var count = group.categories.filter((category) => selected.includes(category)).length
      return count === 0 ? false : (count === group.categories.length ? true : null)
    },

    toggleCategory: function(target, category, value, withDependencies) {
      var selected = new Set(target.categories)
      if (value) {
        selected.add(category)
        if (withDependencies) (BackupService.DEPENDENCIES[category] || []).forEach((dependency) => selected.add(dependency))
      }
      else if (!withDependencies || this.requiredBy(category, target.categories).length === 0)
        selected.delete(category)
      target.categories = this.allCategories.filter((name) => selected.has(name))
    },

    toggleGroup: function(target, group, value, withDependencies) {
      // Partially selected group: selected entirely
      if (value !== false) {
        group.categories.forEach((category) => this.toggleCategory(target, category, true, withDependencies))
        return
      }
      // Unselected at once (dependencies inside the group: clients -> companies), except the categories required by
      // selected categories outside the group
      var outside = target.categories.filter((category) => !group.categories.includes(category))
      var kept = group.categories.filter((category) => withDependencies && this.requiredBy(category, outside).length > 0)
      target.categories = this.allCategories.filter((name) => target.categories.includes(name) && (!group.categories.includes(name) || kept.includes(name)))
    },

    /* Creation */

    openCreate: function() {
      Object.assign(this.create, {
        show: true, running: false, type: 'full', categories: [], password: '', confirm: '',
        name: `${$t('backup.defaultName')} ${date.formatDate(Date.now(), 'YYYY-MM-DD HH:mm')}`,
      })
    },

    createBackup: async function() {
      this.create.running = true
      this.watchProgress()
      try {
        var categories = this.create.type === 'partial' ? this.create.categories : null
        await BackupService.createBackup(this.create.name, categories, this.create.password)
        this.create.show = false
        Notify.create({ message: $t('backup.createOk'), color: 'positive', textColor: 'white', position: 'top-right' })
        this.getBackups()
      }
      catch (err) {
        this.notifyError(err)
      }
      this.stopProgress()
      this.create.running = false
      this.create.password = ''
      this.create.confirm = ''
    },

    /* Upload and download */

    uploadBackup: async function(event) {
      var file = event.target.files && event.target.files[0]
      event.target.value = '' // Same file can be selected again
      if (!file) return
      this.upload.running = true
      this.upload.progress = 0
      try {
        await BackupService.uploadBackup(file, (progress) => {
          if (progress.total) this.upload.progress = progress.loaded / progress.total
        })
        Notify.create({ message: $t('backup.uploadOk', [file.name]), color: 'positive', textColor: 'white', position: 'top-right' })
        this.getBackups()
      }
      catch (err) {
        this.notifyError(err)
      }
      this.upload.running = false
    },

    // Downloaded by the browser, not held in memory (backups of several GB): file name given by the server. The list is
    // requested first: the session is renewed if needed, and a backup deleted meanwhile is not downloaded (the link would
    // download the error message)
    downloadBackup: async function(backup) {
      this.downloading = backup.id
      try {
        this.backups = (await BackupService.getBackups()).data.datas
        if (this.backups.some(b => b.id === backup.id)) {
          var link = document.createElement('a')
          link.href = BackupService.downloadUrl(backup.id)
          link.download = ''
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
        }
      }
      catch (err) {
        this.notifyError(err)
      }
      this.downloading = null
    },

    deleteBackup: function(backup) {
      Dialog.create({
        title: $t('backup.deleteTitle'),
        message: $t('backup.deleteMessage', [this.displayName(backup)]),
        ok: { label: $t('btn.delete'), color: 'negative', unelevated: true },
        cancel: { label: $t('btn.cancel'), color: 'white' },
      })
        .onOk(() => {
          BackupService.deleteBackup(backup.id)
            .then(() => {
              Notify.create({ message: $t('backup.deleteOk'), color: 'positive', textColor: 'white', position: 'top-right' })
              this.getBackups()
            })
            .catch((err) => this.notifyError(err))
        })
    },

    /* Restore */

    openRestore: function(backup) {
      Object.assign(this.restore, {
        show: true, running: false, backup: backup, mode: 'merge', password: '',
        categories: (backup.categories || []).slice(),
      })
    },

    confirmRestore: function() {
      if (this.restore.mode === 'merge')
        return this.restoreBackup()
      Dialog.create({
        title: $t('backup.confirmTitle'),
        message: $t('backup.confirmMessage', [this.categoryList(this.restore.backup.categories ? this.restore.categories : this.allCategories)]),
        ok: { label: $t('backup.restoreBtn'), color: 'negative', unelevated: true },
        cancel: { label: $t('btn.cancel'), color: 'white' },
        persistent: true,
      })
        .onOk(() => this.restoreBackup())
    },

    restoreBackup: async function() {
      this.restore.running = true
      this.watchProgress()
      var backup = this.restore.backup
      try {
        var categories = backup.categories ? this.restore.categories : undefined
        var response = await BackupService.restoreBackup(backup.id, this.restore.mode, categories, this.restore.password)
        var result = response.data.datas
        this.restore.show = false
        var documents = Object.values(result.collections).reduce((total, count) => total + count, 0)
        if (result.categories.includes('users')) {
          Dialog.create({
            title: $t('backup.restoreOkTitle'),
            message: $t('backup.restoreOkUsers', [documents, result.templates]),
            ok: { label: $t('backup.reconnect'), color: 'secondary', unelevated: true },
            persistent: true,
          })
            .onOk(() => UserService.destroyToken()) // Users have been restored: new login
        }
        else {
          Notify.create({ message: $t('backup.restoreOk', [documents, result.templates]), color: 'positive', textColor: 'white', position: 'top-right' })
          this.getBackups()
        }
      }
      catch (err) {
        this.notifyError(err)
      }
      this.stopProgress()
      this.restore.running = false
      this.restore.password = ''
    },
  },
}
</script>

<style>
.backup-dialog {
  width: 640px;
  max-width: 95vw;
}
.backup-categories {
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  padding: 8px 12px;
  max-height: 340px;
  overflow-y: auto;
}
.backups-table .q-table__bottom {
  border-top: none;
}
</style>
