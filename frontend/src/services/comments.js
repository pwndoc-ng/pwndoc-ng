import { reactive } from 'vue'
import { Notify } from 'quasar'

import AuditService from '@/services/audit'
import UserService from '@/services/user'
import Utils from '@/services/utils'
import { $t } from '@/boot/i18n'

// Review comments of an audit.
// A comment targets a field of the audit: {kind: general|network|finding|section, findingId?, sectionId?, field},
// optionally a passage of a text field (quote: {exact, prefix, suffix}).
// The store is created by the audit edit page and provided ('auditComments') to its pages, editors and fields.

// Unique key of a target, e.g. 'general:name', 'finding:<id>:description', 'section:<id>:customFields.<id>'
export function targetKey(target) {
  if (!target)
    return ''
  var id = target.kind === 'finding' ? target.findingId : (target.kind === 'section' ? target.sectionId : null)
  return [target.kind, id, target.field].filter(part => part).join(':')
}

const FIELD_LABELS = {
  general: {
    name: 'name', auditType: 'comments.auditType', language: 'language', template: 'template', company: 'company',
    client: 'client', reviewers: 'reviewers', collaborators: 'collaborators', date_start: 'startDate',
    date_end: 'endDate', date: 'reportingDate', scope: 'auditScope'
  },
  finding: {
    status: 'comments.status', title: 'title', vulnType: 'type', description: 'description', observation: 'observation',
    references: 'references', poc: 'proofs', scope: 'affectedAssets', cvssv3: 'CVSS',
    remediationComplexity: 'remediationDifficulty', priority: 'priority', remediation: 'remediation'
  },
  section: { text: 'description' }
}

// Finding fields displayed in each tab of the finding page (to open the right tab when navigating)
// Audit arrays may not be loaded yet (the edit page initializes audit.findings to {})
const asArray = (value) => Array.isArray(value) ? value : []

export const FINDING_FIELD_TABS = {
  proofs: ['poc'],
  details: ['scope', 'cvssv3', 'remediationComplexity', 'priority', 'remediation']
}

