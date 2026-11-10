import { nextTick } from 'vue';
import { Notify, Dialog } from 'quasar';

import Breadcrumb from 'components/breadcrumb';
import TextareaArray from 'components/textarea-array'
import CustomFields from 'components/custom-fields'
import CommentButton from 'components/comment-button'

import AuditService, { errorMessage } from '@/services/audit';
import ClientService from '@/services/client';
import CompanyService from '@/services/company';
import CollabService from '@/services/collaborator';
import ReviewerService from '@/services/reviewer';
import TemplateService from '@/services/template';
import DataService from '@/services/data';
import Utils from '@/services/utils';

import { $t } from '@/boot/i18n'

export default {
    props: {
        frontEndAuditState: Number,
        parentState: String,
        parentApprovals: Array

    },
    data: () => {
        return {
            // Set audit ID
            auditId: null,
            // Current editing audit object (client and company null until loaded: an empty object is shown as
            // "[object Object]" by their selects)
            audit: {
                creator: {},
                name: "",
                auditType: "",
                client: null,
                company: null,
                collaborators: [],
                reviewers: [],
                date: "",
                date_start: "",
                date_end: "",
                scope: [],
                language: "",
                template: "",
                customFields: [],
                approvals: []
            },
            auditOrig: {},
            // Audit loaded: the form is read only and cannot be saved before (the late answer would replace what is typed)
            loaded: false,
            // Saves numbered in the order of the requests: copy of the audit sent by the last one, number of the last one
            // answered (an older save answered after a newer one is not the saved version)
            auditSaving: null,
            saveCount: 0,
            savedCount: 0,
            // List of existing clients
            clients: [],
            // List of filtered clients when searching in select
            selectClients: [],
            // List of filtered clients when company is selected
            selectClientsFromCompany: [],
            // List of existing Collaborators
            collaborators: [],
            // List of existing reviewers
            reviewers: [],
            // List of existing Companies
            companies: [],
            // List of filtered companies
            selectCompanies: [],
            // List of existing Templates
            templates: [],
            // List of existing Languages
            languages: [],
            // List of existing audit types
            auditTypes: [],
            // List of CustomFields
            customFields: [],
            AUDIT_VIEW_STATE: Utils.AUDIT_VIEW_STATE
        }
    },

    components: {
        Breadcrumb,
        TextareaArray,
        CustomFields,
        CommentButton
    },

    mounted: function() {
        this.auditId = this.$route.params.auditId;
        this.getAuditGeneral();
        this.getTemplates();
        this.getLanguages();
        this.getAuditTypes();

        this.$socket.emit('menu', {menu: 'general', room: this.auditId});

        // save on ctrl+s
        document.addEventListener('keydown', this._listener, false)
    },

    unmounted: function() {
        document.removeEventListener('keydown', this._listener, false)
    },

    beforeRouteLeave (to, from , next) {
        Utils.syncEditors(this.$refs)
        if (!this.unsavedChanges())
            next();
        else {
            Dialog.create({
                title: $t('msg.thereAreUnsavedChanges'),
                message: $t('msg.doYouWantToLeave'),
                ok: {label: $t('btn.confirm'), color: 'negative'},
                cancel: {label: $t('btn.cancel'), color: 'white'}
            })
            .onOk(() => next())
        }
    },
    watch: {
        'audit.company': {
          handler(newCompany, oldCompany) {
            this.filterClients();
          },
          deep: true, // in case the object is modified deeply
        },
      },

    computed: {
        readonly: function() {
            return this.frontEndAuditState !== this.AUDIT_VIEW_STATE.EDIT || !this.loaded
        }
    },

    methods: {
        _listener: function(e) {
            if ((window.navigator.platform.match("Mac") ? e.metaKey : e.ctrlKey) && e.keyCode == 83) {
                e.preventDefault();
                // Only trigger save if we're in the general audit context
                if (this.frontEndAuditState === this.AUDIT_VIEW_STATE.EDIT &&
                    this.$route.name === 'general')
                    this.updateAuditGeneral();
            }
        },

        // Get Audit datas from uuid
        getAuditGeneral: function() {
            DataService.getCustomFields()
            .then((data) => {
                this.customFields = data.data.datas
                return AuditService.getAuditGeneral(this.auditId)
            })
            .then((data) => {
                this.audit = data.data.datas;
                this.auditOrig = this.$_.cloneDeep(this.audit);
                this.loaded = true
                this.getCollaborators();
                this.getReviewers();
                this.getClients();
            })
            .catch((err) => {
                console.log(err.response)
            })
        },

        // Changes not saved, nor being saved. Nothing can be changed before the audit is loaded (audit not readable:
        // the redirection to the error page must not be blocked)
        unsavedChanges: function() {
            if (!this.loaded || this.$_.isEqual(this.audit, this.auditOrig))
                return false
            return !(this.auditSaving && this.$_.isEqual(this.audit, this.auditSaving))
        },

        // Save Audit
        updateAuditGeneral: function() {
            if (!this.loaded) return
            Utils.syncEditors(this.$refs)
            nextTick(() => {
                if (this.$refs.customfields && this.$refs.customfields.requiredFieldsEmpty()) {
                    Notify.create({
                        message: $t('msg.fieldRequired'),
                        color: 'negative',
                        textColor:'white',
                        position: 'top-right'
                    })
                    return
                }
                // Saved version: the data sent, not the data typed while the request is pending
                var sent = this.$_.cloneDeep(this.audit)
                var save = ++this.saveCount
                this.auditSaving = sent
                AuditService.updateAuditGeneral(this.auditId, sent)
                .then(() => {
                    if (save > this.savedCount) {
                        this.savedCount = save
                        this.auditOrig = sent;
                    }
                    Notify.create({
                        message: $t('msg.auditUpdateOk'),
                        color: 'positive',
                        textColor:'white',
                        position: 'top-right'
                    })
                })
                .catch((err) => {
                    Notify.create({
                        message: errorMessage(err),
                        color: 'negative',
                        textColor:'white',
                        position: 'top-right'
                    })
                })
                .finally(() => {
                    if (save === this.saveCount) // Not a later save
                        this.auditSaving = null
                })
            }).catch((err) => {
                console.error('Error in updateAuditGeneral nextTick:', err);
            })
        },

        // Get Clients list
        getClients: function() {
            ClientService.getClients()
            .then((data) => {
                this.clients = data.data.datas;
                this.getCompanies();
            })
            .catch((err) => {
                console.log(err)
            })
        },

        // Get Companies list
        getCompanies: function() {
            CompanyService.getCompanies()
            .then((data) => {
                this.companies = data.data.datas;
                this.filterClients('init')
            })
            .catch((err) => {
                console.log(err)
            })
        },

        // Get Collaborators list
        getCollaborators: function() {
            CollabService.getCollabs()
            .then((data) => {
                var creatorId = ""
                if (this.audit.creator)
                    creatorId = this.audit.creator._id
                this.collaborators = data.data.datas.filter(e => e._id !== creatorId)
            })
            .catch((err) => {
                console.log(err)
            })
        },

        // Get Reviewers list
        getReviewers: function() {
            ReviewerService.getReviewers()
            .then((data) => {
                var creatorId = ""
                if (this.audit.creator)
                    creatorId = this.audit.creator._id
                this.reviewers = data.data.datas.filter(e => e._id !== creatorId)
            })
            .catch((err) => {
                console.log(err)
            })
        },

        // Get Templates list
        getTemplates: function() {
            TemplateService.getTemplates()
            .then((data) => {
                this.templates = data.data.datas;
            })
            .catch((err) => {
                console.log(err)
            })
        },

        // Get Languages list
        getLanguages: function() {
            DataService.getLanguages()
            .then((data) => {
                this.languages = data.data.datas;
            })
            .catch((err) => {
                console.log(err)
            })
        },

        // Get Audit types
        getAuditTypes: function() {
            DataService.getAuditTypes()
            .then((data) => {
                this.auditTypes = data.data.datas;
            })
            .catch((err) => {
                console.log(err)
            })
        },

        // Filter client options when selecting company
        filterClients: function(step) {
 
            //if (step !== 'init') this.audit.client = null // only reset client when company is updated
            
            if (this.audit.company && this.audit.company.name) {
                this.selectClientsFromCompany = [];
                this.clients.map(client => {
                    if (client.company && client.company.name === this.audit.company.name) this.selectClientsFromCompany.push(client)
                })
            }
            else
                this.selectClientsFromCompany = this.$_.clone(this.clients);
        },

        // Set Company when selecting client 
        setCompanyFromClient: function(value) {
            if (value && value.company) {
                for (var i=0; i<this.companies.length; i++) {
                    if (this.companies[i].name === value.company.name) {
                        this.audit.company = this.$_.clone(this.companies[i]);
                        break;
                    }
                }
            }
        },

        createSelectCompany: function(val, done) {
            var index = this.companies.findIndex(e => Utils.normalizeString(e.name) === Utils.normalizeString(val))
            if (index > -1)
                done(this.companies[index], 'add-unique')
            else
                done(val, 'add-unique')
        },
        filterSelectClient (val, update) {
            if (val === '') {
                update(() => this.selectClients = this.selectClientsFromCompany)
                return
              }
            update(() => {
                const needle = Utils.normalizeString(val)
                this.selectClients = this.$_.clone(this.selectClientsFromCompany.filter(v => Utils.normalizeString(v.email).indexOf(needle) > -1))
            })
        },
        clearClient() {
            this.audit = this.$_.clone({...this.audit, client: null})
            this.$refs.select_client.reset();
        },
        clearCompany() {
            this.audit = this.$_.clone({...this.audit, company: null})
        },
        filterSelectCompany (val, update) {
            if (val === '') {
                update(() => this.selectCompanies = this.companies)
                return
              }
            update(() => {
                const needle = Utils.normalizeString(val)
                this.selectCompanies = this.$_.clone(this.companies.filter(v => Utils.normalizeString(v.name).indexOf(needle) > -1))
            })
        }
    }
}
