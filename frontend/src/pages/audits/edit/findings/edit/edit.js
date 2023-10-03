import { Notify, Dialog } from 'quasar';

import BasicEditor from 'components/editor';
import Breadcrumb from 'components/breadcrumb';
import CvssCalculator from 'components/cvsscalculator'
import TextareaArray from 'components/textarea-array'
import CustomFields from 'components/custom-fields'

import AuditService from '@/services/audit';
import DataService from '@/services/data';
import VulnService from '@/services/vulnerability';
import Utils from '@/services/utils';
import ImportAutomatorService from '@/services/import_automator';

import { $t } from '@/boot/i18n'

export default {
    props: {
        frontEndAuditState: Number,
        parentState: String,
        parentApprovals: Array
    },
    data: () => {
        return {
            finding: {},
            findingOrig: {},
            selectedTab: "definition",
            proofsTabVisited: false,
            detailsTabVisited: false,
            vulnTypes: [],
            readyToSave:false,
            needSave:false,
            AUDIT_VIEW_STATE: Utils.AUDIT_VIEW_STATE
        }
    },

    components: {
        BasicEditor,
        Breadcrumb,
        CvssCalculator,
        TextareaArray,
        CustomFields
    },

    mounted: function() {
        this.auditId = this.$route.params.auditId;
        this.findingId = this.$route.params.findingId;
        this.getFinding();
        this.getVulnTypes();

        this.$socket.emit('menu', {menu: 'editFinding', finding: this.findingId, room: this.auditId});

        // save on ctrl+s
        document.addEventListener('keydown', this._listener, false);
    },

    destroyed: function() {
        document.removeEventListener('keydown', this._listener, false);
    },

    beforeRouteLeave (to, from , next) {
        Utils.syncEditors(this.$refs)
        if (this.unsavedChanges()) {
            Dialog.create({
            title: $t('msg.thereAreUnsavedChanges'),
            message: $t('msg.doYouWantToLeave'),
            ok: {label: $t('btn.confirm'), color: 'negative'},
            cancel: {label: $t('btn.cancel'), color: 'white'}
            })
            .onOk(() => next())

        }
        else
            next()
    },

    beforeRouteUpdate (to, from , next) {
        Utils.syncEditors(this.$refs)

        if (this.unsavedChanges()) {
            Dialog.create({
            title: $t('msg.thereAreUnsavedChanges'),
            message: $t('msg.doYouWantToLeave'),
            ok: {label: $t('btn.confirm'), color: 'negative'},
            cancel: {label: $t('btn.cancel'), color: 'white'}
            })
            .onOk(() => next())
        }
        else
            next()
    },

    computed: {
        vulnTypesLang: function() {
            return this.vulnTypes.filter(type => type.locale === this.$parent.audit.language);
        },

        screenshotsSize: function() {
            return ((JSON.stringify(this.uploadedImages).length) / 1024).toFixed(2)
        }
    },

    methods: {
        _listener: function(e) {
            if ((window.navigator.platform.match("Mac") ? e.metaKey : e.ctrlKey) && e.keyCode == 83) {
                e.preventDefault();
                if (this.frontEndAuditState === this.AUDIT_VIEW_STATE.EDIT)
                    this.updateFinding();
            }
        },

        // Get Vulnerabilities types
        getVulnTypes: function() {
            DataService.getVulnerabilityTypes()
            .then((data) => {
                this.vulnTypes = data.data.datas;
            })
            .catch((err) => {
                console.log(err)
            })
        },

        // Get Finding
        getFinding: function() {
            AuditService.getFinding(this.auditId, this.findingId)
            .then((data) => {
                this.finding = data.data.datas;
                if (this.finding.customFields && // For retrocompatibility with customField reference instead of object
                    this.finding.customFields.length > 0 && 
                    typeof (this.finding.customFields[0].customField) === 'string') 
                    this.finding.customFields = Utils.filterCustomFields('finding', this.finding.category, this.$parent.customFields, this.finding.customFields, this.$parent.audit.language)
                if (this.finding.paragraphs.length > 0 && !this.finding.poc)
                    this.finding.poc = this.convertParagraphsToHTML(this.finding.paragraphs)

                this.$nextTick(() => {
                    Utils.syncEditors(this.$refs)
                    this.findingOrig = this.$_.cloneDeep(this.finding); 
                })
            })
            .catch((err) => {
                if (!err.response)
                    console.log(err)
                else if (err.response.status === 403)
                    this.$router.push({name: '403', params: {error: err.response.data.datas}})
                else if (err.response.status === 404)
                    this.$router.push({name: '404', params: {error: err.response.data.datas}})
            })
        },

        // For retro compatibility with old paragraphs
        convertParagraphsToHTML: function(paragraphs) {
            var result = ""
            paragraphs.forEach(p => {
                result += `<p>${p.text}</p>`
                if (p.images.length > 0) {
                    p.images.forEach(img => {
                        result += `<img src="${img.image}" alt="${img.caption}" />`
                    })
                }
            })
            return result
        },

        // Update Finding
        updateFinding: function() {
            Utils.syncEditors(this.$refs)
            this.$nextTick(() => {
                if (this.$refs.customfields && this.$refs.customfields.requiredFieldsEmpty()) {
                    Notify.create({
                        message: $t('msg.fieldRequired'),
                        color: 'negative',
                        textColor:'white',
                        position: 'top-right'
                    })
                    return
                }
                
                ImportAutomatorService.setFakeCVSS(this.finding, this.$parent.audit.language);
                AuditService.updateFinding(this.auditId, this.findingId, this.finding)
                .then(() => {
                    this.findingOrig = this.$_.cloneDeep(this.finding);
                    Notify.create({
                        message: $t('msg.findingUpdateOk'),
                        color: 'positive',
                        textColor:'white',
                        position: 'top-right'
                    })
                    this.needSave=false
                })
                .catch((err) => {
                    Notify.create({
                        message: err.response.data.datas,
                        color: 'negative',
                        textColor:'white',
                        position: 'top-right'
                    })
                })
            })
        },

        deleteFinding: function() {
            Dialog.create({
                title: $t('msg.deleteFindingConfirm'),
                message: $t('msg.deleteFindingNotice'),
                ok: {label: $t('btn.confirm'), color: 'negative'},
                cancel: {label: $t('btn.cancel'), color: 'white'}
            })
            .onOk(() => {
                AuditService.deleteFinding(this.auditId, this.findingId)
                .then(() => {
                    Notify.create({
                        message: $t('msg.findingDeleteOk'),
                        color: 'positive',
                        textColor:'white',
                        position: 'top-right'
                    })
                    this.findingOrig = this.finding
                    var currentIndex = this.$parent.audit.findings.findIndex(e => e._id === this.findingId)
                    if (this.$parent.audit.findings.length === 1)
                        this.$router.push(`/audits/${this.$parent.auditId}/findings/add`)
                    else if (currentIndex === this.$parent.audit.findings.length - 1)
                        this.$router.push(`/audits/${this.$parent.auditId}/findings/${this.$parent.audit.findings[currentIndex - 1]._id}`)
                    else
                        this.$router.push(`/audits/${this.$parent.auditId}/findings/${this.$parent.audit.findings[currentIndex + 1]._id}`)
                })
                .catch((err) => {
                    Notify.create({
                        message: err.response.data.datas,
                        color: 'negative',
                        textColor:'white',
                        position: 'top-right'
                    })
                })
            })
        },

         // Backup Finding to vulnerability database
        backupFinding: function() {
            Utils.syncEditors(this.$refs)
            VulnService.backupFinding(this.$parent.audit.language, this.finding)
            .then((data) => {
                Notify.create({
                    message: data.data.datas,
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
            .catch((err) => {
                Notify.create({
                    message: err.response.data.datas,
                    color: 'negative',
                    textColor:'white',
                    position: 'top-right'
                })
            })
        },

        syncEditors: function() {
            Utils.syncEditors(this.$refs)
        },

        updateOrig: function() {
            if (this.selectedTab === 'proofs' && !this.proofsTabVisited){
                Utils.syncEditors(this.$refs)
                this.findingOrig.poc = this.finding.poc
                this.proofsTabVisited = true
            }
            else if (this.selectedTab === 'details' && !this.detailsTabVisited){
                Utils.syncEditors(this.$refs)
                this.findingOrig.remediation = this.finding.remediation
                this.detailsTabVisited = true
            }
        },
        unsavedChanges: function() {
            return this.needSave
        }
    }
}