export function createCommentsStore(auditId, options) {
  // options: {getAudit(): audit object of the edit page, getCustomFields(): custom fields definitions,
  //           canEdit(): current user is an editor of the audit, navigate(comment): go to the commented element}
  const store = reactive({
    auditId: auditId,
    items: [],
    loaded: false,
    panelOpen: false,
    status: 'open',       // open | resolved | all
    onlyMine: false,
    targetFilter: null,   // target: show only the comments of this field
    activeId: null,       // comment expanded in the panel
    draft: null,          // new comment being written: {target, quote}
    focus: null,          // element to show after navigation: {key, commentId, kind, findingId, field, at}

    async load() {
      try {
        const response = await AuditService.getComments(this.auditId)
        this.items = response.data.datas
        this.loaded = true
      }
      catch (err) {
        console.log(err)
      }
    },

    me() {
      return UserService.user.id
    },

    // ----- Queries -----

    forTarget(target) {
      const key = targetKey(target)
      return this.items.filter(comment => targetKey(comment.target) === key)
    },

    openCount(predicate = () => true) {
      return this.items.filter(comment => !comment.resolved && predicate(comment)).length
    },

    openCountForTarget(target) {
      const key = targetKey(target)
      return this.openCount(comment => targetKey(comment.target) === key)
    },

    // Comments shown in the panel (filters), ordered by location then date
    filtered() {
      const filterKey = this.targetFilter ? targetKey(this.targetFilter) : null
      return this.items
        .filter(comment => this.status === 'all' || (this.status === 'open' ? !comment.resolved : comment.resolved))
        .filter(comment => !this.onlyMine || (comment.author && comment.author._id === this.me()))
        .filter(comment => !filterKey || targetKey(comment.target) === filterKey)
        .sort((a, b) => this.locationOrder(a.target) - this.locationOrder(b.target) || new Date(a.createdAt) - new Date(b.createdAt))
    },

    // ----- Labels -----

    locationOrder(target) {
      const audit = options.getAudit() || {}
      if (target.kind === 'general') return 0
      if (target.kind === 'network') return 1
      if (target.kind === 'finding') {
        const index = asArray(audit.findings).findIndex(f => f._id === target.findingId)
        return 100 + (index < 0 ? 9999 : index)
      }
      const index = asArray(audit.sections).findIndex(s => s._id === target.sectionId)
      return 20000 + (index < 0 ? 9999 : index)
    },

    locationLabel(target) {
      const audit = options.getAudit() || {}
      if (target.kind === 'general') return $t('generalInformation')
      if (target.kind === 'network') return $t('networkScan')
      if (target.kind === 'finding') {
        const finding = asArray(audit.findings).find(f => f._id === target.findingId)
        return finding ? finding.title : $t('comments.deletedElement')
      }
      const section = asArray(audit.sections).find(s => s._id === target.sectionId)
      return section ? section.name : $t('comments.deletedElement')
    },

    fieldLabel(target) {
      const field = target.field || ''
      if (field.startsWith('customFields.')) {
        const id = field.substring('customFields.'.length)
        const customField = asArray(options.getCustomFields()).find(cf => cf._id === id)
        return customField ? customField.label : $t('comments.deletedElement')
      }
      if (target.kind === 'network' && field.startsWith('scope.'))
        return field.substring('scope.'.length)
      const key = (FIELD_LABELS[target.kind] || {})[field]
      return key ? (key === 'CVSS' ? key : $t(key)) : field
    },

    // HTML of the commented field in the audit data, to check that a quoted passage still exists
    fieldContent(target) {
      const audit = options.getAudit() || {}
      let container = null
      if (target.kind === 'general') container = audit
      else if (target.kind === 'finding') container = asArray(audit.findings).find(f => f._id === target.findingId)
      else if (target.kind === 'section') container = asArray(audit.sections).find(s => s._id === target.sectionId)
      if (!container) return null
      if (target.field.startsWith('customFields.')) {
        const id = target.field.substring('customFields.'.length)
        const field = asArray(container.customFields).find(cf => cf.customField && (cf.customField._id || cf.customField) === id)
        return field ? field.text : null
      }
      return container[target.field]
    },

    // A quoted passage or image which is no longer in the field (modified since the comment)
    isOutdated(comment) {
      if (comment.image && comment.image.src && !comment.image.src.startsWith('hash:')) {
        const html = this.fieldContent(comment.target)
        return typeof html === 'string' && !html.includes(comment.image.src)
      }
      if (!comment.quote || !comment.quote.exact) return false
      const content = this.fieldContent(comment.target)
      if (typeof content !== 'string') return false
      const normalize = text => text.replace(/\s+/g, ' ').trim()
      return !normalize(Utils.htmlToText(content)).includes(normalize(comment.quote.exact))
    },

    // Audit in review (or approved): editors propose comments, not formatting
    inReview() {
      const audit = options.getAudit()
      return !!(audit && audit.state && audit.state !== 'EDIT')
    },

    // ----- Permissions (also checked by the backend) -----

    canResolve(comment) {
      return (comment.author && comment.author._id === this.me()) || options.canEdit()
    },

    canDelete(comment) {
      return (comment.author && comment.author._id === this.me()) || UserService.isAllowed('audits:update-all')
    },

    // ----- Panel actions -----

    openPanel() {
      this.panelOpen = true
    },

    // Comments of one field (comment button of a field)
    openTarget(target) {
      this.targetFilter = target
      this.status = 'all'
      this.draft = {target: target, quote: null}
      this.activeId = null
      this.panelOpen = true
    },

    // New comment on a passage ({exact, prefix, suffix}) or an image ({src, alt}) of a text field
    startComment(target, quote, image = null) {
      this.targetFilter = null
      this.draft = {target: target, quote: quote, image: image}
      this.activeId = null
      this.panelOpen = true
    },

    // Show one comment (click on a highlighted passage)
    show(commentId) {
      const comment = this.items.find(c => c._id === commentId)
      if (!comment) return
      if (this.status !== 'all' && (comment.resolved ? 'resolved' : 'open') !== this.status)
        this.status = 'all'
      this.activeId = commentId
      this.panelOpen = true
    },

    // Show a comment and go to the commented element
    select(comment) {
      this.activeId = comment._id
      options.navigate(comment)
    },

    // Previous / next comment of the filtered list (tour of the comments)
    move(step) {
      const list = this.filtered()
      if (list.length === 0) return
      const index = list.findIndex(c => c._id === this.activeId)
      const next = index < 0 ? (step > 0 ? 0 : list.length - 1) : (index + step + list.length) % list.length
      this.select(list[next])
    },

    // ----- API -----

    async request(call) {
      try {
        const response = await call()
        this.items = response.data.datas
        return true
      }
      catch (err) {
        Notify.create({
          message: (err.response && err.response.data && err.response.data.datas) || err.message,
          color: 'negative',
          textColor: 'white',
          position: 'top-right'
        })
        return false
      }
    },

    async create(text) {
      const draft = this.draft
      const comment = {target: draft.target, text: text}
      if (draft.quote) comment.quote = draft.quote
      if (draft.image) comment.image = draft.image
      const before = new Set(this.items.map(c => c._id))
      if (await this.request(() => AuditService.createComment(this.auditId, comment))) {
        this.draft = null
        const created = this.items.find(c => !before.has(c._id))
        if (created) this.activeId = created._id
        return true
      }
      return false
    },

    reply(comment, text) {
      return this.request(() => AuditService.replyComment(this.auditId, comment._id, text))
    },

    setResolved(comment, resolved) {
      return this.request(() => AuditService.updateComment(this.auditId, comment._id, {resolved: resolved}))
    },

    remove(comment) {
      return this.request(() => AuditService.deleteComment(this.auditId, comment._id))
    }
  })
  return store
}
